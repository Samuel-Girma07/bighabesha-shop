import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import httpsStub from 'node:https';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import { createOrder, getOrderById } from '../src/services/orders.service.js';
import { addStockLink, getAvailableStockCount } from '../src/services/stock.service.js';
import { setSetting } from '../src/services/settings.service.js';
import { ReceiptOrchestrator } from '../src/services/receipt_verifier/orchestrator.service.js';
import { ReceiptIngestionService } from '../src/services/receipt_verifier/ingestion.service.js';
import { CbeBankAdapter } from '../src/services/receipt_verifier/adapters/cbe.adapter.js';
import { CircuitBreaker } from '../src/services/receipt_verifier/circuit_breaker.js';
import {
  UnsupportedBankError,
  UnconfirmedTransactionError,
  InvalidReceiptReferenceError,
  ProxyConfigError,
  PortalGeoblockedError,
  BankPortalUnavailableError,
} from '../src/services/receipt_verifier/types.js';
import {
  SYNTHETIC_CBE_TOKEN,
  SYNTHETIC_CBE_TX_ID,
  SYNTHETIC_MASKED_ACCOUNT,
  SYNTHETIC_FOREIGN_MASKED_ACCOUNT,
  buildCbeApiBody,
  buildCbeApiResponse,
  buildCbeInvalidTokenBody,
  cbeApiUrl,
  cbeReceiptUrl,
  cbeReference,
} from './factories/cbe_api_response.factory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../src/db/migrations');

process.env.BOT_TOKEN = process.env.BOT_TOKEN || '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
process.env.ADMIN_IDS = process.env.ADMIN_IDS || '111111111';

/**
 * CBE rail verification against the live transaction-detail JSON API.
 *
 * Regression guards throughout, not just coverage: each block names the defect
 * it exists to prevent. All fixtures are synthetic (see
 * `factories/cbe_api_response.factory.ts`).
 */

const CBE_APP_ID = 'd1292e42-7400-49de-a2d3-9731caa4c819';
const CBE_APP_VERSION = '0a01980b-9859-1369-8198-59f403820000';

const ORIGINAL_PROXY_VARS = {
  TELEBIRR_PROXY_URL: process.env.TELEBIRR_PROXY_URL,
  ETHIOPIA_PROXY_URL: process.env.ETHIOPIA_PROXY_URL,
};

