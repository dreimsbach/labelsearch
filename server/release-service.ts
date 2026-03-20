import type { LabelFailure, LabelRef, Release, SearchRequest } from '../shared/types.js';
import { computeDateRange } from './lib/date.js';
import { dedupeReleaseKey, mapReleaseType, pickBestExternalMatch, pickBestItunesMatch, resolveGenres } from './lib/match.js';
import { logWarn } from './lib/logger.js';
import { findDeezerCandidates } from './providers/deezer.js';
import { fetchDiscogsRelease, findDiscogsCandidates, searchDiscogsByLabelYear } from './providers/discogs.js';
import { findItunesCandidates } from './providers/itunes.js';
import { searchReleasesByLabel, type MbRelease } from './providers/musicbrainz.js';

interface SearchResult {
  releases: Release[];
  fromDate: string;
  toDate: string;
  partialFailures: LabelFailure[];
}

interface CoverArtArchivePayload {
  images?: Array<{
    front?: boolean;
    thumbnails?: {
      large?: string;
      [key: string]: string | undefined;
    };
  }>;
}

const coverArtCache = new Map<string, Promise<string | undefined>>();

function uniqueLinks(items: Release['externalLinks'] = []): Release['externalLinks'] {
  const seen = new Set<string>();
  const out: NonNullable<Release['externalLinks']> = [];

  for (const item of items) {
    if (!item?.url || seen.has(item.url)) {
      continue;
    }
    seen.add(item.url);
    out.push(item);
  }

  return out;
}

function mapMbExternalLinks(release: MbRelease): NonNullable<Release['externalLinks']> {
  const links = (release.relations ?? [])
    .map((relation) => relation.url?.resource?.trim())
    .filter((url): url is string => Boolean(url && /^https?:\/\//i.test(url)))
    .slice(0, 6)
    .map((url) => ({
      label: 'Official',
      url,
      source: 'musicbrainz' as const
    }));

  return uniqueLinks(links) ?? [];
}

function mediaFormat(release: MbRelease): string | undefined {
  const formats = (release.media ?? []).map((entry) => entry.format?.trim()).filter((entry): entry is string => Boolean(entry));
  if (formats.length === 0) {
    return undefined;
  }

  return [...new Set(formats)].join(', ');
}

function trackCount(release: MbRelease): number | undefined {
  const total = (release.media ?? []).reduce((sum, media) => sum + (media['track-count'] ?? 0), 0);
  return total > 0 ? total : undefined;
}

function toHighResArtwork(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }

  return url.replace(/\/\d+x\d+bb(?:-\d+)?\.jpg$/i, '/1200x1200bb.jpg');
}

async function findCoverArtUrl(mbReleaseId?: string): Promise<string | undefined> {
  if (!mbReleaseId) {
    return undefined;
  }

  const cached = coverArtCache.get(mbReleaseId);
  if (cached) {
    return cached;
  }

  const promise = (async (): Promise<string | undefined> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    try {
      const response = await fetch(`https://coverartarchive.org/release/${mbReleaseId}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });

      if (!response.ok) {
        return undefined;
      }

      const payload = (await response.json()) as CoverArtArchivePayload;
      const front = payload.images?.find((image) => image.front) ?? payload.images?.[0];
      // Force CAA to 1200 variant to avoid very large originals (e.g. 3000x3000).
      if (front) {
        return `https://coverartarchive.org/release/${mbReleaseId}/front-1200`;
      }

      return undefined;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  })();

  coverArtCache.set(mbReleaseId, promise);
  return promise;
}

function releaseArtist(release: MbRelease): string {
  return release['artist-credit']?.[0]?.name?.trim() ?? 'Unknown Artist';
}

function releaseDate(release: MbRelease): string {
  return release.date?.slice(0, 10) ?? '0000-00-00';
}

function validYmd(value?: string): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return value;
}

