import type { RateLimiter } from './limiter.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    url: string
  ) {
    super(`HTTP ${status} for ${redactUrl(url)}`);
  }
}

export interface FetchJsonOptions {
  headers?: Record<string, string>;
  limiter?: RateLimiter;
  timeoutMs?: number;
  /** Retries after the first attempt (network errors, timeouts, retryable statuses). */
  retries?: number;
  /** Statuses that mean "slow down": pause the limiter and retry. */
  throttleStatuses?: number[];
  /** Some APIs (Deezer) signal quota errors with HTTP 200 and an error body. */
  isThrottledBody?: (body: unknown) => boolean;
}

const RETRYABLE_STATUSES = new Set([500, 502, 504]);
const MAX_BACKOFF_MS = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function redactUrl(url: string): string {
  return url.replace(/([?&](?:token|key|secret)=)[^&]+/gi, '$1***');
}

function backoffMs(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.min(MAX_BACKOFF_MS * 3, seconds * 1000);
  }
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/**
 * The single retry layer for all providers. Rate limiting happens per attempt through
 * the provider's limiter, and throttling responses pause that limiter for everyone.
 */
export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const { limiter, timeoutMs = 10_000, retries = 3, throttleStatuses = [429, 503] } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    await limiter?.acquire();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json', ...options.headers }
      });

      if (throttleStatuses.includes(response.status)) {
        const delay = retryAfterMs(response) ?? backoffMs(attempt);
        limiter?.pause(delay);
        lastError = new HttpError(response.status, url);
        if (!limiter) {
          await sleep(delay);
        }
        continue;
      }

      if (RETRYABLE_STATUSES.has(response.status)) {
        lastError = new HttpError(response.status, url);
        await sleep(backoffMs(attempt));
        continue;
      }

      if (!response.ok) {
        throw new HttpError(response.status, url);
      }

      const body = (await response.json()) as T;
      if (options.isThrottledBody?.(body)) {
        const delay = backoffMs(attempt);
        limiter?.pause(delay);
        lastError = new HttpError(429, url);
        if (!limiter) {
          await sleep(delay);
        }
        continue;
      }
      return body;
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      lastError = error;
      if (attempt < retries) {
        await sleep(backoffMs(attempt));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  if (lastError instanceof HttpError) {
    throw lastError;
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Request failed for ${redactUrl(url)}: ${reason}`);
}
