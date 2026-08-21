const API_BASE = (import.meta as any).env?.VITE_API_URL || '';

function getAdminToken(): string | null {
  return localStorage.getItem('bighabesha_admin_token');
}

export function saveAdminToken(token: string): void {
  localStorage.setItem('bighabesha_admin_token', token);
}

export function clearAdminToken(): void {
  localStorage.removeItem('bighabesha_admin_token');
}

export function hasAdminSession(): boolean {
  return Boolean(getAdminToken());
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

export async function adminLoginApi(password: string): Promise<{ success: boolean; require2FA: boolean; adminId: number; message: string }> {
  const res = await fetch(`${API_BASE}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
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

export async function broadcastMessageApi(message: string, target: string): Promise<any> {
  const res = await adminFetch(`${API_BASE}/api/admin/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, target }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Broadcast failed');
  return data;
}
