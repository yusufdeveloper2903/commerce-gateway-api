import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, defaultUpstream } from '../helpers/build-test-app.js';
import { json, type FakeUpstream } from '../helpers/fake-upstream.js';

let app: FastifyInstance;
let upstream: FakeUpstream;

afterEach(async () => {
  await app.close();
});

async function login(username = 'emilys', password = 'emilyspass') {
  return app.inject({ method: 'POST', url: '/auth/login', payload: { username, password } });
}

describe('auth', () => {
  it('exchanges valid credentials for a gateway-issued JWT', async () => {
    ({ app, upstream } = await buildTestApp());
    const res = await login();
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
      user: { id: 1, username: 'emilys' },
    });
    expect(body.accessToken).not.toBe('upstream-token');
    expect(JSON.stringify(body)).not.toContain('emilyspass');
    expect(upstream.calls[0]?.body).toMatchObject({ username: 'emilys', password: 'emilyspass' });

    const claims = app.jwt.decode<{ sub: number; iss: string }>(body.accessToken);
    expect(claims).toMatchObject({ sub: 1, iss: 'commerce-gateway' });
  });

  it('rejects invalid credentials with 401', async () => {
    ({ app, upstream } = await buildTestApp());
    const res = await login('emilys', 'wrong');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ status: 401, detail: 'Invalid username or password' });
  });

  it('validates the login body', async () => {
    ({ app, upstream } = await buildTestApp());
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { username: '' } });
    expect(res.statusCode).toBe(400);
    expect(upstream.calls).toHaveLength(0);
  });

  it('never retries login (non-idempotent) on upstream 5xx', async () => {
    ({ app, upstream } = await buildTestApp(
      defaultUpstream().on('POST', /^\/auth\/login$/, () => json(503, {})),
    ));
    const res = await login();
    expect(res.statusCode).toBe(502);
    expect(upstream.count('/auth/login')).toBe(1);
  });

  it('protects /me routes with the gateway JWT', async () => {
    ({ app, upstream } = await buildTestApp());
    const token = (await login()).json().accessToken as string;
    const auth = { authorization: `Bearer ${token}` };

    const me = await app.inject({ url: '/me', headers: auth });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ id: 1, fullName: 'Emily Johnson' });
    expect(me.json()).not.toHaveProperty('password');

    const carts = await app.inject({ url: '/me/carts', headers: auth });
    expect(carts.statusCode).toBe(200);
    expect(carts.json().data[0]).toMatchObject({ id: 7, totalItems: 3, discountedTotal: 23 });
  });

  it.each([
    ['missing token', {}],
    ['malformed token', { authorization: 'Bearer not-a-jwt' }],
    ['upstream token', { authorization: 'Bearer upstream-token' }],
  ])('rejects %s with 401', async (_name, headers) => {
    ({ app, upstream } = await buildTestApp());
    const res = await app.inject({ url: '/me', headers });
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('rejects tokens signed with a different secret', async () => {
    ({ app, upstream } = await buildTestApp());
    const other = await buildTestApp(defaultUpstream(), {
      JWT_SECRET: 'another-secret-another-secret-12345',
    });
    const foreign = other.app.jwt.sign({ sub: 1, username: 'emilys' });
    await other.app.close();
    const res = await app.inject({ url: '/me', headers: { authorization: `Bearer ${foreign}` } });
    expect(res.statusCode).toBe(401);
  });
});
