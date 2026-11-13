import { DAY, HOUR, cached } from '../lib/cache.js';
import { fetchJson } from '../lib/http.js';
import { labelMatches } from '../lib/labels.js';
import { RateLimiter, mapPool } from '../lib/limiter.js';

/** Deezer allows 50 requests / 5 s per IP; stay a bit below. */
const limiter = new RateLimiter('deezer', 40, 5_000);

const SEARCH_PAGE_SIZE = 100;
const MAX_SEARCH_PAGES = 10;
const DETAIL_BATCH = 10;
/** Albums are ingested months ahead (pre-orders), so "old" only counts well before the window. */
const STALE_LOOKBACK_DAYS = 180;
const STOP_AFTER_STALE = 10;
const MAX_DETAILS = { days: 200, year: 400 } as const;

interface DeezerError {
  error?: { code?: number; type?: string; message?: string };
}

interface DeezerSearchPayload extends DeezerError {
  data?: Array<{ id: number }>;
  total?: number;
  next?: string;
}

export interface DeezerAlbum {
  id: number;
  title: string;
  artist: string;
  label?: string;
  releaseDate?: string;
  recordType?: string;
  trackCount?: number;
  upc?: string;
  link?: string;
  cover?: string;
  genres: string[];
}

interface DeezerAlbumPayload extends DeezerError {
  id: number;
  title?: string;
  label?: string;
  release_date?: string;
  record_type?: string;
  nb_tracks?: number;
  upc?: string;
  link?: string;
  cover_xl?: string;
  genres?: { data?: Array<{ name?: string }> };
  artist?: { name?: string };
}

function isQuotaError(body: unknown): boolean {
  return (body as DeezerError)?.error?.code === 4;
}

async function deezerJson<T extends DeezerError>(url: string): Promise<T> {
  const body = await fetchJson<T>(url, { limiter, isThrottledBody: isQuotaError });
  if (body.error && body.error.code !== 800) {
    throw new Error(`Deezer error ${body.error.code ?? ''}: ${body.error.message ?? body.error.type ?? 'unknown'}`);
  }
  return body;
}

function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** All album ids Deezer's (fuzzy) `label:"…"` search returns, newest ingest first. */
export async function searchAlbumIdsByLabel(label: string): Promise<number[]> {
  return cached(`deezer:label-search:${label.toLowerCase()}`, HOUR, async () => {
    const ids = new Set<number>();
    for (let page = 0; page < MAX_SEARCH_PAGES; page += 1) {
      const url = new URL('https://api.deezer.com/search/album');
      url.searchParams.set('q', `label:"${label.replace(/"/g, '')}"`);
      url.searchParams.set('limit', String(SEARCH_PAGE_SIZE));
      url.searchParams.set('index', String(page * SEARCH_PAGE_SIZE));
      const payload = await deezerJson<DeezerSearchPayload>(url.toString());
      (payload.data ?? []).forEach((entry) => ids.add(entry.id));
      if (!payload.next || (payload.data ?? []).length === 0) {
        break;
      }
    }
    // Deezer ids grow with ingestion time, so newest catalog entries come first.
    return [...ids].sort((a, b) => b - a);
  });
}

export async function getAlbum(id: number): Promise<DeezerAlbum | null> {
  return cached<DeezerAlbum | null>(
    `deezer:album:${id}`,
    (album) => {
      // Fresh/upcoming releases can still change (date, label), older ones are stable.
      if (!album?.releaseDate) {
        return 6 * HOUR;
      }
      const ageDays = (Date.now() - Date.parse(album.releaseDate)) / DAY;
      return ageDays < 30 ? DAY : 30 * DAY;
    },
    async () => {
      const payload = await deezerJson<DeezerAlbumPayload>(`https://api.deezer.com/album/${id}`);
      if (payload.error || !payload.id) {
        return null;
      }
      return {
        id: payload.id,
        title: payload.title?.trim() || 'Unknown Title',
        artist: payload.artist?.name?.trim() || 'Unknown Artist',
        label: payload.label?.trim() || undefined,
        releaseDate: payload.release_date || undefined,
        recordType: payload.record_type,
        trackCount: payload.nb_tracks,
        upc: payload.upc,
        link: payload.link,
        cover: payload.cover_xl,
        genres: (payload.genres?.data ?? []).map((entry) => entry.name?.trim()).filter((name): name is string => Boolean(name))
      };
    }
  );
}

/**
 * Albums of exactly `label` released within [fromDate, toDate].
 * Walks the label's albums by descending id and stops after a streak of albums
 * released long before the window, so a weekly search costs ~20–40 requests per label.
 */
export async function findLabelAlbums(
  label: string,
  fromDate: string,
  toDate: string,
  mode: 'days' | 'year'
): Promise<DeezerAlbum[]> {
  const ids = await searchAlbumIdsByLabel(label);
  const staleBefore = addDays(fromDate, -STALE_LOOKBACK_DAYS);
  const maxDetails = MAX_DETAILS[mode];
  const found: DeezerAlbum[] = [];
  let staleStreak = 0;

  for (let offset = 0; offset < Math.min(ids.length, maxDetails); offset += DETAIL_BATCH) {
    const batch = ids.slice(offset, offset + DETAIL_BATCH);
    const albums = await mapPool(batch, DETAIL_BATCH, (id) => getAlbum(id).catch(() => null));

    for (const album of albums) {
      if (!album?.releaseDate || !labelMatches(label, album.label)) {
        continue;
      }
      if (album.releaseDate < staleBefore) {
        staleStreak += 1;
        continue;
      }
      staleStreak = 0;
      if (album.releaseDate >= fromDate && album.releaseDate <= toDate) {
        found.push(album);
      }
    }

    if (staleStreak >= STOP_AFTER_STALE) {
      break;
    }
  }

  return found;
}
