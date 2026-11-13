import { mergeReleases, uniqueLinks } from '../shared/merge.js';
import type { LabelFailure, LabelRef, Release, SearchEvent, SearchMeta, SearchRequest, SourceId } from '../shared/types.js';
import { computeDateRange } from './lib/date.js';
import { HttpError } from './lib/http.js';
import { normalizeLabelName } from './lib/labels.js';
import { mapPool } from './lib/limiter.js';
import { logWarn } from './lib/logger.js';
import { inferDiscogsType, mapDeezerRecordType, mapReleaseType, pickItunesMatch, resolveGenres } from './lib/match.js';
import { findCoverArtUrl } from './providers/coverartarchive.js';
import { findLabelAlbums, type DeezerAlbum } from './providers/deezer.js';
import { fetchDiscogsRelease, findDiscogsLabelIdByName, listLabelReleases, type DiscogsReleaseDetail } from './providers/discogs.js';
import { findItunesCandidates } from './providers/itunes.js';
import { getDiscogsLabelId, searchLabels, searchReleasesByLabel, type MbRelease } from './providers/musicbrainz.js';

/** Labels processed at once; per-provider limiters keep the actual request rate in check. */
const LABEL_CONCURRENCY = 4;
const ENRICH_CONCURRENCY = 3;
const DISCOGS_MAX_DETAILS = 150;
const SOURCE_ORDER: SourceId[] = ['deezer', 'musicbrainz', 'discogs'];

interface SearchContext {
  fromDate: string;
  toDate: string;
  mode: SearchRequest['timeMode'];
  country: string;
  discogsToken?: string;
}

export interface SearchResult {
  releases: Release[];
  fromDate: string;
  toDate: string;
  partialFailures: LabelFailure[];
}

const SOURCE_NAMES: Record<SourceId | 'itunes', string> = {
  deezer: 'Deezer',
  musicbrainz: 'MusicBrainz',
  discogs: 'Discogs',
  itunes: 'iTunes'
};

export function friendlyProviderError(source: SourceId | 'itunes', error: unknown): string {
  const name = SOURCE_NAMES[source];
  if (error instanceof HttpError && (error.status === 429 || error.status === 503)) {
    return source === 'discogs'
      ? 'Discogs rate limit reached. Add a Discogs token (UI or DISCOGS_TOKEN) and retry in a minute.'
      : `${name} rate limit reached. Retry in a minute.`;
  }
  return `${name}: ${error instanceof Error ? error.message : String(error)}`;
}

// ---------- mapping ----------

function toHighResArtwork(url?: string): string | undefined {
  return url?.replace(/\/\d+x\d+bb(?:-\d+)?\.jpg$/i, '/1200x1200bb.jpg');
}

function validYmd(value?: string): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    return null;
  }
  return value;
}

function baseRelease(label: LabelRef, source: SourceId): Pick<Release, 'labels' | 'matchedByLabel' | 'foundBy'> {
  return { labels: [label.name], matchedByLabel: [label.name], foundBy: [source] };
}

export function mapDeezerAlbum(album: DeezerAlbum, label: LabelRef): Release {
  return {
    ...baseRelease(label, 'deezer'),
    id: `deezer-${album.id}`,
    artist: album.artist,
    title: album.title,
    releaseDate: album.releaseDate ?? '0000-00-00',
    genres: resolveGenres(undefined, album.genres),
    type: mapDeezerRecordType(album.recordType, album.title),
    trackCount: album.trackCount,
    barcode: album.upc,
    coverUrl: album.cover,
    deezerAlbumUrl: album.link,
    externalLinks: album.link ? [{ label: 'Deezer', url: album.link, source: 'deezer' }] : [],
    sourceDetails: { deezerAlbumId: album.id }
  };
}

function mbArtist(release: MbRelease): string {
  const credit = (release['artist-credit'] ?? []).map((entry) => `${entry.name ?? ''}${entry.joinphrase ?? ''}`).join('').trim();
  return credit || 'Unknown Artist';
}

