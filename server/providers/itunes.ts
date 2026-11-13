import { HOUR, cached } from '../lib/cache.js';
import { fetchJson } from '../lib/http.js';
import { RateLimiter } from '../lib/limiter.js';
import type { ItunesCandidate } from '../lib/match.js';

/** Apple documents ~20 calls/minute for the Search API and answers 403/429 when exceeded. */
const limiter = new RateLimiter('itunes', 20, 60_000);

interface ItunesPayload {
  results?: ItunesCandidate[];
}

export async function findItunesCandidates(artist: string, title: string, country: string): Promise<ItunesCandidate[]> {
  const term = `${artist} ${title}`.trim();
  return cached(`itunes:${country}:${term.toLowerCase()}`, (results) => (results.length > 0 ? 24 * HOUR : 6 * HOUR), async () => {
    const url = new URL('https://itunes.apple.com/search');
    url.searchParams.set('term', term);
    url.searchParams.set('entity', 'album');
    url.searchParams.set('country', country);
    url.searchParams.set('limit', '25');
    const payload = await fetchJson<ItunesPayload>(url.toString(), { limiter, throttleStatuses: [403, 429, 503] });
    return payload.results ?? [];
  });
}
