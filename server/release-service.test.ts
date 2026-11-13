import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./providers/deezer.js', () => ({ findLabelAlbums: vi.fn(async () => []) }));

vi.mock('./providers/musicbrainz.js', () => ({
  searchReleasesByLabel: vi.fn(async () => []),
  searchLabels: vi.fn(async () => []),
  getDiscogsLabelId: vi.fn(async () => null)
}));

vi.mock('./providers/discogs.js', () => ({
  findDiscogsLabelIdByName: vi.fn(async () => 77423),
  listLabelReleases: vi.fn(async () => []),
  fetchDiscogsRelease: vi.fn(async () => {
    throw new Error('not configured');
  })
}));

vi.mock('./providers/itunes.js', () => ({ findItunesCandidates: vi.fn(async () => []) }));
vi.mock('./providers/coverartarchive.js', () => ({ findCoverArtUrl: vi.fn(async () => undefined) }));

vi.mock('./lib/logger.js', () => ({
  logWarn: vi.fn(async () => undefined),
  logInfo: vi.fn(async () => undefined),
  logError: vi.fn(async () => undefined)
}));

import type { SearchEvent, SearchRequest } from '../shared/types.js';
import { HttpError } from './lib/http.js';
import { findReleases, searchReleases } from './release-service.js';
import { findCoverArtUrl } from './providers/coverartarchive.js';
import { findLabelAlbums, type DeezerAlbum } from './providers/deezer.js';
import { fetchDiscogsRelease, listLabelReleases } from './providers/discogs.js';
import { findItunesCandidates } from './providers/itunes.js';
import { searchLabels, searchReleasesByLabel, type MbRelease } from './providers/musicbrainz.js';

function request(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return {
    labels: [{ mbid: 'mb-erased', name: 'Erased Tapes' }],
    timeMode: 'days',
    timeValue: 7,
    country: 'DE',
    sources: ['deezer', 'musicbrainz'],
    timezone: 'Europe/Berlin',
    ...overrides
  };
}

const fujitaDeezer: DeezerAlbum = {
  id: 1034548662,
  title: 'Forest of Tranquility',
  artist: 'Masayoshi Fujita',
  label: 'Erased Tapes',
  releaseDate: '2026-11-13',
  recordType: 'album',
  trackCount: 9,
  link: 'https://www.deezer.com/album/1034548662',
  cover: 'https://cdn-images.dzcdn.net/cover/1000x1000.jpg',
  genres: ['Electronic']
};

const fujitaMb: MbRelease = {
  id: 'f00-mb',
  title: 'Forest of Tranquility',
  date: '2026-11-13',
  'artist-credit': [{ name: 'Masayoshi Fujita' }],
  'release-group': { id: 'rg-1', 'primary-type': 'Album' },
  media: [{ format: 'Digital Media', 'track-count': 9 }]
};

