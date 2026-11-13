import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMeta, findReleases, searchReleases } from './release-service.js';
import { searchLabels } from './providers/musicbrainz.js';
import { initCachePersistence, saveCache } from './lib/cache.js';
import { logError, logInfo } from './lib/logger.js';
import { ALL_SOURCES, DEFAULT_SOURCES } from '../shared/types.js';
import type { HealthResponse, LabelRef, SearchEvent, SearchRequest, SearchResponse, SourceId } from '../shared/types.js';

const app = express();
const port = Number(process.env.PORT ?? 8787);
const cacheFile = process.env.CACHE_FILE_PATH?.trim() ?? path.resolve(process.cwd(), 'data/cache.json');

app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    void logInfo('HTTP request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - started
    });
  });
  next();
});

/** Validates the request body; returns an error message or the normalized request. */
function parseSearchRequest(body: unknown): SearchRequest | string {
  const input = (body ?? {}) as Partial<SearchRequest> & { sourceMode?: string };

  const labels: LabelRef[] = Array.isArray(input.labels)
    ? input.labels
        .filter((entry): entry is LabelRef => typeof entry?.name === 'string' && entry.name.trim().length > 0)
        .map((entry) => ({ name: entry.name.trim(), mbid: typeof entry.mbid === 'string' && entry.mbid ? entry.mbid : undefined }))
    : [];
  if (labels.length === 0) {
    return 'labels are required';
  }
  if (labels.length > 500) {
    return 'at most 500 labels per search';
  }

  const timeMode = input.timeMode ?? 'days';
  const timeValue = Number(input.timeValue);
  if (timeMode !== 'days' && timeMode !== 'year') {
    return 'timeMode must be days or year';
  }
  if (timeMode === 'days' && (!timeValue || timeValue < 1 || timeValue > 3650)) {
    return 'timeValue for days must be between 1 and 3650';
  }
  if (timeMode === 'year' && (!timeValue || timeValue < 1900 || timeValue > 2100)) {
    return 'timeValue for year must be between 1900 and 2100';
  }

  const requested = Array.isArray(input.sources) ? input.sources.filter((source): source is SourceId => ALL_SOURCES.includes(source)) : [];
  // Legacy clients sent `sourceMode`; map it onto the new source list.
  const legacy: Record<string, SourceId[]> = { discogs: ['discogs'], musicbrainz: ['musicbrainz'], hybrid: DEFAULT_SOURCES };
  const sources = requested.length > 0 ? requested : (legacy[input.sourceMode ?? ''] ?? DEFAULT_SOURCES);

  return {
    labels,
    timeMode,
    timeValue,
    sources,
    country: (input.country || 'DE').toUpperCase(),
    timezone: input.timezone || 'Europe/Berlin',
    discogsToken: typeof input.discogsToken === 'string' && input.discogsToken.trim() ? input.discogsToken.trim() : undefined
  };
}

app.get('/api/health', (_req, res) => {
  const payload: HealthResponse = { ok: true, now: new Date().toISOString() };
  res.json(payload);
});

app.get('/api/labels/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const limit = Math.min(Number(req.query.limit ?? 10), 20);

  if (!q) {
    res.json({ labels: [] });
    return;
  }

  try {
    res.json({ labels: await searchLabels(q, limit) });
  } catch (error) {
    void logError('Label search failed', { query: q, limit, error: error instanceof Error ? error.message : String(error) });
    res.status(502).json({ error: error instanceof Error ? error.message : 'Label search failed' });
  }
});

app.post('/api/releases/search', async (req, res) => {
  const input = parseSearchRequest(req.body);
  if (typeof input === 'string') {
    res.status(400).json({ error: input });
    return;
  }

  try {
    const result = await findReleases(input);
    const payload: SearchResponse = { releases: result.releases, meta: buildMeta(input, result) };
    res.json(payload);
  } catch (error) {
    void logError('Release search failed', { labels: input.labels.map((entry) => entry.name), error: String(error) });
    res.status(502).json({ error: error instanceof Error ? error.message : 'Search failed' });
  }
});

/** Same search, streamed as NDJSON (`SearchEvent` per line) so the UI can render label by label. */
app.post('/api/releases/stream', async (req, res) => {
  const input = parseSearchRequest(req.body);
  if (typeof input === 'string') {
    res.status(400).json({ error: input });
    return;
  }

  const abort = new AbortController();
  res.on('close', () => abort.abort());
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event: SearchEvent): void => {
    if (!res.writableEnded && !abort.signal.aborted) {
      res.write(`${JSON.stringify(event)}\n`);
    }
  };

  try {
    const result = await searchReleases(input, send, abort.signal);
    send({ type: 'done', meta: buildMeta(input, result) });
  } catch (error) {
    void logError('Release stream failed', { labels: input.labels.map((entry) => entry.name), error: String(error) });
    send({ type: 'error', message: error instanceof Error ? error.message : 'Search failed' });
  } finally {
    res.end();
  }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(__dirname, '../../dist');

app.use(express.static(staticDir));
app.get('*', (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

if (cacheFile) {
  const restored = await initCachePersistence(cacheFile);
  void logInfo('Cache loaded', { file: cacheFile, entries: restored });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void saveCache().finally(() => process.exit(0));
  });
}

app.listen(port, () => {
  void logInfo('Server started', { port });
});
