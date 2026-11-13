import { mergeReleases, normalizeText } from '../shared/merge.js';
import { ALL_SOURCES, DEFAULT_SOURCES } from '../shared/types.js';
import type {
  FeedConfigUpdate,
  FeedRun,
  FeedSchedule,
  FeedSettings,
  FeedSnapshot,
  FeedState,
  LabelRef,
  Release,
  RunTrigger,
  SearchRequest,
  SourceId
} from '../shared/types.js';
import { readJsonFile, writeJsonFile } from './lib/json-file.js';
import { logError, logInfo } from './lib/logger.js';
import { buildMeta, searchReleases } from './release-service.js';

const MAX_LABELS = 500;
const FIRST_SEEN_RETENTION_DAYS = 400;
const SCHEDULER_INTERVAL_MS = 60_000;

const DEFAULT_SETTINGS: FeedSettings = { timeMode: 'days', timeValue: 7, country: 'DE', sources: DEFAULT_SOURCES };

interface PersistedState {
  labels: LabelRef[];
  settings: FeedSettings;
  snapshot: FeedSnapshot | null;
  /** release identity -> ISO timestamp of the run that first found it */
  firstSeen: Record<string, string>;
  /** local day of the last scheduled run, so each day runs once */
  lastScheduledDay?: string;
}

export interface ScheduleConfig {
  enabled: boolean;
  time: string;
  timezone: string;
}

export interface FeedOptions {
  filePath?: string;
  schedule: ScheduleConfig;
  search?: typeof searchReleases;
  now?: () => Date;
}

// ---------- pure helpers ----------

export function localClock(now: Date, timezone: string): { day: string; time: string } {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  return { day, time };
}

function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** Due once per local day as soon as the configured time has passed (also catches up after downtime). */
export function isRunDue(now: Date, schedule: ScheduleConfig, lastScheduledDay?: string): boolean {
  if (!schedule.enabled) {
    return false;
  }
  const clock = localClock(now, schedule.timezone);
  return clock.time >= schedule.time && lastScheduledDay !== clock.day;
}

export function nextRunDay(now: Date, schedule: ScheduleConfig, lastScheduledDay?: string): string | undefined {
  if (!schedule.enabled) {
    return undefined;
  }
  const today = localClock(now, schedule.timezone).day;
  return lastScheduledDay === today ? addDays(today, 1) : today;
}

export function releaseIdentity(release: Release): string {
  return `${normalizeText(release.artist)}::${normalizeText(release.title)}`;
}

/** Sets `firstSeenAt` from the history (recording unseen releases) and prunes old history entries. */
export function stampFirstSeen(releases: Release[], firstSeen: Record<string, string>, nowIso: string): Release[] {
  const stamped = releases.map((release) => {
    const key = releaseIdentity(release);
    firstSeen[key] ??= nowIso;
    return { ...release, firstSeenAt: firstSeen[key] };
  });

  const cutoff = new Date(Date.parse(nowIso) - FIRST_SEEN_RETENTION_DAYS * 86_400_000).toISOString();
  for (const [key, seenAt] of Object.entries(firstSeen)) {
    if (seenAt < cutoff) {
      delete firstSeen[key];
    }
  }
  return stamped;
}

