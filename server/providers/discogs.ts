import { fetchJson } from '../lib/http.js';
import type { ExternalCandidate } from '../lib/match.js';
import { RateLimiter } from '../lib/throttle.js';

interface DiscogsPayload {
  pagination?: {
    page?: number;
    pages?: number;
    per_page?: number;
    items?: number;
  };
  results?: Array<{
    id: number;
    title?: string;
    year?: number;
    resource_url?: string;
    cover_image?: string;
  }>;
}

function userAgent(): string {
  return process.env.DISCOGS_USER_AGENT ?? 'label-release-tracker/0.1.0';
}

const discogsRetryDelaysMs = [1500, 4000, 8000];
const discogsAuthLimiter = new RateLimiter(1100);
const discogsAnonLimiter = new RateLimiter(2600);

function resolveToken(requestToken?: string): string | undefined {
  const value = requestToken?.trim();
  if (value) {
    return value;
  }
  const env = process.env.DISCOGS_TOKEN?.trim();
  return env || undefined;
}

function limiterForToken(token?: string): RateLimiter {
  return token ? discogsAuthLimiter : discogsAnonLimiter;
}

export interface DiscogsSearchRelease {
  id: number;
  title?: string;
  year?: number;
  resourceUrl?: string;
  coverImage?: string;
}

interface DiscogsReleasePayload {
  id: number;
  title?: string;
  released?: string;
  year?: number;
  country?: string;
  uri?: string;
  thumb?: string;
  images?: Array<{
    type?: string;
    uri?: string;
    resource_url?: string;
  }>;
  artists_sort?: string;
  artists?: Array<{
    name?: string;
  }>;
  genres?: string[];
  styles?: string[];
  formats?: Array<{
    name?: string;
    descriptions?: string[];
  }>;
  tracklist?: Array<{
    type_?: string;
    title?: string;
  }>;
}

export interface DiscogsReleaseDetail {
  id: number;
  title: string;
  artist: string;
  released?: string;
  year?: number;
  country?: string;
  uri?: string;
  thumb?: string;
  genres: string[];
  styles: string[];
  formatDescriptions: string[];
  trackCount?: number;
}

function toLargeDiscogsImage(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }

  return url
    .replace(/\/q:\d+\//i, '/q:90/')
    .replace(/\/h:\d+\//i, '/h:600/')
    .replace(/\/w:\d+\//i, '/w:600/');
}

function splitArtistAndTitle(value?: string): { artist: string; title: string } {
  const raw = value ?? '';
  const parts = raw.split(' - ');
  if (parts.length >= 2) {
    return {
      artist: parts[0].trim() || 'Unknown Artist',
      title: parts.slice(1).join(' - ').trim() || raw.trim()
    };
  }

  return { artist: 'Unknown Artist', title: raw.trim() };
}

export async function findDiscogsCandidates(artist: string, title: string, requestToken?: string): Promise<ExternalCandidate[]> {
  const queries: Record<string, string>[] = [
    { artist, release_title: title },
    { release_title: title },
    { artist }
  ];
  const seen = new Map<number, ExternalCandidate>();

  for (const query of queries) {
    const candidates = await search(query, requestToken);
    for (const candidate of candidates) {
      if (!seen.has(candidate.id)) {
        seen.set(candidate.id, candidate);
      }
    }
  }

  return [...seen.values()];
}

async function search(query: Record<string, string>, requestToken?: string): Promise<ExternalCandidate[]> {
  const payload = await searchDatabase(query, 1, requestToken);

  return (payload.results ?? []).map((entry) => {
    const split = splitArtistAndTitle(entry.title);
    return {
      source: 'discogs',
      id: entry.id,
      artistName: split.artist,
      collectionName: split.title,
      releaseDate: entry.year ? `${entry.year}-01-01` : undefined,
      albumUrl: entry.resource_url,
      artworkUrl: entry.cover_image
    };
  });
}

async function searchDatabase(query: Record<string, string>, page = 1, requestToken?: string): Promise<DiscogsPayload> {
  const url = new URL('https://api.discogs.com/database/search');
  url.searchParams.set('type', 'release');
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', '100');

  for (const [key, value] of Object.entries(query)) {
    if (value.trim()) {
      url.searchParams.set(key, value.trim());
    }
  }

  const token = resolveToken(requestToken);
  if (token) {
    url.searchParams.set('token', token);
  }

  return withDiscogsRetry(() =>
    limiterForToken(token).schedule(() =>
      fetchJson<DiscogsPayload>(url.toString(), {
        headers: {
          'User-Agent': userAgent()
        }
      })
    )
  );
}

export async function searchDiscogsByLabelYear(label: string, year: number, requestToken?: string): Promise<DiscogsSearchRelease[]> {
  const query = {
    label,
    year: String(year)
  };

  const first = await searchDatabase(query, 1, requestToken);
  const pages = Math.max(1, first.pagination?.pages ?? 1);
  const seen = new Map<number, DiscogsSearchRelease>();

  const collect = (payload: DiscogsPayload): void => {
    for (const entry of payload.results ?? []) {
      if (!seen.has(entry.id)) {
        seen.set(entry.id, {
          id: entry.id,
          title: entry.title,
          year: entry.year,
          resourceUrl: entry.resource_url,
          coverImage: entry.cover_image
        });
      }
    }
  };

  collect(first);

  for (let page = 2; page <= pages; page += 1) {
    const payload = await searchDatabase(query, page, requestToken);
    collect(payload);
  }

  return [...seen.values()];
}

export async function fetchDiscogsRelease(id: number, requestToken?: string): Promise<DiscogsReleaseDetail> {
  const token = resolveToken(requestToken);
  const url = new URL(`https://api.discogs.com/releases/${id}`);
  if (token) {
    url.searchParams.set('token', token);
  }

  const payload = await withDiscogsRetry(() =>
    limiterForToken(token).schedule(() =>
      fetchJson<DiscogsReleasePayload>(url.toString(), {
        headers: {
          'User-Agent': userAgent()
        }
      })
    )
  );

  const primaryImage =
    payload.images?.find((entry) => entry.type === 'primary')?.uri ??
    payload.images?.[0]?.uri ??
    payload.images?.find((entry) => entry.type === 'primary')?.resource_url ??
    payload.images?.[0]?.resource_url;

  const formatDescriptions = (payload.formats ?? [])
    .flatMap((entry) => entry.descriptions ?? [])
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const tracks = (payload.tracklist ?? []).filter(
    (entry) => entry.type_ === 'track' && Boolean(entry.title?.trim())
  );

  return {
    id: payload.id,
    title: payload.title?.trim() || 'Unknown Title',
    artist: payload.artists_sort?.trim() || payload.artists?.[0]?.name?.trim() || 'Unknown Artist',
    released: payload.released?.trim() || undefined,
    year: payload.year,
    country: payload.country,
    uri: payload.uri,
    thumb: primaryImage || toLargeDiscogsImage(payload.thumb) || undefined,
    genres: payload.genres ?? [],
    styles: payload.styles ?? [],
    formatDescriptions,
    trackCount: tracks.length > 0 ? tracks.length : undefined
  };
}

function isDiscogsRateLimitError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('HTTP 429') && error.message.includes('api.discogs.com');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withDiscogsRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= discogsRetryDelaysMs.length; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isDiscogsRateLimitError(error) || attempt === discogsRetryDelaysMs.length) {
        throw error;
      }
      await sleep(discogsRetryDelaysMs[attempt]);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unknown Discogs error');
}
