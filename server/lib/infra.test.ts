import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeReleases } from '../../shared/merge.js';
import type { Release } from '../../shared/types.js';
import { HttpError, fetchJson, redactUrl } from './http.js';
import { labelMatches, normalizeLabelName } from './labels.js';
import { RateLimiter } from './limiter.js';

describe('labelMatches', () => {
  it('ignores legal suffixes and generic words', () => {
    expect(normalizeLabelName('Erased Tapes Records Ltd.')).toBe('erased tapes');
    expect(labelMatches('Erased Tapes', 'Erased Tapes Records Ltd.')).toBe(true);
    expect(labelMatches('Sub Pop', 'Sub Pop Records')).toBe(true);
  });

  it('matches one part of a combined label string', () => {
    expect(labelMatches('Nonesuch', 'Etoile Audio/Nonesuch')).toBe(true);
  });

  it('rejects fuzzy search noise', () => {
    expect(labelMatches('Latency', 'Low Latency FM')).toBe(false);
    expect(labelMatches('Latency', 'Neon Latency Records')).toBe(false);
    expect(labelMatches('Latency', undefined)).toBe(false);
  });
});

describe('RateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('spaces requests beyond the window budget', async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter('test', 2, 1000);
    const started: number[] = [];
    const start = Date.now();
    const runs = [1, 2, 3].map(() => limiter.acquire().then(() => started.push(Date.now() - start)));
    await vi.advanceTimersByTimeAsync(1500);
    await Promise.all(runs);
    expect(started.slice(0, 2)).toEqual([0, 0]);
    expect(started[2]).toBeGreaterThanOrEqual(1000);
  });
});

describe('fetchJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('retries a 429 once the Retry-After pause has passed', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '1' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchJson<{ ok: boolean }>('https://api.example.com/x', { limiter: new RateLimiter('t', 10, 1000) });
    await vi.advanceTimersByTimeAsync(1500);
    await expect(promise).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry client errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchJson('https://api.example.com/missing')).rejects.toBeInstanceOf(HttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('redacts tokens in error messages', () => {
    expect(redactUrl('https://api.discogs.com/x?token=secret&page=2')).toBe('https://api.discogs.com/x?token=***&page=2');
  });
});

describe('mergeReleases', () => {
  const base: Release = {
    id: 'a',
    artist: 'Efdemin & VRIL',
    title: 'Endless / Purge - EP',
    releaseDate: '2026-11-13',
    genres: ['Genre unbekannt'],
    labels: ['CINTH'],
    type: 'EP',
    sourceDetails: {},
    matchedByLabel: ['CINTH'],
    foundBy: ['deezer']
  };

  it('merges across providers despite " - EP" suffix and one-day date drift', () => {
    const merged = mergeReleases([
      base,
      { ...base, id: 'b', title: 'Endless / Purge', releaseDate: '2026-11-12', genres: ['Techno'], foundBy: ['musicbrainz'] }
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 'a', genres: ['Techno'], foundBy: ['deezer', 'musicbrainz'] });
  });

  it('merges artist credits that include featured artists, but not different artists', () => {
    const seinfeld = { ...base, artist: 'DJ Seinfeld', title: 'Modern Dystopia', releaseDate: '2026-11-11' };
    const merged = mergeReleases([
      seinfeld,
      { ...seinfeld, id: 'x', artist: 'DJ Seinfeld & Peter Xan', releaseDate: '2026-11-09' },
      { ...seinfeld, id: 'y', artist: 'Seinfeldt' }
    ]);
    expect(merged.map((entry) => entry.id).sort()).toEqual(['a', 'y']);
  });

  it('keeps reissues far apart in time separate', () => {
    expect(mergeReleases([base, { ...base, id: 'c', releaseDate: '2021-05-01' }])).toHaveLength(2);
  });
});
