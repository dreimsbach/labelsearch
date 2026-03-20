import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./providers/musicbrainz.js', () => ({
  searchReleasesByLabel: vi.fn(async () => [])
}));

vi.mock('./providers/discogs.js', () => ({
  findDiscogsCandidates: vi.fn(async () => []),
  searchDiscogsByLabelYear: vi.fn(async () => []),
  fetchDiscogsRelease: vi.fn(async () => {
    throw new Error('not configured');
  })
}));

vi.mock('./providers/itunes.js', () => ({
  findItunesCandidates: vi.fn(async () => [])
}));

vi.mock('./providers/deezer.js', () => ({
  findDeezerCandidates: vi.fn(async () => [])
}));

vi.mock('./lib/logger.js', () => ({
  logWarn: vi.fn(async () => undefined),
  logInfo: vi.fn(async () => undefined),
  logError: vi.fn(async () => undefined)
}));

import { findReleases } from './release-service.js';
import { fetchDiscogsRelease, searchDiscogsByLabelYear } from './providers/discogs.js';
import { findItunesCandidates } from './providers/itunes.js';

describe('findReleases discogs mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns exactly 2 releases for Smallville in year 2026', async () => {
    vi.mocked(searchDiscogsByLabelYear).mockImplementation(async (_label, year) => {
      if (year !== 2026) {
        return [];
      }
      return [{ id: 36350449 }, { id: 36798148 }] as Array<{ id: number }>;
    });

    vi.mocked(fetchDiscogsRelease).mockImplementation(async (id) => {
      if (id === 36350449) {
        return {
          id,
          title: 'Dispo',
          artist: 'Snad',
          released: '2026-01-30',
          year: 2026,
          country: 'Germany',
          uri: 'https://www.discogs.com/release/36350449-Snad-Dispo',
          thumb: 'https://example.com/dispo.jpg',
          genres: ['Electronic'],
          styles: ['Deep House', 'Tech House'],
          formatDescriptions: ['12"', '33 ⅓ RPM'],
          trackCount: 3
        };
      }

      return {
        id,
        title: 'Poppies',
        artist: 'Lawrence',
        released: '2026-03-20',
        year: 2026,
        country: 'Germany',
        uri: 'https://www.discogs.com/release/36798148-Lawrence-Poppies',
        thumb: 'https://example.com/poppies.jpg',
        genres: ['Electronic'],
        styles: ['Minimal', 'Deep House', 'Ambient House'],
        formatDescriptions: ['12"', '33 ⅓ RPM'],
        trackCount: 4
      };
    });

    const result = await findReleases({
      labels: [{ mbid: 'mb-smallville', name: 'Smallville' }],
      timeMode: 'year',
      timeValue: 2026,
      country: 'DE',
      sourceMode: 'discogs',
      timezone: 'Europe/Berlin'
    });

    expect(result.releases).toHaveLength(2);
    expect(result.releases.map((entry) => entry.artist)).toEqual(['Lawrence', 'Snad']);
    expect(result.releases[0].styles).toEqual(['Minimal', 'Deep House', 'Ambient House']);
    expect(result.releases[1].styles).toEqual(['Deep House', 'Tech House']);
    expect(result.releases[0].type).toBe('EP');
    expect(result.releases[1].trackCount).toBe(3);
  });

  it('returns only Lawrence on the exact day 2026-03-20', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'));

    vi.mocked(searchDiscogsByLabelYear).mockResolvedValue([{ id: 36350449 }, { id: 36798148 }] as Array<{ id: number }>);
    vi.mocked(fetchDiscogsRelease).mockImplementation(async (id) => {
      if (id === 36350449) {
        return {
          id,
          title: 'Dispo',
          artist: 'Snad',
          released: '2026-01-30',
          year: 2026,
          genres: ['Electronic'],
          styles: ['Deep House', 'Tech House'],
          formatDescriptions: ['12"', '33 ⅓ RPM'],
          trackCount: 3
        };
      }

      return {
        id,
        title: 'Poppies',
        artist: 'Lawrence',
        released: '2026-03-20',
        year: 2026,
        genres: ['Electronic'],
        styles: ['Minimal', 'Deep House', 'Ambient House'],
        formatDescriptions: ['12"', '33 ⅓ RPM'],
        trackCount: 4
      };
    });

    const result = await findReleases({
      labels: [{ mbid: 'mb-smallville', name: 'Smallville' }],
      timeMode: 'days',
      timeValue: 1,
      country: 'DE',
      sourceMode: 'discogs',
      timezone: 'Europe/Berlin'
    });

    expect(result.releases).toHaveLength(1);
    expect(result.releases[0].artist).toBe('Lawrence');
    expect(result.releases[0].releaseDate).toBe('2026-03-20');

    vi.useRealTimers();
  });

  it('records partial failures when Discogs provider fails for a label', async () => {
    vi.mocked(searchDiscogsByLabelYear).mockRejectedValue(new Error('Discogs down'));

    const result = await findReleases({
      labels: [{ mbid: 'mb-smallville', name: 'Smallville' }],
      timeMode: 'year',
      timeValue: 2026,
      country: 'DE',
      sourceMode: 'discogs',
      timezone: 'Europe/Berlin'
    });

    expect(result.releases).toEqual([]);
    expect(result.partialFailures).toHaveLength(1);
    expect(result.partialFailures[0].label.name).toBe('Smallville');
    expect(result.partialFailures[0].message).toContain('Discogs down');
  });

  it('maps Discogs 429 errors to a friendly message', async () => {
    vi.mocked(searchDiscogsByLabelYear).mockRejectedValue(
      new Error('HTTP 429 for https://api.discogs.com/database/search?type=release&page=1')
    );

    const result = await findReleases({
      labels: [{ mbid: 'mb-smallville', name: 'Smallville' }],
      timeMode: 'year',
      timeValue: 2026,
      country: 'DE',
      sourceMode: 'discogs',
      timezone: 'Europe/Berlin'
    });

    expect(result.partialFailures).toHaveLength(1);
    expect(result.partialFailures[0].message).toContain('Discogs rate limit reached');
    expect(result.partialFailures[0].message).toContain('DISCOGS_TOKEN');
  });

  it('adds Apple links in discogs mode when iTunes match exists', async () => {
    vi.mocked(searchDiscogsByLabelYear).mockResolvedValue([{ id: 36798148 }] as Array<{ id: number }>);
    vi.mocked(fetchDiscogsRelease).mockResolvedValue({
      id: 36798148,
      title: 'Poppies',
      artist: 'Lawrence',
      released: '2026-03-20',
      year: 2026,
      country: 'Germany',
      uri: 'https://www.discogs.com/release/36798148-Lawrence-Poppies',
      thumb: 'https://example.com/poppies.jpg',
      genres: ['Electronic'],
      styles: ['Minimal'],
      formatDescriptions: ['12"', '33 ⅓ RPM'],
      trackCount: 4
    });

    vi.mocked(findItunesCandidates).mockResolvedValue([
      {
        collectionId: 100,
        artistName: 'Lawrence',
        collectionName: 'Poppies - EP',
        releaseDate: '2026-03-20',
        artistViewUrl: 'https://music.apple.com/artist/lawrence/1',
        collectionViewUrl: 'https://music.apple.com/album/poppies/2',
        artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/a/b/c/100x100bb.jpg'
      }
    ]);

    const result = await findReleases({
      labels: [{ mbid: 'mb-smallville', name: 'Smallville' }],
      timeMode: 'year',
      timeValue: 2026,
      country: 'DE',
      sourceMode: 'discogs',
      timezone: 'Europe/Berlin'
    });

    expect(result.releases).toHaveLength(1);
    expect(result.releases[0].appleArtistUrl).toContain('music.apple.com/artist/lawrence');
    expect(result.releases[0].appleAlbumUrl).toContain('music.apple.com/album/poppies');
    expect(result.releases[0].sourceDetails.itunesCollectionId).toBe(100);
    const labels = (result.releases[0].externalLinks ?? []).map((entry) => entry.label);
    expect(labels).toContain('Apple Artist');
    expect(labels).toContain('Apple Album');
  });

  it('infers release type from Discogs rules', async () => {
    vi.mocked(searchDiscogsByLabelYear).mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] as Array<{ id: number }>);
    vi.mocked(fetchDiscogsRelease).mockImplementation(async (id) => {
      if (id === 1) {
        return {
          id,
          title: 'Solar EP',
          artist: 'A',
          released: '2026-04-01',
          year: 2026,
          genres: [],
          styles: [],
          formatDescriptions: [],
          trackCount: 8
        };
      }
      if (id === 2) {
        return {
          id,
          title: 'Cut',
          artist: 'B',
          released: '2026-04-02',
          year: 2026,
          genres: [],
          styles: [],
          formatDescriptions: ['45 RPM'],
          trackCount: 9
        };
      }
      if (id === 3) {
        return {
          id,
          title: 'Longplay',
          artist: 'C',
          released: '2026-04-03',
          year: 2026,
          genres: [],
          styles: [],
          formatDescriptions: ['LP'],
          trackCount: undefined
        };
      }
      return {
        id,
        title: 'Set',
        artist: 'D',
        released: '2026-04-04',
        year: 2026,
        genres: [],
        styles: [],
        formatDescriptions: [],
        trackCount: 7
      };
    });

    const result = await findReleases({
      labels: [{ mbid: 'mb-x', name: 'X' }],
      timeMode: 'year',
      timeValue: 2026,
      country: 'DE',
      sourceMode: 'discogs',
      timezone: 'Europe/Berlin'
    });

    const typeByArtist = new Map(result.releases.map((entry) => [entry.artist, entry.type]));
    expect(typeByArtist.get('A')).toBe('EP');
    expect(typeByArtist.get('B')).toBe('Single');
    expect(typeByArtist.get('C')).toBe('Album');
    expect(typeByArtist.get('D')).toBe('Album');
  });
});
