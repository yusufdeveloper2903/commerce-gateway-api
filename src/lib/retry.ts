export interface RetryOptions {
  /** Retries after the first attempt (0 = no retry). */
  retries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  shouldRetry: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Exponential backoff with "full jitter" (AWS Architecture Blog):
 *   delay = random(0, min(maxDelay, base * 2^attempt))
 * Jitter de-synchronises clients so a recovering upstream is not hit by a
 * thundering herd of retries all landing at the same instant.
 */
export function computeBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number = Math.random,
): number {
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.floor(random() * exp);
}

export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  const maxDelayMs = options.maxDelayMs ?? 2_000;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= options.retries || !options.shouldRetry(error, attempt)) throw error;
      const delay = computeBackoff(attempt, options.baseDelayMs, maxDelayMs, options.random);
      options.onRetry?.(error, attempt + 1, delay);
      await sleep(delay);
    }
  }
}
