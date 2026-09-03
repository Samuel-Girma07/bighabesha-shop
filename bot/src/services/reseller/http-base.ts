import type { AppConfig } from '../../config/env.js';
import { fetchJson, HttpError, CircuitOpenError } from '../../lib/http.js';
import { logger, redactSecret } from '../../logger/index.js';
import type {
  ResellerBalanceResult,
  ResellerFulfillParams,
  ResellerFulfillResult,
} from './types.js';
import {
  InsufficientFloatError,
  InvalidTargetUserError,
  ProviderUnavailableError,
  type IResellerProvider,
} from './types.js';

/**
 * Shared plumbing for HTTP-based reseller adapters: base URL resolution,
 * auth header construction, request options tuned for delivery semantics, and
 * uniform mapping of transport/HTTP faults onto the reseller error taxonomy.
 *
 * Security: the API key is only ever attached as a header value — it is never
 * interpolated into logged URLs or messages. All log lines use redactSecret().
 */
export abstract class HttpResellerProviderBase implements IResellerProvider {
  abstract readonly name: string;

  constructor(protected readonly config: AppConfig) {}

  /** Absolute base URL with trailing slash stripped; throws on misconfiguration. */
  protected abstract baseUrl(): string;

  /** Resolved API key for this provider; subclasses can prioritize provider-specific keys. */
  protected apiKey(): string {
    return this.config.RESELLER_API_KEY;
  }

  /** Auth header value, e.g. `Bearer <key>`; subclasses may override the scheme. */
  protected authHeaderValue(): string {
    return `Bearer ${this.apiKey()}`;
  }

  /**
   * Overridable auth header builder. Defaults to standard Bearer token.
   * Providers using proprietary auth (e.g., Gramix x-api-key) override this.
   */
  protected authHeaders(): Record<string, string> {
    return { Authorization: this.authHeaderValue() };
  }

  /** Default request timeout; delivery calls are long-running on the provider side. */
  protected get timeoutMs(): number {
    return 30_000;
  }

  /**
   * POST a JSON body. Retries 5xx/429 but never 4xx — a 4xx from the provider
   * is a deterministic rejection (bad target, low float), not transient noise.
   * Delivery calls are NOT retried automatically at this layer: idempotency is
   * the service layer's job (orderId is sent as the provider idempotency key).
   */
  protected async postJson<T>(
    path: string,
    body: unknown,
    options?: { headers?: Record<string, string> }
  ): Promise<T> {
    const url = `${this.baseUrl()}/${path.replace(/^\//, '')}`;
    return fetchJson<T>(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders(),
        ...options?.headers,
      },
      body: JSON.stringify(body),
      timeoutMs: this.timeoutMs,
      attempts: 1, // delivery must not auto-retry — see service layer retry flow
      breakerKey: `reseller:${this.name}`,
      retryOn5xx: false,
    });
  }

  protected async getJson<T>(
    path: string,
    options?: { headers?: Record<string, string> }
  ): Promise<T> {
    const url = `${this.baseUrl()}/${path.replace(/^\//, '')}`;
    return fetchJson<T>(url, {
      method: 'GET',
      headers: {
        ...this.authHeaders(),
        ...options?.headers,
      },
      timeoutMs: 15_000,
      attempts: 2,
      breakerKey: `reseller:${this.name}`,
      retryOn5xx: true,
    });
  }

  protected logContext(): Record<string, unknown> {
    return { provider: this.name, apiKey: redactSecret(this.apiKey()) };
  }

  /**
   * Map any failure thrown during fulfill() into the reseller error taxonomy.
   * Provider-specific status mapping happens before this call; this is the
   * fallback for transport-level and unrecognized faults.
   */
  protected toUnavailable(err: unknown): ProviderUnavailableError {
    if (err instanceof CircuitOpenError) {
      return new ProviderUnavailableError(this.name, `Provider circuit is open (too many recent failures): ${err.message}`, err);
    }
    if (err instanceof HttpError) {
      logger.warn({ ...this.logContext(), status: err.status }, 'Reseller HTTP error');
      return new ProviderUnavailableError(this.name, `Provider returned HTTP ${err.status}`, err);
    }
    logger.warn({ ...this.logContext(), err }, 'Reseller request failed');
    return new ProviderUnavailableError(this.name, undefined, err);
  }

  abstract fulfill(params: ResellerFulfillParams): Promise<ResellerFulfillResult>;
  abstract getBalance(): Promise<ResellerBalanceResult>;
}

export { InsufficientFloatError, InvalidTargetUserError, ProviderUnavailableError };