export function sanitizeLabels(input: unknown): LabelRef[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set<string>();
  const labels: LabelRef[] = [];
  for (const entry of input as Array<Partial<LabelRef>>) {
    const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
    if (!name) {
      continue;
    }
    const mbid = typeof entry.mbid === 'string' && entry.mbid ? entry.mbid : undefined;
    const key = mbid ?? `name:${name.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      labels.push({ name, mbid });
    }
  }
  return labels.slice(0, MAX_LABELS);
}

export function sanitizeSettings(input: Partial<FeedSettings> | undefined, current: FeedSettings): FeedSettings {
  const next = { ...current };
  if (!input) {
    return next;
  }
  if (input.timeMode === 'days' || input.timeMode === 'year') {
    next.timeMode = input.timeMode;
  }
  const value = Number(input.timeValue);
  if (Number.isFinite(value)) {
    next.timeValue = Math.trunc(value);
  }
  const [min, max, fallback] = next.timeMode === 'days' ? [1, 3650, 7] : [1900, 2100, new Date().getFullYear()];
  if (next.timeValue < min || next.timeValue > max) {
    next.timeValue = fallback;
  }
  if (typeof input.country === 'string' && /^[a-z]{2}$/i.test(input.country)) {
    next.country = input.country.toUpperCase();
  }
  if (Array.isArray(input.sources)) {
    const sources = input.sources.filter((source): source is SourceId => ALL_SOURCES.includes(source));
    if (sources.length > 0) {
      next.sources = sources;
    }
  }
  return next;
}

function idleRun(): FeedRun {
  return { running: false, completed: 0, total: 0, releases: [], failures: [] };
}

// ---------- feed ----------

export class Feed {
  private state: PersistedState = { labels: [], settings: DEFAULT_SETTINGS, snapshot: null, firstSeen: {} };
  private run: FeedRun = idleRun();
  private current: Promise<void> | null = null;
  private timer: NodeJS.Timeout | undefined;
  private readonly search: typeof searchReleases;
  private readonly now: () => Date;

  constructor(private readonly options: FeedOptions) {
    this.search = options.search ?? searchReleases;
    this.now = options.now ?? (() => new Date());
  }

  async load(): Promise<void> {
    if (!this.options.filePath) {
      return;
    }
    const stored = await readJsonFile<Partial<PersistedState>>(this.options.filePath);
    if (stored) {
      this.state = {
        labels: sanitizeLabels(stored.labels),
        settings: sanitizeSettings(stored.settings, DEFAULT_SETTINGS),
        snapshot: stored.snapshot ?? null,
        firstSeen: stored.firstSeen ?? {},
        lastScheduledDay: stored.lastScheduledDay
      };
    }
  }

  private async persist(): Promise<void> {
    if (this.options.filePath) {
      await writeJsonFile(this.options.filePath, this.state);
    }
  }

  getState(): FeedState {
    const schedule: FeedSchedule = {
      enabled: this.options.schedule.enabled,
      time: this.options.schedule.time,
      timezone: this.options.schedule.timezone,
      nextRunDay: nextRunDay(this.now(), this.options.schedule, this.state.lastScheduledDay)
    };
    return {
      labels: this.state.labels,
      settings: this.state.settings,
      snapshot: this.state.snapshot,
      run: this.run,
      schedule,
      discogsTokenConfigured: Boolean(process.env.DISCOGS_TOKEN?.trim())
    };
  }

  async updateConfig(update: FeedConfigUpdate): Promise<FeedState> {
    if (update.labels !== undefined) {
      this.state.labels = sanitizeLabels(update.labels);
    }
    if (update.settings !== undefined) {
      this.state.settings = sanitizeSettings(update.settings, this.state.settings);
    }
    await this.persist();
    return this.getState();
  }

  /** Starts a run unless one is already in progress. Returns whether a new run started. */
  startRun(trigger: RunTrigger): boolean {
    if (this.current) {
      return false;
    }
    this.current = this.execute(trigger).finally(() => {
      this.current = null;
    });
    return true;
  }

  /** Resolves when the current run (if any) has finished. */
  async whenIdle(): Promise<void> {
    await this.current;
  }

  private async execute(trigger: RunTrigger): Promise<void> {
    const labels = this.state.labels;
    const settings = this.state.settings;
    const startedAt = this.now().toISOString();
    this.run = { ...idleRun(), running: true, trigger, startedAt, total: labels.length };

    if (trigger === 'schedule') {
      this.state.lastScheduledDay = localClock(this.now(), this.options.schedule.timezone).day;
    }
    if (labels.length === 0) {
      this.run = idleRun();
      await this.persist();
      return;
    }

    const request: SearchRequest = { labels, ...settings, timezone: this.options.schedule.timezone };
    // Keyed per label so a release found for two labels keeps both label names.
    const byKey = new Map<string, Release>();
    void logInfo('Feed run started', { trigger, labels: labels.length });

    try {
      const result = await this.search(request, (event) => {
        if (event.type === 'releases') {
          const labelKey = event.label.mbid ?? event.label.name.toLowerCase();
          event.releases.forEach((release) => byKey.set(`${labelKey}::${release.id}`, release));
          this.run = { ...this.run, releases: mergeReleases([...byKey.values()]) };
        } else if (event.type === 'failure') {
          this.run = { ...this.run, failures: [...this.run.failures, event.failure] };
        } else if (event.type === 'labelDone') {
          this.run = { ...this.run, completed: event.completed };
        }
      });

      const finishedAt = this.now().toISOString();
      this.state.snapshot = {
        releases: stampFirstSeen(result.releases, this.state.firstSeen, finishedAt),
        meta: buildMeta(request, result),
        trigger,
        finishedAt
      };
      this.run = idleRun();
      void logInfo('Feed run finished', { trigger, releases: result.releases.length, failures: result.partialFailures.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.run = { ...idleRun(), error: message };
      void logError('Feed run failed', { trigger, error: message });
    }
    await this.persist();
  }

  /** Scheduler check; runs at most once per local day after the configured time. */
  tick(): void {
    if (!this.current && isRunDue(this.now(), this.options.schedule, this.state.lastScheduledDay)) {
      this.startRun('schedule');
    }
  }

  startScheduler(): void {
    if (!this.options.schedule.enabled || this.timer) {
      return;
    }
    this.tick();
    this.timer = setInterval(() => this.tick(), SCHEDULER_INTERVAL_MS);
    this.timer.unref();
  }
}

/** Reads `SCHEDULE_TIME` (`HH:MM`, or `off`) and `SCHEDULE_TIMEZONE`. */
export function scheduleFromEnv(env: NodeJS.ProcessEnv = process.env): ScheduleConfig {
  const raw = (env.SCHEDULE_TIME ?? '06:00').trim().toLowerCase();
  const timezone = env.SCHEDULE_TIMEZONE?.trim() || 'Europe/Berlin';
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (raw === 'off' || !match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    return { enabled: false, time: '06:00', timezone };
  }
  return { enabled: true, time: `${match[1].padStart(2, '0')}:${match[2]}`, timezone };
}
