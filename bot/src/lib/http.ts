import { logger } from '../logger/index.js';

interface BreakerState {
  failures: number;
  openUntil: number;
  halfOpen: boolean;
}

const breakers = new Map<string, BreakerState>();
const BREAKER_THRESHOLD = 5;
const BREAKER_OPEN_MS = 30_000;

export class HttpError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export class CircuitOpenError extends Error {
  constructor(key: string) {
    super(`Circuit breaker open for "${key}" — upstream is failing, request shed without calling it`);
    this.name = 'CircuitOpenError';
  }
}

export interface HardenedFetchOptions extends Omit<RequestInit, 'signal'> {
  timeoutMs: number;
  attempts?: number;
  breakerKey?: string;
  retryOn5xx?: boolean;
}

function breakerFor(key: string): BreakerState {
  let s = breakers.get(key);
  if (!s) {
    s = { failures: 0, openUntil: 0, halfOpen: false };
    breakers.set(key, s);
  }
  return s;
}

function recordSuccess(key: string): void {
  const s = breakerFor(key);
  s.failures = 0;
  s.openUntil = 0;
  s.halfOpen = false;
}

function recordFailure(key: string): void {
  const s = breakerFor(key);
  s.failures += 1;
  if (s.failures >= BREAKER_THRESHOLD) {
    s.openUntil = Date.now() + BREAKER_OPEN_MS;
    s.halfOpen = false;
    logger.error({ breakerKey: key, failures: s.failures, openMs: BREAKER_OPEN_MS }, 'Circuit breaker opened');
  }
}

function assertClosed(key: string): void {
  const s = breakerFor(key);
  if (s.openUntil === 0) return;
  if (Date.now() < s.openUntil) {
    if (s.halfOpen) throw new CircuitOpenError(key);
    s.halfOpen = true;
    return;
  }
  s.openUntil = 0;
  s.failures = 0;
  s.halfOpen = false;
}

/** Test/diagnostic helper: clears breaker state so a suite cannot leak an open circuit. */
export function resetBreakers(): void {
  breakers.clear();
}

export async function hardenedFetch(url: string, opts: HardenedFetchOptions): Promise<Response> {
  const key = opts.breakerKey ?? new URL(url).origin;
  const attempts = Math.max(1, opts.attempts ?? 1);
  const method = (opts.method ?? 'GET').toUpperCase();
  const retryOn5xx = opts.retryOn5xx ?? method === 'GET';

  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    assertClosed(key);
    try {
      const { timeoutMs, attempts: _a, breakerKey: _b, retryOn5xx: _r, ...init } = opts;
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });

      if (response.status >= 500 || response.status === 429) {
        recordFailure(key);
        if (!retryOn5xx || attempt === attempts - 1) {
          const body = await response.text().catch(() => '');
          throw new HttpError(`Upstream ${response.status} from ${key}`, response.status, body.slice(0, 512));
        }
        await sleep(Math.random() * Math.min(2000, 200 * 2 ** attempt));
        continue;
      }

      recordSuccess(key);
      return response;
    } catch (err: any) {
      lastErr = err;
      if (err instanceof CircuitOpenError) throw err;
      recordFailure(key);
      const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      logger.warn({ err, url, attempt: attempt + 1, attempts, isTimeout }, 'Outbound HTTP attempt failed');
      if (attempt === attempts - 1) break;
      await sleep(Math.random() * Math.min(2000, 200 * 2 ** attempt));
    }
  }
  throw lastErr;
}

export async function fetchJson<T>(url: string, opts: HardenedFetchOptions): Promise<T> {
  const response = await hardenedFetch(url, opts);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new HttpError(`Upstream ${response.status} from ${url}`, response.status, body.slice(0, 512));
  }
  return (await response.json()) as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
