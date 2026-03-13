import { fetchJson } from '../lib/http.js';
import type { ExternalCandidate } from '../lib/match.js';

interface DiscogsPayload {
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

async function search(query: Record<string, string>): Promise<ExternalCandidate[]> {
  const url = new URL('https://api.discogs.com/database/search');
  url.searchParams.set('type', 'release');

  for (const [key, value] of Object.entries(query)) {
    if (value.trim()) {
      url.searchParams.set(key, value.trim());
    }
  }

  const token = process.env.DISCOGS_TOKEN;
  if (token) {
    url.searchParams.set('token', token);
  }

  const payload = await fetchJson<DiscogsPayload>(url.toString(), {
    headers: {
      'User-Agent': userAgent()
    }
  });

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

export async function findDiscogsCandidates(artist: string, title: string): Promise<ExternalCandidate[]> {
  const queries: Record<string, string>[] = [
    { artist, release_title: title },
    { release_title: title },
    { artist }
  ];
  const seen = new Map<number, ExternalCandidate>();

  for (const query of queries) {
    const candidates = await search(query);
    for (const candidate of candidates) {
      if (!seen.has(candidate.id)) {
        seen.set(candidate.id, candidate);
      }
    }
  }

  return [...seen.values()];
}
