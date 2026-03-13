import { fetchJson } from '../lib/http.js';
import type { ExternalCandidate } from '../lib/match.js';

interface DeezerPayload {
  data?: Array<{
    id: number;
    title: string;
    release_date?: string;
    link?: string;
    cover_xl?: string;
    artist?: {
      name?: string;
    };
  }>;
}

async function searchAlbums(query: string, limit: number): Promise<ExternalCandidate[]> {
  const url = new URL('https://api.deezer.com/search/album');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));

  const payload = await fetchJson<DeezerPayload>(url.toString());

  return (payload.data ?? []).map((entry) => ({
    source: 'deezer',
    id: entry.id,
    artistName: entry.artist?.name?.trim() ?? 'Unknown Artist',
    collectionName: entry.title,
    releaseDate: entry.release_date,
    albumUrl: entry.link,
    artworkUrl: entry.cover_xl
  }));
}

export async function findDeezerCandidates(artist: string, title: string): Promise<ExternalCandidate[]> {
  const terms = [`${artist} ${title}`.trim(), title.trim(), artist.trim()].filter((entry) => entry.length > 0);
  const seen = new Map<number, ExternalCandidate>();

  for (const term of terms) {
    const candidates = await searchAlbums(term, 25);
    for (const candidate of candidates) {
      if (!seen.has(candidate.id)) {
        seen.set(candidate.id, candidate);
      }
    }
  }

  return [...seen.values()];
}
