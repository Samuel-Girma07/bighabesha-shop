import { describe, it, expect } from 'vitest';
import { sanitizeProxyEndpoint, LOGGER_REDACT_PATHS } from '../src/logger/index.js';
import { PortalGeoblockedError } from '../src/services/receipt_verifier/types.js';
import { toCustomerSafeProblem, toCustomerSafeResult } from '../src/api/receipts.js';

/**
 * P0 regression guard: the operator's Ethiopian egress proxy URI embeds
 * `user:pass` credentials. Before this suite, those credentials reached the
 * customer verbatim through `PortalGeoblockedError.details.proxyHost`, which
 * `POST /api/receipts/verify` serialised straight into its response body.
 */

const PROXY_SECRET = 'sup3rs3cret-do-not-leak';
const RAW_PROXY_URL = `http://ethiopiauser:${PROXY_SECRET}@proxy.provider.et:8080`;

/** Any embedded `scheme://user:pass@` credential. Mirrors the API sweep. */
const CREDENTIAL_PATTERN = /[a-z0-9+.-]+:\/\/[^\s/@:]+:[^\s/@]*@/i;

describe('sanitizeProxyEndpoint', () => {
  it('reduces a full proxy URI to a bare host:port', () => {
    expect(sanitizeProxyEndpoint(RAW_PROXY_URL)).toBe('proxy.provider.et:8080');
  });

  it('strips credentials from an https proxy URI', () => {
    expect(sanitizeProxyEndpoint(`https://u:${PROXY_SECRET}@10.0.0.1:3128`)).toBe('10.0.0.1:3128');
  });

  it('preserves a bare host:port unchanged', () => {
    expect(sanitizeProxyEndpoint('proxy.provider.et:8080')).toBe('proxy.provider.et:8080');
  });

  it('drops path and query segments', () => {
    expect(sanitizeProxyEndpoint(`http://u:${PROXY_SECRET}@proxy.et:8080/path?q=1`)).toBe('proxy.et:8080');
  });

  it('never emits a userinfo separator even for pathological input', () => {
    // Password itself contains an '@'; lastIndexOf('@') must win.
    const nasty = `http://user:p@ss${PROXY_SECRET}@proxy.et:8080`;
    const out = sanitizeProxyEndpoint(nasty);
    expect(out).toBe('proxy.et:8080');
    expect(out).not.toContain('@');
  });

  it('returns empty string for absent or blank values', () => {
    expect(sanitizeProxyEndpoint(undefined)).toBe('');
    expect(sanitizeProxyEndpoint(null)).toBe('');
    expect(sanitizeProxyEndpoint('')).toBe('');
    expect(sanitizeProxyEndpoint('   ')).toBe('');
  });

  it('does not throw on a malformed URI', () => {
    expect(() => sanitizeProxyEndpoint('http://')).not.toThrow();
    expect(sanitizeProxyEndpoint('http://')).toBe('');
  });
});

describe('PortalGeoblockedError credential containment', () => {
  it('never places proxy credentials in details', () => {
    const err = new PortalGeoblockedError('telebirr', RAW_PROXY_URL);

    const serialised = JSON.stringify(err.problemDetails);
    expect(serialised).not.toContain(PROXY_SECRET);
    expect(serialised).not.toMatch(CREDENTIAL_PATTERN);
    expect(serialised).not.toContain('@');
  });

  it('retains a diagnosable, credential-free endpoint for operators', () => {
    const err = new PortalGeoblockedError('telebirr', RAW_PROXY_URL);
    expect(err.problemDetails.details?.proxyEndpoint).toBe('proxy.provider.et:8080');
  });

  it('omits the endpoint key entirely when no proxy is configured', () => {
    const err = new PortalGeoblockedError('cbe');
    expect(err.problemDetails.details).not.toHaveProperty('proxyEndpoint');
  });
});

describe('customer-facing response projections', () => {
  it('strips operator diagnostics from a problem body', () => {
    const problem = new PortalGeoblockedError('telebirr', RAW_PROXY_URL).problemDetails;

    const safe = toCustomerSafeProblem(problem) as Record<string, unknown>;

    expect(safe).not.toHaveProperty('details');
    // Customer-facing narrative fields survive.
    expect(safe.code).toBe('PORTAL_GEOBLOCKED');
    expect(safe.remediation_hint).toBeTruthy();
  });

  it('sweeps credentials out of retained string fields as defence in depth', () => {
    const safe = toCustomerSafeProblem({
      type: 'https://shop.example/errors/x',
      title: 't',
      status: 502,
      detail: `proxy ${RAW_PROXY_URL} unreachable`,
      instance: '/api/receipts/verify',
      code: 'PORTAL_GEOBLOCKED',
      remediation_hint: 'r',
      timestamp: new Date().toISOString(),
    }) as Record<string, unknown>;

    expect(String(safe.detail)).not.toContain(PROXY_SECRET);
    expect(String(safe.detail)).not.toMatch(CREDENTIAL_PATTERN);
  });

  it('handles an absent problem without throwing', () => {
    expect(toCustomerSafeProblem(undefined)).toBeUndefined();
  });

  it('removes the raw bank audit trail from a success payload', () => {
    const safe = toCustomerSafeResult({
      success: true,
      status: 'auto_verified',
      orderId: 'ORD-1',
      transactionReference: 'FT123',
      bankPayload: {
        bank: 'telebirr',
        amountEtb: 1000,
        settledAmountEtb: 1000,
        rawAuditTrail: { html: '<table>bank markup</table>' },
      },
    }) as Record<string, unknown>;

    const bankPayload = safe.bankPayload as Record<string, unknown>;
    expect(bankPayload).not.toHaveProperty('rawAuditTrail');
    expect(bankPayload.amountEtb).toBe(1000);
    expect(safe.transactionReference).toBe('FT123');
  });

  it('tolerates a success payload with no bankPayload', () => {
    const safe = toCustomerSafeResult({ success: true, status: 'auto_verified' }) as Record<string, unknown>;
    expect(safe.success).toBe(true);
  });
});

describe('logger redact coverage', () => {
  it('redacts proxy URL and endpoint keys at any depth', () => {
    for (const key of ['proxyUrl', 'proxyHost', 'proxyEndpoint']) {
      expect(LOGGER_REDACT_PATHS).toContain(key);
      expect(LOGGER_REDACT_PATHS).toContain(`*.${key}`);
    }
  });
});