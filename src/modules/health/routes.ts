import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const healthSchema = z.object({ status: z.literal('ok'), uptimeSeconds: z.number() });
const readySchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({
    shuttingDown: z.boolean(),
    upstreamCircuit: z.enum(['closed', 'open', 'half-open']),
  }),
});

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  const { breaker, lifecycle } = app.deps;

  // Liveness: the process is up and the event loop responds. Never depends on upstream.
  app.get(
    '/health',
    { schema: { tags: ['ops'], summary: 'Liveness probe', response: { 200: healthSchema } } },
    async () => ({ status: 'ok' as const, uptimeSeconds: Math.round(process.uptime()) }),
  );

  // Readiness: should the load balancer send traffic here right now?
  app.get(
    '/ready',
    {
      schema: {
        tags: ['ops'],
        summary:
          'Readiness probe (fails while shutting down or while the upstream circuit is open)',
        response: { 200: readySchema, 503: readySchema },
      },
    },
    async (_request, reply) => {
      const upstreamCircuit = breaker.state;
      const ready = !lifecycle.shuttingDown && upstreamCircuit !== 'open';
      reply.status(ready ? 200 : 503);
      return {
        status: ready ? ('ready' as const) : ('not_ready' as const),
        checks: { shuttingDown: lifecycle.shuttingDown, upstreamCircuit },
      };
    },
  );
};
