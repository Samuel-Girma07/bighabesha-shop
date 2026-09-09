import type { AdminOrder } from './Orders.tsx';

const API_BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL || '';

const TOKEN_STORAGE_KEY = 'bighabesha_admin_token';
/** Server issues 32-byte hex tokens; anything else is stale garbage. */
const TOKEN_SHAPE = /^[0-9a-f]{64}$/;

// ── Domain & API Interfaces ──────────────────────────────────────────

export interface AdminProfile {
  id: number;
  username?: string;
  role?: string;
  adminIds?: number[];
  [key: string]: unknown;
}

export interface AdminOverviewPoint {
  label: string;
  revenue: number;
  orders: number;
}

export interface AdminOverviewData {
  totalRevenue?: number;
  totalOrders?: number;
  activeUsers?: number;
  chartPoints?: AdminOverviewPoint[];
  [key: string]: unknown;
}

export interface AdminStockSummary {
  available?: number;
  used?: number;
  delivered?: number;
  total?: number;
  [key: string]: unknown;
}

export interface AdminStockItem {
  id: string | number;
  payload?: string;
  product_id?: string | null;
  used?: boolean | number;
  order_id?: string | null;
  created_at?: string;
  used_at?: string | null;
  [key: string]: unknown;
}

export interface AdminUser {
  id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone_number?: string | null;
  tier?: string | null;
  created_at?: string;
  total_orders?: number;
  orders_count?: number;
  [key: string]: unknown;
}

export interface AdminPayout {
  id: number;
  user_id?: number;
  username?: string | null;
  amount_etb?: number;
  status?: string;
  created_at?: string;
  payment_method?: string;
  account_details?: string;
  [key: string]: unknown;
}

export interface AdminBroadcastJob {
  id?: string;
  status?: string;
  sent?: number;
  total?: number;
  message?: string;
  target?: string;
  [key: string]: unknown;
}

export interface OrderActionResponse {
  success: boolean;
  message?: string;
  order?: unknown;
  [key: string]: unknown;
}

export interface StockActionResponse {
  success: boolean;
  message?: string;
  [key: string]: unknown;
}

export interface PayoutDecisionResponse {
  success: boolean;
  message?: string;
  payout?: unknown;
  [key: string]: unknown;
}

export interface LoginResponse {
  success: boolean;
  require2FA: boolean;
  adminId: number;
  adminIds?: number[];
  message: string;
}

export interface Verify2FAResponse {
  success: boolean;
  token: string;
  admin: AdminProfile;
}

export interface AddStockResponse {
  success: boolean;
  addedCount: number;
  duplicateCount?: number;
  message?: string;
}

/**
 * Standardized helper to parse JSON and unpack error messages from responses.
 */
async function parseJsonResponse<T>(res: Response, fallbackError: string): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errorMsg = data.detail || data.error || data.title || fallbackError;
    throw new Error(errorMsg);
  }
  return data as T;
}

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

export async function adminLoginApi(password: string, adminId?: number): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, adminId }),
  });
  return parseJsonResponse<LoginResponse>(res, 'Login failed');
}

