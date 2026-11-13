import type { FeedConfigUpdate, FeedState, LabelSearchResult, SearchEvent, SearchRequest } from '../../shared/types';

async function json<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `${fallback} (HTTP ${response.status})`);
  }
  return (await response.json()) as T;
}

export async function getFeed(): Promise<FeedState> {
  return json<FeedState>(await fetch('/api/feed'), 'Could not load feed');
}

export async function updateFeedConfig(update: FeedConfigUpdate): Promise<FeedState> {
  const response = await fetch('/api/feed/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update)
  });
  return json<FeedState>(response, 'Could not save');
}

export async function startFeedRun(): Promise<FeedState> {
  return json<FeedState>(await fetch('/api/feed/run', { method: 'POST' }), 'Could not start refresh');
}

export async function searchLabels(query: string): Promise<LabelSearchResult[]> {
  const response = await fetch(`/api/labels/search?q=${encodeURIComponent(query)}&limit=10`);
  if (!response.ok) {
    throw new Error('Label search failed');
  }

  const payload = (await response.json()) as { labels: LabelSearchResult[] };
  return payload.labels;
}

/** Streams NDJSON search events; resolves when the server closes the stream. */
export async function streamReleases(request: SearchRequest, onEvent: (event: SearchEvent) => void, signal?: AbortSignal): Promise<void> {
  const response = await fetch('/api/releases/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal
  });

  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Search failed (HTTP ${response.status})`);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += value;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.filter((line) => line.trim()).forEach((line) => onEvent(JSON.parse(line) as SearchEvent));
    }
    if (done) {
      if (buffer.trim()) {
        onEvent(JSON.parse(buffer) as SearchEvent);
      }
      return;
    }
  }
}
