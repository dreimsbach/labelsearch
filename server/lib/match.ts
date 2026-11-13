import { dayDistance, normalizeText } from '../../shared/merge.js';
import type { ReleaseType } from '../../shared/types.js';

export interface ItunesCandidate {
  collectionId: number;
  artistName: string;
  collectionName: string;
  releaseDate: string;
  primaryGenreName?: string;
  collectionType?: string;
  artistViewUrl?: string;
  collectionViewUrl?: string;
  artworkUrl100?: string;
}

export function scoreCandidate(artist: string, title: string, releaseDate: string, candidate: ItunesCandidate): number {
  let score = 0;
  if (normalizeText(candidate.artistName) === normalizeText(artist)) {
    score += 60;
  }
  if (normalizeText(candidate.collectionName) === normalizeText(title)) {
    score += 30;
  }
  if (dayDistance(candidate.releaseDate, releaseDate) <= 2) {
    score += 10;
  }
  return score;
}

/** Strict: exact normalized artist + title (score >= 80), ties broken by date distance. */
export function pickBestItunesMatch(artist: string, title: string, releaseDate: string, candidates: ItunesCandidate[]): ItunesCandidate | null {
  let best: ItunesCandidate | null = null;
  let bestScore = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const score = scoreCandidate(artist, title, releaseDate, candidate);
    const distance = dayDistance(candidate.releaseDate, releaseDate);
    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      best = candidate;
      bestScore = score;
      bestDistance = distance;
    }
  }

  return bestScore >= 80 ? best : null;
}

/**
 * Loose fallback for credits like "Popol Vuh, james K, ML Buch & Lorenzo Senni" vs "Popol Vuh":
 * artist and title must contain each other and the date must be within 7 days.
 */
export function pickLooseItunesMatch(artist: string, title: string, releaseDate: string, candidates: ItunesCandidate[]): ItunesCandidate | null {
  const wantedArtist = normalizeText(artist);
  const wantedTitle = normalizeText(title);
  if (!wantedArtist || !wantedTitle) {
    return null;
  }

  const contains = (left: string, right: string): boolean => Boolean(left && right) && (left.includes(right) || right.includes(left));
  let best: ItunesCandidate | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const distance = dayDistance(candidate.releaseDate, releaseDate);
    if (
      distance <= 7 &&
      distance < bestDistance &&
      contains(normalizeText(candidate.artistName), wantedArtist) &&
      contains(normalizeText(candidate.collectionName), wantedTitle)
    ) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}

export function pickItunesMatch(artist: string, title: string, releaseDate: string, candidates: ItunesCandidate[]): ItunesCandidate | null {
  return pickBestItunesMatch(artist, title, releaseDate, candidates) ?? pickLooseItunesMatch(artist, title, releaseDate, candidates);
}

export function mapReleaseType(primaryType?: string, secondaryTypes: string[] = [], itunesCollectionType?: string, title = ''): ReleaseType {
  const lowerPrimary = (primaryType ?? '').toLowerCase();
  const lowerSecondary = secondaryTypes.map((entry) => entry.toLowerCase());

  if (lowerPrimary === 'album') {
    return 'Album';
  }
  if (lowerPrimary === 'single') {
    return 'Single';
  }
  if (lowerPrimary === 'ep' || lowerSecondary.includes('ep')) {
    return 'EP';
  }
  if ((itunesCollectionType ?? '').toLowerCase() === 'album' && /\bep\b/i.test(title)) {
    return 'EP';
  }
  if ((itunesCollectionType ?? '').toLowerCase() === 'album') {
    return 'Album';
  }
  return 'Single';
}

/** Deezer `record_type`: album | ep | single | compile */
export function mapDeezerRecordType(recordType?: string, title = ''): ReleaseType {
  switch ((recordType ?? '').toLowerCase()) {
    case 'ep':
      return 'EP';
    case 'single':
      return /\bep\b/i.test(title) ? 'EP' : 'Single';
    default:
      return 'Album';
  }
}

export function inferDiscogsType(title: string, descriptions: string[], trackTotal?: number): ReleaseType {
  const lowerDescriptions = descriptions.map((entry) => entry.toLowerCase());

  if (/\bep\b/i.test(title) || lowerDescriptions.some((entry) => /\bep\b/i.test(entry))) {
    return 'EP';
  }
  if (lowerDescriptions.some((entry) => entry.includes('single') || entry.includes('45 rpm'))) {
    return 'Single';
  }
  if (typeof trackTotal === 'number') {
    if (trackTotal <= 2) {
      return 'Single';
    }
    return trackTotal <= 6 ? 'EP' : 'Album';
  }
  if (lowerDescriptions.some((entry) => /\blp\b/i.test(entry) || entry.includes('album'))) {
    return 'Album';
  }
  return 'Single';
}

export function resolveGenres(primaryGenreName?: string, ...fallbacks: string[][]): string[] {
  const cleaned = new Map<string, string>();

  const add = (value: string | undefined): void => {
    const trimmed = value?.trim();
    if (!trimmed || trimmed.length < 2 || trimmed.length > 30 || !/[a-z0-9]/i.test(trimmed)) {
      return;
    }
    const key = trimmed.toLowerCase();
    if (!cleaned.has(key)) {
      cleaned.set(key, trimmed);
    }
  };

  add(primaryGenreName);
  fallbacks.forEach((list) => list.forEach(add));

  const values = [...cleaned.values()].slice(0, 3);
  return values.length > 0 ? values : ['Genre unbekannt'];
}