/** Minimal `Response`-alike: the adapter only reads `status` and `text()`. */
function jsonResponse(body: string, status = 200): Response {
  return {
    status,
    statusText: status === 200 ? 'OK' : 'Internal Server Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

beforeEach(() => {
  // These tests assert the direct-egress path and the settings fallback; never
  // inherit a proxy from the host environment.
  delete process.env.TELEBIRR_PROXY_URL;
  delete process.env.ETHIOPIA_PROXY_URL;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();

  if (ORIGINAL_PROXY_VARS.TELEBIRR_PROXY_URL === undefined) delete process.env.TELEBIRR_PROXY_URL;
  else process.env.TELEBIRR_PROXY_URL = ORIGINAL_PROXY_VARS.TELEBIRR_PROXY_URL;

  if (ORIGINAL_PROXY_VARS.ETHIOPIA_PROXY_URL === undefined) delete process.env.ETHIOPIA_PROXY_URL;
  else process.env.ETHIOPIA_PROXY_URL = ORIGINAL_PROXY_VARS.ETHIOPIA_PROXY_URL;
});

// ============================================================================
// Fixture integrity — the shape is load-bearing
// ============================================================================

describe('CBE API fixture integrity', () => {
  it('models the live contract: strings, a masked account, and a settled amount distinct from the total', () => {
    const doc = buildCbeApiResponse();

    expect(typeof doc.id).toBe('string');
    expect(typeof doc.amountCredited).toBe('string');
    expect(typeof doc.isOtherBank).toBe('boolean');

    // `id` is NOT the request token: reference-binding by equality is impossible.
    expect(doc.id).not.toBe(SYNTHETIC_CBE_TOKEN);
    expect(String(doc.id)).toHaveLength(12);
    expect(SYNTHETIC_CBE_TOKEN).toHaveLength(23);

    // Masked account: 13 characters containing asterisks, and no unmasked copy.
    const masked = String(doc.creditAccountNo);
    expect(masked).toHaveLength(13);
    expect(masked).toContain('*');

    // Settled < debited, because the debited figure carries the fee and tax.
    const credited = parseFloat(String(doc.amountCredited));
    const debited = parseFloat(String(doc.amountDebited));
    expect(credited).toBeLessThan(debited);
    expect(parseFloat(String(doc.totalChargeAmount)) + parseFloat(String(doc.totalTaxAmount))).toBe(
      debited - credited
    );

    // Only `dateTimes[0]` carries a time component.
    expect(String((doc.dateTimes as string[])[0])).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(String(doc.processingDate)).toMatch(/^\d{8}$/);
    expect(String(doc.processingDate)).toHaveLength(8);
  });
});

// ============================================================================
// 1. Intake
// ============================================================================

describe('CBE intake recognises the live receipt format', () => {
  const ingestion = new ReceiptIngestionService();

  it('claims the mbreciept.cbe.com.et/v2- link and keeps the FULL v2- segment as the reference', async () => {
    const sms =
      'Dear Customer, you transferred ETB 1,250.00 from your account to Bighabesha Shop. ' +
      `View your receipt: ${cbeReceiptUrl()}. Thank you for banking with CBE.`;

    const parsed = await ingestion.ingestText(sms);

    expect(parsed.bank).toBe('cbe');
    // The `v2-` prefix is part of the credential the API resolves, so it must
    // survive intake. Dropping it turns a valid receipt into HTTP 500.
    expect(parsed.normalizedReference).toBe(SYNTHETIC_CBE_TOKEN);
    expect(parsed.rawReference).toBe(SYNTHETIC_CBE_TOKEN);
    expect(parsed.sourceUrl).toBe(cbeReceiptUrl());
    expect(parsed.amountEtb).toBe(1250);
  });

  it('preserves token casing (the token is a mixed-case credential, not an FT code)', async () => {
    const mixedCase = 'v2-AbCd3fGh1jKl5MnP9';
    const parsed = await ingestion.ingestText(`Receipt link: ${cbeReceiptUrl(mixedCase)}`);

    // `.toUpperCase()` was correct for FT references and would have silently
    // corrupted every CBE receipt: only the exact-cased token exists upstream.
    expect(parsed.normalizedReference).toBe(mixedCase);
    expect(parsed.normalizedReference).not.toBe(mixedCase.toUpperCase());
  });

  it('claims a bare v2- token pasted on its own', async () => {
    const parsed = await ingestion.ingestText(SYNTHETIC_CBE_TOKEN);

    expect(parsed.bank).toBe('cbe');
    expect(parsed.normalizedReference).toBe(SYNTHETIC_CBE_TOKEN);
  });

  /**
   * The confirmed misroute: a 20-character CBE token sits exactly on the
   * generic `STANDALONE_ALPHA_PATTERN` upper bound (8-20 chars), so the
   * standalone fallback labelled it `telebirr`. The engine then spent an
   * upstream call on Ethio Telecom's portal for a CBE transfer, and reported a
   * failure naming the wrong bank.
   */
  it('never labels a bare CBE v2- token as telebirr', async () => {
    const body = 'v2-Zq4Tk9Wn3Vb7Yc1Hs6Jd';
    expect(body.replace('v2-', '')).toHaveLength(20);

    const parsed = await ingestion.ingestText(body);

    expect(parsed.bank).toBe('cbe');
    expect(parsed.bank).not.toBe('telebirr');
    expect(parsed.normalizedReference).toBe(body);
  });

  it('rejects the legacy apps.cbe.com.et/?id=FT… form outright', async () => {
    // Retiring the legacy endpoint removed the only pattern that used to claim
    // this text, so it can no longer masquerade as a CBE reference.
    await expect(
      ingestion.ingestText('https://apps.cbe.com.et:100/?id=FT24252Y8WQM')
    ).rejects.toBeInstanceOf(UnsupportedBankError);

    await expect(
      ingestion.ingestText(
        'Dear Customer, your account was debited with ETB 1,250.00 for transfer to 1000510711258. Ref: FT24252Y8WQM.'
      )
    ).rejects.toBeInstanceOf(UnsupportedBankError);
  });

  it('still leaves a genuine Telebirr SMS on the Telebirr rail', async () => {
    const parsed = await ingestion.ingestText(
      'telebirr: You have transferred 500.00 ETB to 0965579045. Transaction number: RA75OD70C2 on 2026-09-08.'
    );
    expect(parsed.bank).toBe('telebirr');
  });
});

// ============================================================================
// 2. Adapter — request shape
// ============================================================================

describe('CBE adapter requests the transaction-detail API', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calls the API URL with both X-App-* headers, not the customer SMS link', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(buildCbeApiBody()));
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new CbeBankAdapter(new CircuitBreaker({ failureThreshold: 10 }));
    await adapter.verify(cbeReference());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(url).toBe(cbeApiUrl());
    expect(url).toContain('/api/v1/transactions/public/transaction-detail/');
    // The `v2-` prefix travels with the request segment.
    expect(url.endsWith(`/${SYNTHETIC_CBE_TOKEN}`)).toBe(true);
    // NOT the Nuxt receipt shell, which returns HTML with no receipt fields.
    expect(url).not.toContain('mbreciept.cbe.com.et');

    expect(headers['X-App-ID']).toBe(CBE_APP_ID);
    expect(headers['X-App-Version']).toBe(CBE_APP_VERSION);
    expect(headers.Accept).toBe('application/json');
    expect(headers['User-Agent']).toContain('Mozilla/5.0');
  });

  it('ignores a customer-supplied sourceUrl instead of fetching it', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(buildCbeApiBody()));
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new CbeBankAdapter(new CircuitBreaker({ failureThreshold: 10 }));
    await adapter.verify(
      cbeReference(SYNTHETIC_CBE_TOKEN, { sourceUrl: 'https://evil.example.invalid/?id=' + SYNTHETIC_CBE_TOKEN })
    );

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe(cbeApiUrl());
  });
});

