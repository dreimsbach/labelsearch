import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findReleases } from './release-service.js';
import { searchLabels } from './providers/musicbrainz.js';
import type { HealthResponse, SearchRequest, SearchResponse } from '../shared/types.js';

const app = express();
const port = Number(process.env.PORT ?? 8787);

app.use(express.json({ limit: '1mb' }));

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

  if (!input.daysBack || input.daysBack < 1 || input.daysBack > 365) {
    res.status(400).json({ error: 'daysBack must be between 1 and 365' });
    return;
  }

  try {
    const result = await findReleases({
      labels: input.labels,
      daysBack: input.daysBack,
      country: (input.country || 'DE').toUpperCase(),
      sourceMode: input.sourceMode ?? 'hybrid',
      timezone: input.timezone || 'Europe/Berlin'
    });

    const payload: SearchResponse = {
      releases: result.releases,
      meta: {
        sourceMode: input.sourceMode ?? 'hybrid',
        country: (input.country || 'DE').toUpperCase(),
        fromDate: result.fromDate,
        toDate: result.toDate,
        searchedAt: new Date().toISOString(),
        partialFailures: result.partialFailures
      }
    };

    res.json(payload);
  } catch (error) {
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
  // eslint-disable-next-line no-console
  console.log(`label-release-tracker listening on ${port}`);
});