export function mapMbRelease(release: MbRelease, label: LabelRef): Release {
  const formats = [...new Set((release.media ?? []).map((entry) => entry.format?.trim()).filter((entry): entry is string => Boolean(entry)))];
  const tracks = (release.media ?? []).reduce((sum, media) => sum + (media['track-count'] ?? 0), 0);
  const url = `https://musicbrainz.org/release/${release.id}`;
  return {
    ...baseRelease(label, 'musicbrainz'),
    id: `mb-${release.id}`,
    artist: mbArtist(release),
    title: release.title,
    releaseDate: release.date?.slice(0, 10) ?? '0000-00-00',
    genres: resolveGenres(undefined, release.genres?.map((entry) => entry.name) ?? [], release.tags?.map((entry) => entry.name) ?? []),
    type: mapReleaseType(release['release-group']?.['primary-type'], release['release-group']?.['secondary-types'], undefined, release.title),
    status: release.status,
    country: release.country,
    barcode: release.barcode,
    packaging: release.packaging,
    trackCount: tracks > 0 ? tracks : undefined,
    mediaFormat: formats.length > 0 ? formats.join(', ') : undefined,
    externalLinks: [{ label: 'MusicBrainz', url, source: 'musicbrainz' }],
    sourceDetails: {
      musicbrainzReleaseId: release.id,
      musicbrainzReleaseGroupId: release['release-group']?.id
    }
  };
}

export function mapDiscogsRelease(detail: DiscogsReleaseDetail, releaseDate: string, label: LabelRef): Release {
  return {
    ...baseRelease(label, 'discogs'),
    id: `discogs-${detail.id}`,
    artist: detail.artist,
    title: detail.title,
    releaseDate,
    genres: resolveGenres(undefined, detail.genres),
    styles: detail.styles,
    type: inferDiscogsType(detail.title, detail.formatDescriptions, detail.trackCount),
    country: detail.country,
    trackCount: detail.trackCount,
    coverUrl: detail.thumb,
    discogsReleaseUrl: detail.uri,
    externalLinks: detail.uri ? [{ label: 'Discogs', url: detail.uri, source: 'discogs' }] : [],
    sourceDetails: { discogsReleaseId: detail.id }
  };
}

// ---------- sources ----------

async function resolveMbid(label: LabelRef): Promise<string | undefined> {
  if (label.mbid) {
    return label.mbid;
  }
  const target = normalizeLabelName(label.name);
  const candidates = await searchLabels(label.name, 5);
  return candidates.find((entry) => normalizeLabelName(entry.name) === target)?.id;
}

async function fromDeezer(label: LabelRef, ctx: SearchContext): Promise<Release[]> {
  const albums = await findLabelAlbums(label.name, ctx.fromDate, ctx.toDate, ctx.mode);
  return albums.map((album) => mapDeezerAlbum(album, label));
}

async function fromMusicBrainz(label: LabelRef, ctx: SearchContext): Promise<Release[]> {
  const mbid = await resolveMbid(label);
  if (!mbid) {
    return [];
  }
  const releases = await searchReleasesByLabel(mbid, ctx.fromDate, ctx.toDate, ctx.mode);
  return releases.map((release) => mapMbRelease(release, label));
}

async function fromDiscogs(label: LabelRef, ctx: SearchContext): Promise<Release[]> {
  const viaMb = label.mbid ? await getDiscogsLabelId(label.mbid).catch(() => null) : null;
  const labelId = viaMb ?? (await findDiscogsLabelIdByName(label.name, ctx.discogsToken));
  if (!labelId) {
    throw new Error(`no Discogs label found for "${label.name}"`);
  }

  const years = [...new Set([Number(ctx.fromDate.slice(0, 4)), Number(ctx.toDate.slice(0, 4))])];
  const entries = await listLabelReleases(labelId, years, ctx.discogsToken);
  if (entries.length > DISCOGS_MAX_DETAILS) {
    void logWarn('Discogs detail lookups capped', { label: label.name, candidates: entries.length, cap: DISCOGS_MAX_DETAILS });
  }

  // Newest Discogs ids first: recent submissions are the most likely in-window releases.
  const candidates = [...entries].sort((a, b) => b.id - a.id).slice(0, DISCOGS_MAX_DETAILS);
  const details = await mapPool(candidates, 4, (entry) => fetchDiscogsRelease(entry.id, ctx.discogsToken).catch(() => null));

  const releases: Release[] = [];
  for (const detail of details) {
    if (!detail) {
      continue;
    }
    const exact = validYmd(detail.released);
    if (ctx.mode === 'days' && !exact) {
      continue;
    }
    const day = exact ?? `${detail.year ?? ctx.fromDate.slice(0, 4)}-01-01`;
    if (day >= ctx.fromDate && day <= ctx.toDate) {
      releases.push(mapDiscogsRelease(detail, day, label));
    }
  }
  return releases;
}

const SOURCES: Record<SourceId, (label: LabelRef, ctx: SearchContext) => Promise<Release[]>> = {
  deezer: fromDeezer,
  musicbrainz: fromMusicBrainz,
  discogs: fromDiscogs
};

// ---------- enrichment ----------