export async function adminVerify2FAApi(adminId: number, otp: string): Promise<Verify2FAResponse> {
  const res = await fetch(`${API_BASE}/api/admin/auth/verify-2fa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminId, otp }),
  });
  return parseJsonResponse<Verify2FAResponse>(res, '2FA verification failed');
}

export async function fetchAdminOverviewApi(range: string = '6M', rail: string = 'all'): Promise<AdminOverviewData> {
  const res = await adminFetch(`${API_BASE}/api/admin/overview?range=${encodeURIComponent(range)}&rail=${encodeURIComponent(rail)}`);
  return parseJsonResponse<AdminOverviewData>(res, 'Failed to load overview data');
}

export async function fetchAdminOrdersApi(status?: string, search?: string): Promise<{ orders: AdminOrder[] }> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (search) params.set('search', search);

  const res = await adminFetch(`${API_BASE}/api/admin/orders?${params.toString()}`);
  return parseJsonResponse<{ orders: AdminOrder[] }>(res, 'Failed to load orders');
}

export async function approveOrderApi(orderId: string): Promise<OrderActionResponse> {
  const res = await adminFetch(`${API_BASE}/api/admin/orders/${orderId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return parseJsonResponse<OrderActionResponse>(res, 'Failed to approve order');
}

export async function rejectOrderApi(orderId: string, reason: string): Promise<OrderActionResponse> {
  const res = await adminFetch(`${API_BASE}/api/admin/orders/${orderId}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  return parseJsonResponse<OrderActionResponse>(res, 'Failed to reject order');
}

export async function fulfillOrderApi(orderId: string, proofNote: string): Promise<OrderActionResponse> {
  const res = await adminFetch(`${API_BASE}/api/admin/orders/${orderId}/fulfill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proofNote }),
  });
  return parseJsonResponse<OrderActionResponse>(res, 'Failed to fulfill order');
}

export async function fetchAdminStockApi(): Promise<{ summary: AdminStockSummary; items: AdminStockItem[] }> {
  const res = await adminFetch(`${API_BASE}/api/admin/stock`);
  return parseJsonResponse<{ summary: AdminStockSummary; items: AdminStockItem[] }>(res, 'Failed to load stock');
}

export async function addStockLinksApi(linksText: string): Promise<AddStockResponse> {
  const res = await adminFetch(`${API_BASE}/api/admin/stock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ linksText }),
  });
  return parseJsonResponse<AddStockResponse>(res, 'Failed to add stock');
}

export async function deleteStockItemApi(itemId: string | number): Promise<StockActionResponse> {
  const res = await adminFetch(`${API_BASE}/api/admin/stock/${encodeURIComponent(String(itemId))}`, {
    method: 'DELETE',
  });
  return parseJsonResponse<StockActionResponse>(res, 'Failed to delete stock item');
}

export async function fetchAdminUsersApi(): Promise<{ users: AdminUser[] }> {
  const res = await adminFetch(`${API_BASE}/api/admin/users`);
  return parseJsonResponse<{ users: AdminUser[] }>(res, 'Failed to load users');
}

export async function fetchAdminSettingsApi(): Promise<{ settings: Record<string, string> }> {
  const res = await adminFetch(`${API_BASE}/api/admin/settings`);
  return parseJsonResponse<{ settings: Record<string, string> }>(res, 'Failed to load settings');
}

export async function updateAdminSettingsApi(settings: Record<string, string>): Promise<{ success: boolean; settings?: Record<string, string> }> {
  const res = await adminFetch(`${API_BASE}/api/admin/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  });
  return parseJsonResponse<{ success: boolean; settings?: Record<string, string> }>(res, 'Failed to update settings');
}

export async function broadcastMessageApi(message: string, target: string, photoFileId?: string): Promise<{ success: boolean; jobId?: string; message?: string }> {
  const res = await adminFetch(`${API_BASE}/api/admin/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(photoFileId ? { message, target, photoFileId } : { message, target }),
  });
  return parseJsonResponse<{ success: boolean; jobId?: string; message?: string }>(res, 'Broadcast failed');
}

export async function broadcastStatusApi(jobId: string): Promise<{ job: AdminBroadcastJob }> {
  const res = await adminFetch(`${API_BASE}/api/admin/broadcast/status/${encodeURIComponent(jobId)}`);
  return parseJsonResponse<{ job: AdminBroadcastJob }>(res, 'Failed to fetch broadcast status');
}

// --- Payouts & financial exports (finance / superadmin) ---
export async function fetchPayoutsApi(status: string = 'pending'): Promise<{ payouts: AdminPayout[] }> {
  const res = await adminFetch(`${API_BASE}/api/admin/payouts?status=${encodeURIComponent(status)}`);
  return parseJsonResponse<{ payouts: AdminPayout[] }>(res, 'Failed to load payouts');
}

export async function decidePayoutApi(id: number, decision: 'paid' | 'rejected'): Promise<PayoutDecisionResponse> {
  const res = await adminFetch(`${API_BASE}/api/admin/payouts/${id}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  });
  return parseJsonResponse<PayoutDecisionResponse>(res, 'Decision failed');
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

