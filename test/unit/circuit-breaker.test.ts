import { describe, expect, it, vi } from 'vitest';
import { CircuitBreaker } from '../../src/lib/circuit-breaker.js';
import { CircuitOpenError } from '../../src/lib/errors.js';

class Transient extends Error {}
class Permanent extends Error {}

function setup(overrides: Partial<ConstructorParameters<typeof CircuitBreaker>[0]> = {}) {
  let now = 0;
  const onStateChange = vi.fn();
  const breaker = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeoutMs: 1000,
    isFailure: (e) => e instanceof Transient,
    now: () => now,
    onStateChange,
    ...overrides,
  });
  return {
    breaker,
    onStateChange,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const fail = () => Promise.reject(new Transient('boom'));
const ok = () => Promise.resolve('ok');

async function trip(breaker: CircuitBreaker, times = 3) {
  for (let i = 0; i < times; i++)
    await expect(breaker.execute(fail)).rejects.toBeInstanceOf(Transient);
}

describe('CircuitBreaker', () => {
  it('stays closed below the failure threshold', async () => {
    const { breaker } = setup();
    await trip(breaker, 2);
    expect(breaker.state).toBe('closed');
  });

  it('resets the failure count after a success', async () => {
    const { breaker } = setup();
    await trip(breaker, 2);
    await breaker.execute(ok);
    await trip(breaker, 2);
    expect(breaker.state).toBe('closed');
  });

  it('opens after N consecutive failures and fails fast without calling fn', async () => {
    const { breaker, onStateChange } = setup();
    await trip(breaker);
    expect(breaker.state).toBe('open');
    expect(onStateChange).toHaveBeenCalledWith('closed', 'open');

    const fn = vi.fn(ok);
    const error = await breaker.execute(fn).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CircuitOpenError);
    expect((error as CircuitOpenError).headers['retry-after']).toBe('1');
    expect(fn).not.toHaveBeenCalled();
  });

  it('does not count non-failure errors (e.g. 404) toward the threshold', async () => {
    const { breaker } = setup();
    for (let i = 0; i < 10; i++) {
      await expect(breaker.execute(() => Promise.reject(new Permanent()))).rejects.toBeInstanceOf(
        Permanent,
      );
    }
    expect(breaker.state).toBe('closed');
  });

  it('moves to half-open after the reset timeout and closes on a successful probe', async () => {
    const { breaker, advance, onStateChange } = setup();
    await trip(breaker);
    advance(999);
    expect(breaker.state).toBe('open');
    advance(1);
    expect(breaker.state).toBe('half-open');

    await expect(breaker.execute(ok)).resolves.toBe('ok');
    expect(breaker.state).toBe('closed');
    expect(onStateChange.mock.calls).toEqual([
      ['closed', 'open'],
      ['open', 'half-open'],
      ['half-open', 'closed'],
    ]);
  });

  it('re-opens immediately when the half-open probe fails', async () => {
    const { breaker, advance } = setup();
    await trip(breaker);
    advance(1000);
    await expect(breaker.execute(fail)).rejects.toBeInstanceOf(Transient);
    expect(breaker.state).toBe('open');
    advance(500);
    await expect(breaker.execute(ok)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('allows only a limited number of concurrent probes while half-open', async () => {
    const { breaker, advance } = setup();
    await trip(breaker);
    advance(1000);

    let release!: () => void;
    const probe = breaker.execute(
      () =>
        new Promise<string>((resolve) => {
          release = () => {
            resolve('probe');
          };
        }),
    );
    await expect(breaker.execute(ok)).rejects.toBeInstanceOf(CircuitOpenError);
    release();
    await expect(probe).resolves.toBe('probe');
    expect(breaker.state).toBe('closed');
  });
});
