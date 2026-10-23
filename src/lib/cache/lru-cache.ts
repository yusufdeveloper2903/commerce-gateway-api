import type { Cache } from './cache.js';

interface Entry {
  value: unknown;
  expiresAt: number;
}

export interface LruCacheOptions {
  maxEntries: number;
  now?: () => number;
}

/**
 * O(1) LRU with per-entry TTL, built on Map's insertion order:
 * a read re-inserts the key (marking it most-recent) and eviction removes
 * the first key (least-recent). Expired entries are dropped lazily on read.
 */
export class LruCache implements Cache {
  private readonly store = new Map<string, Entry>();
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: LruCacheOptions) {
    if (options.maxEntries < 1) throw new RangeError('maxEntries must be >= 1');
    this.maxEntries = options.maxEntries;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.store.size;
  }

  get<T>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.getSync(key) as T | undefined);
  }

  set(key: string, value: unknown, ttlMs: number): Promise<void> {
    if (ttlMs <= 0) return Promise.resolve();
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next();
      if (oldest.done) break;
      this.store.delete(oldest.value);
    }
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.store.clear();
    return Promise.resolve();
  }

  private getSync(key: string): unknown {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh recency.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }
}