function inferDiscogsType(title: string, descriptions: string[], trackTotal?: number): Release['type'] {
  const lowerTitle = title.toLowerCase();
  const lowerDescriptions = descriptions.map((entry) => entry.toLowerCase());

  if (/\bep\b/i.test(lowerTitle) || lowerDescriptions.some((entry) => /\bep\b/i.test(entry))) {
    return 'EP';
  }

  if (lowerDescriptions.some((entry) => entry.includes('single') || entry.includes('45 rpm'))) {
    return 'Single';
  }

  if (typeof trackTotal === 'number') {
    if (trackTotal <= 2) {
      return 'Single';
    }
    if (trackTotal <= 6) {
      return 'EP';
    }
    return 'Album';
  }

  if (lowerDescriptions.some((entry) => /\blp\b/i.test(entry) || entry.includes('album'))) {
    return 'Album';
  }

  return 'Single';
}

function discogsReleaseDate(released: string | undefined, fallbackYear: number): string {
  const parsed = validYmd(released);
  if (parsed) {
    return parsed;
  }

  return `${fallbackYear}-01-01`;
}

function inDateRange(day: string, fromDate: string, toDate: string): boolean {
  return day >= fromDate && day <= toDate;
}

async function collectDiscogsReleasesForLabel(label: LabelRef, fromDate: string, toDate: string, mode: SearchRequest['timeMode']): Promise<Release[]> {
  const years = new Set<number>([Number(fromDate.slice(0, 4)), Number(toDate.slice(0, 4))]);
  const releaseIds = new Set<number>();

  for (const year of years) {
    const entries = await searchDiscogsByLabelYear(label.name, year);
    entries.forEach((entry) => releaseIds.add(entry.id));
  }

  const releases: Release[] = [];

  for (const id of releaseIds) {
    const detail = await fetchDiscogsRelease(id);
    const releaseYear = detail.year ?? Number(fromDate.slice(0, 4));
    const releaseDay = discogsReleaseDate(detail.released, releaseYear);
    const hasExactDate = Boolean(validYmd(detail.released));

    if (mode === 'days' && !hasExactDate) {
      continue;
    }
    if (!inDateRange(releaseDay, fromDate, toDate)) {
      continue;
    }

    releases.push({
      id: `discogs-${detail.id}`,
      artist: detail.artist,
      title: detail.title,
      releaseDate: releaseDay,
      genres: resolveGenres(undefined, detail.genres, []),
      styles: detail.styles,
      labels: [label.name],
      type: inferDiscogsType(detail.title, detail.formatDescriptions, detail.trackCount),
      country: detail.country,
      trackCount: detail.trackCount,
      coverUrl: detail.thumb,
      discogsReleaseUrl: detail.uri,
      externalLinks: uniqueLinks([
        ...(detail.uri
          ? [
              {
                label: 'Discogs',
                url: detail.uri,
                source: 'discogs' as const
              }
            ]
          : [])
      ]),
      sourceDetails: {
        discogsReleaseId: detail.id
      },
      matchedByLabel: [label.name],
      matchConfidence: 'high',
      matchedBy: 'discogs'
    });
  }

  return releases;
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
    status: release.status,
    country: release.country,
    barcode: release.barcode,
    packaging: release.packaging,
    trackCount: trackCount(release),
    mediaFormat: mediaFormat(release),
    externalLinks: mapMbExternalLinks(release),
    sourceDetails: {
      musicbrainzReleaseId: release.id,
      musicbrainzReleaseGroupId: release['release-group']?.id
    },
    matchedByLabel: [label.name],
    matchConfidence: 'none',
    matchedBy: mode === 'hybrid' ? 'hybrid' : 'musicbrainz'
  };
}

