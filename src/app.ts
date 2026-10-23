import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { AppConfig } from './config/env.js';
import { createContainer, type ContainerOverrides } from './container.js';
import { authRoutes } from './modules/auth/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { productRoutes } from './modules/products/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { authPlugin } from './plugins/auth.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { metricsPlugin } from './plugins/metrics.js';
import { swaggerPlugin } from './plugins/swagger.js';

export interface BuildAppOptions {
  config: AppConfig;
  overrides?: Omit<ContainerOverrides, 'logger'>;
  logger?: FastifyServerOptions['logger'];
}

const REQUEST_ID_PATTERN = /^[\w.:-]{1,128}$/;
const UNLIMITED_ROUTES = new Set(['/health', '/ready', '/metrics']);

function defaultLogger(config: AppConfig): FastifyServerOptions['logger'] {
  return {
    level: config.logLevel,
    redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password'],
    ...(config.env === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss.l' } } }
      : {}),
  };
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;

  const app = Fastify({
    logger: options.logger ?? defaultLogger(config),
    // Honour a caller-supplied correlation id (if sane), otherwise mint one.
    requestIdHeader: false,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
        ? incoming
        : randomUUID();
    },
    // Only trust X-Forwarded-* when deployed behind a known proxy (affects req.ip / rate limiting).
    trustProxy: config.trustProxy,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const container = createContainer(config, {
    ...options.overrides,
    logger: app.log,
  });
  app.decorate('deps', container);

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  await app.register(errorHandlerPlugin);
  await app.register(helmet, {
    // JSON API: the only HTML served is Swagger UI, which needs inline scripts/styles.
    contentSecurityPolicy: false,
  });
  await app.register(cors, {
    origin: config.corsOrigin,
    exposedHeaders: ['x-request-id', 'x-cache'],
  });
  await app.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
    allowList: (request) => UNLIMITED_ROUTES.has(request.url),
  });
  await app.register(authPlugin, { secret: config.jwt.secret });
  await app.register(swaggerPlugin);
  await app.register(metricsPlugin);

  await app.register(healthRoutes);
  await app.register(productRoutes, { prefix: '/products' });
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(userRoutes);

  return app;
}
