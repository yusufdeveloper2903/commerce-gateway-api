import { CircuitOpenError } from './errors.js';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Consecutive failures that trip the breaker from closed to open. */
  failureThreshold: number;
  /** How long the breaker stays open before allowing a trial request. */
  resetTimeoutMs: number;
  /** Concurrent trial requests allowed while half-open. */
  halfOpenMaxCalls?: number;
  /** Decides whether an error indicates an unhealthy dependency. Defaults to "every error". */
  isFailure?: (error: unknown) => boolean;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

/**
 * Classic three-state circuit breaker.
 *
 *  closed    -- N consecutive failures -->  open
 *  open      -- resetTimeout elapsed   -->  half-open (next call is a probe)
 *  half-open -- probe succeeds         -->  closed
 *  half-open -- probe fails            -->  open (timer restarts)
 *
 * While open, calls fail immediately with CircuitOpenError, which protects both
 * the struggling upstream (no pile-on) and our own latency budget (no waiting
 * on timeouts we already know will happen).
 */
export class CircuitBreaker {
  private _state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private halfOpenInFlight = 0;

  private readonly halfOpenMaxCalls: number;
  private readonly isFailure: (error: unknown) => boolean;
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.halfOpenMaxCalls = options.halfOpenMaxCalls ?? 1;
    this.isFailure = options.isFailure ?? (() => true);
    this.now = options.now ?? Date.now;
  }

  get state(): CircuitState {
    // Lazily promote open -> half-open once the cool-down has elapsed.
    if (this._state === 'open' && this.now() - this.openedAt >= this.options.resetTimeoutMs) {
      this.transition('half-open');
    }
    return this._state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.state;

    if (state === 'open') {
      throw new CircuitOpenError(this.remainingOpenMs());
    }
    if (state === 'half-open') {
      if (this.halfOpenInFlight >= this.halfOpenMaxCalls) {
        throw new CircuitOpenError(this.options.resetTimeoutMs);
      }
      this.halfOpenInFlight++;
    }

    const isProbe = state === 'half-open';
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      if (this.isFailure(error)) {
        this.onFailure();
      } else {
        // A non-failure error (e.g. a 404) still proves the upstream is alive.
        this.onSuccess();
      }
      throw error;
    } finally {
      if (isProbe) this.halfOpenInFlight--;
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    if (this._state !== 'closed') this.transition('closed');
  }

  private onFailure(): void {
    this.consecutiveFailures++;
    if (this._state === 'half-open' || this.consecutiveFailures >= this.options.failureThreshold) {
      this.openedAt = this.now();
      this.transition('open');
    }
  }

  private remainingOpenMs(): number {
    return Math.max(0, this.options.resetTimeoutMs - (this.now() - this.openedAt));
  }

  private transition(to: CircuitState): void {
    const from = this._state;
    if (from === to) return;
    this._state = to;
    if (to === 'closed') this.consecutiveFailures = 0;
    this.options.onStateChange?.(from, to);
  }
}
