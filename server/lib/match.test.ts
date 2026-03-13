import { describe, expect, it } from 'vitest';
import { mapReleaseType, pickBestExternalMatch, pickBestItunesMatch, resolveGenres, scoreCandidate, scoreExternalCandidate } from './match.js';

describe('match helpers', () => {
  it('scores exact match at 100', () => {
    const score = scoreCandidate('The Notwist', 'News from Planet Zombie', '2026-03-13', {
      collectionId: 1,
      artistName: 'The Notwist',
      collectionName: 'News from Planet Zombie',
      releaseDate: '2026-03-13T00:00:00Z'
    });

    expect(score).toBe(100);
  });

  it('rejects low-confidence candidates', () => {
    const picked = pickBestItunesMatch('The Notwist', 'News from Planet Zombie', '2026-03-13', [
      {
        collectionId: 1,
        artistName: 'Other Artist',
        collectionName: 'Other Name',
        releaseDate: '2026-01-01T00:00:00Z'
      }
    ]);

    expect(picked).toBeNull();
  });

  it('maps EP from secondary types', () => {
    expect(mapReleaseType('Album', ['EP'], 'album', 'Anything')).toBe('Album');
    expect(mapReleaseType(undefined, ['EP'], undefined, 'Anything')).toBe('EP');
  });

  it('builds genre fallback', () => {
    expect(resolveGenres('Indie-Pop', ['Indie Rock'], ['dream pop', 'dream pop'])).toEqual(['Indie-Pop', 'Indie Rock', 'dream pop']);
  });

  it('scores external candidate with strict date requirement', () => {
    const score = scoreExternalCandidate('Simo Cell', 'MURMURATIONS', '2026-03-12', {
      source: 'deezer',
      id: 1,
      artistName: 'Simo Cell',
      collectionName: 'MURMURATIONS',
      releaseDate: '2026-03-12'
    });

    expect(score).toBeGreaterThanOrEqual(80);
  });

  it('rejects external candidates without usable date proximity', () => {
    const picked = pickBestExternalMatch('Simo Cell', 'MURMURATIONS', '2026-03-12', [
      {
        source: 'deezer',
        id: 2,
        artistName: 'Simo Cell',
        collectionName: 'MURMURATIONS'
      }
    ]);

    expect(picked).toBeNull();
  });
});
