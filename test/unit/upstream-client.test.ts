import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ResilientHttpClient } from '../../src/http/upstream-client.js';
import { CircuitBreaker } from '../../src/lib/circuit-breaker.js';
import {
  CircuitOpenError,
  UpstreamContractError,
  UpstreamHttpError,
  UpstreamTimeoutError,
  UpstreamUnavailableError,
  isTransientUpstreamError,
} from '../../src/lib/errors.js';
import { MetricsRegistry } from '../../src/lib/metrics.js';
import { createFakeUpstream, hang, json } from '../helpers/fake-upstream.js';

const schema = z.object({ ok: z.boolean() });

function setup(failureThreshold = 10) {
  const upstream = createFakeUpstream();
  const metrics = new MetricsRegistry();
  const breaker = new CircuitBreaker({
    failureThreshold,
    resetTimeoutMs: 60_000,
    isFailure: isTransientUpstreamError,
  });
  const client = new ResilientHttpClient({
    baseUrl: 'http://upstream.test',
    timeoutMs: 30,
    maxRetries: 2,
    retryBaseDelayMs: 1,
    breaker,
    metrics,
    fetch: upstream.fetch,
    sleep: () => Promise.resolve(),
  });
  return { upstream, client, breaker, metrics };
}

describe('ResilientHttpClient', () => {
  it('retries transient 5xx responses and succeeds', async () => {
    const { upstream, client, metrics } = setup();
    let n = 0;
    upstream.on('GET', /^\/x$/, () =>
      ++n < 3 ? json(503, { message: 'busy' }) : json(200, { ok: true }),
    );
    await expect(client.request({ path: '/x', endpoint: 'x' }, schema)).resolves.toEqual({
      ok: true,
    });
    expect(upstream.count('/x')).toBe(3);
    expect(metrics.upstreamRetriesTotal.get({ endpoint: 'x' })).toBe(2);
  });

  it('does not retry 4xx responses', async () => {
    const { upstream, client } = setup();
    upstream.on('GET', /^\/x$/, () => json(404, { message: 'nope' }));
    const error = await client
      .request({ path: '/x', endpoint: 'x' }, schema)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamHttpError);
    expect((error as UpstreamHttpError).upstreamStatus).toBe(404);
    expect((error as Error).message).toBe('nope');
    expect(upstream.count('/x')).toBe(1);
  });

  it('does not retry non-idempotent POST requests', async () => {
    const { upstream, client } = setup();
    upstream.on('POST', /^\/x$/, () => json(503, {}));
    await expect(
      client.request({ method: 'POST', path: '/x', endpoint: 'x', body: {} }, schema),
    ).rejects.toBeInstanceOf(UpstreamHttpError);
    expect(upstream.count('/x')).toBe(1);
  });

  it('maps a hung upstream to UpstreamTimeoutError (after retries)', async () => {
    const { upstream, client } = setup();
    upstream.on('GET', /^\/x$/, hang);
    await expect(client.request({ path: '/x', endpoint: 'x' }, schema)).rejects.toBeInstanceOf(
      UpstreamTimeoutError,
    );
    expect(upstream.count('/x')).toBe(3);
  });

  it('maps network failures to UpstreamUnavailableError', async () => {
    const { upstream, client } = setup();
    upstream.on('GET', /^\/x$/, () => Promise.reject(new TypeError('fetch failed')));
    await expect(client.request({ path: '/x', endpoint: 'x' }, schema)).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });

  it('opens the circuit and then fails fast without hitting the upstream', async () => {
    const { upstream, client, breaker } = setup(3);
    upstream.on('GET', /^\/x$/, () => json(500, {}));
    // 3 attempts (1 + 2 retries) trip the breaker inside a single call.
    await expect(client.request({ path: '/x', endpoint: 'x' }, schema)).rejects.toBeInstanceOf(
      UpstreamHttpError,
    );
    expect(breaker.state).toBe('open');
    await expect(client.request({ path: '/x', endpoint: 'x' }, schema)).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
    expect(upstream.count('/x')).toBe(3);
  });

  it('rejects payloads that violate the contract', async () => {
    const { upstream, client } = setup();
    upstream.on('GET', /^\/x$/, () => json(200, { ok: 'yes' }));
    await expect(client.request({ path: '/x', endpoint: 'x' }, schema)).rejects.toBeInstanceOf(
      UpstreamContractError,
    );
  });

  it('serialises query parameters and skips undefined values', async () => {
    const { upstream, client } = setup();
    upstream.on('GET', /^\/x$/, () => json(200, { ok: true }));
    await client.request(
      { path: '/x', endpoint: 'x', query: { a: 1, b: undefined, q: 'a b' } },
      schema,
    );
    expect(upstream.calls[0]?.path).toBe('/x?a=1&q=a+b');
  });
});
