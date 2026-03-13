import { fetchJson } from '../lib/http.js';
import { RateLimiter } from '../lib/throttle.js';
import type { LabelRef, LabelSearchResult } from '../../shared/types.js';

const BASE_URL = 'https://musicbrainz.org/ws/2';
const limiter = new RateLimiter(1000);

interface MbLabelResponse {
  labels?: Array<{
    id: string;
    name: string;
    country?: string;
    disambiguation?: string;
  }>;
}

interface MbReleaseResponse {
  releases?: MbRelease[];
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
    genres?: Array<{ name: string }>;
    tags?: Array<{ name: string }>;
  };
  'artist-credit'?: Array<{ name?: string }>;
  genres?: Array<{ name: string }>;
  tags?: Array<{ name: string }>;
  'label-info'?: Array<{ label?: { id: string; name: string } }>;
  media?: Array<{
    format?: string;
    'track-count'?: number;
  }>;
  relations?: Array<{
    type?: string;
    url?: {
      resource?: string;
    };
  }>;
}

function userAgent(): string {
  return process.env.MB_USER_AGENT ?? 'label-release-tracker/0.1.0 (https://example.com)';
}

export async function searchLabels(query: string, limit = 10): Promise<LabelSearchResult[]> {
  const url = new URL(`${BASE_URL}/label/`);
  url.searchParams.set('query', query);
  url.searchParams.set('fmt', 'json');
  url.searchParams.set('limit', String(limit));

  const payload = await limiter.schedule(() =>
    fetchJson<MbLabelResponse>(url.toString(), {
      headers: {
        'User-Agent': userAgent()
      }
    })
  );

  return (payload.labels ?? []).map((entry) => ({
    id: entry.id,
    name: entry.name,
    country: entry.country,
    disambiguation: entry.disambiguation
  }));
}

export async function searchReleasesByLabel(label: LabelRef, fromDate: string, toDate: string): Promise<MbRelease[]> {
  const url = new URL(`${BASE_URL}/release/`);
  url.searchParams.set('query', `laid:${label.mbid} AND date:[${fromDate} TO ${toDate}]`);
  url.searchParams.set('fmt', 'json');
  url.searchParams.set('limit', '100');
  url.searchParams.set('inc', 'release-groups+artists+labels+genres+tags+media+url-rels');

  const payload = await limiter.schedule(() =>
    fetchJson<MbReleaseResponse>(url.toString(), {
      headers: {
        'User-Agent': userAgent()
      }
    })
  );

  return payload.releases ?? [];
}
