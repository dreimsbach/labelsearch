import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/http.js', () => ({ fetchJson: vi.fn() }));

import { clearCache } from '../lib/cache.js';
import { fetchJson } from '../lib/http.js';
import { findLabelAlbums } from './deezer.js';

interface FakeAlbum {
  id: number;
  label: string;
  release_date: string;
  title?: string;
}

function serve(albums: FakeAlbum[]): void {
  vi.mocked(fetchJson).mockImplementation(async (url: string) => {
    if (url.includes('/search/album')) {
      return { data: albums.map((album) => ({ id: album.id })), total: albums.length };
    }
    const id = Number(url.split('/album/')[1]);
    const album = albums.find((entry) => entry.id === id);
    return album
      ? { id, title: album.title ?? `Album ${id}`, label: album.label, release_date: album.release_date, artist: { name: 'Artist' } }
      : { error: { code: 800, type: 'DataException' } };
  });
}

function detailCalls(): number {
  return vi.mocked(fetchJson).mock.calls.filter(([url]) => String(url).includes('/album/') && !String(url).includes('/search/')).length;
}

describe('findLabelAlbums', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCache();
  });

  it('keeps only exact label matches inside the window', async () => {
    serve([
      { id: 900, label: 'Neon Latency Records', release_date: '2026-11-10' },
      { id: 800, label: 'Latency', release_date: '2026-11-13', title: 'Woodcarver Steiner' },
      { id: 700, label: 'Latency Records', release_date: '2026-10-01' }
    ]);

    const albums = await findLabelAlbums('Latency', '2026-11-07', '2026-11-13', 'days');
    expect(albums.map((album) => album.title)).toEqual(['Woodcarver Steiner']);
  });

  it('finds pre-order ingests behind newer, older-dated albums', async () => {
    // Fujita was ingested months ahead: several albums with higher ids were released earlier.
    serve([
      { id: 1000, label: 'Erased Tapes', release_date: '2026-11-11' },
      { id: 990, label: 'Erased Tapes', release_date: '2026-10-30' },
      { id: 980, label: 'Erased Tapes', release_date: '2026-09-03' },
      { id: 970, label: 'Erased Tapes', release_date: '2026-08-11' },
      { id: 960, label: 'Erased Tapes', release_date: '2026-11-13', title: 'Forest of Tranquility' }
    ]);

    const albums = await findLabelAlbums('Erased Tapes', '2026-11-07', '2026-11-13', 'days');
    expect(albums.map((album) => album.title)).toEqual(['Album 1000', 'Forest of Tranquility']);
  });

  it('stops after a streak of albums released long before the window', async () => {
    const old = Array.from({ length: 60 }, (_, index) => ({ id: 500 - index, label: 'Warp Records', release_date: '2019-01-01' }));
    serve([{ id: 1000, label: 'Warp Records', release_date: '2026-11-13' }, ...old]);

    const albums = await findLabelAlbums('Warp', '2026-11-07', '2026-11-13', 'days');
    expect(albums).toHaveLength(1);
    expect(detailCalls()).toBeLessThanOrEqual(20);
  });

  it('serves repeated searches from cache', async () => {
    serve([{ id: 1, label: 'Nonesuch', release_date: '2026-11-13' }]);
    await findLabelAlbums('Nonesuch', '2026-11-07', '2026-11-13', 'days');
    const calls = vi.mocked(fetchJson).mock.calls.length;
    await findLabelAlbums('Nonesuch', '2026-11-07', '2026-11-13', 'days');
    expect(vi.mocked(fetchJson).mock.calls.length).toBe(calls);
  });
});
