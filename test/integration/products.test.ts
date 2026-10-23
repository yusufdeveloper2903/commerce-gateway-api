import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, defaultUpstream } from '../helpers/build-test-app.js';
import { json, type FakeUpstream } from '../helpers/fake-upstream.js';

let app: FastifyInstance;
let upstream: FakeUpstream;

afterEach(async () => {
  await app.close();
});

async function start(fake = defaultUpstream()) {
  ({ app, upstream } = await buildTestApp(fake));
}

describe('GET /products', () => {
  it('returns mapped products with pagination meta and translates page -> skip', async () => {
    await start();
    const res = await app.inject({ method: 'GET', url: '/products?page=3&limit=5' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta).toEqual({ page: 3, limit: 5, total: 194, totalPages: 39 });
    expect(body.data).toHaveLength(5);
    expect(body.data[0]).toMatchObject({ id: 11, finalPrice: 90, inStock: true, brand: 'Acme' });
    expect(body.data[0]).not.toHaveProperty('sku');
    expect(upstream.calls[0]?.path).toBe('/products?limit=5&skip=10');
  });

  it('serves repeated requests from cache (x-cache: MISS then HIT)', async () => {
    await start();
    const first = await app.inject('/products?limit=2');
    const second = await app.inject('/products?limit=2');
    expect(first.headers['x-cache']).toBe('MISS');
    expect(second.headers['x-cache']).toBe('HIT');
    expect(upstream.count('/products')).toBe(1);
  });

  it('coalesces concurrent identical requests into a single upstream call', async () => {
    await start();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => app.inject('/products?limit=3')),
    );
    expect(responses.every((r) => r.statusCode === 200)).toBe(true);
    expect(upstream.count('/products')).toBe(1);
    expect(responses.map((r) => r.headers['x-cache']).filter((h) => h === 'MISS')).toHaveLength(1);
  });

  it('routes search and category filters to the matching upstream endpoints', async () => {
    await start();
    const search = await app.inject('/products?q=phone&sortBy=price&order=desc');
    const category = await app.inject('/products?category=beauty');
    expect(search.json().data[0].id).toBe(42);
    expect(category.json().data[0].id).toBe(2);
    expect(upstream.calls.map((c) => c.path)).toEqual([
      '/products/search?limit=20&skip=0&sortBy=price&order=desc&q=phone',
      '/products/category/beauty?limit=20&skip=0',
    ]);
  });

  it.each([
    ['/products?limit=1000', 'limit'],
    ['/products?page=0', 'page'],
    ['/products?category=Not%20A%20Slug', 'category'],
    ['/products?q=x&category=beauty', 'category'],
    ['/products?sortBy=hacker', 'sortBy'],
  ])('rejects invalid query %s with a problem document', async (url, field) => {
    await start();
    const res = await app.inject(url);
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const body = res.json();
    expect(body).toMatchObject({ status: 400, title: 'Request validation failed' });
    expect(body.errors.map((e: { path: string }) => e.path)).toContain(field);
    expect(upstream.calls).toHaveLength(0);
  });
});

describe('GET /products/:id', () => {
  it('returns a single product', async () => {
    await start();
    const res = await app.inject('/products/7');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 7, title: 'Product 7' });
  });

  it('maps upstream 404 to a 404 problem document', async () => {
    await start();
    const res = await app.inject('/products/5000');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      status: 404,
      type: 'https://commerce-gateway.dev/problems/not-found',
      detail: 'Product 5000 not found',
      instance: '/products/5000',
    });
  });

  it('returns 502 when the upstream payload breaks the contract', async () => {
    await start(defaultUpstream().on('GET', /^\/products\/\d+$/, () => json(200, { id: 'nope' })));
    const res = await app.inject('/products/1');
    expect(res.statusCode).toBe(502);
    expect(res.json().type).toContain('upstream-contract');
  });
});

describe('GET /products/categories', () => {
  it('lists categories', async () => {
    await start(
      defaultUpstream().on('GET', /^\/products\/categories$/, () =>
        json(200, [{ slug: 'beauty', name: 'Beauty', url: 'x' }]),
      ),
    );
    const res = await app.inject('/products/categories');
    expect(res.json()).toEqual([{ slug: 'beauty', name: 'Beauty' }]);
  });
});
