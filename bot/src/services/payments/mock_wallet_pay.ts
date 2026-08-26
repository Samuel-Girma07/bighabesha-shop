import { PaymentAdapter, CreatePaymentParams, PaymentResult } from './types.js';
import { calculateCryptoQuote, fetchCoinGeckoPrices } from '../rate_engine.service.js';
import { getConfig } from '../../config/env.js';
import { logger } from '../../logger/index.js';

export class MockWalletPayAdapter implements PaymentAdapter {
  async createPayment(params: CreatePaymentParams): Promise<PaymentResult> {
    const currency = params.currency || 'TON';
    const { tonUsd, usdtUsd } = await fetchCoinGeckoPrices();
    const coinPrice = currency === 'TON' ? tonUsd : usdtUsd;

    const { cryptoAmount } = calculateCryptoQuote(params.amountETB, coinPrice);
    const paymentRef = `MOCK-WP-${params.orderId}`;
    const payUrl = `https://t.me/wallet?startattach=${paymentRef}`;

    logger.info(
      { orderId: params.orderId, currency, cryptoAmount, paymentRef },
      'MockWalletPay created payment quote'
    );

    return {
      paymentRef,
      status: 'awaiting_payment',
      payUrl,
      cryptoAmount,
      cryptoCurrency: currency,
    };
  }

  async verifyPayment(paymentRef: string): Promise<boolean> {
    // Fail-closed: the mock adapter must NEVER confirm a payment in production.
    // (Production boots are already blocked from using mock mode by env validation;
    // this is defense-in-depth.)
    if (getConfig().NODE_ENV === 'production') {
      logger.error({ paymentRef }, 'MockWalletPay.verifyPayment() refused in production mode');
      return false;
    }
    logger.info({ paymentRef }, 'MockWalletPay verifying payment');
    return true;
  }
}
