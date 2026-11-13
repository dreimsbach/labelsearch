import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface Entry {
  value: unknown;
  expiresAt: number;
}

const MAX_ENTRIES = 50_000;
const SAVE_DEBOUNCE_MS = 5_000;

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
let persistPath: string | undefined;
let saveTimer: NodeJS.Timeout | undefined;

function evictOverflow(): void {
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) {
      return;
    }
    entries.delete(oldest);
  }
}

function scheduleSave(): void {
  if (!persistPath || saveTimer) {
    return;
  }
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    void saveCache();
  }, SAVE_DEBOUNCE_MS);
  saveTimer.unref();
}

export function getCached<T>(key: string): T | undefined {
  const entry = entries.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    entries.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function setCached(key: string, value: unknown, ttlMs: number): void {
  entries.delete(key);
  entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  evictOverflow();
  scheduleSave();
}

/**
 * Read-through cache with in-flight dedupe. `ttl` may depend on the loaded value
 * (e.g. shorter TTL for fresh releases whose metadata can still change).
 */
export async function cached<T>(key: string, ttl: number | ((value: T) => number), load: () => Promise<T>): Promise<T> {
  const hit = getCached<T>(key);
  if (hit !== undefined) {
    return hit;
  }
  const running = inflight.get(key);
  if (running) {
    return running as Promise<T>;
  }

  const promise = load()
    .then((value) => {
      const ttlMs = typeof ttl === 'function' ? ttl(value) : ttl;
      if (ttlMs > 0 && value !== undefined) {
        setCached(key, value, ttlMs);
      }
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

export function clearCache(): void {
  entries.clear();
  inflight.clear();
}

/** Enable file persistence (JSON). Without this call the cache is memory-only (tests). */
export async function initCachePersistence(filePath: string): Promise<number> {
  persistPath = filePath;
  try {
    const raw = await readFile(filePath, 'utf8');
    const data = JSON.parse(raw) as Record<string, Entry>;
    const now = Date.now();
    for (const [key, entry] of Object.entries(data)) {
      if (entry && entry.expiresAt > now) {
        entries.set(key, entry);
      }
    }
    evictOverflow();
  } catch {
    // missing or corrupt cache file: start empty
  }
  return entries.size;
}

export async function saveCache(): Promise<void> {
  if (!persistPath) {
    return;
  }
  const now = Date.now();
  const data: Record<string, Entry> = {};
  for (const [key, entry] of entries) {
    if (entry.expiresAt > now) {
      data[key] = entry;
    }
  }
  const tmp = `${persistPath}.tmp`;
  await mkdir(path.dirname(persistPath), { recursive: true });
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, persistPath);
}
