function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sliding-window rate limiter: at most `maxRequests` per `windowMs`, FIFO order.
 * Requests may run concurrently; only their start times are spaced.
 * `pause()` lets a provider back off globally after a 429/503.
 */
export class RateLimiter {
  private startedAt: number[] = [];
  private pausedUntil = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    readonly name: string,
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  acquire(): Promise<void> {
    const slot = this.chain.then(() => this.waitForSlot());
    this.chain = slot.catch(() => undefined);
    return slot;
  }

  pause(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
  }

  private async waitForSlot(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.startedAt = this.startedAt.filter((time) => now - time < this.windowMs);
      const windowWait = this.startedAt.length >= this.maxRequests ? this.startedAt[0] + this.windowMs - now : 0;
      const wait = Math.max(this.pausedUntil - now, windowWait);
      if (wait <= 0) {
        this.startedAt.push(now);
        return;
      }
      await sleep(wait);
    }
  }
}

/** Run `worker` over `items` with at most `concurrency` in flight; results keep input order. */
export async function mapPool<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
