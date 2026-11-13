import type { ExternalLink, Release } from './types.js';

const BRACKETS_RE = /\((.*?)\)|\[(.*?)\]/g;
const NOISE_RE = /\b(deluxe|remaster(ed)?|explicit|edition|version)\b/g;
const SUFFIX_RE = /\s+-\s+(ep|single)$/;

/** Same-release tolerance between providers that disagree on the exact day. */
const MERGE_MAX_DAY_DISTANCE = 14;

export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(SUFFIX_RE, '')
    .replace(BRACKETS_RE, '')
    .replace(NOISE_RE, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function dayDistance(left?: string, right?: string): number {
  if (!left || !right) {
    return Number.POSITIVE_INFINITY;
  }
  const a = Date.parse(`${left.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${right.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.round(Math.abs(a - b) / 86_400_000);
}

/** "DJ Seinfeld" vs "DJ Seinfeld & Peter Xan": providers credit featured artists differently. */
function sameArtist(left: string, right: string): boolean {
  const a = normalizeText(left);
  const b = normalizeText(right);
  return a === b || (a.length > 0 && b.length > 0 && (` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `)));
}

export function uniqueLinks(items: ExternalLink[] = []): ExternalLink[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item?.url || seen.has(item.url)) {
      return false;
    }
    seen.add(item.url);
    return true;
  });
}

function union<T>(left: T[] = [], right: T[] = []): T[] {
  return [...new Set([...left, ...right])];
}

/** Merge `incoming` into `existing`; existing values win, gaps are filled from incoming. */
export function mergeRelease(existing: Release, incoming: Release): Release {
  return {
    ...incoming,
    ...Object.fromEntries(Object.entries(existing).filter(([, value]) => value !== undefined)),
    labels: union(existing.labels, incoming.labels),
    matchedByLabel: union(existing.matchedByLabel, incoming.matchedByLabel),
    foundBy: union(existing.foundBy, incoming.foundBy),
    genres: existing.genres.length > 0 && existing.genres[0] !== 'Genre unbekannt' ? existing.genres : incoming.genres,
    styles: (existing.styles?.length ?? 0) > 0 ? existing.styles : incoming.styles,
    externalLinks: uniqueLinks([...(existing.externalLinks ?? []), ...(incoming.externalLinks ?? [])]),
    sourceDetails: { ...incoming.sourceDetails, ...existing.sourceDetails }
  } as Release;
}

/** Dedupe across sources and labels: same title by the same artist within a few days is one release. */
export function mergeReleases(releases: Release[]): Release[] {
  const buckets = new Map<string, Release[]>();

  for (const release of releases) {
    const key = normalizeText(release.title);
    const bucket = buckets.get(key) ?? [];
    const index = bucket.findIndex(
      (entry) => sameArtist(entry.artist, release.artist) && dayDistance(entry.releaseDate, release.releaseDate) <= MERGE_MAX_DAY_DISTANCE
    );
    if (index >= 0) {
      bucket[index] = mergeRelease(bucket[index], release);
    } else {
      bucket.push(release);
    }
    buckets.set(key, bucket);
  }

  return [...buckets.values()].flat().sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.artist.localeCompare(b.artist));
}
