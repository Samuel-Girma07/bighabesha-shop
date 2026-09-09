import React from 'react';

export interface ResellerBadgeProps {
  provider?: string | null;
  size?: 'sm' | 'md';
  className?: string;
}

export interface ReceiptEvidenceSummary {
  id: number;
  bank: 'cbe' | 'telebirr' | 'abyssinia' | 'unknown' | string;
  reference: string | null;
  normalized_reference: string | null;
  status: 'auto_verified' | 'pending_manual_review' | 'rejected' | 'upstream_failure' | string;
  error_code: string | null;
  verified_amount_etb: number | null;
  security_gate_passed: boolean;
  created_at: string;
}

export interface AdminOrder {
  id: string;
  user_id: number;
  username: string | null;
  product_id: string;
  variant_id: string | null;
  amount_etb: number;
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
  updated_at?: string;
  evidence?: ReceiptEvidenceSummary | null;
}

/**
 * Formats the reseller provider string into a clean display label and CSS class name.
 * Handles 'gramix', 'istar', 'mock', and custom fallback providers.
 */
export function formatResellerBadge(provider?: string | null): { label: string; className: string; providerKey: string } | null {
  if (!provider || !provider.trim()) return null;
  const p = provider.toLowerCase().trim();
  if (p === 'gramix') {
    return { label: 'Gramix', className: 'reseller-pill gramix', providerKey: 'gramix' };
  }
  if (p === 'istar') {
    return { label: 'iStar', className: 'reseller-pill istar', providerKey: 'istar' };
  }
  if (p === 'mock') {
    return { label: 'Mock Provider', className: 'reseller-pill mock', providerKey: 'mock' };
  }
  return {
    label: provider.charAt(0).toUpperCase() + provider.slice(1),
    className: 'reseller-pill generic',
    providerKey: p,
  };
}

/**
 * ResellerBadge: Visual badge indicating fulfillment provider (Gramix, iStar, etc.)
 */
export const ResellerBadge: React.FC<ResellerBadgeProps> = ({ provider, size = 'sm', className = '' }) => {
  const badge = formatResellerBadge(provider);
  if (!badge) return null;

  return (
    <span
      className={`${badge.className} ${size === 'md' ? 'md' : ''} ${className}`.trim()}
      title={`Fulfilled via ${badge.label}`}
    >
      <span className="reseller-dot" />
      {badge.label}
    </span>
  );
};

// ============================================================================
// Automated Bank Verification Components (ADR-002)
// ============================================================================

export interface AutoVerifiedBadgeProps {
  bank?: string | null;
  reference?: string | null;
  onClick?: () => void;
  onCopy?: (ref: string) => void;
  size?: 'sm' | 'md';
  className?: string;
}

export function formatBankLabel(bank?: string | null): string {
  if (!bank) return 'Bank';
  const b = bank.toLowerCase().trim();
  if (b === 'cbe') return 'CBE';
  if (b === 'telebirr') return 'Telebirr';
  if (b === 'abyssinia') return 'Abyssinia';
  return b.toUpperCase();
}

/**
 * AutoVerifiedBadge: Renders high-contrast "⚡ Auto-Verified (CBE/Telebirr)" badge
 * with normalized transaction reference and 1-click inspection trigger.
 */
export const AutoVerifiedBadge: React.FC<AutoVerifiedBadgeProps> = ({
  bank,
  reference,
  onClick,
  onCopy,
  size = 'sm',
  className = '',
}) => {
  const bankLabel = formatBankLabel(bank);
  const displayRef = reference || 'VERIFIED';

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (reference && onCopy) {
      onCopy(reference);
    } else if (reference && navigator?.clipboard) {
      navigator.clipboard.writeText(reference);
    }
  };

  return (
    <div className={`auto-verified-badge ${size === 'md' ? 'md' : ''} ${className}`.trim()}>
      <button
        type="button"
        className="auto-verified-trigger-btn"
        onClick={onClick}
        title="Verified automatically by bank portal. Click to inspect full 4-pillar audit evidence."
        aria-label={`Inspect ${bankLabel} automated verification audit`}
      >
        <span className="auto-verified-dot" aria-hidden="true" />
        <span className="auto-verified-title">⚡ Auto-Verified ({bankLabel})</span>
      </button>
      {reference && (
        <span className="auto-verified-ref" title={`Ref: ${reference}`}>
          <span>{displayRef}</span>
          <button
            type="button"
            className="auto-verified-copy-btn"
            onClick={handleCopy}
            title={`Copy reference ID ${reference}`}
            aria-label={`Copy reference ID ${reference}`}
          >
            📋
          </button>
        </span>
      )}
    </div>
  );
};

