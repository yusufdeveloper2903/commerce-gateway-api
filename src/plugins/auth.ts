import fastifyJwt from '@fastify/jwt';
import fp from 'fastify-plugin';
import { UnauthorizedError } from '../lib/errors.js';

export interface AuthPluginOptions {
  secret: string;
}

export const authPlugin = fp<AuthPluginOptions>(
  async (app, opts) => {
    await app.register(fastifyJwt, {
      secret: opts.secret,
      sign: { algorithm: 'HS256', iss: 'commerce-gateway' },
      verify: { algorithms: ['HS256'], allowedIss: 'commerce-gateway' },
    });

    app.decorate('authenticate', async (request) => {
      try {
        await request.jwtVerify();
      } catch (error) {
        throw new UnauthorizedError('Missing, invalid or expired bearer token', { cause: error });
      }
    });
  },
  { name: 'auth' },
);
