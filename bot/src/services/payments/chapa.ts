import crypto from 'crypto';
import { getConfig } from '../../config/env.js';
import { logger } from '../../logger/index.js';
import { fetchJson, HttpError, CircuitOpenError } from '../../lib/http.js';

const CHAPA_API = 'https://api.chapa.co/v1';

export function isChapaEnabled(): boolean {
  return Boolean(getConfig().CHAPA_SECRET_KEY);
}

/**
 * Verifies Chapa's webhook signature: HMAC-SHA256 of the RAW request body,
 * hex-encoded, keyed with the CHAPA_SECRET_KEY ('chapa-signature' header).
 * Constant-time comparison.
 */
export function verifyChapaSignature(secretKey: string, signature: string | undefined, rawBody: string): boolean {
  if (!secretKey || !signature || !rawBody) return false;
  try {
    const expected = crypto.createHmac('sha256', secretKey).update(rawBody, 'utf-8').digest('hex');
    const provided = Buffer.from(signature, 'utf-8');
    const expectedBuf = Buffer.from(expected, 'utf-8');
    if (provided.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(provided, expectedBuf);
  } catch {
    return false;
  }
}

export interface ChapaInitializeParams {
  txRef: string;          // unique per order — we use order.id
  amountEtb: number;
  buyerName?: string;
  buyerPhone?: string | null;
  returnUrl: string;
}

/** Creates a Chapa hosted-checkout session and returns the payment URL. */
export async function chapaInitialize(params: ChapaInitializeParams): Promise<{ payUrl: string; providerRef: string }> {
  const config = getConfig();
  if (!config.CHAPA_SECRET_KEY) throw new Error('Chapa is not configured (CHAPA_SECRET_KEY missing).');

  try {
    const data = await fetchJson<{ data?: { checkout_url?: string; reference?: string } }>(
      `${CHAPA_API}/transaction/initialize`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.CHAPA_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: String(params.amountEtb),
          currency: 'ETB',
          tx_ref: params.txRef,
          return_url: params.returnUrl,
          customization: { title: 'Bighabesha Shop', description: `Order ${params.txRef}` },
          ...(params.buyerPhone ? { phone_number: params.buyerPhone } : {}),
        }),
        // Payment creation is not safely retryable: a single bounded attempt only.
        timeoutMs: 8000,
        attempts: 1,
        breakerKey: 'chapa',
      }
    );

    if (!data.data?.checkout_url) throw new Error('Chapa response missing checkout_url');

    return { payUrl: data.data.checkout_url, providerRef: data.data.reference ?? params.txRef };
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      logger.warn({ txRef: params.txRef }, 'Chapa circuit open — offering alternate rails');
      throw new Error('Card and mobile-money payments are temporarily unavailable. Please try another method.');
    }
    if (err instanceof HttpError) {
      throw new Error(`Chapa initialize failed (${err.status}): ${(err.body ?? '').slice(0, 200)}`);
    }
    throw err;
  }
}

/** Server-side status verification against Chapa's API. */
export async function chapaQueryStatus(txRef: string): Promise<'pending' | 'success' | 'failed' | 'unknown'> {
  const config = getConfig();
  if (!config.CHAPA_SECRET_KEY) return 'unknown';
  try {
    const data = await fetchJson<{ data?: { status?: string } }>(
      `${CHAPA_API}/transaction/verify/${encodeURIComponent(txRef)}`,
      {
        headers: { Authorization: `Bearer ${config.CHAPA_SECRET_KEY}` },
        timeoutMs: 6000,
        attempts: 2,
        retryOn5xx: true,
        breakerKey: 'chapa',
      }
    );
    const status = data.data?.status;
    if (status === 'success') return 'success';
    if (status === 'failed') return 'failed';
    return 'pending';
  } catch (err) {
    if (err instanceof CircuitOpenError) return 'unknown';
    logger.warn({ err, txRef }, 'Chapa status query failed');
    return 'unknown';
  }
}