async function enrichRelease(release: Release, ctx: SearchContext): Promise<Release> {
  let next = release;

  if (!next.coverUrl && next.sourceDetails.musicbrainzReleaseId) {
    const cover = await findCoverArtUrl(next.sourceDetails.musicbrainzReleaseId);
    if (cover) {
      next = { ...next, coverUrl: cover };
    }
  }

  if (next.appleAlbumUrl) {
    return next;
  }

  try {
    let match = pickItunesMatch(next.artist, next.title, next.releaseDate, await findItunesCandidates(next.artist, next.title, ctx.country));
    if (!match && ctx.country !== 'US') {
      match = pickItunesMatch(next.artist, next.title, next.releaseDate, await findItunesCandidates(next.artist, next.title, 'US'));
    }
    if (!match) {
      return next;
    }

    return {
      ...next,
      coverUrl: next.coverUrl ?? toHighResArtwork(match.artworkUrl100),
      appleArtistUrl: match.artistViewUrl,
      appleAlbumUrl: match.collectionViewUrl,
      genres: resolveGenres(match.primaryGenreName, next.genres.filter((genre) => genre !== 'Genre unbekannt')),
      externalLinks: uniqueLinks([
        ...(next.externalLinks ?? []),
        ...(match.collectionViewUrl ? [{ label: 'Apple Album', url: match.collectionViewUrl, source: 'itunes' as const }] : []),
        ...(match.artistViewUrl ? [{ label: 'Apple Artist', url: match.artistViewUrl, source: 'itunes' as const }] : [])
      ]),
      sourceDetails: { ...next.sourceDetails, itunesCollectionId: match.collectionId }
    };
  } catch (error) {
    void logWarn('iTunes enrichment failed', { artist: next.artist, title: next.title, message: String(error) });
    return next;
  }
}

// ---------- orchestration ----------

async function processLabel(label: LabelRef, sources: SourceId[], ctx: SearchContext, emit: (event: SearchEvent) => void): Promise<Release[]> {
  const settled = await Promise.allSettled(sources.map((source) => SOURCES[source](label, ctx)));
  const found: Release[] = [];

  settled.forEach((result, index) => {
    const source = sources[index];
    if (result.status === 'fulfilled') {
      found.push(...result.value);
      return;
    }
    const message = friendlyProviderError(source, result.reason);
    void logWarn('Label source failed', { label: label.name, source, message });
    emit({ type: 'failure', failure: { label, source, message } });
  });

  const merged = mergeReleases(found);
  if (merged.length === 0) {
    return [];
  }
  emit({ type: 'releases', label, releases: merged });

  const enriched = await mapPool(merged, ENRICH_CONCURRENCY, (release) => enrichRelease(release, ctx));
  const changed = enriched.filter((release, index) => release !== merged[index]);
  if (changed.length > 0) {
    emit({ type: 'releases', label, releases: changed });
  }
  return enriched;
}

/**
 * Streams results label by label. Resolves with the final merged list once all labels are done.
 */
export async function searchReleases(input: SearchRequest, emit: (event: SearchEvent) => void, signal?: AbortSignal): Promise<SearchResult> {
  const { fromDate, toDate } = computeDateRange(input.timeMode, input.timeValue, input.timezone);
  const sources = SOURCE_ORDER.filter((source) => input.sources.includes(source));
  const ctx: SearchContext = { fromDate, toDate, mode: input.timeMode, country: input.country, discogsToken: input.discogsToken };
  const failures: LabelFailure[] = [];
  const collected: Release[] = [];
  let completed = 0;

  const forward = (event: SearchEvent): void => {
    if (event.type === 'failure') {
      failures.push(event.failure);
    }
    emit(event);
  };

  emit({ type: 'start', fromDate, toDate, totalLabels: input.labels.length });

  await mapPool(input.labels, LABEL_CONCURRENCY, async (label) => {
    if (signal?.aborted) {
      return;
    }
    try {
      collected.push(...(await processLabel(label, sources, ctx, forward)));
    } catch (error) {
      forward({ type: 'failure', failure: { label, message: error instanceof Error ? error.message : String(error) } });
    }
    completed += 1;
    emit({ type: 'labelDone', label, completed, totalLabels: input.labels.length });
  });

  return { releases: mergeReleases(collected), fromDate, toDate, partialFailures: failures };
}

/** Non-streaming variant (used by `POST /api/releases/search` and tests). */
export function findReleases(input: SearchRequest): Promise<SearchResult> {
  return searchReleases(input, () => undefined);
}

export function buildMeta(input: SearchRequest, result: SearchResult): SearchMeta {
  return {
    sources: input.sources,
    timeMode: input.timeMode,
    timeValue: input.timeValue,
    country: input.country,
    fromDate: result.fromDate,
    toDate: result.toDate,
    searchedAt: new Date().toISOString(),
    partialFailures: result.partialFailures
  };
}
