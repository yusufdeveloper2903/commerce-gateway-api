import type { FetchFn } from '../../src/http/upstream-client.js';

type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

export const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Never resolves until the request's AbortSignal fires (simulates a hung upstream). */
export const hang: Handler = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(init.signal?.reason as Error);
    });
  });

/**
 * In-process stand-in for DummyJSON. Injected as the `fetch` implementation,
 * so the real resilience pipeline runs but no network is touched.
 */
export function createFakeUpstream() {
  const routes: { method: string; path: RegExp; handler: Handler }[] = [];
  const calls: { method: string; path: string; body?: unknown }[] = [];

  const fetch: FetchFn = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    calls.push({
      method,
      path: url.pathname + url.search,
      ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) } : {}),
    });
    // Match the most recently registered route first so tests can override defaults.
    const route = [...routes]
      .reverse()
      .find((r) => r.method === method && r.path.test(url.pathname));
    if (!route) return json(404, { message: `no fake route for ${method} ${url.pathname}` });
    return route.handler(url, init);
  };

  return {
    fetch,
    calls,
    on(method: 'GET' | 'POST', path: RegExp, handler: Handler) {
      routes.push({ method, path, handler });
      return this;
    },
    count(pathPrefix: string): number {
      return calls.filter((c) => c.path.startsWith(pathPrefix)).length;
    },
  };
}

export type FakeUpstream = ReturnType<typeof createFakeUpstream>;
