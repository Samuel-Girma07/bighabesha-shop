import { CircuitBreakerState } from './types.js';
import { logger } from '../../logger/index.js';
import {
  DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
  DEFAULT_CIRCUIT_BREAKER_COOLDOWN_MS,
  DEFAULT_CIRCUIT_BREAKER_NAME,
} from './constants.js';

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
  name?: string;
}

/**
 * Three-state circuit breaker pattern implementation (CLOSED, OPEN, HALF_OPEN)
 * protecting downstream services from cascading failures when upstream bank portals timeout.
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = 'CLOSED';
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly name: string;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_CIRCUIT_BREAKER_COOLDOWN_MS;
    this.name = options.name ?? DEFAULT_CIRCUIT_BREAKER_NAME;
  }

  /**
   * Checks whether a request can be attempted.
   * In OPEN state, checks if cooldown period has elapsed to transition to HALF_OPEN.
   */
  public canAttempt(bypass: boolean = false): boolean {
    if (bypass) {
      return true;
    }

    if (this.state === 'CLOSED') {
      return true;
    }

    const now = Date.now();
    if (this.state === 'OPEN') {
      if (now - this.lastFailureTime >= this.cooldownMs) {
        this.state = 'HALF_OPEN';
        logger.info({ name: this.name }, 'Circuit breaker transitioning from OPEN to HALF_OPEN');
        return true;
      }
      return false;
    }

    // In HALF_OPEN, allow probe attempt
    return true;
  }

  /**
   * Records a successful execution and resets state to CLOSED.
   */
  public recordSuccess(): void {
    if (this.state === 'HALF_OPEN' || this.failureCount > 0) {
      logger.info(
        { name: this.name, previousState: this.state },
        'Circuit breaker reset to CLOSED after successful request'
      );
    }
    this.state = 'CLOSED';
    this.failureCount = 0;
  }

  /**
   * Records an upstream execution failure.
   * If failure threshold is reached or breaker is probe-testing in HALF_OPEN, trips to OPEN.
   */
  public recordFailure(err?: unknown): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      logger.warn(
        {
          name: this.name,
          failureCount: this.failureCount,
          err: err instanceof Error ? err.message : String(err),
        },
        'Circuit breaker tripped to OPEN state'
      );
    }
  }

  /**
   * Returns current breaker state, taking cooldown expiration into account.
   */
  public getState(): CircuitBreakerState {
    if (this.state === 'OPEN' && Date.now() - this.lastFailureTime >= this.cooldownMs) {
      return 'HALF_OPEN';
    }
    return this.state;
  }

  /**
   * Forcefully resets the circuit breaker to CLOSED with 0 failures.
   */
  public reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }
}
