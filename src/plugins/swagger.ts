import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fp from 'fastify-plugin';
import { jsonSchemaTransform, jsonSchemaTransformObject } from 'fastify-type-provider-zod';

export const swaggerPlugin = fp(
  async (app) => {
    await app.register(fastifySwagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'Commerce Gateway API',
          description:
            'Backend-for-Frontend aggregating DummyJSON with caching, circuit breaking and JWT auth. ' +
            'Errors are returned as RFC 7807 application/problem+json.',
          version: '1.0.0',
        },
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          },
        },
        tags: [
          { name: 'products' },
          { name: 'auth' },
          { name: 'me', description: 'Requires a gateway JWT' },
          { name: 'users' },
          { name: 'ops', description: 'Health and readiness probes' },
        ],
      },
      transform: jsonSchemaTransform,
      transformObject: jsonSchemaTransformObject,
    });
    await app.register(fastifySwaggerUi, { routePrefix: '/docs' });
  },
  { name: 'swagger' },
);
