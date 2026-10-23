import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  UPSTREAM_BASE_URL: z.url().default('https://dummyjson.com'),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  UPSTREAM_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(2),
  UPSTREAM_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(0).default(100),

  CB_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
  CB_RESET_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  CACHE_MAX_ENTRIES: z.coerce.number().int().positive().default(1000),
  CACHE_TTL_MS: z.coerce.number().int().min(0).default(30_000),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  CORS_ORIGIN: z.string().default('*'),
  TRUST_PROXY: z.stringbool().default(false),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export type Env = z.infer<typeof envSchema>;

export interface AppConfig {
  env: Env['NODE_ENV'];
  host: string;
  port: number;
  logLevel: Env['LOG_LEVEL'];
  upstream: {
    baseUrl: string;
    timeoutMs: number;
    maxRetries: number;
    retryBaseDelayMs: number;
  };
  circuitBreaker: {
    failureThreshold: number;
    resetTimeoutMs: number;
  };
  cache: {
    maxEntries: number;
    ttlMs: number;
  };
  jwt: {
    secret: string;
    ttlSeconds: number;
  };
  rateLimit: {
    max: number;
    windowMs: number;
  };
  corsOrigin: string | string[];
  trustProxy: boolean;
  shutdownTimeoutMs: number;
}

/**
 * Parses and validates environment variables once at startup.
 * Fails fast with a readable message instead of crashing later at first use.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  const env = parsed.data;
  const origins = env.CORS_ORIGIN.split(',').map((o) => o.trim());

  return {
    env: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    upstream: {
      baseUrl: env.UPSTREAM_BASE_URL.replace(/\/+$/, ''),
      timeoutMs: env.UPSTREAM_TIMEOUT_MS,
      maxRetries: env.UPSTREAM_MAX_RETRIES,
      retryBaseDelayMs: env.UPSTREAM_RETRY_BASE_DELAY_MS,
    },
    circuitBreaker: {
      failureThreshold: env.CB_FAILURE_THRESHOLD,
      resetTimeoutMs: env.CB_RESET_TIMEOUT_MS,
    },
    cache: { maxEntries: env.CACHE_MAX_ENTRIES, ttlMs: env.CACHE_TTL_MS },
    jwt: { secret: env.JWT_SECRET, ttlSeconds: env.JWT_TTL_SECONDS },
    rateLimit: { max: env.RATE_LIMIT_MAX, windowMs: env.RATE_LIMIT_WINDOW_MS },
    trustProxy: env.TRUST_PROXY,
    corsOrigin: origins.length === 1 ? (origins[0] ?? '*') : origins,
    shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
  };
}
