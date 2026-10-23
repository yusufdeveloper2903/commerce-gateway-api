/**
 * Typed application errors. Every error that can reach a client carries an HTTP
 * status and a stable problem `type`, so the error handler can render an
 * RFC 7807 `application/problem+json` response without string matching.
 */
export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly type: string;
  abstract readonly title: string;
  readonly headers: Record<string, string> = {};

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

const PROBLEM_BASE = 'https://commerce-gateway.dev/problems';

export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly type = `${PROBLEM_BASE}/not-found`;
  readonly title = 'Resource not found';
}

export class UnauthorizedError extends AppError {
  readonly statusCode = 401;
  readonly type = `${PROBLEM_BASE}/unauthorized`;
  readonly title = 'Unauthorized';
}

/** Upstream answered with an unexpected non-2xx status. */
export class UpstreamHttpError extends AppError {
  readonly statusCode = 502;
  readonly type = `${PROBLEM_BASE}/upstream-error`;
  readonly title = 'Bad gateway';

  constructor(
    readonly upstreamStatus: number,
    readonly upstreamBody: unknown,
    message = `Upstream responded with HTTP ${upstreamStatus}`,
  ) {
    super(message);
  }

  /** 5xx and 429 are worth retrying; other 4xx are caller mistakes. */
  get isTransient(): boolean {
    return this.upstreamStatus >= 500 || this.upstreamStatus === 429;
  }
}

/** Network-level failure: DNS, connection reset, TLS, etc. */
export class UpstreamUnavailableError extends AppError {
  readonly statusCode = 502;
  readonly type = `${PROBLEM_BASE}/upstream-unavailable`;
  readonly title = 'Upstream unavailable';
}

export class UpstreamTimeoutError extends AppError {
  readonly statusCode = 504;
  readonly type = `${PROBLEM_BASE}/upstream-timeout`;
  readonly title = 'Upstream timeout';
}

/** Upstream responded 2xx but with a payload that violates our contract. */
export class UpstreamContractError extends AppError {
  readonly statusCode = 502;
  readonly type = `${PROBLEM_BASE}/upstream-contract`;
  readonly title = 'Upstream contract violation';
}

export class CircuitOpenError extends AppError {
  readonly statusCode = 503;
  readonly type = `${PROBLEM_BASE}/circuit-open`;
  readonly title = 'Service temporarily unavailable';

  constructor(readonly retryAfterMs: number) {
    super('Upstream circuit breaker is open; failing fast');
    this.headers['retry-after'] = String(Math.max(1, Math.ceil(retryAfterMs / 1000)));
  }
}

/** Failures that indicate upstream health problems (count toward the breaker, retryable). */
export function isTransientUpstreamError(error: unknown): boolean {
  if (error instanceof UpstreamHttpError) return error.isTransient;
  return error instanceof UpstreamUnavailableError || error instanceof UpstreamTimeoutError;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  requestId?: string;
  errors?: { path: string; message: string }[];
}
