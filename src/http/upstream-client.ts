import type { z } from 'zod';
import type { CircuitBreaker } from '../lib/circuit-breaker.js';
import {
  CircuitOpenError,
  UpstreamContractError,
  UpstreamHttpError,
  UpstreamTimeoutError,
  UpstreamUnavailableError,
  isTransientUpstreamError,
} from '../lib/errors.js';
import type { MetricsRegistry } from '../lib/metrics.js';
import { retry } from '../lib/retry.js';

export type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface UpstreamRequest {
  method?: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Low-cardinality label for metrics/logs, e.g. "products.get". */
  endpoint: string;
}

/** The only thing services know about HTTP. Easy to fake in tests. */
export interface HttpClient {
  request<S extends z.ZodType>(req: UpstreamRequest, schema: S): Promise<z.output<S>>;
}

export interface UpstreamLogger {
  warn(obj: object, msg: string): void;
}

export interface ResilientHttpClientOptions {
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  breaker: CircuitBreaker;
  metrics: MetricsRegistry;
  logger?: UpstreamLogger;
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
}

const IDEMPOTENT = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

/**
 * fetch() wrapped in the resilience pipeline:
 *
 *   retry (idempotent only, transient errors only, backoff + jitter)
 *     └─ circuit breaker (fail fast when upstream is unhealthy)
 *          └─ single attempt with AbortSignal timeout
 *   └─ Zod contract validation of the 2xx payload
 */
export class ResilientHttpClient implements HttpClient {
  private readonly fetch: FetchFn;

  constructor(private readonly options: ResilientHttpClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async request<S extends z.ZodType>(req: UpstreamRequest, schema: S): Promise<z.output<S>> {
    const method = req.method ?? 'GET';
    const retries = IDEMPOTENT.has(method) ? this.options.maxRetries : 0;

    const raw = await retry(() => this.options.breaker.execute(() => this.attempt(req, method)), {
      retries,
      baseDelayMs: this.options.retryBaseDelayMs,
      shouldRetry: (error) =>
        !(error instanceof CircuitOpenError) && isTransientUpstreamError(error),
      onRetry: (error, attempt, delayMs) => {
        this.options.metrics.upstreamRetriesTotal.inc({ endpoint: req.endpoint });
        this.options.logger?.warn(
          { endpoint: req.endpoint, attempt, delayMs, err: (error as Error).message },
          'retrying upstream request',
        );
      },
      ...(this.options.sleep ? { sleep: this.options.sleep } : {}),
    }).catch((error: unknown) => {
      if (error instanceof CircuitOpenError) {
        this.options.metrics.upstreamRequestsTotal.inc({
          endpoint: req.endpoint,
          outcome: 'circuit_open',
        });
      }
      throw error;
    });

    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new UpstreamContractError(
        `Upstream payload for ${req.endpoint} did not match the expected contract`,
        { cause: parsed.error },
      );
    }
    return parsed.data;
  }

  private buildUrl(req: UpstreamRequest): string {
    const url = new URL(this.options.baseUrl + req.path);
    for (const [key, value] of Object.entries(req.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private async attempt(req: UpstreamRequest, method: string): Promise<unknown> {
    const started = performance.now();
    let outcome = 'success';
    try {
      const signal = AbortSignal.timeout(this.options.timeoutMs);
      let response: Response;
      try {
        response = await this.fetch(this.buildUrl(req), {
          method,
          signal,
          headers: {
            accept: 'application/json',
            ...(req.body !== undefined ? { 'content-type': 'application/json' } : {}),
          },
          ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
        });
      } catch (error) {
        throw this.mapFetchError(error, req);
      }

      let body: unknown;
      try {
        const text = await response.text();
        body = text ? (JSON.parse(text) as unknown) : undefined;
      } catch (error) {
        if (isAbortError(error)) throw this.mapFetchError(error, req);
        body = undefined;
      }

      if (!response.ok) {
        outcome = response.status >= 500 ? 'http_5xx' : 'http_4xx';
        throw new UpstreamHttpError(response.status, body, upstreamMessage(body, response.status));
      }
      return body;
    } catch (error) {
      if (error instanceof UpstreamTimeoutError) outcome = 'timeout';
      else if (error instanceof UpstreamUnavailableError) outcome = 'network';
      throw error;
    } finally {
      const labels = { endpoint: req.endpoint, outcome };
      this.options.metrics.upstreamRequestsTotal.inc(labels);
      this.options.metrics.upstreamRequestDuration.observe((performance.now() - started) / 1000, {
        endpoint: req.endpoint,
      });
    }
  }

  private mapFetchError(error: unknown, req: UpstreamRequest): Error {
    if (isAbortError(error)) {
      return new UpstreamTimeoutError(
        `Upstream ${req.endpoint} did not respond within ${this.options.timeoutMs}ms`,
        { cause: error },
      );
    }
    return new UpstreamUnavailableError(`Upstream ${req.endpoint} is unreachable`, {
      cause: error,
    });
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function upstreamMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
    return body.message;
  }
  return `Upstream responded with HTTP ${status}`;
}
