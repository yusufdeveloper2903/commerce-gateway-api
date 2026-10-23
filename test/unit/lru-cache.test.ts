import { describe, expect, it } from 'vitest';
import { LruCache } from '../../src/lib/cache/lru-cache.js';

function setup(maxEntries = 3) {
  let now = 0;
  const cache = new LruCache({ maxEntries, now: () => now });
  return { cache, advance: (ms: number) => (now += ms) };
}

describe('LruCache', () => {
  it('stores and retrieves values', async () => {
    const { cache } = setup();
    await cache.set('a', { x: 1 }, 1000);
    expect(await cache.get('a')).toEqual({ x: 1 });
    expect(await cache.get('missing')).toBeUndefined();
  });

  it('expires entries after their TTL', async () => {
    const { cache, advance } = setup();
    await cache.set('a', 1, 100);
    advance(99);
    expect(await cache.get('a')).toBe(1);
    advance(1);
    expect(await cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('evicts the least recently used entry when full', async () => {
    const { cache } = setup(3);
    await cache.set('a', 1, 1000);
    await cache.set('b', 2, 1000);
    await cache.set('c', 3, 1000);
    await cache.get('a'); // a becomes most recent; b is now LRU
    await cache.set('d', 4, 1000);
    expect(await cache.get('b')).toBeUndefined();
    expect(await cache.get('a')).toBe(1);
    expect(await cache.get('c')).toBe(3);
    expect(await cache.get('d')).toBe(4);
  });

  it('overwriting a key refreshes value, TTL and recency', async () => {
    const { cache, advance } = setup(2);
    await cache.set('a', 1, 100);
    await cache.set('b', 2, 100);
    advance(50);
    await cache.set('a', 10, 100);
    await cache.set('c', 3, 100); // evicts b
    advance(60);
    expect(await cache.get('a')).toBe(10);
    expect(await cache.get('b')).toBeUndefined();
  });

  it('ignores non-positive TTLs and supports delete/clear', async () => {
    const { cache } = setup();
    await cache.set('a', 1, 0);
    expect(await cache.get('a')).toBeUndefined();
    await cache.set('b', 2, 100);
    await cache.delete('b');
    expect(await cache.get('b')).toBeUndefined();
    await cache.set('c', 3, 100);
    await cache.clear();
    expect(cache.size).toBe(0);
  });
});
