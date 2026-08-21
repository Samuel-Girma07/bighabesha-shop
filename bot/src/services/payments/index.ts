import { getConfig } from '../../config/env.js';
import { PaymentAdapter } from './types.js';
import { MockWalletPayAdapter } from './mock_wallet_pay.js';
import { LiveWalletPayAdapter } from './live_wallet_pay.js';

let adapterInstance: PaymentAdapter | null = null;

export function getWalletPayAdapter(): PaymentAdapter {
  if (!adapterInstance) {
    const config = getConfig();
    if (config.WALLET_PAY_MODE === 'live') {
      adapterInstance = new LiveWalletPayAdapter();
    } else {
      adapterInstance = new MockWalletPayAdapter();
    }
  }
  return adapterInstance;
}

export * from './types.js';
export * from './mock_wallet_pay.js';
export * from './live_wallet_pay.js';
