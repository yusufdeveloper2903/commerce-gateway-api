import fp from 'fastify-plugin';

/** Records RED metrics per route template (not raw URL, to bound cardinality). */
export const metricsPlugin = fp(
  async (app) => {
    const { metrics } = app.deps;

    app.addHook('onResponse', async (request, reply) => {
      const route = request.routeOptions.url ?? 'unmatched';
      if (route === '/metrics') return;
      const labels = { method: request.method, route, status_code: reply.statusCode };
      metrics.httpRequestsTotal.inc(labels);
      metrics.httpRequestDuration.observe(reply.elapsedTime / 1000, {
        method: request.method,
        route,
      });
    });

    app.get('/metrics', { schema: { hide: true } }, async (_request, reply) => {
      reply.type('text/plain; version=0.0.4; charset=utf-8');
      return metrics.render();
    });
  },
  { name: 'metrics' },
);
