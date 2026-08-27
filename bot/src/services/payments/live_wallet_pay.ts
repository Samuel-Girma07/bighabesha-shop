import crypto from 'crypto';
import { PaymentAdapter, CreatePaymentParams, PaymentResult } from './types.js';
import { getConfig } from '../../config/env.js';
import { calculateCryptoQuote, fetchCoinGeckoPrices } from '../rate_engine.service.js';
import { logger } from '../../logger/index.js';
import { fetchJson, HttpError, CircuitOpenError } from '../../lib/http.js';

const WPAY_BASE = 'https://pay.wallet.tg/wpay/v1';

/** Maximum age/drift (seconds) accepted for webhook timestamps — replay guard. */
export const WEBHOOK_TIMESTAMP_MAX_SKEW_SECONDS = 300;

/**
 * Validates webhook timestamp freshness. Rejects timestamps that are too old
 * (replay attacks) or in the future beyond clock-drift tolerance.
 */
export function isWebhookTimestampFresh(
  timestamp: string | number,
  nowMs: number = Date.now(),
  maxSkewSeconds: number = WEBHOOK_TIMESTAMP_MAX_SKEW_SECONDS
): boolean {
  const ts = typeof timestamp === 'number' ? timestamp : parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  const skewSeconds = Math.abs(nowMs / 1000 - ts);
  return skewSeconds <= maxSkewSeconds;
}

/**
 * Verifies a Wallet Pay webhook signature using the documented scheme:
 *
 *   dataToSign = `${METHOD}.${pathWithQuery}.${timestamp}.${base64(rawBody)}`
 *   signature  = hex( HMAC_SHA256(StoreApiKey, dataToSign) )
 *
 * Both hex (canonical) and base64 encodings of the same HMAC are accepted —
 * this is encoding tolerance for a single scheme, not alternative schemes.
 * Comparison is constant-time.
 */
export function verifyWalletPayWebhookSignature(
  apiKey: string,
  signature: string,
  timestamp: string,
  method: string,
  path: string,
  rawBody: string | Buffer
): boolean {
  if (!apiKey || !signature || !timestamp) return false;
  try {
    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8');
    const base64Body = Buffer.from(bodyStr).toString('base64');
    const dataToSign = `${method.toUpperCase()}.${path}.${timestamp}.${base64Body}`;

    const expected = crypto.createHmac('sha256', apiKey).update(dataToSign).digest();
    const provided = Buffer.from(signature, 'utf-8');

    // Compare against hex (canonical) and base64 encodings of the same HMAC
    const hexExpected = Buffer.from(expected.toString('hex'), 'utf-8');
    const b64Expected = Buffer.from(expected.toString('base64'), 'utf-8');

    if (provided.length === hexExpected.length && crypto.timingSafeEqual(provided, hexExpected)) {
      return true;
    }
    if (provided.length === b64Expected.length && crypto.timingSafeEqual(provided, b64Expected)) {
      return true;
    }

    return false;
  } catch (err) {
    logger.error({ err }, 'Error verifying Wallet Pay webhook signature');
    return false;
  }
}

export class LiveWalletPayAdapter implements PaymentAdapter {
  private apiKey: string;

  constructor() {
    const config = getConfig();
    this.apiKey = config.WALLET_PAY_API_KEY || '';
    if (!this.apiKey) {
      logger.warn('LiveWalletPayAdapter initialized without WALLET_PAY_API_KEY. Calls will fail unless configured.');
    }
  }

  async createPayment(params: CreatePaymentParams): Promise<PaymentResult> {
    if (!this.apiKey) {
      throw new Error('WALLET_PAY_API_KEY is not configured in environment.');
    }

    const currency = params.currency || 'TON';
    const { tonUsd, usdtUsd } = await fetchCoinGeckoPrices();
    const coinPrice = currency === 'TON' ? tonUsd : usdtUsd;
    const { cryptoAmount } = calculateCryptoQuote(params.amountETB, coinPrice);

    logger.info({ orderId: params.orderId, currency, cryptoAmount }, 'LiveWalletPay requesting order from Wallet Pay API');

    try {
      const data = await fetchJson<{ data: { payLink: string; id: string } }>(`${WPAY_BASE}/order`, {
        method: 'POST',
        headers: {
          'Wpay-Store-Api-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: {
            currencyCode: currency,
            amount: cryptoAmount.toString(),
          },
          description: `Bighabesha Shop - ${params.productName}`,
          externalId: params.orderId,
          timeoutSeconds: 3600,
          customerTelegramUserId: params.userId,
        }),
        // Order creation is not safely retryable: a single bounded attempt only.
        timeoutMs: 8000,
        attempts: 1,
        breakerKey: 'wallet-pay',
      });

      if (!data.data?.payLink || !data.data?.id) {
        throw new Error('Wallet Pay returned no payLink/id');
      }

      return {
        paymentRef: data.data.id,
        status: 'awaiting_payment',
        payUrl: data.data.payLink,
        cryptoAmount,
        cryptoCurrency: currency,
      };
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        logger.warn({ orderId: params.orderId }, 'Wallet Pay circuit open — offering alternate rails');
        throw new Error('Crypto payments are temporarily unavailable. Please try another method.');
      }
      if (err instanceof HttpError) {
        throw new Error(`Wallet Pay API error (${err.status}): ${err.body ?? ''}`);
      }
      throw err;
    }
  }

  async verifyPayment(paymentRef: string): Promise<boolean> {
    if (!this.apiKey) return false;

    try {
      const data = await fetchJson<{ data?: { status?: string } }>(
        `${WPAY_BASE}/order/preview?id=${encodeURIComponent(paymentRef)}`,
        {
          headers: { 'Wpay-Store-Api-Key': this.apiKey },
          timeoutMs: 6000,
          attempts: 2,
          retryOn5xx: true,
          breakerKey: 'wallet-pay',
        }
      );
      return data.data?.status === 'PAID';
    } catch (err) {
      if (err instanceof CircuitOpenError) return false;
      logger.warn({ err, paymentRef }, 'Wallet Pay preview failed; will retry next pass');
      return false;
    }
  }
}
