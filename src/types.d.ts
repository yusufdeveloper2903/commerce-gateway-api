import type { onRequestHookHandler } from 'fastify';
import type { Container } from './container.js';

declare module 'fastify' {
  interface FastifyInstance {
    deps: Container;
    authenticate: onRequestHookHandler;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: number; username: string };
    user: { sub: number; username: string; iat: number; exp: number };
  }
}