// ============================================================================
// Bank Receipt Verification Engine API Contracts & Types (ADR-002)
// ============================================================================

export type VerificationStatus =
  | 'auto_verified'
  | 'pending_manual_review'
  | 'rejected'
  | 'upstream_failure';

export type VerificationFailureCode =
  | 'RECEIPT_ALREADY_USED'
  | 'BENEFICIARY_MISMATCH'
  | 'AMOUNT_MISMATCH'
  | 'RECEIPT_EXPIRED'
  | 'QR_DECODE_FAILED'
  | 'BANK_PORTAL_UNAVAILABLE'
  | 'PORTAL_GEOBLOCKED'
  | 'UNSUPPORTED_BANK'
  | 'CORRUPTED_FILE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ENGINE_ERROR';

export type SecurityPillarId =
  | 'anti_replay'
  | 'beneficiary_whitelist'
  | 'exact_amount'
  | 'recency_window';

export interface SecurityPillarEvaluation {
  pillar: SecurityPillarId;
  passed: boolean;
  expected: string | number;
  actual: string | number;
  details?: string;
  tolerance?: number;
}

export interface ReceiptVerificationEvidenceSummary {
  evidenceId: number;
  bank: 'cbe' | 'telebirr' | 'abyssinia' | 'unknown' | string;
  reference: string | null;
  amountEtb: number | null;
  verifiedAmountEtb: number | null;
  status: VerificationStatus | string;
  errorCode: VerificationFailureCode | string | null;
  diagnosticMessage: string | null;
  securityGatePassed: boolean;
  timestamp: string;
}

export interface BankVerificationAuditAttempt {
  id: number;
  attemptNumber: number;
  bank: string;
  rawReference: string | null;
  normalizedReference: string;
  verifiedAmountEtb: number | null;
  senderName: string | null;
  senderIdentifier: string | null;
  beneficiaryAccount: string | null;
  beneficiaryName: string | null;
  transactionTimestamp: string | null;
  paymentChannel: string | null;
  securityGatePassed: boolean;
  securityGateEvaluations: SecurityPillarEvaluation[];
  status: string;
  errorCode: string | null;
  errorDetail: string | null;
  rawBankPayload: Record<string, unknown> | null;
  rawEvidenceSnippet: string | null;
  httpStatus: number | null;
  latencyMs: number | null;
  verifiedBy: string;
  createdAt: string;
}

export interface BankVerificationAuditDetails {
  orderId: string;
  orderStatus?: string;
  bank: 'cbe' | 'telebirr' | 'abyssinia' | 'unknown' | string;
  reference: string | null;
  orderAmountEtb: number;
  verifiedAmountEtb: number | null;
  beneficiaryAccount: string | null;
  beneficiaryName: string | null;
  senderName: string | null;
  senderIdentifier?: string | null;
  transactionTimestamp: string | null;
  paymentChannel?: string | null;
  evaluations: SecurityPillarEvaluation[];
  rawSnippet: string | null;
  rawBankPayload?: Record<string, unknown> | null;
  latencyMs: number | null;
  httpStatus: number | null;
  attemptNumber: number;
  status: VerificationStatus | string;
  errorCode: VerificationFailureCode | string | null;
  errorDetail?: string | null;
  securityGatePassed?: boolean;
  verifiedBy?: string;
  createdAt?: string;
  evidence?: ReceiptVerificationEvidenceSummary | null;
  attempts?: BankVerificationAuditAttempt[];
}

