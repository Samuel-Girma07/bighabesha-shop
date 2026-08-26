const API_BASE = (import.meta as any).env?.VITE_API_URL || '';

const TOKEN_STORAGE_KEY = 'bighabesha_admin_token';
/** Server issues 32-byte hex tokens; anything else is stale garbage. */
const TOKEN_SHAPE = /^[0-9a-f]{64}$/;

export function getAdminToken(): string | null {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  // Self-healing: a malformed/corrupted token can never be valid — drop it
  // immediately so the next request doesn't waste a round-trip on a 401.
  if (token && !TOKEN_SHAPE.test(token)) {
    clearAdminToken();
    return null;
  }
  return token;
}

/** Legacy inline data-URL receipts render directly — no network fetch needed. */
export function receiptIsInline(receiptFileId?: string | null): boolean {
  return Boolean(receiptFileId && receiptFileId.startsWith('data:image/'));
}

/**
 * Fetches a SHORT-LIVED signed download URL for a receipt image.
 *
 * Replaces the old getReceiptImageUrl() which embedded the 24h admin session
 * token in the query string — leaking it into proxy logs, browser history,
 * and Referer headers. Signed links are purpose-bound, order-bound, and
 * expire in ~60 seconds.
 */
export async function fetchReceiptImageUrl(orderId: string): Promise<string> {
  const res = await adminFetch(`${API_BASE}/api/admin/orders/${encodeURIComponent(orderId)}/receipt-link`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to create receipt link');
  return `${API_BASE}${data.url}`;
}

export function saveAdminToken(token: string): void {
  if (!token || !TOKEN_SHAPE.test(token)) {
    // Never persist a token that cannot possibly be valid.
    clearAdminToken();
    return;
  }
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

/**
 * Clears the local admin session unconditionally. Called by explicit logout,
 * any 401 response, and token-shape validation failures.
 */
export function clearAdminToken(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Storage unavailable (private mode) — nothing to clean.
  }
}

export function hasAdminSession(): boolean {
  return Boolean(getAdminToken());
}

/**
 * Terminates the session server-side AND clears local state.
 * Local storage is cleared even if the network call fails.
 */
export async function adminLogoutApi(): Promise<void> {
  const token = getAdminToken();
  clearAdminToken();
  if (!token) return;
  try {
    await fetch(`${API_BASE}/api/admin/auth/logout`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Network failure: local session is already gone, which is the security-
    // relevant half. The orphaned server row expires via scheduled cleanup.
  }
}

let sessionExpiredHandler: (() => void) | null = null;

export function onSessionExpired(callback: () => void): void {
  sessionExpiredHandler = callback;
}

function handle401(): void {
  clearAdminToken();
  if (sessionExpiredHandler) {
    sessionExpiredHandler();
  }
}

async function adminFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getAdminToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    handle401();
    throw new Error('Your admin session has expired. Please sign in again.');
  }
  return res;
}

export async function adminLoginApi(password: string, adminId?: number): Promise<{ success: boolean; require2FA: boolean; adminId: number; adminIds?: number[]; message: string }> {
  const res = await fetch(`${API_BASE}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, adminId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');
  return data;
}

export async function adminVerify2FAApi(adminId: number, otp: string): Promise<{ success: boolean; token: string; admin: any }> {
  const res = await fetch(`${API_BASE}/api/admin/auth/verify-2fa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminId, otp }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '2FA verification failed');
  return data;
}

export async function fetchAdminOverviewApi(range: string = '6M', rail: string = 'all'): Promise<any> {
  const res = await adminFetch(`${API_BASE}/api/admin/overview?range=${encodeURIComponent(range)}&rail=${encodeURIComponent(rail)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to load overview data');
  }
  return res.json();
}

export async function fetchAdminOrdersApi(status?: string, search?: string): Promise<{ orders: any[] }> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (search) params.set('search', search);

  const res = await adminFetch(`${API_BASE}/api/admin/orders?${params.toString()}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to load orders');
  }
  return res.json();
}

export async function approveOrderApi(orderId: string): Promise<any> {
  const res = await adminFetch(`${API_BASE}/api/admin/orders/${orderId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to approve order');
  return data;
}

export async function rejectOrderApi(orderId: string, reason: string): Promise<any> {
  const res = await adminFetch(`${API_BASE}/api/admin/orders/${orderId}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to reject order');
  return data;
}

export async function fulfillOrderApi(orderId: string, proofNote: string): Promise<any> {
  const res = await adminFetch(`${API_BASE}/api/admin/orders/${orderId}/fulfill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proofNote }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fulfill order');
  return data;
}

export async function fetchAdminStockApi(): Promise<{ summary: any; items: any[] }> {
  const res = await adminFetch(`${API_BASE}/api/admin/stock`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to load stock');
  }
  return res.json();
}

export async function addStockLinksApi(linksText: string): Promise<{ success: boolean; addedCount: number; duplicateCount?: number; message?: string }> {
  const res = await adminFetch(`${API_BASE}/api/admin/stock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ linksText }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to add stock');
  return data;
}

export async function deleteStockItemApi(itemId: string): Promise<any> {
  const res = await adminFetch(`${API_BASE}/api/admin/stock/${itemId}`, {
    method: 'DELETE',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to delete stock item');
  return data;
}

export async function fetchAdminUsersApi(): Promise<{ users: any[] }> {
  const res = await adminFetch(`${API_BASE}/api/admin/users`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to load users');
  }
  return res.json();
}

export async function fetchAdminSettingsApi(): Promise<{ settings: Record<string, string> }> {
  const res = await adminFetch(`${API_BASE}/api/admin/settings`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to load settings');
  }
  return res.json();
}

export async function updateAdminSettingsApi(settings: Record<string, string>): Promise<any> {
  const res = await adminFetch(`${API_BASE}/api/admin/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update settings');
  return data;
}

export async function broadcastMessageApi(message: string, target: string, photoFileId?: string): Promise<any> {
  const res = await adminFetch(`${API_BASE}/api/admin/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(photoFileId ? { message, target, photoFileId } : { message, target }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Broadcast failed');
  return data;
}

export async function broadcastStatusApi(jobId: string): Promise<{ job: any }> {
  const res = await adminFetch(`${API_BASE}/api/admin/broadcast/status/${encodeURIComponent(jobId)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to fetch broadcast status');
  }
  return res.json();
}

// --- Payouts & financial exports (finance / superadmin) ---
export async function fetchPayoutsApi(status: string = 'pending'): Promise<{ payouts: any[] }> {
  const res = await adminFetch(`${API_BASE}/api/admin/payouts?status=${encodeURIComponent(status)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load payouts');
  return data;
}

export async function decidePayoutApi(id: number, decision: 'paid' | 'rejected'): Promise<any> {
  const res = await adminFetch(`${API_BASE}/api/admin/payouts/${id}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Decision failed');
  return data;
}

/**
 * Downloads an authenticated export as a file: fetches with the Bearer
 * token and saves via object URL (plain <a download> links cannot send
 * Authorization headers).
 */
export async function downloadExportApi(path: string, filename: string): Promise<void> {
  const res = await adminFetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error('Export failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
