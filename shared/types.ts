export type SourceId = 'deezer' | 'musicbrainz' | 'discogs';
export type TimeMode = 'days' | 'year';

export type ReleaseType = 'Album' | 'Single' | 'EP';

export const ALL_SOURCES: SourceId[] = ['deezer', 'musicbrainz', 'discogs'];
export const DEFAULT_SOURCES: SourceId[] = ['deezer', 'musicbrainz'];

export interface LabelRef {
  name: string;
  /** MusicBrainz label id; optional because Deezer/Discogs work by name. */
  mbid?: string;
}

export interface SearchRequest {
  labels: LabelRef[];
  timeMode: TimeMode;
  timeValue: number;
  country: string;
  sources: SourceId[];
  timezone: string;
  /** Optional per-request override; otherwise the server's DISCOGS_TOKEN is used. */
  discogsToken?: string;
}

export interface LabelFailure {
  label: LabelRef;
  source?: SourceId | 'itunes';
  message: string;
}

export interface ExternalLink {
  label: string;
  url: string;
  source: 'musicbrainz' | 'itunes' | 'deezer' | 'discogs';
}

export interface Release {
  id: string;
  artist: string;
  title: string;
  releaseDate: string;
  genres: string[];
  styles?: string[];
  labels: string[];
  type: ReleaseType;
  status?: string;
  country?: string;
  barcode?: string;
  packaging?: string;
  trackCount?: number;
  mediaFormat?: string;
  coverUrl?: string;
  appleArtistUrl?: string;
  appleAlbumUrl?: string;
  deezerAlbumUrl?: string;
  discogsReleaseUrl?: string;
  externalLinks?: ExternalLink[];
  sourceDetails: {
    musicbrainzReleaseId?: string;
    musicbrainzReleaseGroupId?: string;
    itunesCollectionId?: number;
    deezerAlbumId?: number;
    discogsReleaseId?: number;
  };
  matchedByLabel: string[];
  /** Primary sources that reported this release for a label. */
  foundBy: SourceId[];
  /** When the daily feed first saw this release (ISO timestamp); only set on feed snapshots. */
  firstSeenAt?: string;
}

export interface SearchMeta {
  sources: SourceId[];
  timeMode: TimeMode;
  timeValue: number;
  country: string;
  fromDate: string;
  toDate: string;
  searchedAt: string;
  partialFailures: LabelFailure[];
}

export interface SearchResponse {
  releases: Release[];
  meta: SearchMeta;
}

/**
 * NDJSON events of `POST /api/releases/stream`.
 * `releases` events upsert by `Release.id` (enriched versions are re-sent with the same id).
 */
export type SearchEvent =
  | { type: 'start'; fromDate: string; toDate: string; totalLabels: number }
  | { type: 'releases'; label: LabelRef; releases: Release[] }
  | { type: 'failure'; failure: LabelFailure }
  | { type: 'labelDone'; label: LabelRef; completed: number; totalLabels: number }
  | { type: 'done'; meta: SearchMeta }
  | { type: 'error'; message: string };

/** Search settings the daily feed run uses. The feed always checks the last `days` days. */
export interface FeedSettings {
  days: number;
  country: string;
  sources: SourceId[];
}

export type RunTrigger = 'schedule' | 'manual';

export interface FeedSnapshot {
  releases: Release[];
  meta: SearchMeta;
  trigger: RunTrigger;
  finishedAt: string;
}

export interface FeedRun {
  running: boolean;
  trigger?: RunTrigger;
  startedAt?: string;
  completed: number;
  total: number;
  /** Releases found so far by the running run (shown while no snapshot exists yet). */
  releases: Release[];
  failures: LabelFailure[];
  error?: string;
}

export interface FeedSchedule {
  enabled: boolean;
  /** Local time `HH:MM` in `timezone`. */
  time: string;
  timezone: string;
  /** Local day (`YYYY-MM-DD`) of the next scheduled run. */
  nextRunDay?: string;
}

export interface FeedState {
  labels: LabelRef[];
  settings: FeedSettings;
  snapshot: FeedSnapshot | null;
  run: FeedRun;
  schedule: FeedSchedule;
  /** Releases stay in the feed this many days after their release date. */
  retentionDays: number;
  discogsTokenConfigured: boolean;
}

export interface FeedConfigUpdate {
  labels?: LabelRef[];
  settings?: Partial<FeedSettings>;
}

export interface LabelSearchResult {
  id: string;
  name: string;
  country?: string;
  disambiguation?: string;
}

export interface HealthResponse {
  ok: true;
  now: string;
}
