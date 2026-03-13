import type { ReleaseType } from '../../shared/types.js';

const CLEANUP_RE = /\((.*?)\)|\[(.*?)\]|\b(deluxe|remaster|explicit|edition|version)\b/gi;

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(CLEANUP_RE, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dateDistanceDays(left: string, right: string): number {
  const l = new Date(left.slice(0, 10));
  const r = new Date(right.slice(0, 10));
  const ms = Math.abs(l.getTime() - r.getTime());
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function safeDateDistanceDays(left?: string, right?: string): number | null {
  if (!left || !right) {
    return null;
  }

  const l = new Date(left.slice(0, 10));
  const r = new Date(right.slice(0, 10));
  if (Number.isNaN(l.getTime()) || Number.isNaN(r.getTime())) {
    return null;
  }

  const ms = Math.abs(l.getTime() - r.getTime());
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

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

export interface ExternalCandidate {
  source: 'deezer' | 'discogs';
  id: number;
  artistName: string;
  collectionName: string;
  releaseDate?: string;
  primaryGenreName?: string;
  albumUrl?: string;
  artworkUrl?: string;
}

export function scoreCandidate(artist: string, title: string, releaseDate: string, candidate: ItunesCandidate): number {
  let score = 0;

  if (normalize(candidate.artistName) === normalize(artist)) {
    score += 60;
  }

  if (normalize(candidate.collectionName) === normalize(title)) {
    score += 30;
  }

  if (dateDistanceDays(candidate.releaseDate, releaseDate) <= 2) {
    score += 10;
  }

  return score;
}

export function pickBestItunesMatch(
  artist: string,
  title: string,
  releaseDate: string,
  candidates: ItunesCandidate[]
): ItunesCandidate | null {
  let best: ItunesCandidate | null = null;
  let bestScore = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const score = scoreCandidate(artist, title, releaseDate, candidate);
    const distance = dateDistanceDays(candidate.releaseDate, releaseDate);

    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      best = candidate;
      bestScore = score;
      bestDistance = distance;
    }
  }

  if (bestScore < 80) {
    return null;
  }

  return best;
}

export function scoreExternalCandidate(artist: string, title: string, releaseDate: string, candidate: ExternalCandidate): number {
  const normalizedArtist = normalize(artist);
  const normalizedTitle = normalize(title);
  const candidateArtist = normalize(candidate.artistName);
  const candidateTitle = normalize(candidate.collectionName);

  let score = 0;
  let titleMatched = false;
  let artistMatched = false;

  if (candidateArtist === normalizedArtist) {
    score += 45;
    artistMatched = true;
  } else if (candidateArtist.includes(normalizedArtist) || normalizedArtist.includes(candidateArtist)) {
    score += 30;
    artistMatched = true;
  }

  if (candidateTitle === normalizedTitle) {
    score += 45;
    titleMatched = true;
  } else if (candidateTitle.includes(normalizedTitle) || normalizedTitle.includes(candidateTitle)) {
    score += 30;
    titleMatched = true;
  }

  const distance = safeDateDistanceDays(candidate.releaseDate, releaseDate);
  if (distance !== null && distance <= 7) {
    score += 10;
  }

  if (!titleMatched || !artistMatched || distance === null || distance > 7) {
    return 0;
  }

  return score;
}

export function pickBestExternalMatch(
  artist: string,
  title: string,
  releaseDate: string,
  candidates: ExternalCandidate[]
): ExternalCandidate | null {
  let best: ExternalCandidate | null = null;
  let bestScore = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const score = scoreExternalCandidate(artist, title, releaseDate, candidate);
    const distance = safeDateDistanceDays(candidate.releaseDate, releaseDate) ?? Number.POSITIVE_INFINITY;

    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      best = candidate;
      bestScore = score;
      bestDistance = distance;
    }
  }

  if (bestScore < 75) {
    return null;
  }

  return best;
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

  if (lowerSecondary.includes('ep')) {
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

export function resolveGenres(primaryGenreName?: string, mbGenres: string[] = [], mbTags: string[] = []): string[] {
  const cleaned = new Map<string, string>();

  const add = (value: string | undefined): void => {
    if (!value) {
      return;
    }

    const trimmed = value.trim();
    if (trimmed.length < 2 || trimmed.length > 30 || !/[a-z0-9]/i.test(trimmed)) {
      return;
    }

    const key = trimmed.toLowerCase();
    if (!cleaned.has(key)) {
      cleaned.set(key, trimmed);
    }
  };

  add(primaryGenreName);
  mbGenres.forEach(add);
  mbTags.forEach(add);

  const values = [...cleaned.values()].slice(0, 3);
  return values.length > 0 ? values : ['Genre unbekannt'];
}

export function dedupeReleaseKey(artist: string, title: string, releaseDate: string): string {
  return `${normalize(artist)}::${normalize(title)}::${releaseDate.slice(0, 10)}`;
}
