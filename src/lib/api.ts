import type { LabelRef, LabelSearchResult, Release, SearchResponse, SourceMode, TimeMode } from '../../shared/types';

export async function searchLabels(query: string): Promise<LabelSearchResult[]> {
  const response = await fetch(`/api/labels/search?q=${encodeURIComponent(query)}&limit=10`);
  if (!response.ok) {
    throw new Error('Label search failed');
  }

  const payload = (await response.json()) as { labels: LabelSearchResult[] };
  return payload.labels;
}

export async function searchReleasesForLabels(
  labels: LabelRef[],
  timeMode: TimeMode,
  timeValue: number,
  country: string,
  sourceMode: SourceMode,
  timezone: string
): Promise<SearchResponse> {
  const response = await fetch('/api/releases/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      labels,
      timeMode,
      timeValue,
      country,
      sourceMode,
      timezone
    })
  });

  if (!response.ok) {
    const payload = (await response.json()) as { error?: string };
    if (payload.error?.includes('daysBack')) {
      throw new Error('Backend appears outdated (daysBack API). Please restart dev server so frontend and backend use the same version.');
    }
    throw new Error(payload.error ?? 'Search failed');
  }

  return (await response.json()) as SearchResponse;
}

export function dedupeReleases(releases: Release[]): Release[] {
  const map = new Map<string, Release>();

  for (const release of releases) {
    const key = `${release.artist.toLowerCase()}::${release.title.toLowerCase()}::${release.releaseDate}`;
    const current = map.get(key);

    if (!current) {
      map.set(key, release);
      continue;
    }

    map.set(key, {
      ...current,
      labels: [...new Set([...current.labels, ...release.labels])],
      matchedByLabel: [...new Set([...current.matchedByLabel, ...release.matchedByLabel])],
      genres: current.genres.length > 0 ? current.genres : release.genres,
      coverUrl: current.coverUrl ?? release.coverUrl,
      appleArtistUrl: current.appleArtistUrl ?? release.appleArtistUrl,
      appleAlbumUrl: current.appleAlbumUrl ?? release.appleAlbumUrl,
      matchConfidence: current.matchConfidence === 'high' || release.matchConfidence === 'high' ? 'high' : 'none'
    });
  }

  return [...map.values()].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
}
