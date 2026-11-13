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
