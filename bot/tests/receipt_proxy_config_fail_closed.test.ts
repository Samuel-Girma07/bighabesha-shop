import { describe, it, expect, afterEach } from 'vitest';
import { TelebirrAdapter } from '../src/services/receipt_verifier/adapters/telebirr.adapter.js';
import { ProxyConfigError, PortalGeoblockedError } from '../src/services/receipt_verifier/types.js';

/**
 * P1 regression guard: proxy construction failure used to fail OPEN.
 *
 * When `new HttpsProxyAgent(...)` threw (malformed URI, unsupported scheme),
 * the adapter logged a warning and continued with `agent === undefined`, which
 * means DIRECT egress. The operator's chosen in-country egress was silently
 * discarded, the request was then geo-blocked, and the failure surfaced as
 * PORTAL_GEOBLOCKED - hiding a configuration fault behind a network symptom
 * that looks like it needs a different fix entirely.
 */

function telebirrReference(ref: string) {
  return {
    bank: 'telebirr' as const,
    rawReference: ref,
    normalizedReference: ref,
    extractedAt: new Date(),
    confidence: 0.9,
    source: 'text' as const,
  };
}

const ORIGINAL_PROXY = process.env.TELEBIRR_PROXY_URL;
const ORIGINAL_ALIAS = process.env.ETHIOPIA_PROXY_URL;

afterEach(() => {
  if (ORIGINAL_PROXY === undefined) delete process.env.TELEBIRR_PROXY_URL;
  else process.env.TELEBIRR_PROXY_URL = ORIGINAL_PROXY;
  if (ORIGINAL_ALIAS === undefined) delete process.env.ETHIOPIA_PROXY_URL;
  else process.env.ETHIOPIA_PROXY_URL = ORIGINAL_ALIAS;
});

describe('FIX-5: proxy configuration failure fails closed', () => {
  it('throws ProxyConfigError for an unparseable proxy URI', async () => {
    process.env.TELEBIRR_PROXY_URL = 'definitely not a uri';
    delete process.env.ETHIOPIA_PROXY_URL;

    const adapter = new TelebirrAdapter();
    await expect(adapter.verify(telebirrReference('FT26PROXYCFG001'))).rejects.toThrow(ProxyConfigError);
  });

  it('does not misreport a config fault as a geo-block', async () => {
    process.env.TELEBIRR_PROXY_URL = 'http://';
    delete process.env.ETHIOPIA_PROXY_URL;

    const adapter = new TelebirrAdapter();
    const err = await adapter
      .verify(telebirrReference('FT26PROXYCFG002'))
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProxyConfigError);
    expect(err).not.toBeInstanceOf(PortalGeoblockedError);
    expect((err as ProxyConfigError).problemDetails.code).toBe('PROXY_CONFIG_INVALID');
  });

  it('never places proxy credentials in the thrown problem details', async () => {
    const secret = 'sup3rs3cret-do-not-leak';
    process.env.TELEBIRR_PROXY_URL = `http://operator:${secret}@proxy.et:not-a-port`;
    delete process.env.ETHIOPIA_PROXY_URL;

    const adapter = new TelebirrAdapter();
    const err = await adapter
      .verify(telebirrReference('FT26PROXYCFG003'))
      .then(() => null)
      .catch((e: unknown) => e);

    const serialised = JSON.stringify((err as ProxyConfigError).problemDetails);
    expect(serialised).not.toContain(secret);
    expect(serialised).not.toContain('operator');
  });

  it('uses a 500 status, since the fault is ours rather than the portal\'s', async () => {
    process.env.TELEBIRR_PROXY_URL = 'http://';
    delete process.env.ETHIOPIA_PROXY_URL;

    const adapter = new TelebirrAdapter();
    const err = await adapter
      .verify(telebirrReference('FT26PROXYCFG004'))
      .then(() => null)
      .catch((e: unknown) => e);

    expect((err as ProxyConfigError).problemDetails.status).toBe(500);
  });

  it('leaves a blank proxy setting alone (direct egress still allowed)', () => {
    // A blank proxy is a legitimate configuration when hosting inside Ethiopia,
    // so it must not be treated as a config fault.
    const adapter = new TelebirrAdapter();
    const isProxyFailure = (adapter as unknown as { isProxyFailure: (e: unknown, h: boolean) => boolean })
      .isProxyFailure.bind(adapter);
    expect(isProxyFailure(new Error('some network error'), false)).toBe(false);
  });
});