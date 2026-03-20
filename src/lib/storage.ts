import type { LabelRef, Release, SourceMode, TimeMode } from '../../shared/types';

const LABELS_KEY = 'labelsearch.labels';
const SETTINGS_KEY = 'labelsearch.settings';
const RESULTS_KEY = 'labelsearch.lastResults';

export interface Settings {
  timeMode: TimeMode;
  timeValue: number;
  country: string;
  sourceMode: SourceMode;
  discogsToken: string;
}

const defaultSettings: Settings = {
  timeMode: 'days',
  timeValue: 7,
  country: 'DE',
  sourceMode: 'discogs',
  discogsToken: ''
};

function toSourceMode(value: unknown): SourceMode {
  if (value === 'hybrid' || value === 'musicbrainz' || value === 'discogs') {
    return value;
  }
  return defaultSettings.sourceMode;
}

export function loadLabels(): LabelRef[] {
  try {
    const data = localStorage.getItem(LABELS_KEY);
    if (!data) {
      return [];
    }
    const parsed = JSON.parse(data) as LabelRef[];
    return parsed.filter((entry) => entry.mbid && entry.name);
  } catch {
    return [];
  }
}

export function saveLabels(labels: LabelRef[]): void {
  localStorage.setItem(LABELS_KEY, JSON.stringify(labels));
}

export function loadSettings(): Settings {
  try {
    const data = localStorage.getItem(SETTINGS_KEY);
    if (!data) {
      return defaultSettings;
    }
    const parsed = JSON.parse(data) as Partial<Settings> & { daysBack?: number };
    return {
      ...defaultSettings,
      ...parsed,
      timeMode: parsed.timeMode ?? 'days',
      timeValue: parsed.timeValue ?? parsed.daysBack ?? defaultSettings.timeValue,
      sourceMode: toSourceMode(parsed.sourceMode),
      discogsToken: typeof parsed.discogsToken === 'string' ? parsed.discogsToken : ''
    };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadResults(): Release[] {
  try {
    const data = localStorage.getItem(RESULTS_KEY);
    if (!data) {
      return [];
    }
    return JSON.parse(data) as Release[];
  } catch {
    return [];
  }
}

export function saveResults(results: Release[]): void {
  localStorage.setItem(RESULTS_KEY, JSON.stringify(results));
}
