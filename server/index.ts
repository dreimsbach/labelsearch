import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findReleases } from './release-service.js';
import { searchLabels } from './providers/musicbrainz.js';
import { logError, logInfo } from './lib/logger.js';
import type { HealthResponse, SearchRequest, SearchResponse } from '../shared/types.js';

const app = express();
const port = Number(process.env.PORT ?? 8787);

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

app.get('/api/health', (_req, res) => {
  const payload: HealthResponse = {
    ok: true,
    now: new Date().toISOString()
  };
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
    const labels = await searchLabels(q, limit);
    res.json({ labels });
  } catch (error) {
    void logError('Label search failed', {
      query: q,
      limit,
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Label search failed'
    });
  }
});

app.post('/api/releases/search', async (req, res) => {
  const input = req.body as SearchRequest;

  if (!Array.isArray(input.labels) || input.labels.length === 0) {
    res.status(400).json({ error: 'labels are required' });
    return;
  }

  const mode = input.timeMode ?? 'days';
  const value = Number(input.timeValue);

  if (mode !== 'days' && mode !== 'year') {
    res.status(400).json({ error: 'timeMode must be days or year' });
    return;
  }

  if (mode === 'days' && (!value || value < 1 || value > 3650)) {
    res.status(400).json({ error: 'timeValue for days must be between 1 and 3650' });
    return;
  }

  if (mode === 'year' && (!value || value < 1900 || value > 2100)) {
    res.status(400).json({ error: 'timeValue for year must be between 1900 and 2100' });
    return;
  }

  try {
    const result = await findReleases({
      labels: input.labels,
      timeMode: mode,
      timeValue: value,
      country: (input.country || 'DE').toUpperCase(),
      sourceMode: input.sourceMode ?? 'hybrid',
      timezone: input.timezone || 'Europe/Berlin',
      discogsToken: typeof input.discogsToken === 'string' && input.discogsToken.trim() ? input.discogsToken.trim() : undefined
    });

    const payload: SearchResponse = {
      releases: result.releases,
      meta: {
        sourceMode: input.sourceMode ?? 'hybrid',
        timeMode: mode,
        timeValue: value,
        country: (input.country || 'DE').toUpperCase(),
        fromDate: result.fromDate,
        toDate: result.toDate,
        searchedAt: new Date().toISOString(),
        partialFailures: result.partialFailures
      }
    };

    res.json(payload);
  } catch (error) {
    void logError('Release search failed', {
      labels: input.labels?.map((entry) => entry.name) ?? [],
      sourceMode: input.sourceMode,
      country: input.country,
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(502).json({ error: error instanceof Error ? error.message : 'Search failed' });
  }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(__dirname, '../../dist');

app.use(express.static(staticDir));
app.get('*', (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

app.listen(port, () => {
  void logInfo('Server started', { port });
});