// ============================================================================
// 2. Adapter — settled vs. total, mask, fee, timestamp, names
// ============================================================================

describe('CBE adapter maps the transaction detail onto the payload', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('takes the settled amount from amountCredited, never from the larger totals', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(buildCbeApiBody())));

    const payload = await new CbeBankAdapter().verify(cbeReference());

    // The fixture deliberately sets amountDebited / totalChargeAmount /
    // totalTaxAmount ABOVE the settled figure. Reading any of them would accept
    // a payment whose fee-inflated total reaches the order value while the shop
    // is still short — the underpayment hole already closed on the Telebirr rail.
    expect(payload.amountEtb).toBe(1250);
    expect(payload.amountEtb).toBeLessThan(parseFloat(String(buildCbeApiResponse().amountDebited)));
  });

  it('publishes the bank-side transaction id as the reference, never the customer token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(buildCbeApiBody())));

    const payload = await new CbeBankAdapter().verify(cbeReference());

    expect(payload.transactionReference).toBe(SYNTHETIC_CBE_TX_ID);
    expect(payload.transactionReference).not.toBe(SYNTHETIC_CBE_TOKEN);
  });

  it('returns amountEtb 0 when amountCredited is absent, instead of trusting the SMS amount', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(buildCbeApiBody({ amountCredited: null }))));

    const adapter = new CbeBankAdapter();
    // The reference carries an SMS-derived amount, which is the buyer's own
    // claim about their payment. Trusting it would make the amount pillar
    // attest to itself.
    const payload = await adapter.verify(cbeReference(SYNTHETIC_CBE_TOKEN, { amountEtb: 1250 }));

    expect(payload.amountEtb).toBe(0);
  });

  it('returns amountEtb 0 when amountCredited is unparseable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(buildCbeApiBody({ amountCredited: 'N/A' }))));

    const payload = await new CbeBankAdapter().verify(cbeReference(SYNTHETIC_CBE_TOKEN, { amountEtb: 1250 }));

    expect(payload.amountEtb).toBe(0);
  });

  it('preserves the server-side account mask', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(buildCbeApiBody())));

    const payload = await new CbeBankAdapter().verify(cbeReference());

    // Asterisks are not noise to strip: the API exposes no unmasked account, so
    // the mask IS the available evidence. Stripping it yields a digit string
    // that can never equal the configured account.
    expect(payload.beneficiaryAccount).toBe(SYNTHETIC_MASKED_ACCOUNT);
    expect(payload.beneficiaryAccount).toContain('*');
    expect(payload.beneficiaryAccount).not.toMatch(/^\d+$/);
  });

  it("reports an absent creditAccountHolder as '' and never as the shop's own name", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(buildCbeApiBody({ creditAccountHolder: null }))));

    const payload = await new CbeBankAdapter().verify(cbeReference());

    // The old fallback was the literal 'Bighabesha Shop', the most dangerous
    // possible default: it made a name-based pillar compare the shop's name
    // against itself and pass EVERY receipt, including one paid to a stranger.
    expect(payload.beneficiaryName).toBe('');
    expect(payload.beneficiaryName).not.toBe('Bighabesha Shop');
  });

  it('surfaces the credited party name the bank actually published', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(buildCbeApiBody({ creditAccountHolder: 'Bighabesha Shop' })))
    );

    const payload = await new CbeBankAdapter().verify(cbeReference());

    expect(payload.beneficiaryName).toBe('Bighabesha Shop');
  });

  it('populates feeEtb from the charge and tax totals instead of hardcoding 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          buildCbeApiBody({
            amountCredited: '1250.00',
            amountDebited: '1262.00',
            totalChargeAmount: '10.00',
            totalTaxAmount: '2.00',
          })
        )
      )
    );

    const payload = await new CbeBankAdapter().verify(cbeReference());

    // 10.00 charge + 2.00 tax. The old hardcoded 0 understated what every
    // customer was charged across the whole audit ledger.
    expect(payload.feeEtb).toBe(12);
  });

  it('falls back to the charge components when the aggregates are missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          buildCbeApiBody({
            totalChargeAmount: null,
            totalTaxAmount: null,
            serviceChargeValue: '7.50',
            vatValue: '1.25',
            drCharge: '0.25',
          })
        )
      )
    );

    const payload = await new CbeBankAdapter().verify(cbeReference());

    expect(payload.feeEtb).toBe(9);
  });

  it('reads the timestamp from dateTimes[0], not from the compact value dates', async () => {
    const settledAt = '2026-04-21T13:07:09Z';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(buildCbeApiBody({ dateTimes: [settledAt], valueDateCompact: '20260421' }))
      )
    );

    const payload = await new CbeBankAdapter().verify(cbeReference());

    expect(payload.transactionTimestamp).toBeInstanceOf(Date);
    expect(payload.transactionTimestamp!.toISOString()).toBe('2026-04-21T13:07:09.000Z');
  });

  it('returns a null timestamp when dateTimes is absent (never substitutes "now")', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(buildCbeApiBody({ dateTimes: null }))));

    const payload = await new CbeBankAdapter().verify(cbeReference());

    // `null` fails the recency pillar closed, sending the order to manual
    // review. Substituting "now" would let any arbitrarily stale receipt pass.
    expect(payload.transactionTimestamp).toBeNull();
  });

  it('reports the bank-declared payment channel rather than a hardcoded label', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(buildCbeApiBody({ channel: 'CBE Mobile', platformTransactionType: 'IntraBank' }))
      )
    );

    const payload = await new CbeBankAdapter().verify(cbeReference());

    expect(payload.paymentChannel).toBe('CBE Mobile/IntraBank');
    expect(payload.paymentChannel).not.toBe('cbe_digital');
  });
});

