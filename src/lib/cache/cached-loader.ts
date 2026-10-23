import type { Cache } from './cache.js';
import { SingleFlight } from './single-flight.js';

/** HIT: served from cache. MISS: fetched upstream. COALESCED: piggybacked on a concurrent MISS. */
export type CacheStatus = 'HIT' | 'MISS' | 'COALESCED';

export interface Cached<T> {
  value: T;
  cache: CacheStatus;
}

export interface CachedLoaderOptions {
  cache: Cache;
  defaultTtlMs: number;
  onResult?: (status: CacheStatus) => void;
}

/**
 * Read-through cache + single-flight. Errors are never cached and the
 * in-flight slot is released on failure so the next caller retries.
 */
export class CachedLoader {
  private readonly flights = new SingleFlight();

  constructor(private readonly options: CachedLoaderOptions) {}

  async load<T>(
    key: string,
    loader: () => Promise<T>,
    ttlMs = this.options.defaultTtlMs,
  ): Promise<Cached<T>> {
    const hit = await this.options.cache.get<T>(key);
    if (hit !== undefined) return this.report({ value: hit, cache: 'HIT' });

    const { value, shared } = await this.flights.do(key, async () => {
      const fresh = await loader();
      await this.options.cache.set(key, fresh, ttlMs);
      return fresh;
    });
    return this.report({ value, cache: shared ? 'COALESCED' : 'MISS' });
  }

  private report<T>(result: Cached<T>): Cached<T> {
    this.options.onResult?.(result.cache);
    return result;
  }
}