async function enrichWithItunes(
  release: Release,
  country: string,
  mbRelease: MbRelease,
  mbCoverUrl?: string
): Promise<Release> {
  let matched = null;
  try {
    const candidates = await findItunesCandidates(release.artist, release.title, country);
    matched = pickBestItunesMatch(release.artist, release.title, release.releaseDate, candidates);
  } catch {
    matched = null;
  }

  if (!matched) {
    let merged: Release = {
      ...release,
      coverUrl: mbCoverUrl ?? release.coverUrl,
      genres: resolveGenres(undefined, mbRelease.genres?.map((entry) => entry.name) ?? [], mbRelease.tags?.map((entry) => entry.name) ?? [])
    };

    let deezerMatch = null;
    try {
      const deezerCandidates = await findDeezerCandidates(release.artist, release.title);
      deezerMatch = pickBestExternalMatch(release.artist, release.title, release.releaseDate, deezerCandidates);
    } catch {
      deezerMatch = null;
    }
    if (deezerMatch) {
      merged = {
        ...merged,
        coverUrl: merged.coverUrl ?? deezerMatch.artworkUrl,
        deezerAlbumUrl: deezerMatch.albumUrl ?? merged.deezerAlbumUrl,
        externalLinks: uniqueLinks([
          ...(merged.externalLinks ?? []),
          ...(deezerMatch.albumUrl
            ? [
                {
                  label: 'Deezer',
                  url: deezerMatch.albumUrl,
                  source: 'deezer' as const
                }
              ]
            : [])
        ]),
        sourceDetails: {
          ...merged.sourceDetails,
          deezerAlbumId: deezerMatch.id
        },
        matchConfidence: 'high',
        matchedBy: 'hybrid-deezer'
      };
    }

    let discogsMatch = null;
    try {
      const discogsCandidates = await findDiscogsCandidates(release.artist, release.title);
      discogsMatch = pickBestExternalMatch(release.artist, release.title, release.releaseDate, discogsCandidates);
    } catch {
      discogsMatch = null;
    }
    if (discogsMatch) {
      merged = {
        ...merged,
        coverUrl: merged.coverUrl ?? discogsMatch.artworkUrl,
        discogsReleaseUrl: discogsMatch.albumUrl ?? merged.discogsReleaseUrl,
        externalLinks: uniqueLinks([
          ...(merged.externalLinks ?? []),
          ...(discogsMatch.albumUrl
            ? [
                {
                  label: 'Discogs',
                  url: discogsMatch.albumUrl,
                  source: 'discogs' as const
                }
              ]
            : [])
        ]),
        sourceDetails: {
          ...merged.sourceDetails,
          discogsReleaseId: discogsMatch.id
        },
        matchConfidence: 'high',
        matchedBy: merged.matchedBy === 'hybrid-deezer' ? merged.matchedBy : 'hybrid-discogs'
      };
    }

    return merged;
  }

  return {
    ...release,
    coverUrl: mbCoverUrl ?? toHighResArtwork(matched.artworkUrl100),
    appleArtistUrl: matched.artistViewUrl,
    appleAlbumUrl: matched.collectionViewUrl,
    externalLinks: uniqueLinks([
      ...(release.externalLinks ?? []),
      ...(matched.collectionViewUrl
        ? [
            {
              label: 'Apple Album',
              url: matched.collectionViewUrl,
              source: 'itunes' as const
            }
          ]
        : []),
      ...(matched.artistViewUrl
        ? [
            {
              label: 'Apple Artist',
              url: matched.artistViewUrl,
              source: 'itunes' as const
            }
          ]
        : [])
    ]),
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

  const mergedMatchSource = (() => {
    const priority: Record<Release['matchedBy'], number> = {
      musicbrainz: 0,
      hybrid: 1,
      discogs: 2,
      itunes: 3,
      'hybrid-discogs': 4,
      'hybrid-deezer': 5
    };
    return priority[incoming.matchedBy] >= priority[existing.matchedBy] ? incoming.matchedBy : existing.matchedBy;
  })();

  return {
    ...existing,
    labels: [...labels],
    matchedByLabel: [...matchedByLabel],
    coverUrl: existing.coverUrl ?? incoming.coverUrl,
    appleArtistUrl: existing.appleArtistUrl ?? incoming.appleArtistUrl,
    appleAlbumUrl: existing.appleAlbumUrl ?? incoming.appleAlbumUrl,
    genres: existing.genres.length > 0 ? existing.genres : incoming.genres,
    styles: (existing.styles?.length ?? 0) > 0 ? existing.styles : incoming.styles,
    status: existing.status ?? incoming.status,
    country: existing.country ?? incoming.country,
    barcode: existing.barcode ?? incoming.barcode,
    packaging: existing.packaging ?? incoming.packaging,
    trackCount: existing.trackCount ?? incoming.trackCount,
    mediaFormat: existing.mediaFormat ?? incoming.mediaFormat,
    deezerAlbumUrl: existing.deezerAlbumUrl ?? incoming.deezerAlbumUrl,
    discogsReleaseUrl: existing.discogsReleaseUrl ?? incoming.discogsReleaseUrl,
    externalLinks: uniqueLinks([...(existing.externalLinks ?? []), ...(incoming.externalLinks ?? [])]),
    sourceDetails: {
      ...existing.sourceDetails,
      ...incoming.sourceDetails
    },
    matchedBy: mergedMatchSource,
    matchConfidence: existing.matchConfidence === 'high' || incoming.matchConfidence === 'high' ? 'high' : 'none'
  };
}

export async function findReleases(input: SearchRequest): Promise<SearchResult> {
  const { fromDate, toDate } = computeDateRange(input.timeMode, input.timeValue, input.timezone);

  const releaseMap = new Map<string, Release>();
  const failures: LabelFailure[] = [];

  for (const label of input.labels) {
    try {
      const mbReleases =
        input.sourceMode === 'itunes' || input.sourceMode === 'discogs' ? [] : await searchReleasesByLabel(label, fromDate, toDate);

      for (const mbRelease of mbReleases) {
        let mapped = mapBaseRelease(mbRelease, label, input.sourceMode);
        const mbCoverUrl = await findCoverArtUrl(mbRelease.id);
        if (mbCoverUrl) {
          mapped.coverUrl = mbCoverUrl;
        }

        if (input.sourceMode === 'hybrid') {
          mapped = await enrichWithItunes(mapped, input.country, mbRelease, mbCoverUrl);
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
      void logWarn('Label processing failed', {
        label: label.name,
        sourceMode: input.sourceMode,
        message: error instanceof Error ? error.message : String(error)
      });
      failures.push({
        label,
        message: error instanceof Error ? error.message : 'Unknown provider error'
      });
    }
  }

  if (input.sourceMode === 'discogs') {
    for (const label of input.labels) {
      try {
        const discogsReleases = await collectDiscogsReleasesForLabel(label, fromDate, toDate, input.timeMode);
        for (const mapped of discogsReleases) {
          const key = dedupeReleaseKey(mapped.artist, mapped.title, mapped.releaseDate);
          const current = releaseMap.get(key);
          if (current) {
            releaseMap.set(key, mergeRelease(current, mapped, label.name));
          } else {
            releaseMap.set(key, mapped);
          }
        }
      } catch (error) {
        void logWarn('Discogs primary search failed', {
          label: label.name,
          message: error instanceof Error ? error.message : String(error)
        });
        failures.push({
          label,
          message: error instanceof Error ? error.message : 'Unknown provider error'
        });
      }
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
            coverUrl: toHighResArtwork(candidate.artworkUrl100),
            appleArtistUrl: candidate.artistViewUrl,
            appleAlbumUrl: candidate.collectionViewUrl,
            externalLinks: uniqueLinks([
              ...(candidate.collectionViewUrl
                ? [
                    {
                      label: 'Apple Album',
                      url: candidate.collectionViewUrl,
                      source: 'itunes' as const
                    }
                  ]
                : []),
              ...(candidate.artistViewUrl
                ? [
                    {
                      label: 'Apple Artist',
                      url: candidate.artistViewUrl,
                      source: 'itunes' as const
                    }
                  ]
                : [])
            ]),
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
        void logWarn('iTunes-only fallback failed', {
          label: label.name,
          message: error instanceof Error ? error.message : String(error)
        });
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
