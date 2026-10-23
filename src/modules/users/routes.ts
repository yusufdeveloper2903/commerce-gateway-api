import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { cartListSchema, userIdParams, userProfileSchema, userSummarySchema } from './schemas.js';

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  const { userService } = app.deps;

  app.get(
    '/users/:id/summary',
    {
      schema: {
        tags: ['users'],
        summary:
          'Aggregated user view: profile + carts + enriched products (partial-failure tolerant)',
        params: userIdParams,
        response: { 200: userSummarySchema },
      },
    },
    async (request) => userService.getSummary(request.params.id),
  );

  app.get(
    '/me',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['me'],
        summary: 'Current user profile',
        security: [{ bearerAuth: [] }],
        response: { 200: userProfileSchema },
      },
    },
    async (request, reply) => {
      const result = await userService.getProfile(request.user.sub);
      reply.header('x-cache', result.cache);
      return result.value;
    },
  );

  app.get(
    '/me/carts',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['me'],
        summary: "Current user's carts",
        security: [{ bearerAuth: [] }],
        response: { 200: cartListSchema },
      },
    },
    async (request, reply) => {
      const result = await userService.getCarts(request.user.sub);
      reply.header('x-cache', result.cache);
      return { data: result.value };
    },
  );

  app.get(
    '/me/summary',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['me'],
        summary: 'Aggregated summary for the current user',
        security: [{ bearerAuth: [] }],
        response: { 200: userSummarySchema },
      },
    },
    async (request) => userService.getSummary(request.user.sub),
  );
};
