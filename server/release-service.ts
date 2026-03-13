import type { LabelFailure, LabelRef, Release, SearchRequest } from '../shared/types.js';
import { computeDateRange } from './lib/date.js';
import { dedupeReleaseKey, mapReleaseType, pickBestItunesMatch, resolveGenres } from './lib/match.js';
import { findItunesCandidates } from './providers/itunes.js';
import { searchReleasesByLabel, type MbRelease } from './providers/musicbrainz.js';

interface SearchResult {
  releases: Release[];
  fromDate: string;
  toDate: string;
  partialFailures: LabelFailure[];
}

function releaseArtist(release: MbRelease): string {
  return release['artist-credit']?.[0]?.name?.trim() ?? 'Unknown Artist';
}

function releaseDate(release: MbRelease): string {
  return release.date?.slice(0, 10) ?? '0000-00-00';
}

function mapBaseRelease(release: MbRelease, label: LabelRef, mode: SearchRequest['sourceMode']): Release {
  return {
    id: release.id,
    artist: releaseArtist(release),
    title: release.title,
    releaseDate: releaseDate(release),
    genres: [],
    labels: [label.name],
    type: mapReleaseType(release['release-group']?.['primary-type'], release['release-group']?.['secondary-types'], undefined, release.title),
    sourceDetails: {
      musicbrainzReleaseId: release.id,
      musicbrainzReleaseGroupId: release['release-group']?.id
    },
    matchedByLabel: [label.name],
    matchConfidence: 'none',
    matchedBy: mode === 'hybrid' ? 'hybrid' : 'musicbrainz'
  };
}

async function enrichWithItunes(release: Release, country: string, mbRelease: MbRelease): Promise<Release> {
  const candidates = await findItunesCandidates(release.artist, release.title, country);
  const matched = pickBestItunesMatch(release.artist, release.title, release.releaseDate, candidates);

  if (!matched) {
    return {
      ...release,
      genres: resolveGenres(undefined, mbRelease.genres?.map((entry) => entry.name) ?? [], mbRelease.tags?.map((entry) => entry.name) ?? [])
    };
  }

  return {
    ...release,
    coverUrl: matched.artworkUrl100,
    appleArtistUrl: matched.artistViewUrl,
    appleAlbumUrl: matched.collectionViewUrl,
    type: mapReleaseType(
      mbRelease['release-group']?.['primary-type'],
      mbRelease['release-group']?.['secondary-types'],
      matched.collectionType,
      release.title
    ),
    genres: resolveGenres(
      matched.primaryGenreName,
      mbRelease.genres?.map((entry) => entry.name) ?? [],
      mbRelease.tags?.map((entry) => entry.name) ?? []
    ),
    sourceDetails: {
      ...release.sourceDetails,
      itunesCollectionId: matched.collectionId
    },
    matchConfidence: 'high'
  };
}

function mergeRelease(existing: Release, incoming: Release, labelName: string): Release {
  const labels = new Set([...existing.labels, ...incoming.labels]);
  const matchedByLabel = new Set([...existing.matchedByLabel, labelName]);

  return {
    ...existing,
    labels: [...labels],
    matchedByLabel: [...matchedByLabel],
    coverUrl: existing.coverUrl ?? incoming.coverUrl,
    appleArtistUrl: existing.appleArtistUrl ?? incoming.appleArtistUrl,
    appleAlbumUrl: existing.appleAlbumUrl ?? incoming.appleAlbumUrl,
    genres: existing.genres.length > 0 ? existing.genres : incoming.genres,
    matchConfidence: existing.matchConfidence === 'high' || incoming.matchConfidence === 'high' ? 'high' : 'none'
  };
}

export async function findReleases(input: SearchRequest): Promise<SearchResult> {
  const { fromDate, toDate } = computeDateRange(input.daysBack, input.timezone);

  const releaseMap = new Map<string, Release>();
  const failures: LabelFailure[] = [];

  for (const label of input.labels) {
    try {
      const mbReleases = input.sourceMode === 'itunes' ? [] : await searchReleasesByLabel(label, fromDate, toDate);

      for (const mbRelease of mbReleases) {
        let mapped = mapBaseRelease(mbRelease, label, input.sourceMode);

        if (input.sourceMode === 'hybrid') {
          mapped = await enrichWithItunes(mapped, input.country, mbRelease);
        } else if (input.sourceMode === 'musicbrainz') {
          mapped.genres = resolveGenres(
            undefined,
            mbRelease.genres?.map((entry) => entry.name) ?? [],
            mbRelease.tags?.map((entry) => entry.name) ?? []
          );
        }

        const key = dedupeReleaseKey(mapped.artist, mapped.title, mapped.releaseDate);
        const current = releaseMap.get(key);
        if (current) {
          releaseMap.set(key, mergeRelease(current, mapped, label.name));
        } else {
          releaseMap.set(key, mapped);
        }
      }
    } catch (error) {
      failures.push({
        label,
        message: error instanceof Error ? error.message : 'Unknown provider error'
      });
    }
  }

  if (input.sourceMode === 'itunes') {
    for (const label of input.labels) {
      try {
        const candidates = await findItunesCandidates(label.name, '', input.country);
        for (const candidate of candidates) {
          const day = candidate.releaseDate?.slice(0, 10);
          if (!day || day < fromDate || day > toDate) {
            continue;
          }

          const mapped: Release = {
            id: `itunes-${candidate.collectionId}`,
            artist: candidate.artistName,
            title: candidate.collectionName,
            releaseDate: day,
            genres: resolveGenres(candidate.primaryGenreName, [], []),
            labels: [label.name],
            type: mapReleaseType(undefined, [], candidate.collectionType, candidate.collectionName),
            coverUrl: candidate.artworkUrl100,
            appleArtistUrl: candidate.artistViewUrl,
            appleAlbumUrl: candidate.collectionViewUrl,
            sourceDetails: {
              itunesCollectionId: candidate.collectionId
            },
            matchedByLabel: [label.name],
            matchConfidence: 'high',
            matchedBy: 'itunes'
          };

          const key = dedupeReleaseKey(mapped.artist, mapped.title, mapped.releaseDate);
          const current = releaseMap.get(key);
          if (current) {
            releaseMap.set(key, mergeRelease(current, mapped, label.name));
          } else {
            releaseMap.set(key, mapped);
          }
        }
      } catch (error) {
        failures.push({
          label,
          message: error instanceof Error ? error.message : 'Unknown provider error'
        });
      }
    }
  }

  const releases = [...releaseMap.values()].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));

  return {
    releases,
    fromDate,
    toDate,
    partialFailures: failures
  };
}
