import crypto from 'crypto';
import { getConfig } from '../../config/env.js';
import { logger } from '../../logger/index.js';

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

  const response = await fetch(`${CHAPA_API}/transaction/initialize`, {
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
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Chapa initialize failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as { data?: { checkout_url?: string; reference?: string } };
  if (!data.data?.checkout_url) throw new Error('Chapa response missing checkout_url');

  return { payUrl: data.data.checkout_url, providerRef: data.data.reference ?? params.txRef };
}

/** Server-side status verification against Chapa's API. */
export async function chapaQueryStatus(txRef: string): Promise<'pending' | 'success' | 'failed' | 'unknown'> {
  const config = getConfig();
  if (!config.CHAPA_SECRET_KEY) return 'unknown';
  try {
    const response = await fetch(`${CHAPA_API}/transaction/verify/${encodeURIComponent(txRef)}`, {
      headers: { Authorization: `Bearer ${config.CHAPA_SECRET_KEY}` },
    });
    if (!response.ok) return 'unknown';
    const data = (await response.json()) as { data?: { status?: string } };
    const status = data.data?.status;
    if (status === 'success') return 'success';
    if (status === 'failed') return 'failed';
    return 'pending';
  } catch (err) {
    logger.warn({ err, txRef }, 'Chapa status query failed');
    return 'unknown';
  }
}