// ============================================================================
// 2. Adapter — positive confirmation
// ============================================================================

describe('CBE adapter requires positive confirmation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('throws UnconfirmedTransactionError when status is not COMPLETED', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(buildCbeApiBody({ status: 'PENDING' }))));

    const err = await new CbeBankAdapter()
      .verify(cbeReference())
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnconfirmedTransactionError);
    expect((err as UnconfirmedTransactionError).problemDetails.code).toBe('TRANSACTION_NOT_CONFIRMED');
  });

  it('throws UnconfirmedTransactionError when the bank sends no status at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(buildCbeApiBody({ status: '' }))));

    await expect(new CbeBankAdapter().verify(cbeReference())).rejects.toBeInstanceOf(
      UnconfirmedTransactionError
    );
  });
});

// ============================================================================
// 2. Adapter — error classification
// ============================================================================

describe('CBE adapter classifies upstream errors', () => {
  afterEach(() => vi.unstubAllGlobals());

  /**
   * The defect: every non-2xx became `Upstream CBE responded with HTTP 500`,
   * which the breaker wrapper rewrote to BANK_PORTAL_UNAVAILABLE — "the bank is
   * down, retry". For a token the bank will never resolve, that is a lie that
   * buries a permanent customer-data error under retryable-outage handling.
   */
  it('maps the HTTP 500 invalid-token body to INVALID_RECEIPT_REFERENCE, not BANK_PORTAL_UNAVAILABLE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(buildCbeInvalidTokenBody(), 500)));

    const err = await new CbeBankAdapter()
      .verify(cbeReference())
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InvalidReceiptReferenceError);
    expect(err).not.toBeInstanceOf(BankPortalUnavailableError);
    expect((err as InvalidReceiptReferenceError).problemDetails.code).toBe('INVALID_RECEIPT_REFERENCE');
    expect((err as InvalidReceiptReferenceError).reason).toContain('tampered');
  });

  it('still treats an opaque HTTP 500 (no readable detail) as an upstream outage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse('<html>Server Error</html>', 500)));

    const err = await new CbeBankAdapter()
      .verify(cbeReference())
      .then(() => null)
      .catch((e: unknown) => e);

    // The absence of a readable `detail` is not evidence of a bad token, so this
    // must NOT be silently downgraded to a customer fault.
    expect(err).toBeInstanceOf(BankPortalUnavailableError);
  });

  it('rejects a legacy FT reference locally, without contacting the bank', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(buildCbeApiBody()));
    vi.stubGlobal('fetch', fetchMock);

    const err = await new CbeBankAdapter()
      .verify(cbeReference('FT24252Y8WQM', { bank: 'cbe' }))
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InvalidReceiptReferenceError);
    // No egress, and — just as importantly — no breaker failure recorded, so a
    // customer typo cannot trip the breaker for everyone else.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps 403 to PortalGeoblockedError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse('Forbidden', 403)));

    await expect(new CbeBankAdapter().verify(cbeReference())).rejects.toBeInstanceOf(PortalGeoblockedError);
  });

  it('maps 451 to PortalGeoblockedError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse('Unavailable For Legal Reasons', 451)));

    await expect(new CbeBankAdapter().verify(cbeReference())).rejects.toBeInstanceOf(PortalGeoblockedError);
  });

  it('maps a timeout to BankPortalUnavailableError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
      })
    );

    await expect(new CbeBankAdapter().verify(cbeReference(), { timeoutMs: 50 })).rejects.toBeInstanceOf(
      BankPortalUnavailableError
    );
  });

  it('fails when the 200 body is not a transaction-detail object', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse('<!doctype html><html>receipt shell</html>')));

    await expect(new CbeBankAdapter().verify(cbeReference())).rejects.toBeInstanceOf(
      BankPortalUnavailableError
    );
  });
});

