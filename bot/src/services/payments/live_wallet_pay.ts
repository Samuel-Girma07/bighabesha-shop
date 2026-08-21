import { PaymentAdapter, CreatePaymentParams, PaymentResult } from './types.js';
import { getConfig } from '../../config/env.js';
import { calculateCryptoQuote, fetchCoinGeckoPrices } from '../rate_engine.service.js';
import { logger } from '../../logger/index.js';

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

    // Real API integration endpoint structure for @wallet / Pay API
    const response = await fetch('https://pay.wallet.tg/wpay/v1/order', {
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
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Wallet Pay API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as { data: { payLink: string; id: string } };

    return {
      paymentRef: data.data.id,
      status: 'awaiting_payment',
      payUrl: data.data.payLink,
      cryptoAmount,
      cryptoCurrency: currency,
    };
  }

  async verifyPayment(paymentRef: string): Promise<boolean> {
    if (!this.apiKey) return false;

    const response = await fetch(`https://pay.wallet.tg/wpay/v1/order/preview?id=${paymentRef}`, {
      headers: {
        'Wpay-Store-Api-Key': this.apiKey,
      },
    });

    if (!response.ok) return false;
    const data = (await response.json()) as { data?: { status?: string } };
    return data.data?.status === 'PAID';
  }
}