export interface VerificationDiagnosticBadgeProps {
  errorCode?: string | null;
  bank?: string | null;
  onClick?: () => void;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Helper to compute diagnostic badge parameters without circular imports
 */
export function getDiagnosticBadgeDetails(
  errorCode?: string | null,
  bank?: string | null
): { label: string; severity: 'warning' | 'danger' | 'neutral'; hint: string; fullTitle: string } {
  const bankUpper = bank ? bank.toUpperCase() : 'Bank';
  switch (errorCode) {
    case 'BANK_PORTAL_UNAVAILABLE':
      return {
        label: `${bankUpper} Timeout`,
        severity: 'warning',
        hint: 'Bank confirmation portal timed out. Retry or inspect manually.',
        fullTitle: `${bankUpper} Portal Unavailable`,
      };
    case 'PORTAL_GEOBLOCKED':
      return {
        label: 'Geoblocked',
        severity: 'warning',
        hint: 'Bank portal blocked non-Ethiopian egress or proxy timed out.',
        fullTitle: 'Bank Portal Geoblocked',
      };
    case 'BENEFICIARY_MISMATCH':
      return {
        label: 'Account Mismatch',
        severity: 'danger',
        hint: 'Payment received on unauthorized account not in shop whitelist.',
        fullTitle: 'Beneficiary Account Mismatch',
      };
    case 'AMOUNT_MISMATCH':
      return {
        label: 'Amount Mismatch',
        severity: 'danger',
        hint: 'Verified bank amount is lower than required order total.',
        fullTitle: 'Payment Amount Mismatch',
      };
    case 'RECEIPT_ALREADY_USED':
      return {
        label: 'Replay Alert',
        severity: 'danger',
        hint: 'Transaction reference code was previously verified and redeemed.',
        fullTitle: 'Receipt Replay Detected',
      };
    case 'RECEIPT_EXPIRED':
      return {
        label: 'Stale Receipt',
        severity: 'warning',
        hint: 'Slip execution time is outside allowable recency window.',
        fullTitle: 'Receipt Stale / Expired',
      };
    case 'QR_DECODE_FAILED':
      return {
        label: 'Blurry / Unreadable',
        severity: 'neutral',
        hint: 'Receipt QR matrix unreadable. Check uploaded slip screenshot.',
        fullTitle: 'QR Matrix Decoding Failed',
      };
    case 'UNSUPPORTED_BANK':
      return {
        label: 'Unsupported Bank',
        severity: 'neutral',
        hint: `Automated verification not supported for ${bank || 'unknown'} rail.`,
        fullTitle: 'Unsupported Banking Rail',
      };
    case 'CORRUPTED_FILE':
      return {
        label: 'Corrupted File',
        severity: 'danger',
        hint: 'File failed magic-byte validation or is not a valid JPEG/PNG/PDF.',
        fullTitle: 'Corrupted Receipt File',
      };
    case 'RATE_LIMITED':
      return {
        label: 'Rate Limited',
        severity: 'warning',
        hint: 'Too many queries sent to bank. Rate limit active.',
        fullTitle: 'Bank Query Rate Limited',
      };
    case 'INTERNAL_ENGINE_ERROR':
    default:
      return {
        label: errorCode ? `Err: ${errorCode}` : 'Review Needed',
        severity: errorCode ? 'danger' : 'neutral',
        hint: 'Verification could not be automatically resolved. Manual inspection required.',
        fullTitle: 'Manual Review Required',
      };
  }
}

/**
 * VerificationDiagnosticBadge: Renders diagnostic indicators like [CBE Timeout],
 * [Account Mismatch], [Amount Mismatch], [Blurry QR] on orders in pending_approval.
 */
export const VerificationDiagnosticBadge: React.FC<VerificationDiagnosticBadgeProps> = ({
  errorCode,
  bank,
  onClick,
  size = 'sm',
  className = '',
}) => {
  if (!errorCode) return null;
  const diag = getDiagnosticBadgeDetails(errorCode, bank);

  return (
    <button
      type="button"
      className={`diagnostic-badge ${diag.severity} ${size === 'md' ? 'md' : ''} ${className}`.trim()}
      title={`${diag.fullTitle}: ${diag.hint} (Click to inspect)`}
      aria-label={`${diag.fullTitle}: ${diag.hint}. Click to inspect.`}
      onClick={onClick}
    >
      <span className="diagnostic-dot" aria-hidden="true" />
      <span>[{diag.label}]</span>
    </button>
  );
};

export interface ReverifyActionBtnProps {
  orderId: string;
  isReverifying?: boolean;
  disabled?: boolean;
  onReverify: (orderId: string) => void | Promise<void>;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * ReverifyActionBtn: Inline 1-click action to re-verify order receipt against bank rails
 * with loading spinner and debounce protection.
 */
export const ReverifyActionBtn: React.FC<ReverifyActionBtnProps> = ({
  orderId,
  isReverifying = false,
  disabled = false,
  onReverify,
  size = 'sm',
  className = '',
}) => {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isReverifying && !disabled) {
      onReverify(orderId);
    }
  };

  return (
    <button
      type="button"
      className={`reverify-btn ${size === 'md' ? 'md' : ''} ${isReverifying ? 'busy' : ''} ${className}`.trim()}
      disabled={disabled || isReverifying}
      aria-busy={isReverifying}
      onClick={handleClick}
      title="Trigger automated bank verification query against upstream portal"
      aria-label={`Re-verify receipt for order ${orderId} with bank`}
    >
      {isReverifying ? (
        <>
          <span className="reverify-spinner" aria-hidden="true" />
          <span>Verifying…</span>
        </>
      ) : (
        <>
          <span className="reverify-icon" aria-hidden="true">⚡</span>
          <span>Re-verify with Bank</span>
        </>
      )}
    </button>
  );
};

export default ResellerBadge;
