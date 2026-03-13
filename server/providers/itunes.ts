import { fetchJson } from '../lib/http.js';
import type { ItunesCandidate } from '../lib/match.js';

interface ItunesPayload {
  results?: Array<ItunesCandidate>;
}

export async function findItunesCandidates(artist: string, title: string, country: string): Promise<ItunesCandidate[]> {
  const url = new URL('https://itunes.apple.com/search');
  url.searchParams.set('term', `${artist} ${title}`);
  url.searchParams.set('entity', 'album');
  url.searchParams.set('country', country);
  url.searchParams.set('limit', '25');

  const payload = await fetchJson<ItunesPayload>(url.toString());
  return payload.results ?? [];
}
