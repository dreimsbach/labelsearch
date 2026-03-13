export class RateLimiter {
  private queue = Promise.resolve();
  private lastRunAt = 0;

  constructor(private readonly minIntervalMs: number) {}

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const task = async (): Promise<T> => {
      const elapsed = Date.now() - this.lastRunAt;
      const wait = Math.max(0, this.minIntervalMs - elapsed);
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      this.lastRunAt = Date.now();
      return fn();
    };

    const result = this.queue.then(task, task);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}