describe('searchReleases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
  });

  it('merges the same release from Deezer and MusicBrainz into one card', async () => {
    vi.mocked(findLabelAlbums).mockResolvedValue([fujitaDeezer]);
    vi.mocked(searchReleasesByLabel).mockResolvedValue([fujitaMb]);

    const result = await findReleases(request());

    expect(findLabelAlbums).toHaveBeenCalledWith('Erased Tapes', '2026-11-07', '2026-11-13', 'days');
    expect(result.releases).toHaveLength(1);
    const [release] = result.releases;
    expect(release.foundBy).toEqual(['deezer', 'musicbrainz']);
    expect(release.coverUrl).toBe(fujitaDeezer.cover);
    expect(release.sourceDetails).toMatchObject({ deezerAlbumId: 1034548662, musicbrainzReleaseId: 'f00-mb' });
    expect(release.mediaFormat).toBe('Digital Media');
    expect(release.type).toBe('Album');
  });

  it('streams raw results first, then enriched results with the same id', async () => {
    vi.mocked(findLabelAlbums).mockResolvedValue([fujitaDeezer]);
    vi.mocked(findItunesCandidates).mockResolvedValue([
      {
        collectionId: 42,
        artistName: 'Masayoshi Fujita',
        collectionName: 'Forest of Tranquility',
        releaseDate: '2026-11-13T08:00:00Z',
        primaryGenreName: 'Ambient',
        artistViewUrl: 'https://music.apple.com/de/artist/1',
        collectionViewUrl: 'https://music.apple.com/de/album/42'
      }
    ]);

    const events: SearchEvent[] = [];
    await searchReleases(request({ sources: ['deezer'] }), (event) => events.push(event));

    const releaseEvents = events.filter((event) => event.type === 'releases');
    expect(releaseEvents).toHaveLength(2);
    const [raw, enriched] = releaseEvents.map((event) => (event.type === 'releases' ? event.releases[0] : null));
    expect(raw?.appleAlbumUrl).toBeUndefined();
    expect(enriched?.id).toBe(raw?.id);
    expect(enriched?.appleAlbumUrl).toBe('https://music.apple.com/de/album/42');
    expect(enriched?.genres[0]).toBe('Ambient');
    expect(events[0]).toMatchObject({ type: 'start', totalLabels: 1 });
    expect(events.at(-1)).toMatchObject({ type: 'labelDone', completed: 1 });
  });

  it('matches iTunes credits that list more artists (loose match)', async () => {
    vi.mocked(findLabelAlbums).mockResolvedValue([
      { ...fujitaDeezer, id: 5, artist: 'Popol Vuh', title: 'The Great Ecstasy of Woodcarver Steiner (Original Score & Variations)' }
    ]);
    vi.mocked(findItunesCandidates).mockResolvedValue([
      {
        collectionId: 7,
        artistName: 'Popol Vuh, james K, ML Buch & Lorenzo Senni',
        collectionName: 'The Great Ecstasy of Woodcarver Steiner (Original Score & Variations)',
        releaseDate: '2026-11-13T08:00:00Z',
        collectionViewUrl: 'https://music.apple.com/de/album/7'
      }
    ]);

    const result = await findReleases(request({ sources: ['deezer'] }));
    expect(result.releases[0].appleAlbumUrl).toBe('https://music.apple.com/de/album/7');
  });

  it('keeps going when one source fails and reports the failure per source', async () => {
    vi.mocked(findLabelAlbums).mockResolvedValue([fujitaDeezer]);
    vi.mocked(searchReleasesByLabel).mockRejectedValue(new HttpError(503, 'https://musicbrainz.org/ws/2/release/'));

    const result = await findReleases(request());

    expect(result.releases).toHaveLength(1);
    expect(result.partialFailures).toHaveLength(1);
    expect(result.partialFailures[0]).toMatchObject({ source: 'musicbrainz', label: { name: 'Erased Tapes' } });
    expect(result.partialFailures[0].message).toContain('MusicBrainz rate limit');
  });

  it('resolves name-only labels on MusicBrainz by exact name and skips MB when unknown', async () => {
    vi.mocked(searchLabels).mockResolvedValue([{ id: 'mb-cinth-other', name: 'Cinthia Records' }]);

    await findReleases(request({ labels: [{ name: 'CINTH' }] }));

    expect(searchLabels).toHaveBeenCalledWith('CINTH', 5);
    expect(searchReleasesByLabel).not.toHaveBeenCalled();
    expect(findLabelAlbums).toHaveBeenCalled();
  });

  it('uses Cover Art Archive only when no other cover exists', async () => {
    vi.mocked(searchReleasesByLabel).mockResolvedValue([fujitaMb]);
    vi.mocked(findCoverArtUrl).mockResolvedValue('https://coverartarchive.org/release/f00-mb/front-1200');

    const result = await findReleases(request({ sources: ['musicbrainz'] }));
    expect(result.releases[0].coverUrl).toBe('https://coverartarchive.org/release/f00-mb/front-1200');
  });

  it('merges a release found for two labels into one card with both labels', async () => {
    vi.mocked(findLabelAlbums).mockResolvedValue([fujitaDeezer]);

    const result = await findReleases(
      request({ sources: ['deezer'], labels: [{ name: 'Erased Tapes' }, { name: 'Erased Tapes Music' }] })
    );
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0].labels).toEqual(['Erased Tapes', 'Erased Tapes Music']);
  });
});

describe('discogs source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'));
  });

  const smallville = { name: 'Smallville' };

  function mockSmallville(): void {
    vi.mocked(listLabelReleases).mockResolvedValue([{ id: 36350449, year: 2026 }, { id: 36798148, year: 2026 }]);
    vi.mocked(fetchDiscogsRelease).mockImplementation(async (id) =>
      id === 36350449
        ? {
            id,
            title: 'Dispo',
            artist: 'Snad',
            released: '2026-01-30',
            year: 2026,
            genres: ['Electronic'],
            styles: ['Deep House', 'Tech House'],
            formatDescriptions: ['12"', '33 ⅓ RPM'],
            trackCount: 3
          }
        : {
            id,
            title: 'Poppies',
            artist: 'Lawrence',
            released: '2026-03-20',
            year: 2026,
            genres: ['Electronic'],
            styles: ['Minimal', 'Deep House', 'Ambient House'],
            formatDescriptions: ['12"', '33 ⅓ RPM'],
            trackCount: 4
          }
    );
  }

  it('returns both Smallville releases in year mode with styles and inferred types', async () => {
    mockSmallville();
    const result = await findReleases(request({ labels: [smallville], sources: ['discogs'], timeMode: 'year', timeValue: 2026 }));

    expect(listLabelReleases).toHaveBeenCalledWith(77423, [2026], undefined);
    expect(result.releases.map((entry) => entry.artist)).toEqual(['Lawrence', 'Snad']);
    expect(result.releases[0].styles).toEqual(['Minimal', 'Deep House', 'Ambient House']);
    expect(result.releases[0].type).toBe('EP');
    expect(result.releases[1].trackCount).toBe(3);
  });

  it('filters by exact day in days mode', async () => {
    mockSmallville();
    const result = await findReleases(request({ labels: [smallville], sources: ['discogs'], timeValue: 1 }));

    expect(result.releases).toHaveLength(1);
    expect(result.releases[0]).toMatchObject({ artist: 'Lawrence', releaseDate: '2026-03-20' });
  });

  it('maps Discogs 429 to a token hint', async () => {
    vi.mocked(listLabelReleases).mockRejectedValue(new HttpError(429, 'https://api.discogs.com/labels/1/releases'));
    const result = await findReleases(request({ labels: [smallville], sources: ['discogs'] }));

    expect(result.partialFailures[0].message).toContain('Discogs rate limit reached');
    expect(result.partialFailures[0].message).toContain('token');
  });
});
