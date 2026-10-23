import { describe, expect, it } from 'vitest';
import { settleWithConcurrency } from '../../src/lib/concurrency.js';

describe('settleWithConcurrency', () => {
  it('never exceeds the concurrency limit and preserves order', async () => {
    let active = 0;
    let peak = 0;
    const results = await settleWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      if (n === 4) throw new Error('four');
      return n * 10;
    });
    expect(peak).toBe(3);
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : 'x'))).toEqual([
      10,
      20,
      30,
      'x',
      50,
      60,
      70,
    ]);
  });

  it('handles empty input', async () => {
    await expect(settleWithConcurrency([], 3, () => Promise.resolve(1))).resolves.toEqual([]);
  });
});
