export interface CreatePaymentParams {
  orderId: string;
  userId: number;
  amountETB: number;
  productName: string;
  currency?: 'TON' | 'USDT';
}

export interface PaymentResult {
  paymentRef: string;
  status: 'awaiting_payment' | 'paid';
  payUrl?: string;
  cryptoAmount?: number;
  cryptoCurrency?: string;
}

export interface PaymentAdapter {
  createPayment(params: CreatePaymentParams): Promise<PaymentResult>;
  verifyPayment(paymentRef: string): Promise<boolean>;
}
