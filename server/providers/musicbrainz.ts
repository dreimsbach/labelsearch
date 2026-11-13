import { DAY, HOUR, cached } from '../lib/cache.js';
import { fetchJson } from '../lib/http.js';
import { RateLimiter } from '../lib/limiter.js';
import type { LabelSearchResult } from '../../shared/types.js';

const BASE_URL = 'https://musicbrainz.org/ws/2';
/** MusicBrainz allows ~1 request/second per client and answers 503 when exceeded. */
const limiter = new RateLimiter('musicbrainz', 1, 1_100);
/** MB search can be slow (observed up to ~20 s for busy labels). */
const TIMEOUT_MS = 30_000;

interface MbLabelResponse {
  labels?: Array<{
    id: string;
    name: string;
    country?: string;
    disambiguation?: string;
  }>;
}

interface MbLabelDetail {
  relations?: Array<{ type?: string; url?: { resource?: string } }>;
}

interface MbReleaseResponse {
  releases?: MbRelease[];
  count?: number;
}

export interface MbRelease {
  id: string;
  title: string;
  date?: string;
  status?: string;
  country?: string;
  barcode?: string;
  packaging?: string;
  'release-group'?: {
    id: string;
    'primary-type'?: string;
    'secondary-types'?: string[];
  };
  'artist-credit'?: Array<{ name?: string; joinphrase?: string }>;
  genres?: Array<{ name: string }>;
  tags?: Array<{ name: string }>;
  media?: Array<{
    format?: string;
    'track-count'?: number;
  }>;
}

function userAgent(): string {
  return process.env.MB_USER_AGENT ?? 'example-app/0.0.0';
}

function mbJson<T>(url: URL): Promise<T> {
  url.searchParams.set('fmt', 'json');
  return fetchJson<T>(url.toString(), {
    limiter,
    timeoutMs: TIMEOUT_MS,
    headers: { 'User-Agent': userAgent() }
  });
}

export async function searchLabels(query: string, limit = 10): Promise<LabelSearchResult[]> {
  return cached(`mb:label-search:${limit}:${query.toLowerCase()}`, DAY, async () => {
    const url = new URL(`${BASE_URL}/label/`);
    url.searchParams.set('query', query);
    url.searchParams.set('limit', String(limit));
    const payload = await mbJson<MbLabelResponse>(url);
    return (payload.labels ?? []).map((entry) => ({
      id: entry.id,
      name: entry.name,
      country: entry.country,
      disambiguation: entry.disambiguation
    }));
  });
}

/** Discogs label id from the MB label's URL relations, if editors linked one. */
export async function getDiscogsLabelId(mbid: string): Promise<number | null> {
  return cached(`mb:label-discogs:${mbid}`, 30 * DAY, async () => {
    const url = new URL(`${BASE_URL}/label/${mbid}`);
    url.searchParams.set('inc', 'url-rels');
    const payload = await mbJson<MbLabelDetail>(url);
    for (const relation of payload.relations ?? []) {
      const match = relation.url?.resource?.match(/discogs\.com\/label\/(\d+)/);
      if (match) {
        return Number(match[1]);
      }
    }
    return null;
  });
}

/**
 * Releases of the label within the window. In `days` mode only releases with an exact
 * day (YYYY-MM-DD) count; year-only dates ("2026") would otherwise match every week.
 */
export async function searchReleasesByLabel(mbid: string, fromDate: string, toDate: string, mode: 'days' | 'year'): Promise<MbRelease[]> {
  return cached(`mb:releases:${mbid}:${fromDate}:${toDate}`, HOUR, async () => {
    const releases: MbRelease[] = [];
    for (let offset = 0; offset < 500; offset += 100) {
      const url = new URL(`${BASE_URL}/release/`);
      url.searchParams.set('query', `laid:${mbid} AND date:[${fromDate} TO ${toDate}]`);
      url.searchParams.set('limit', '100');
      url.searchParams.set('offset', String(offset));
      const payload = await mbJson<MbReleaseResponse>(url);
      releases.push(...(payload.releases ?? []));
      if (releases.length >= (payload.count ?? 0) || (payload.releases ?? []).length === 0) {
        break;
      }
    }
    return releases.filter((release) => {
      const date = release.date ?? '';
      return mode === 'days' ? /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= fromDate && date <= toDate : date.startsWith(fromDate.slice(0, 4));
    });
  });
}