// ============================================================================
// 3. Proxy support
// ============================================================================

describe('CBE adapter proxy support', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('throws ProxyConfigError for an unparseable proxy URI and never egresses directly', async () => {
    process.env.TELEBIRR_PROXY_URL = 'definitely not a uri';
    const fetchMock = vi.fn(async () => jsonResponse(buildCbeApiBody()));
    vi.stubGlobal('fetch', fetchMock);

    const err = await new CbeBankAdapter()
      .verify(cbeReference())
      .then(() => null)
      .catch((e: unknown) => e);

    // Failing closed is the whole point: continuing with `agent === undefined`
    // would mean direct egress, silently discarding the operator's in-country
    // IP and resurfacing a config fault as a geo-block.
    expect(err).toBeInstanceOf(ProxyConfigError);
    expect(err).not.toBeInstanceOf(PortalGeoblockedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never leaks proxy credentials through the thrown problem details', async () => {
    const secret = 'synthetic-proxy-password-do-not-leak';
    process.env.ETHIOPIA_PROXY_URL = `http://operator:${secret}@proxy.example.invalid:not-a-port`;
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(buildCbeApiBody())));

    const err = await new CbeBankAdapter()
      .verify(cbeReference())
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProxyConfigError);
    const serialised = JSON.stringify((err as ProxyConfigError).problemDetails);
    expect(serialised).not.toContain(secret);
    expect(serialised).not.toContain('operator');
  });

  it('classifies transport errors as proxy failures only when a proxy is configured', async () => {
    const adapter = new CbeBankAdapter();
    const isProxyFailure = (adapter as unknown as { isProxyFailure: (e: unknown, h: boolean) => boolean })
      .isProxyFailure.bind(adapter);

    expect(isProxyFailure({ code: 'ECONNRESET', message: 'socket hang up' }, true)).toBe(true);
    expect(isProxyFailure(new Error('proxy connection refused'), true)).toBe(true);
    expect(isProxyFailure({ code: 'ETIMEDOUT', message: 'connection timed out' }, false)).toBe(false);
    expect(isProxyFailure(new Error('regular parsing error'), true)).toBe(false);
  });

  it('uses https.request (not fetch) when a proxy agent is set, so the tunnel is honoured', async () => {
    process.env.TELEBIRR_PROXY_URL = 'http://127.0.0.1:9';

    const seen: { url?: string; headers?: Record<string, string>; agent?: unknown } = {};

    const requestSpy = vi.spyOn(httpsStub, 'request').mockImplementation(((
      url: string,
      opts: Record<string, unknown>,
      cb: (res: unknown) => void
    ) => {
      seen.url = url;
      seen.headers = opts.headers as Record<string, string>;
      seen.agent = opts.agent;

      const resHandlers: Record<string, (arg?: unknown) => void> = {};
      const res = {
        statusCode: 200,
        on: (event: string, handler: (arg?: unknown) => void) => {
          resHandlers[event] = handler;
        },
      };

      return {
        on: () => undefined,
        end: () => {
          // Deliver asynchronously, the way node does, so every handler the
          // adapter registered is already attached.
          setImmediate(() => {
            cb(res);
            resHandlers.data?.(Buffer.from(buildCbeApiBody()));
            resHandlers.end?.();
          });
        },
      };
    }) as never);

    const fetchMock = vi.fn(async () => jsonResponse(buildCbeApiBody()));
    vi.stubGlobal('fetch', fetchMock);

    const payload = await new CbeBankAdapter().verify(cbeReference());

    // Node's native fetch ignores `Agent`, so it would bypass the tunnel and
    // egress directly — the exact failure the proxy exists to prevent.
    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(seen.url).toBe(cbeApiUrl());
    expect(seen.agent).toBeTruthy();
    expect(seen.headers?.['X-App-ID']).toBe(CBE_APP_ID);
    expect(payload.amountEtb).toBe(1250);

    requestSpy.mockRestore();
  });
});