export interface Rfc7807ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: VerificationFailureCode | string;
  remediation_hint: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface ReverifyReceiptResult {
  success: boolean;
  status: VerificationStatus | string;
  orderId: string;
  bank?: 'cbe' | 'telebirr' | 'abyssinia' | 'unknown' | string;
  transactionReference?: string;
  reference?: string;
  verifiedAmountEtb?: number;
  beneficiaryAccount?: string;
  needsAdminReview?: boolean;
  adminReviewReason?: string;
  error?: Rfc7807ProblemDetails;
  verifiedAt?: string;
  processingDurationMs?: number;
  securityGatePassed?: boolean;
}

export interface BankVerificationSettings {
  receipt_auto_verify_enabled?: string | boolean;
  cbe_account?: string;
  cbe_name?: string;
  telebirr_account?: string;
  telebirr_name?: string;
  abyssinia_account?: string;
  abyssinia_name?: string;
  receipt_recency_before_mins?: string | number;
  receipt_recency_after_mins?: string | number;
  receipt_cbe_port?: string | number;
  receipt_circuit_breaker_threshold?: string | number;
  receipt_circuit_breaker_cooldown_sec?: string | number;
  receipt_retention_days_raw_payloads?: string | number;
  receipt_retention_days_unverified?: string | number;
  receipt_retention_days_verified?: string | number;
  receipt_cbe_beneficiaries?: string;
  receipt_telebirr_beneficiaries?: string;
  receipt_abyssinia_beneficiaries?: string;
  receipt_ethiopia_proxy_url?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface VerificationDiagnosticToast {
  title: string;
  message: string;
  badgeLabel: string;
  badgeClass: string;
  severity: 'error' | 'warning' | 'info';
  remediationHint: string;
}

/**
 * Standard RFC 7807 Error Code Mapping to Admin Toast Notifications & Diagnostic Badges
 */
export function getVerificationDiagnosticToast(
  errorCode: string | null | undefined,
  bank?: string | null
): VerificationDiagnosticToast {
  const bankLabel = bank ? bank.toUpperCase() : 'Bank';
  switch (errorCode) {
    case 'BANK_PORTAL_UNAVAILABLE':
      return {
        title: `${bankLabel} Portal Unavailable`,
        message: `${bankLabel} confirmation portal timed out. Bank may be undergoing maintenance.`,
        badgeLabel: `${bankLabel} Timeout`,
        badgeClass: 'diagnostic-badge warning',
        severity: 'warning',
        remediationHint: 'Retry in a few minutes or verify via manual banking app.',
      };
    case 'PORTAL_GEOBLOCKED':
      return {
        title: 'Bank Portal Geoblocked',
        message: `${bankLabel} transaction verification portal blocked non-Ethiopian egress or proxy failed.`,
        badgeLabel: 'Geoblocked',
        badgeClass: 'diagnostic-badge warning',
        severity: 'warning',
        remediationHint: 'Inspect Ethiopian residential proxy configuration in Settings.',
      };
    case 'BENEFICIARY_MISMATCH':
      return {
        title: 'Beneficiary Account Mismatch',
        message: 'Payment was sent to an unauthorized recipient account not in shop whitelist.',
        badgeLabel: 'Account Mismatch',
        badgeClass: 'diagnostic-badge danger',
        severity: 'error',
        remediationHint: 'Reject order or check if customer transferred to personal account.',
      };
    case 'AMOUNT_MISMATCH':
      return {
        title: 'Payment Amount Mismatch',
        message: 'Verified bank payment amount is less than the required net order total.',
        badgeLabel: 'Amount Mismatch',
        badgeClass: 'diagnostic-badge danger',
        severity: 'error',
        remediationHint: 'Ask buyer to transfer the remaining balance before fulfillment.',
      };
    case 'RECEIPT_ALREADY_USED':
      return {
        title: 'Receipt Replay Detected',
        message: 'Transaction reference code was previously verified and credited to another order.',
        badgeLabel: 'Replay Alert',
        badgeClass: 'diagnostic-badge danger',
        severity: 'error',
        remediationHint: 'Reject order; potential receipt reuse attempt.',
      };
    case 'RECEIPT_EXPIRED':
      return {
        title: 'Receipt Stale / Expired',
        message: 'Transaction timestamp is outside the allowable recency tolerance window.',
        badgeLabel: 'Stale Receipt',
        badgeClass: 'diagnostic-badge warning',
        severity: 'warning',
        remediationHint: 'Verify if customer paid for a previously abandoned order.',
      };
    case 'QR_DECODE_FAILED':
      return {
        title: 'QR Matrix Decoding Failed',
        message: 'Receipt image could not be decoded. Image may be blurry, uncropped, or corrupted.',
        badgeLabel: 'Blurry / Unreadable',
        badgeClass: 'diagnostic-badge neutral',
        severity: 'info',
        remediationHint: 'Inspect uploaded slip photo manually or ask customer for clear screenshot.',
      };
    case 'UNSUPPORTED_BANK':
      return {
        title: 'Unsupported Banking Rail',
        message: `Automated verification is not currently supported for rail '${bank || 'unknown'}'.`,
        badgeLabel: 'Unsupported Bank',
        badgeClass: 'diagnostic-badge neutral',
        severity: 'info',
        remediationHint: 'Verify receipt manually via SMS or mobile banking app.',
      };
    case 'CORRUPTED_FILE':
      return {
        title: 'Corrupted Receipt File',
        message: 'Uploaded slip file failed magic-byte validation or is not a valid JPEG/PNG/PDF.',
        badgeLabel: 'Corrupted File',
        badgeClass: 'diagnostic-badge danger',
        severity: 'error',
        remediationHint: 'Request a clean receipt screenshot or PDF from the customer.',
      };
    case 'RATE_LIMITED':
      return {
        title: 'Bank Query Rate Limited',
        message: 'Too many verification attempts sent to bank gateway. Rate limit active.',
        badgeLabel: 'Rate Limited',
        badgeClass: 'diagnostic-badge warning',
        severity: 'warning',
        remediationHint: 'Wait 60 seconds before initiating another re-verification.',
      };
    case 'INTERNAL_ENGINE_ERROR':
    default:
      return {
        title: 'Verification Engine Error',
        message: errorCode ? `Verification failed with error: ${errorCode}` : 'Verification could not be completed.',
        badgeLabel: errorCode ? `Err: ${errorCode}` : 'Engine Error',
        badgeClass: 'diagnostic-badge danger',
        severity: 'error',
        remediationHint: 'Inspect application error logs or approve manually.',
      };
  }
}

/**
 * Triggers re-verification of an order receipt against upstream bank rails.
 * POST /api/admin/receipts/:orderId/reverify
 */
export async function reverifyOrderReceiptApi(orderId: string): Promise<ReverifyReceiptResult> {
  const res = await adminFetch(`${API_BASE}/api/admin/receipts/${encodeURIComponent(orderId)}/reverify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errorMsg = data.detail || data.error || data.title || 'Re-verification failed';
    const err = new Error(errorMsg) as Error & { problemDetails?: Rfc7807ProblemDetails; code?: string };
    err.problemDetails = data;
    err.code = data.code;
    throw err;
  }
  return data;
}

/**
 * Retrieves the full bank verification audit details, security gate checklist,
 * and attempt telemetry for an order.
 * GET /api/receipts/status/:orderId
 */
export async function fetchOrderReceiptStatusApi(orderId: string): Promise<BankVerificationAuditDetails> {
  const res = await adminFetch(`${API_BASE}/api/receipts/status/${encodeURIComponent(orderId)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errorMsg = data.detail || data.error || data.title || 'Failed to fetch receipt verification status';
    const err = new Error(errorMsg) as Error & { problemDetails?: Rfc7807ProblemDetails };
    err.problemDetails = data;
    throw err;
  }
  return data;
}

