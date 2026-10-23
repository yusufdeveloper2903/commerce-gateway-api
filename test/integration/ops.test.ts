import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, defaultUpstream } from '../helpers/build-test-app.js';
import { hang, json, type FakeUpstream } from '../helpers/fake-upstream.js';

let app: FastifyInstance;
let upstream: FakeUpstream;

afterEach(async () => {
  await app.close();
});

describe('resilience', () => {
  it('maps upstream 5xx to 502 after exhausting retries', async () => {
    ({ app, upstream } = await buildTestApp(
      defaultUpstream().on('GET', /^\/products\/\d+$/, () => json(500, {})),
    ));
    const res = await app.inject('/products/1');
    expect(res.statusCode).toBe(502);
    expect(upstream.count('/products/1')).toBe(3);
  });

  it('maps upstream timeouts to 504', async () => {
    ({ app, upstream } = await buildTestApp(
      defaultUpstream().on('GET', /^\/products\/\d+$/, hang),
    ));
    const res = await app.inject('/products/1');
    expect(res.statusCode).toBe(504);
    expect(res.json().type).toContain('upstream-timeout');
  });

  it('opens the circuit: fails fast with 503 + Retry-After and flips readiness', async () => {
    ({ app, upstream } = await buildTestApp(
      defaultUpstream().on('GET', /^\/products\/\d+$/, () => json(503, {})),
      { CB_FAILURE_THRESHOLD: '3', CB_RESET_TIMEOUT_MS: '30000' },
    ));
    expect((await app.inject('/ready')).statusCode).toBe(200);

    expect((await app.inject('/products/1')).statusCode).toBe(502); // 3 attempts -> breaker opens
    const fastFail = await app.inject('/products/2');
    expect(fastFail.statusCode).toBe(503);
    expect(fastFail.headers['retry-after']).toBe('30');
    expect(fastFail.json().type).toContain('circuit-open');
    expect(upstream.count('/products/2')).toBe(0);

    const ready = await app.inject('/ready');
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toMatchObject({
      status: 'not_ready',
      checks: { upstreamCircuit: 'open' },
    });

    // Liveness is independent of upstream health.
    expect((await app.inject('/health')).statusCode).toBe(200);
  });
});

describe('operational endpoints', () => {
  it('reports not ready while shutting down', async () => {
    ({ app, upstream } = await buildTestApp());
    app.deps.lifecycle.shuttingDown = true;
    const res = await app.inject('/ready');
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.shuttingDown).toBe(true);
  });

  it('exposes Prometheus metrics', async () => {
    ({ app, upstream } = await buildTestApp());
    await app.inject('/products/1');
    await app.inject('/products/1');
    const res = await app.inject('/metrics');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain(
      'http_requests_total{method="GET",route="/products/:id",status_code="200"} 2',
    );
    expect(res.body).toContain('cache_events_total{result="HIT"} 1');
    expect(res.body).toContain(
      'upstream_requests_total{endpoint="products.get",outcome="success"} 1',
    );
    expect(res.body).toContain('circuit_breaker_state{upstream="dummyjson"} 0');
    expect(res.body).toMatch(/http_request_duration_seconds_bucket\{.*le="\+Inf"\} \d+/);
  });

  it('propagates a caller-supplied x-request-id and generates one otherwise', async () => {
    ({ app, upstream } = await buildTestApp());
    const echoed = await app.inject({ url: '/health', headers: { 'x-request-id': 'abc-123' } });
    expect(echoed.headers['x-request-id']).toBe('abc-123');
    const generated = await app.inject({
      url: '/health',
      headers: { 'x-request-id': 'bad id with spaces' },
    });
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns problem+json for unknown routes', async () => {
    ({ app, upstream } = await buildTestApp());
    const res = await app.inject('/nope');
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('serves the OpenAPI document', async () => {
    ({ app, upstream } = await buildTestApp());
    const res = await app.inject('/docs/json');
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining([
        '/products/',
        '/products/{id}',
        '/auth/login',
        '/me',
        '/users/{id}/summary',
      ]),
    );
  });

  it('enforces rate limits with a 429 problem document', async () => {
    ({ app, upstream } = await buildTestApp(defaultUpstream(), { RATE_LIMIT_MAX: '2' }));
    await app.inject('/products/1');
    await app.inject('/products/1');
    const limited = await app.inject('/products/1');
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['content-type']).toContain('application/problem+json');
    expect(limited.headers['retry-after']).toBeDefined();
    // Probes are exempt.
    expect((await app.inject('/health')).statusCode).toBe(200);
  });
});
