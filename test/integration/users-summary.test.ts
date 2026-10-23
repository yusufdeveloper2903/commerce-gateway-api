import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, defaultUpstream } from '../helpers/build-test-app.js';
import { json, type FakeUpstream } from '../helpers/fake-upstream.js';

let app: FastifyInstance;
let upstream: FakeUpstream;

afterEach(async () => {
  await app.close();
});

describe('GET /users/:id/summary', () => {
  it('aggregates user, carts and enriched products', async () => {
    ({ app, upstream } = await buildTestApp());
    const res = await app.inject('/users/5/summary');
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.partial).toBe(false);
    expect(body.errors).toEqual([]);
    expect(body.user).toMatchObject({ id: 5, fullName: 'Emily Johnson' });
    expect(body.carts[0].items[0]).toMatchObject({
      productId: 1,
      quantity: 2,
      product: { category: 'groceries' },
    });
    expect(body.stats).toEqual({
      cartCount: 1,
      totalItems: 3,
      totalSpent: 23,
      totalSaved: 2,
      topCategories: [
        { category: 'groceries', quantity: 2 },
        { category: 'beauty', quantity: 1 },
      ],
    });
    expect(upstream.count('/users/5')).toBe(1);
    expect(upstream.count('/carts/user/5')).toBe(1);
    expect(upstream.count('/products/')).toBe(2);
  });

  it('degrades gracefully when the carts dependency fails', async () => {
    ({ app, upstream } = await buildTestApp(
      defaultUpstream().on('GET', /^\/carts\/user\/\d+$/, () =>
        json(500, { message: 'carts exploded' }),
      ),
    ));
    const res = await app.inject('/users/5/summary');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      user: { id: 5 },
      carts: null,
      stats: null,
      partial: true,
      errors: [{ source: 'carts', message: 'carts exploded' }],
    });
  });

  it('returns items without product details when enrichment fails', async () => {
    ({ app, upstream } = await buildTestApp(
      defaultUpstream().on('GET', /^\/products\/2$/, () => json(503, { message: 'unavailable' })),
    ));
    const body = (await app.inject('/users/5/summary')).json();
    expect(body.partial).toBe(true);
    expect(body.errors).toEqual([{ source: 'product:2', message: 'unavailable' }]);
    expect(body.carts[0].items[1]).toMatchObject({ productId: 2, product: null });
    expect(body.carts[0].items[0].product).not.toBeNull();
  });

  it('fails with 404 when the core user resource is missing', async () => {
    ({ app, upstream } = await buildTestApp());
    const res = await app.inject('/users/5000/summary');
    expect(res.statusCode).toBe(404);
    expect(res.json().detail).toBe('User 5000 not found');
  });
});
