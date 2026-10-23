import { describe, expect, it, vi } from 'vitest';
import { computeBackoff, retry } from '../../src/lib/retry.js';

describe('computeBackoff', () => {
  it('grows exponentially and is capped by maxDelay', () => {
    const max = () => 0.999999;
    expect(computeBackoff(0, 100, 10_000, max)).toBe(99);
    expect(computeBackoff(1, 100, 10_000, max)).toBe(199);
    expect(computeBackoff(3, 100, 10_000, max)).toBe(799);
    expect(computeBackoff(20, 100, 1_000, max)).toBe(999);
  });

  it('applies full jitter in [0, cap)', () => {
    expect(computeBackoff(5, 100, 10_000, () => 0)).toBe(0);
    for (let i = 0; i < 100; i++) {
      const d = computeBackoff(2, 100, 10_000);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(400);
    }
  });
});

describe('retry', () => {
  const sleep = vi.fn(() => Promise.resolve());

  it('returns the first successful result', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('a')).mockResolvedValueOnce('ok');
    await expect(
      retry(fn, { retries: 3, baseDelayMs: 10, shouldRetry: () => true, sleep }),
    ).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after `retries` extra attempts and rethrows the last error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('down'));
    const onRetry = vi.fn();
    await expect(
      retry(fn, {
        retries: 2,
        baseDelayMs: 10,
        shouldRetry: () => true,
        sleep,
        onRetry,
        random: () => 0.5,
      }),
    ).rejects.toThrow('down');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      [1, 5],
      [2, 10],
    ]);
  });

  it('does not retry errors rejected by shouldRetry', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('400'));
    await expect(
      retry(fn, { retries: 5, baseDelayMs: 10, shouldRetry: () => false, sleep }),
    ).rejects.toThrow('400');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
