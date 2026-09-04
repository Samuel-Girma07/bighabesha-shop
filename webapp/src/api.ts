export interface BootstrapData {
  user: {
    id: number;
    username?: string;
    firstName: string;
    languageCode: string;
    isAdmin: boolean;
    tier?: string;
    ordersCount?: number;
    lifetimeEtb?: number;
    balanceStars?: number;
  } | null;
  products: {
    id: string;
    type: 'stock' | 'order';
    name: string;
    description: string;
    is_active: number;
    meta: string;
    variants: {
      id: string;
      product_id: string;
      name: string;
      price_etb: number;
      is_active: number;
      sort_order: number;
    }[];
    availableStock: number | null;
  }[];
  settings: Record<string, string>;
  cryptoRates: {
    tonUsd: number;
    usdtUsd: number;
  };
  tonTreasury?: string;
}

export type PaymentRail = 'telebirr' | 'cbe' | 'abyssinia';
export type ActivePaymentRail = PaymentRail;

export interface CreateOrderResponse {
  order: OrderItem;
  invoiceLink?: string;
  payUrl?: string;
  saleApplied?: boolean;
}

export interface OrderItem {
  id: string;
  user_id: number;
  username: string | null;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  amount_etb: number;
  discount_etb?: number;
  payment_rail: string;
  status: string;
  receipt_file_id: string | null;
  receipt_note: string | null;
  fulfillment_payload: string | null;
  fulfillment_proof: string | null;
  rejection_reason: string | null;
  target_username?: string | null;
  reseller_provider?: string | null;
  reseller_tx_id?: string | null;
  reseller_error?: string | null;
  created_at: string;
}

const API_BASE = (import.meta as any).env?.VITE_API_URL || '';

function getAuthHeader(): Record<string, string> {
  const initData = typeof window !== 'undefined' ? (window.Telegram?.WebApp?.initData || '') : '';
  if (initData) {
    return { Authorization: `tma ${initData}` };
  }
  return {};
}

export async function fetchBootstrap(): Promise<BootstrapData> {
  const res = await fetch(`${API_BASE}/api/bootstrap`, {
    headers: {
      ...getAuthHeader(),
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to load store data (${res.status})`);
  }
  return res.json();
}

export async function fetchOrders(): Promise<{ orders: OrderItem[] }> {
  const headers = getAuthHeader();
  if (!headers.Authorization) {
    // Standalone browser preview
    return { orders: [] };
  }

  const res = await fetch(`${API_BASE}/api/orders`, {
    headers,
  });
  if (!res.ok) return { orders: [] };
  return res.json();
}

export interface CreateOrderOptions {
  productId: string;
  variantId?: string;
  customStars?: number;
  paymentRail?: PaymentRail | string;
  promoCode?: string;
  targetUsername?: string;
}

export async function createOrderApi(
  productId: string,
  variantId?: string,
  paymentRail?: PaymentRail,
  promoCode?: string,
  targetUsername?: string,
): Promise<CreateOrderResponse>;
export async function createOrderApi(
  options: CreateOrderOptions,
): Promise<CreateOrderResponse>;
export async function createOrderApi(
  productIdOrOptions: string | CreateOrderOptions,
  variantId?: string,
  paymentRail: PaymentRail = 'telebirr',
  promoCode?: string,
  targetUsername?: string,
): Promise<CreateOrderResponse> {
  const headers = getAuthHeader();
  let body: Record<string, unknown>;

  if (typeof productIdOrOptions === 'object') {
    const opts = productIdOrOptions;
    body = {
      productId: opts.productId,
      variantId: opts.variantId,
      paymentRail: opts.paymentRail || 'telebirr',
      promoCode: opts.promoCode,
      targetUsername: opts.targetUsername,
    };
  } else {
    body = {
      productId: productIdOrOptions,
      variantId,
      paymentRail,
      promoCode,
      targetUsername,
    };
  }

  if (!body.promoCode) delete body.promoCode;
  if (!body.variantId) delete body.variantId;
  if (!body.targetUsername) delete body.targetUsername;

  const res = await fetch(`${API_BASE}/api/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.error || 'Failed to create order');
  }
  return data;
}

/** Live TON on-chain verification poll for a TON Connect payment. */
export async function verifyTonPaymentApi(orderId: string): Promise<{ verified: boolean; txHash?: string; alreadyProcessed?: boolean }> {
  const headers = getAuthHeader();
  const res = await fetch(`${API_BASE}/api/payments/ton/status/${encodeURIComponent(orderId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Verification failed');
  return data;
}

export interface ReferralSummary {
  code: string;
  balanceEtb: number;
  referredUsers: number;
  commissionRatePct: number;
  recentEntries: { direction: string; amount_etb: number; type: string; created_at: string }[];
}

export async function fetchReferralsApi(): Promise<ReferralSummary> {
  const headers = getAuthHeader();
  const res = await fetch(`${API_BASE}/api/me/referrals`, { headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load referrals');
  return data;
}

// ---------------------------------------------------------------------------
// In-app support bridge
// ---------------------------------------------------------------------------

export async function sendSupportMessage(body: string): Promise<void> {
  const headers = getAuthHeader();
  const res = await fetch(`${API_BASE}/api/support/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Message failed');
}

export async function fetchSupportMessages(afterId = 0): Promise<{ messages: { id: number; sender_role: string; body: string; created_at: string }[]; status: string }> {
  const headers = getAuthHeader();
  const res = await fetch(`${API_BASE}/api/support/messages?after=${afterId}`, { headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load messages');
  return data;
}

export async function submitReceiptApi(params: {
  orderId: string;
  receiptImageBase64?: string;
  note?: string;
}): Promise<{ order: OrderItem; success: boolean }> {
  const headers = getAuthHeader();
  const res = await fetch(`${API_BASE}/api/receipt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(params),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.error || 'Failed to submit receipt');
  }
  return data;
}

export async function recheckUsernameApi(): Promise<{
  success: boolean;
  user: {
    id: number;
    username?: string | null;
    firstName: string;
    languageCode: string;
    isAdmin: boolean;
  };
}> {
  const headers = getAuthHeader();
  const res = await fetch(`${API_BASE}/api/user/recheck-username`, {
    headers,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.error || 'Failed to recheck username');
  }
  return data;
}

/** Full order detail incl. the status-transition timeline. */
export async function getOrderEventsApi(orderId: string): Promise<{ order: OrderItem; events: any[] }> {
  const headers = getAuthHeader();
  const res = await fetch(`${API_BASE}/api/orders/${encodeURIComponent(orderId)}`, { headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load order');
  return { order: data.order, events: data.events ?? [] };
}

export async function requestPayoutApi(params: {
  amountEtb: number;
  method: ActivePaymentRail;
  destination: string;
}): Promise<{ success: boolean; message: string }> {
  const headers = getAuthHeader();
  const res = await fetch(`${API_BASE}/api/user/payout-request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || data.message || 'Failed to submit payout request');
  }
  return data;
}

