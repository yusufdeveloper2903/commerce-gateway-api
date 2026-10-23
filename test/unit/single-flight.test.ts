import { describe, expect, it, vi } from 'vitest';
import { CachedLoader } from '../../src/lib/cache/cached-loader.js';
import { LruCache } from '../../src/lib/cache/lru-cache.js';
import { SingleFlight } from '../../src/lib/cache/single-flight.js';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SingleFlight', () => {
  it('executes concurrent calls for the same key once', async () => {
    const flight = new SingleFlight();
    const d = deferred<number>();
    const fn = vi.fn(() => d.promise);

    const calls = Array.from({ length: 10 }, () => flight.do('k', fn));
    expect(flight.pending).toBe(1);
    d.resolve(42);
    const results = await Promise.all(calls);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.value)).toEqual(Array(10).fill(42));
    expect(results.filter((r) => !r.shared)).toHaveLength(1);
    expect(flight.pending).toBe(0);
  });

  it('keeps different keys independent', async () => {
    const flight = new SingleFlight();
    const fn = vi.fn((v: string) => Promise.resolve(v));
    const [a, b] = await Promise.all([
      flight.do('a', () => fn('a')),
      flight.do('b', () => fn('b')),
    ]);
    expect([a.value, b.value]).toEqual(['a', 'b']);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('propagates errors to all waiters and releases the slot', async () => {
    const flight = new SingleFlight();
    const d = deferred<number>();
    const p1 = flight.do('k', () => d.promise);
    const p2 = flight.do('k', () => Promise.resolve(1));
    d.reject(new Error('upstream down'));
    await expect(p1).rejects.toThrow('upstream down');
    await expect(p2).rejects.toThrow('upstream down');
    await expect(flight.do('k', () => Promise.resolve(7))).resolves.toEqual({
      value: 7,
      shared: false,
    });
  });
});

describe('CachedLoader', () => {
  const make = () => {
    const onResult = vi.fn();
    const loader = new CachedLoader({
      cache: new LruCache({ maxEntries: 10 }),
      defaultTtlMs: 1000,
      onResult,
    });
    return { loader, onResult };
  };

  it('reports MISS, then HIT', async () => {
    const { loader } = make();
    const fn = vi.fn(() => Promise.resolve('v'));
    expect(await loader.load('k', fn)).toEqual({ value: 'v', cache: 'MISS' });
    expect(await loader.load('k', fn)).toEqual({ value: 'v', cache: 'HIT' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent misses into one load', async () => {
    const { loader, onResult } = make();
    const d = deferred<string>();
    const fn = vi.fn(() => d.promise);
    const all = Promise.all(Array.from({ length: 5 }, () => loader.load('k', fn)));
    await Promise.resolve();
    d.resolve('v');
    const results = await all;
    expect(fn).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.cache).sort()).toEqual([
      'COALESCED',
      'COALESCED',
      'COALESCED',
      'COALESCED',
      'MISS',
    ]);
    expect(onResult).toHaveBeenCalledTimes(5);
  });

  it('never caches failures', async () => {
    const { loader } = make();
    const fn = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce('ok');
    await expect(loader.load('k', fn)).rejects.toThrow('fail');
    await expect(loader.load('k', fn)).resolves.toEqual({ value: 'ok', cache: 'MISS' });
  });
});
