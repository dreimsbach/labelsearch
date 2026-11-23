import { ALL_SOURCES, DEFAULT_SOURCES } from '../../shared/types';
import type { FeedSettings, LabelRef, SourceId, TimeMode } from '../../shared/types';

// Before the server-side feed, labels and settings lived in the browser. They are read once
// to migrate them to the server; afterwards the server is the source of truth.
const LEGACY_LABELS_KEY = 'labelsearch.labels';
const LEGACY_SETTINGS_KEY = 'labelsearch.settings';
const LEGACY_RESULTS_KEY = 'labelsearch.lastResults';
const MIGRATED_KEY = 'labelsearch.migratedToServer';
const LAST_VISIT_KEY = 'labelsearch.lastVisit';
const SPECIAL_SEARCH_KEY = 'labelsearch.specialSearch';

/** Stable identity for a label in the list (MBID when known, otherwise the name). */
export function labelKey(label: LabelRef): string {
  return label.mbid ?? `name:${label.name.trim().toLowerCase()}`;
}

function read<T>(key: string): T | undefined {
  try {
    const data = localStorage.getItem(key);
    return data ? (JSON.parse(data) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: nothing is remembered in this browser
  }
}

/** Labels and settings from the browser that still need to move to the server, if any. */
export function takeLegacyConfig(): { labels: LabelRef[]; settings: Partial<FeedSettings> } | null {
  if (read<boolean>(MIGRATED_KEY)) {
    return null;
  }
  const labels = (read<LabelRef[]>(LEGACY_LABELS_KEY) ?? [])
    .filter((entry) => typeof entry?.name === 'string' && entry.name.trim())
    .map((entry) => ({ name: entry.name, mbid: entry.mbid || undefined }));
  const settings = read<Partial<FeedSettings>>(LEGACY_SETTINGS_KEY) ?? {};
  const sources = Array.isArray(settings.sources)
    ? settings.sources.filter((entry): entry is SourceId => ALL_SOURCES.includes(entry))
    : undefined;
  return labels.length > 0 ? { labels, settings: { ...settings, sources } } : null;
}

export function markLegacyMigrated(): void {
  write(MIGRATED_KEY, true);
  try {
    localStorage.removeItem(LEGACY_RESULTS_KEY);
  } catch {
    // ignore
  }
}

/** Last form of the special search (one-off searches outside the feed); kept per browser only. */
export interface SpecialSearchForm {
  label: string;
  mode: TimeMode;
  /** Raw input text, validated when the search starts (so a year can be typed digit by digit). */
  days: string;
  year: string;
  sources: SourceId[];
}

export function readSpecialSearchForm(): SpecialSearchForm {
  const stored = read<Partial<SpecialSearchForm>>(SPECIAL_SEARCH_KEY) ?? {};
  const sources = Array.isArray(stored.sources) ? stored.sources.filter((entry): entry is SourceId => ALL_SOURCES.includes(entry)) : [];
  return {
    label: typeof stored.label === 'string' ? stored.label : '',
    mode: stored.mode === 'year' ? 'year' : 'days',
    days: typeof stored.days === 'string' ? stored.days : '30',
    year: typeof stored.year === 'string' ? stored.year : String(new Date().getFullYear()),
    sources: sources.length > 0 ? sources : DEFAULT_SOURCES
  };
}

export function saveSpecialSearchForm(form: SpecialSearchForm): void {
  write(SPECIAL_SEARCH_KEY, form);
}

/** Returns the previous visit timestamp (for "new" badges) and records this visit. */
export function takeLastVisit(): string | null {
  const previous = read<string>(LAST_VISIT_KEY) ?? null;
  write(LAST_VISIT_KEY, new Date().toISOString());
  return previous;
}
