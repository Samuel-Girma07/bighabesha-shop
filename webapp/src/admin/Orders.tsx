import React from 'react';

export interface ResellerBadgeProps {
  provider?: string | null;
  size?: 'sm' | 'md';
  className?: string;
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

export default ResellerBadge;
