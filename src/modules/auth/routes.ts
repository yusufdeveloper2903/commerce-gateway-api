import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { loginBodySchema, loginResponseSchema } from './schemas.js';

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const { authService, config } = app.deps;

  app.post(
    '/login',
    {
      // Stricter limit than the global one to slow down credential stuffing.
      config: { rateLimit: { max: 10, timeWindow: 60_000 } },
      schema: {
        tags: ['auth'],
        summary: 'Exchange DummyJSON credentials for a gateway-issued JWT',
        body: loginBodySchema,
        response: { 200: loginResponseSchema },
      },
    },
    async (request) => {
      const user = await authService.verifyCredentials(
        request.body.username,
        request.body.password,
      );
      const accessToken = app.jwt.sign(
        { sub: user.id, username: user.username },
        { expiresIn: `${config.jwt.ttlSeconds}s` },
      );
      return {
        accessToken,
        tokenType: 'Bearer' as const,
        expiresIn: config.jwt.ttlSeconds,
        user,
      };
    },
  );
};
