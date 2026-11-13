import { DAY, HOUR, cached } from '../lib/cache.js';
import { fetchJson } from '../lib/http.js';
import { RateLimiter } from '../lib/limiter.js';

const limiter = new RateLimiter('coverartarchive', 10, 1_000);

interface CoverArtArchivePayload {
  images?: Array<{ front?: boolean }>;
}

/** `front-1200` URL when the MB release has a front cover, otherwise undefined. */
export async function findCoverArtUrl(mbReleaseId: string): Promise<string | undefined> {
  const hasFront = await cached(`caa:${mbReleaseId}`, (value: boolean) => (value ? 30 * DAY : 12 * HOUR), async () => {
    try {
      const payload = await fetchJson<CoverArtArchivePayload>(`https://coverartarchive.org/release/${mbReleaseId}`, {
        limiter,
        timeoutMs: 6_000,
        retries: 1
      });
      return (payload.images ?? []).some((image) => image.front);
    } catch {
      return false;
    }
  });
  return hasFront ? `https://coverartarchive.org/release/${mbReleaseId}/front-1200` : undefined;
}
