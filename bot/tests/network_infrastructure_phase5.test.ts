import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker } from '../src/services/receipt_verifier/circuit_breaker.js';
import { CbeBankAdapter } from '../src/services/receipt_verifier/adapters/cbe.adapter.js';
import { TelebirrAdapter } from '../src/services/receipt_verifier/adapters/telebirr.adapter.js';
import {
  DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
} from '../src/services/receipt_verifier/constants.js';
import { BankPortalUnavailableError } from '../src/services/receipt_verifier/types.js';

/** Minimal valid extraction payload for CBE adapter.verify() */
function cbeReference(ref: string) {
  return {
    bank: 'cbe' as const,
    rawReference: ref,
    normalizedReference: ref,
    extractedAt: new Date(),
    confidence: 1,
    decodeMethod: 'qr_matrix' as const,
  };
}

/** Minimal valid extraction payload for Telebirr adapter.verify() */
function telebirrReference(ref: string) {
  return {
    bank: 'telebirr' as const,
    rawReference: ref,
    normalizedReference: ref,
    extractedAt: new Date(),
    confidence: 0.9,
    decodeMethod: 'qr_matrix' as const,
  };
}

describe('Phase 5: Network & Infrastructure Hardening', () => {
  const originalProxyVars = {
    TELEBIRR_PROXY_URL: process.env.TELEBIRR_PROXY_URL,
    ETHIOPIA_PROXY_URL: process.env.ETHIOPIA_PROXY_URL,
  };

  beforeEach(() => {
    // Never inherit a proxy from the host environment: these tests assert DIRECT egress
    // classification, which is only meaningful when no proxy is configured.
    delete process.env.TELEBIRR_PROXY_URL;
    delete process.env.ETHIOPIA_PROXY_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();

    if (originalProxyVars.TELEBIRR_PROXY_URL === undefined) delete process.env.TELEBIRR_PROXY_URL;
    else process.env.TELEBIRR_PROXY_URL = originalProxyVars.TELEBIRR_PROXY_URL;

    if (originalProxyVars.ETHIOPIA_PROXY_URL === undefined) delete process.env.ETHIOPIA_PROXY_URL;
    else process.env.ETHIOPIA_PROXY_URL = originalProxyVars.ETHIOPIA_PROXY_URL;
  });

  describe('Circuit Breaker Tuning', () => {
    it('defaults to failure threshold 5 to resist transient network spikes', () => {
      expect(DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD).toBe(5);

      const cb = new CircuitBreaker({});
      // Record 3 failures: state must remain CLOSED (previously would have tripped)
      cb.recordFailure(new Error('transient timeout 1'));
      cb.recordFailure(new Error('transient timeout 2'));
      cb.recordFailure(new Error('transient timeout 3'));
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.canAttempt()).toBe(true);

      // 4th failure: still CLOSED
      cb.recordFailure(new Error('transient timeout 4'));
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.canAttempt()).toBe(true);

      // 5th failure: trips to OPEN
      cb.recordFailure(new Error('transient timeout 5'));
      expect(cb.getState()).toBe('OPEN');
      expect(cb.canAttempt()).toBe(false);
    });
  });

  /**
   * The "CBE Port 100 Outbound Firewall Fallback" this file used to assert no
   * longer exists, and its absence is the point.
   *
   * The old rail fetched `https://apps.cbe.com.et:100/?id={FT}` and, when the
   * outbound firewall dropped port 100, silently retried the same URL on 443.
   * That flow is retired: it could never verify anything (the legacy endpoint
   * additionally required the last 8 digits of the shop account appended to the
   * FT code, which the bot has no way to know), and `apps.cbe.com.et:443` has
   * nothing listening at all. The rail now talks to a single HTTPS/443 JSON
   * endpoint, so there is no second port to fall back to — the retry branch,
   * `RECEIPT_CBE_PORT` and the port-100 SSRF allowance went with it.
   *
   * These assertions guard against that dead code creeping back in.
   */
  describe('CBE legacy port-100 egress is retired', () => {
    it('queries exactly one HTTPS/443 API URL and never probes a second port', async () => {
      const adapter = new CbeBankAdapter(new CircuitBreaker({ failureThreshold: 10 }));

      const requestedUrls: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: any) => {
          requestedUrls.push(String(url));
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({
                id: 'TXR4K9Z7Q2WX',
                status: 'COMPLETED',
                amountCredited: '500.00',
                creditAccountNo: '1000******000',
                creditAccountHolder: 'Bighabesha Shop',
                dateTimes: [new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')],
              }),
          } as unknown as Response;
        })
      );

      const payload = await adapter.verify(cbeReference('v2-Ts7Qv4Nb2Xk9Rm5Pw3Zd'));

      expect(requestedUrls).toHaveLength(1);
      expect(requestedUrls[0]).toContain('https://mb.cbe.com.et/');
      expect(requestedUrls[0]).not.toContain(':100');
      expect(payload.amountEtb).toBe(500);
    });

    it('rejects a legacy FT reference locally, so no egress is attempted at all', async () => {
      const adapter = new CbeBankAdapter(new CircuitBreaker({ failureThreshold: 10 }));
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      await expect(adapter.verify(cbeReference('FT26TESTPORTFALLBACK'))).rejects.toThrow(
        /cannot be verified as a CBE transaction/
      );

      // Not merely "no fallback": no call whatsoever. The throw happens before
      // the breaker wrapper, so an unroutable customer code cannot record a
      // portal failure and trip the breaker for everyone else.
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('surfaces an aborted request as BankPortalUnavailableError, with no retry', async () => {
      const adapter = new CbeBankAdapter(new CircuitBreaker({ failureThreshold: 10 }));

      const requestedUrls: string[] = [];
      const abortError = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: any) => {
          requestedUrls.push(String(url));
          throw abortError;
        })
      );

      await expect(adapter.verify(cbeReference('v2-Ts7Qv4Nb2Xk9Rm5Pw3Zd'))).rejects.toBeInstanceOf(
        BankPortalUnavailableError
      );

      expect(requestedUrls).toHaveLength(1);
    });
  });

  describe('Telebirr Proxy Resilience', () => {
    it('classifies connection reset/refusal/timeout as proxy failures WHEN a proxy is configured', () => {
      const adapter = new TelebirrAdapter();
      const isProxyFailure = (adapter as any).isProxyFailure.bind(adapter);

      expect(isProxyFailure(new Error('proxy connection refused'), true)).toBe(true);
      expect(isProxyFailure({ code: 'ECONNRESET', message: 'socket hang up' }, true)).toBe(true);
      expect(isProxyFailure({ code: 'ECONNREFUSED', message: 'connection refused' }, true)).toBe(true);
      expect(isProxyFailure({ code: 'ETIMEDOUT', message: 'connection timed out' }, true)).toBe(true);
      expect(isProxyFailure(new Error('regular parsing error'), true)).toBe(false);
    });

    it('never classifies transport errors as proxy failures when no proxy is configured', () => {
      const adapter = new TelebirrAdapter();
      const isProxyFailure = (adapter as any).isProxyFailure.bind(adapter);

      // Regression guard: these used to be rewritten to PORTAL_GEOBLOCKED even with no proxy,
      // telling administrators the portal was geo-blocking us when it had simply timed out.
      expect(isProxyFailure({ code: 'ETIMEDOUT', message: 'connection timed out' }, false)).toBe(false);
      expect(isProxyFailure({ code: 'ECONNREFUSED', message: 'connection refused' }, false)).toBe(false);
      expect(isProxyFailure({ code: 'ECONNRESET', message: 'socket hang up' }, false)).toBe(false);
      expect(isProxyFailure(new Error('proxy connection refused'), false)).toBe(false);
    });

    it('surfaces a direct (no proxy) timeout as BANK_PORTAL_UNAVAILABLE, not PORTAL_GEOBLOCKED', async () => {
      const adapter = new TelebirrAdapter();

      vi.stubGlobal('fetch', vi.fn(async () => {
        throw Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
      }));

      const error = await adapter.verify(telebirrReference('TELEBIRRTIMEOUT1')).catch((err) => err);

      expect(error).toBeInstanceOf(BankPortalUnavailableError);
      expect((error as Error).name).not.toBe('PortalGeoblockedError');
    });
  });
});