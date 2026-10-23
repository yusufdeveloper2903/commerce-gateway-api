import type { AppConfig } from './config/env.js';
import { DummyJsonClient } from './http/dummyjson-client.js';
import {
  ResilientHttpClient,
  type FetchFn,
  type HttpClient,
  type UpstreamLogger,
} from './http/upstream-client.js';
import type { Cache } from './lib/cache/cache.js';
import { CachedLoader } from './lib/cache/cached-loader.js';
import { LruCache } from './lib/cache/lru-cache.js';
import { CircuitBreaker, type CircuitState } from './lib/circuit-breaker.js';
import { isTransientUpstreamError } from './lib/errors.js';
import { MetricsRegistry } from './lib/metrics.js';
import { AuthService } from './modules/auth/service.js';
import { ProductService } from './modules/products/service.js';
import { UserService } from './modules/users/service.js';

export interface Container {
  config: AppConfig;
  metrics: MetricsRegistry;
  cache: Cache;
  breaker: CircuitBreaker;
  http: HttpClient;
  productService: ProductService;
  userService: UserService;
  authService: AuthService;
  lifecycle: { shuttingDown: boolean };
}

/** Seams that tests (or alternative deployments) can replace. */
export interface ContainerOverrides {
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  cache?: Cache;
  http?: HttpClient;
  logger?: UpstreamLogger;
  now?: () => number;
}

const STATE_VALUE: Record<CircuitState, number> = { closed: 0, 'half-open': 1, open: 2 };

/**
 * Composition root: the single place where concrete implementations are wired.
 * Everything below takes its collaborators via constructor injection.
 */
export function createContainer(config: AppConfig, overrides: ContainerOverrides = {}): Container {
  const metrics = new MetricsRegistry();

  const breaker = new CircuitBreaker({
    failureThreshold: config.circuitBreaker.failureThreshold,
    resetTimeoutMs: config.circuitBreaker.resetTimeoutMs,
    isFailure: isTransientUpstreamError,
    ...(overrides.now ? { now: overrides.now } : {}),
    onStateChange: (from, to) => {
      metrics.circuitBreakerState.set(STATE_VALUE[to], { upstream: 'dummyjson' });
      overrides.logger?.warn({ from, to }, 'circuit breaker state change');
    },
  });
  metrics.circuitBreakerState.set(0, { upstream: 'dummyjson' });

  const http =
    overrides.http ??
    new ResilientHttpClient({
      baseUrl: config.upstream.baseUrl,
      timeoutMs: config.upstream.timeoutMs,
      maxRetries: config.upstream.maxRetries,
      retryBaseDelayMs: config.upstream.retryBaseDelayMs,
      breaker,
      metrics,
      ...(overrides.logger ? { logger: overrides.logger } : {}),
      ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
      ...(overrides.sleep ? { sleep: overrides.sleep } : {}),
    });

  const cache =
    overrides.cache ??
    new LruCache({
      maxEntries: config.cache.maxEntries,
      ...(overrides.now ? { now: overrides.now } : {}),
    });
  const loader = new CachedLoader({
    cache,
    defaultTtlMs: config.cache.ttlMs,
    onResult: (result) => {
      metrics.cacheEventsTotal.inc({ result });
    },
  });

  const client = new DummyJsonClient(http);
  const productService = new ProductService(client, loader);
  const userService = new UserService(client, loader, productService);
  const authService = new AuthService(client);

  return {
    config,
    metrics,
    cache,
    breaker,
    http,
    productService,
    userService,
    authService,
    lifecycle: { shuttingDown: false },
  };
}
