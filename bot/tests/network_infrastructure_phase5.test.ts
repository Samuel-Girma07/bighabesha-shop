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

  describe('CBE Port 100 Outbound Firewall Fallback', () => {
    it('falls back to standard HTTPS port 443 when port 100 query fails', async () => {
      const adapter = new CbeBankAdapter(new CircuitBreaker({ failureThreshold: 10 }));

      const requestedUrls: string[] = [];
      const mockFetch = vi.fn(async (url: any) => {
        requestedUrls.push(String(url));
        if (String(url).includes(':100/')) {
          // Simulate outbound firewall dropping/rejecting port 100
          const err = new Error('connect ECONNREFUSED apps.cbe.com.et:100');
          (err as any).code = 'ECONNREFUSED';
          throw err;
        }

        // Port 443 fallback succeeds
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'text/html' }),
          arrayBuffer: async () => Buffer.from(`
            <html>
              <body>
                <div>Transaction Reference: FT26TESTPORTFALLBACK</div>
                <div>Amount: 500.00 ETB</div>
                <div>Receiver Account: 1000123456789</div>
                <div>Receiver Name: Bighabesha Shop</div>
                <div>Date: 2026-09-16 15:30:00</div>
              </body>
            </html>
          `),
        } as unknown as Response;
      });

      vi.stubGlobal('fetch', mockFetch);

      const payload = await adapter.verify(cbeReference('FT26TESTPORTFALLBACK'));

      // Verify both port 100 and port 443 were queried in sequence
      expect(requestedUrls.length).toBe(2);
      expect(requestedUrls[0]).toContain(':100/');
      expect(requestedUrls[1]).not.toContain(':100/');
      expect(requestedUrls[1]).toContain('apps.cbe.com.et');
      expect(payload.transactionReference).toBe('FT26TESTPORTFALLBACK');
      expect(payload.amountEtb).toBe(500);
    });

    it('rethrows abort/timeout without attempting the port 443 fallback', async () => {
      const adapter = new CbeBankAdapter(new CircuitBreaker({ failureThreshold: 10 }));

      const requestedUrls: string[] = [];
      const abortError = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
      vi.stubGlobal('fetch', vi.fn(async (url: any) => {
        requestedUrls.push(String(url));
        throw abortError;
      }));

      await expect(adapter.verify(cbeReference('FT26TESTABORT'))).rejects.toBeInstanceOf(
        BankPortalUnavailableError
      );

      // Exactly one attempt (port 100): an aborted request must never trigger a fallback retry.
      expect(requestedUrls.length).toBe(1);
      expect(requestedUrls[0]).toContain(':100/');
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
