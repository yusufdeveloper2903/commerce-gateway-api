import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { cartsFixture, productFixture, userFixture } from './fixtures.js';
import { createFakeUpstream, json, type FakeUpstream } from './fake-upstream.js';

export function testConfig(env: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-test-secret-test-secret-123',
    UPSTREAM_BASE_URL: 'http://upstream.test',
    UPSTREAM_TIMEOUT_MS: '50',
    UPSTREAM_MAX_RETRIES: '2',
    CB_FAILURE_THRESHOLD: '5',
    CB_RESET_TIMEOUT_MS: '1000',
    RATE_LIMIT_MAX: '1000',
    ...env,
  });
}

/** Fake DummyJSON with sensible defaults; tests register overrides on top. */
export function defaultUpstream(): FakeUpstream {
  return createFakeUpstream()
    .on('GET', /^\/products$/, (url) => {
      const limit = Number(url.searchParams.get('limit') ?? 30);
      const skip = Number(url.searchParams.get('skip') ?? 0);
      const products = Array.from({ length: limit }, (_, i) => productFixture(skip + i + 1));
      return json(200, { products, total: 194, skip, limit });
    })
    .on('GET', /^\/products\/search$/, () =>
      json(200, { products: [productFixture(42)], total: 1, skip: 0, limit: 20 }),
    )
    .on('GET', /^\/products\/category\/[\w-]+$/, () =>
      json(200, { products: [productFixture(2)], total: 1, skip: 0, limit: 20 }),
    )
    .on('GET', /^\/products\/\d+$/, (url) => {
      const id = Number(url.pathname.split('/').pop());
      return id > 1000
        ? json(404, { message: `Product with id '${id}' not found` })
        : json(200, productFixture(id));
    })
    .on('GET', /^\/users\/\d+$/, (url) => {
      const id = Number(url.pathname.split('/').pop());
      return id > 1000 ? json(404, { message: 'not found' }) : json(200, userFixture(id));
    })
    .on('GET', /^\/carts\/user\/\d+$/, (url) =>
      json(200, cartsFixture(Number(url.pathname.split('/').pop()))),
    )
    .on('POST', /^\/auth\/login$/, (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { username: string; password: string };
      return body.username === 'emilys' && body.password === 'emilyspass'
        ? json(200, {
            ...userFixture(1),
            accessToken: 'upstream-token',
            refreshToken: 'upstream-refresh',
          })
        : json(400, { message: 'Invalid credentials' });
    });
}

export async function buildTestApp(
  upstream: FakeUpstream = defaultUpstream(),
  env: Record<string, string> = {},
): Promise<{ app: FastifyInstance; upstream: FakeUpstream }> {
  const app = await buildApp({
    config: testConfig(env),
    logger: false,
    overrides: { fetch: upstream.fetch, sleep: () => Promise.resolve() },
  });
  await app.ready();
  return { app, upstream };
}
