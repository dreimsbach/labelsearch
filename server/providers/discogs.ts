import { DAY, HOUR, cached } from '../lib/cache.js';
import { fetchJson } from '../lib/http.js';
import { normalizeLabelName } from '../lib/labels.js';
import { RateLimiter } from '../lib/limiter.js';

/** Discogs: 60 req/min authenticated, 25 req/min anonymous (moving window). */
const authLimiter = new RateLimiter('discogs-auth', 55, 60_000);
const anonLimiter = new RateLimiter('discogs-anon', 22, 60_000);
const MAX_LISTING_PAGES = 10;

function userAgent(): string {
  return process.env.DISCOGS_USER_AGENT ?? 'example-app/0.0.0';
}

export function resolveDiscogsToken(requestToken?: string): string | undefined {
  return requestToken?.trim() || process.env.DISCOGS_TOKEN?.trim() || undefined;
}

function discogsJson<T>(url: URL, token?: string): Promise<T> {
  return fetchJson<T>(url.toString(), {
    limiter: token ? authLimiter : anonLimiter,
    headers: {
      'User-Agent': userAgent(),
      ...(token ? { Authorization: `Discogs token=${token}` } : {})
    }
  });
}

interface DiscogsLabelSearchPayload {
  results?: Array<{ id: number; title?: string }>;
}

interface DiscogsLabelReleasesPayload {
  pagination?: { page?: number; pages?: number };
  releases?: Array<{ id: number; year?: number; title?: string; artist?: string }>;
}

export interface DiscogsListingEntry {
  id: number;
  year?: number;
}

interface DiscogsReleasePayload {
  id: number;
  title?: string;
  released?: string;
  year?: number;
  country?: string;
  uri?: string;
  thumb?: string;
  images?: Array<{ type?: string; uri?: string; resource_url?: string }>;
  artists_sort?: string;
  artists?: Array<{ name?: string }>;
  genres?: string[];
  styles?: string[];
  formats?: Array<{ name?: string; descriptions?: string[] }>;
  tracklist?: Array<{ type_?: string; title?: string }>;
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
  return url.replace(/\/q:\d+\//i, '/q:90/').replace(/\/h:\d+\//i, '/h:600/').replace(/\/w:\d+\//i, '/w:600/');
}

/** Discogs label id by exact (normalized) name; `null` when no unambiguous match exists. */
export async function findDiscogsLabelIdByName(name: string, requestToken?: string): Promise<number | null> {
  const token = resolveDiscogsToken(requestToken);
  return cached(`discogs:label-id:${name.toLowerCase()}`, 30 * DAY, async () => {
    const url = new URL('https://api.discogs.com/database/search');
    url.searchParams.set('type', 'label');
    url.searchParams.set('q', name);
    url.searchParams.set('per_page', '25');
    const payload = await discogsJson<DiscogsLabelSearchPayload>(url, token);
    const results = payload.results ?? [];
    const exact = results.find((entry) => entry.title?.trim().toLowerCase() === name.trim().toLowerCase());
    if (exact) {
      return exact.id;
    }
    const target = normalizeLabelName(name);
    return results.find((entry) => normalizeLabelName(entry.title ?? '') === target)?.id ?? null;
  });
}

/** Releases listed on the label page (exact label, no fuzzy name search), filtered by year. */
export async function listLabelReleases(labelId: number, years: number[], requestToken?: string): Promise<DiscogsListingEntry[]> {
  const token = resolveDiscogsToken(requestToken);
  const all = await cached(`discogs:label-releases:${labelId}`, 6 * HOUR, async () => {
    const entries: DiscogsListingEntry[] = [];
    for (let page = 1; page <= MAX_LISTING_PAGES; page += 1) {
      const url = new URL(`https://api.discogs.com/labels/${labelId}/releases`);
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', String(page));
      const payload = await discogsJson<DiscogsLabelReleasesPayload>(url, token);
      (payload.releases ?? []).forEach((entry) => entries.push({ id: entry.id, year: entry.year }));
      if (page >= (payload.pagination?.pages ?? 1)) {
        break;
      }
    }
    return entries;
  });

  const seen = new Set<number>();
  return all.filter((entry) => {
    if (seen.has(entry.id) || !entry.year || !years.includes(entry.year)) {
      return false;
    }
    seen.add(entry.id);
    return true;
  });
}

export async function fetchDiscogsRelease(id: number, requestToken?: string): Promise<DiscogsReleaseDetail> {
  const token = resolveDiscogsToken(requestToken);
  return cached(
    `discogs:release:${id}`,
    (detail) => (detail.released && Date.now() - Date.parse(detail.released) < 30 * DAY ? DAY : 14 * DAY),
    async () => {
      const payload = await discogsJson<DiscogsReleasePayload>(new URL(`https://api.discogs.com/releases/${id}`), token);

      const primary = payload.images?.find((entry) => entry.type === 'primary') ?? payload.images?.[0];
      const formatDescriptions = (payload.formats ?? [])
        .flatMap((entry) => entry.descriptions ?? [])
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      const tracks = (payload.tracklist ?? []).filter((entry) => entry.type_ === 'track' && Boolean(entry.title?.trim()));

      return {
        id: payload.id,
        title: payload.title?.trim() || 'Unknown Title',
        artist: payload.artists_sort?.trim() || payload.artists?.[0]?.name?.trim() || 'Unknown Artist',
        released: payload.released?.trim() || undefined,
        year: payload.year,
        country: payload.country,
        uri: payload.uri,
        thumb: primary?.uri || primary?.resource_url || toLargeDiscogsImage(payload.thumb) || undefined,
        genres: payload.genres ?? [],
        styles: payload.styles ?? [],
        formatDescriptions,
        trackCount: tracks.length > 0 ? tracks.length : undefined
      };
    }
  );
}
