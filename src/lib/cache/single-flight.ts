/**
 * Request coalescing ("single-flight", after Go's golang.org/x/sync/singleflight).
 * Concurrent callers asking for the same key share one in-flight promise, so a
 * burst of identical cache misses produces exactly one upstream request.
 */
export class SingleFlight {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  get pending(): number {
    return this.inFlight.size;
  }

  /** Returns the result and whether this caller joined an existing flight. */
  async do<T>(key: string, fn: () => Promise<T>): Promise<{ value: T; shared: boolean }> {
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) return { value: await existing, shared: true };

    const promise = (async () => {
      try {
        return await fn();
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, promise);
    return { value: await promise, shared: false };
  }
}
