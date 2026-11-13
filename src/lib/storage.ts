import { ALL_SOURCES, DEFAULT_SOURCES } from '../../shared/types';
import type { LabelRef, Release, SourceId, TimeMode } from '../../shared/types';

const LABELS_KEY = 'labelsearch.labels';
const SETTINGS_KEY = 'labelsearch.settings';
const RESULTS_KEY = 'labelsearch.lastResults';

export interface Settings {
  timeMode: TimeMode;
  timeValue: number;
  country: string;
  sources: SourceId[];
  discogsToken: string;
}

const defaultSettings: Settings = {
  timeMode: 'days',
  timeValue: 7,
  country: 'DE',
  sources: DEFAULT_SOURCES,
  discogsToken: ''
};

/** Stable identity for a label in the list (MBID when known, otherwise the name). */
export function labelKey(label: LabelRef): string {
  return label.mbid ?? `name:${label.name.trim().toLowerCase()}`;
}

function toSources(value: unknown): SourceId[] {
  if (!Array.isArray(value)) {
    // Settings from before the source checkboxes (`sourceMode`) start with the new defaults.
    return defaultSettings.sources;
  }
  const sources = value.filter((entry): entry is SourceId => ALL_SOURCES.includes(entry));
  return sources.length > 0 ? sources : defaultSettings.sources;
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
    // storage full or unavailable: settings simply aren't remembered
  }
}

export function loadLabels(): LabelRef[] {
  const parsed = read<LabelRef[]>(LABELS_KEY) ?? [];
  return parsed
    .filter((entry) => typeof entry?.name === 'string' && entry.name.trim())
    .map((entry) => ({ name: entry.name, mbid: entry.mbid || undefined }));
}

export function saveLabels(labels: LabelRef[]): void {
  write(LABELS_KEY, labels);
}

export function loadSettings(): Settings {
  const parsed = read<Partial<Settings> & { daysBack?: number }>(SETTINGS_KEY);
  if (!parsed) {
    return defaultSettings;
  }
  return {
    timeMode: parsed.timeMode === 'year' ? 'year' : 'days',
    timeValue: parsed.timeValue ?? parsed.daysBack ?? defaultSettings.timeValue,
    country: parsed.country ?? defaultSettings.country,
    sources: toSources(parsed.sources),
    discogsToken: typeof parsed.discogsToken === 'string' ? parsed.discogsToken : ''
  };
}

export function saveSettings(settings: Settings): void {
  write(SETTINGS_KEY, settings);
}

export function loadResults(): Release[] {
  const releases = read<Release[]>(RESULTS_KEY) ?? [];
  // Results cached by older versions lack `foundBy`.
  return releases.map((release) => ({ ...release, foundBy: release.foundBy ?? [] }));
}

export function saveResults(results: Release[]): void {
  write(RESULTS_KEY, results);
}