// ============================================================================
// 5. End-to-end: SMS -> intake -> adapter -> security gate -> fulfillment
// ============================================================================

describe('CBE rail end-to-end through the orchestrator', () => {
  let db: ReturnType<typeof getDatabase>;

  beforeEach(() => {
    db = initDatabase(':memory:', migrationsDir);

    // Manual-only shipping decision: the rail is exercised here with the
    // operator switch flipped ON for the test only. The seed default and
    // DEFAULT_VERIFICATION_SETTINGS both ship '0' and are not touched by this
    // suite.
    setSetting('receipt_auto_verify_enabled', '1');
    // The masked form is what the bank publishes, and the whitelist comparison
    // understands wildcards, so the operator can configure the masked value.
    setSetting('receipt_cbe_beneficiaries', JSON.stringify([SYNTHETIC_MASKED_ACCOUNT]));

    db.prepare(`INSERT INTO users (id, username, first_name) VALUES (1001, 'buyer_cbe', 'Buyer')`).run();
    db.prepare(`INSERT INTO products (id, type, name, description) VALUES ('gemini_pro', 'stock', 'Gemini Pro 18M', 'Test')`).run();
    addStockLink('gemini_pro', 'https://example.invalid/activate/SYNTHETIC-CODE-001');
  });

  afterEach(() => {
    closeDatabase();
  });

  it('auto-verifies a realistic CBE confirmation SMS and fulfils the order atomically', async () => {
    const order = createOrder({
      userId: 1001,
      productId: 'gemini_pro',
      amountETB: 1250,
      paymentRail: 'cbe',
    });

    const fetchMock = vi.fn(async () => jsonResponse(buildCbeApiBody()));
    vi.stubGlobal('fetch', fetchMock);

    // Shaped like a real bank SMS, including the masked account digits and a
    // "total paid" line that is LARGER than the settled amount — the trap that
    // the Telebirr rail had to be hardened against.
    const sms =
      'Dear Customer, ETB 1,250.00 has been credited to account 1000******000 ' +
      `for 1,262.00 ETB including charges. View receipt: ${cbeReceiptUrl()}. Thank you for banking with CBE.`;

    const orchestrator = new ReceiptOrchestrator();
    const result = await orchestrator.processSubmission({
      orderId: order.id,
      userId: 1001,
      source: 'sms_forward',
      note: sms,
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('auto_verified');
    expect(result.bank).toBe('cbe');
    // The reference that reaches the anti-replay index is the bank's own id,
    // not the customer-pasted token.
    expect(result.transactionReference).toBe(SYNTHETIC_CBE_TX_ID);
    expect(result.bankPayload?.amountEtb).toBe(1250);
    expect(result.bankPayload?.feeEtb).toBe(12);
    expect(result.bankPayload?.beneficiaryAccount).toBe(SYNTHETIC_MASKED_ACCOUNT);
    expect(result.needsAdminReview).toBe(false);

    // Every pillar passed, including the amount pillar on the settled figure.
    expect(result.securityGateResult?.passed).toBe(true);
    expect(result.securityGateResult?.failedPillar).toBeUndefined();

    // Fulfillment landed atomically.
    const updated = getOrderById(order.id)!;
    expect(updated.status).toBe('fulfilled');
    expect(updated.payment_ref).toBe(SYNTHETIC_CBE_TX_ID);
    expect(updated.fulfillment_payload).toContain('SYNTHETIC-CODE-001');
    expect(getAvailableStockCount('gemini_pro')).toBe(0);

    const audit = await orchestrator.getAuditRecord(order.id);
    expect(audit?.securityGatePassed).toBe(true);
    expect(audit?.verifiedAmountEtb).toBe(1250);
  });

  it('routes to manual review when the bank reports the transfer as not completed', async () => {
    const order = createOrder({
      userId: 1001,
      productId: 'gemini_pro',
      amountETB: 1250,
      paymentRail: 'cbe',
    });

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(buildCbeApiBody({ status: 'REVERSED' }))));

    const orchestrator = new ReceiptOrchestrator();
    const result = await orchestrator.processSubmission({
      orderId: order.id,
      userId: 1001,
      source: 'sms_forward',
      directReference: SYNTHETIC_CBE_TOKEN,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('pending_manual_review');
    expect(result.error?.code).toBe('TRANSACTION_NOT_CONFIRMED');
    expect(result.needsAdminReview).toBe(true);
    expect(getOrderById(order.id)?.status).toBe('pending_approval');
  });

  it('routes to manual review when the bank rejects the reference as invalid', async () => {
    const order = createOrder({
      userId: 1001,
      productId: 'gemini_pro',
      amountETB: 1250,
      paymentRail: 'cbe',
    });

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(buildCbeInvalidTokenBody(), 500)));

    const orchestrator = new ReceiptOrchestrator();
    const result = await orchestrator.processSubmission({
      orderId: order.id,
      userId: 1001,
      source: 'sms_forward',
      directReference: SYNTHETIC_CBE_TOKEN,
    });

    expect(result.success).toBe(false);
    // A permanent customer-data fault, not an outage: it belongs in the manual
    // queue where a human reads the SMS, not in the retry-heavy outage bucket.
    expect(result.status).toBe('pending_manual_review');
    expect(result.error?.code).toBe('INVALID_RECEIPT_REFERENCE');
    expect(result.error?.code).not.toBe('BANK_PORTAL_UNAVAILABLE');
  });
});