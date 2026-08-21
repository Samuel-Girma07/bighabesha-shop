export interface BootstrapData {
  user: {
    id: number;
    username?: string;
    firstName: string;
    languageCode: string;
    isAdmin: boolean;
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
}

export interface OrderItem {
  id: string;
  user_id: number;
  username: string | null;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  amount_etb: number;
  payment_rail: string;
  status: string;
  receipt_file_id: string | null;
  receipt_note: string | null;
  fulfillment_payload: string | null;
  fulfillment_proof: string | null;
  rejection_reason: string | null;
  created_at: string;
}

const API_BASE = (import.meta as any).env?.VITE_API_URL || '';

function getAuthHeader(): Record<string, string> {
  const initData = window.Telegram?.WebApp?.initData || '';
  return initData ? { Authorization: `tma ${initData}` } : {};
}

export async function fetchBootstrap(): Promise<BootstrapData> {
  const res = await fetch(`${API_BASE}/api/bootstrap`, {
    headers: {
      ...getAuthHeader(),
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to load app data (${res.status})`);
  }
  return res.json();
}

export async function fetchOrders(): Promise<{ orders: OrderItem[] }> {
  const res = await fetch(`${API_BASE}/api/orders`, {
    headers: {
      ...getAuthHeader(),
    },
  });
  if (!res.ok) throw new Error('Failed to load orders');
  return res.json();
}

export async function createOrderApi(params: {
  productId: string;
  variantId?: string;
  customStars?: number;
  amountETB: number;
  paymentRail: string;
}): Promise<{ order: OrderItem; invoiceLink?: string; payUrl?: string }> {
  const res = await fetch(`${API_BASE}/api/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
    },
    body: JSON.stringify(params),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.error || 'Failed to create order');
  }
  return data;
}

export async function submitReceiptApi(params: {
  orderId: string;
  receiptImageBase64?: string;
  note?: string;
}): Promise<{ order: OrderItem; success: boolean }> {
  const res = await fetch(`${API_BASE}/api/receipt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
    },
    body: JSON.stringify(params),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.error || 'Failed to submit receipt');
  }
  return data;
}
