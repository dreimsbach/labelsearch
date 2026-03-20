export type SourceMode = 'hybrid' | 'itunes' | 'musicbrainz' | 'discogs';
export type TimeMode = 'days' | 'year';

export type ReleaseType = 'Album' | 'Single' | 'EP';

export interface LabelRef {
  mbid: string;
  name: string;
}

export interface SearchRequest {
  labels: LabelRef[];
  timeMode: TimeMode;
  timeValue: number;
  country: string;
  sourceMode: SourceMode;
  timezone: string;
}

export interface LabelFailure {
  label: LabelRef;
  message: string;
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
  externalLinks?: Array<{
    label: string;
    url: string;
    source: 'musicbrainz' | 'itunes' | 'deezer' | 'discogs';
  }>;
  sourceDetails: {
    musicbrainzReleaseId?: string;
    musicbrainzReleaseGroupId?: string;
    itunesCollectionId?: number;
    deezerAlbumId?: number;
    discogsReleaseId?: number;
  };
  matchedByLabel: string[];
  matchConfidence: 'high' | 'none';
  matchedBy: 'itunes' | 'musicbrainz' | 'hybrid' | 'hybrid-deezer' | 'hybrid-discogs' | 'discogs';
}

export interface SearchResponse {
  releases: Release[];
  meta: {
    sourceMode: SourceMode;
    timeMode: TimeMode;
    timeValue: number;
    country: string;
    fromDate: string;
    toDate: string;
    searchedAt: string;
    partialFailures: LabelFailure[];
  };
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
