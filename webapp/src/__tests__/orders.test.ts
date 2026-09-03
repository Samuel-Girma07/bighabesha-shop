import { describe, it, expect } from 'vitest';
import { formatResellerBadge } from '../admin/Orders.tsx';
import type { OrderItem } from '../api.ts';
import type { AdminOrder } from '../admin/Orders.tsx';

describe('formatResellerBadge (Admin Orders Provider Badge Formatter)', () => {
  it('correctly maps gramix to Gramix badge with vibrant cyan styling', () => {
    const res = formatResellerBadge('gramix');
    expect(res).toEqual({
      label: 'Gramix',
      className: 'reseller-pill gramix',
      providerKey: 'gramix',
    });

    // Case-insensitivity check
    expect(formatResellerBadge('Gramix')?.label).toBe('Gramix');
    expect(formatResellerBadge('GRAMIX')?.className).toBe('reseller-pill gramix');
  });

  it('correctly maps istar to iStar badge with amethyst purple styling', () => {
    const res = formatResellerBadge('istar');
    expect(res).toEqual({
      label: 'iStar',
      className: 'reseller-pill istar',
      providerKey: 'istar',
    });

    // Case-insensitivity check
    expect(formatResellerBadge('iStar')?.label).toBe('iStar');
    expect(formatResellerBadge('ISTAR')?.className).toBe('reseller-pill istar');
  });

  it('correctly maps mock to Mock Provider badge with slate gray styling', () => {
    const res = formatResellerBadge('mock');
    expect(res).toEqual({
      label: 'Mock Provider',
      className: 'reseller-pill mock',
      providerKey: 'mock',
    });
  });

  it('gracefully handles custom/third-party providers as generic pills', () => {
    const res = formatResellerBadge('telefrag');
    expect(res).toEqual({
      label: 'Telefrag',
      className: 'reseller-pill generic',
      providerKey: 'telefrag',
    });
  });

  it('returns null for empty, whitespace, or undefined provider strings', () => {
    expect(formatResellerBadge(null)).toBeNull();
    expect(formatResellerBadge(undefined)).toBeNull();
    expect(formatResellerBadge('')).toBeNull();
    expect(formatResellerBadge('   ')).toBeNull();
  });
});

describe('OrderItem & AdminOrder Reseller Provider Typing', () => {
  it('supports orders fulfilled via Gramix with transaction IDs', () => {
    const order: OrderItem = {
      id: 'ord_gramix_001',
      user_id: 12345,
      username: 'testuser',
      product_id: 'telegram_premium',
      variant_id: 'tg_prem_3m',
      quantity: 1,
      amount_etb: 1100,
      payment_rail: 'cbe',
      status: 'fulfilled',
      receipt_file_id: null,
      receipt_note: null,
      fulfillment_payload: null,
      fulfillment_proof: 'Delivered via Gramix API',
      rejection_reason: null,
      target_username: 'friend',
      reseller_provider: 'gramix',
      reseller_tx_id: 'gmx_tx_998877',
      created_at: new Date().toISOString(),
    };

    expect(order.reseller_provider).toBe('gramix');
    expect(order.reseller_tx_id).toBe('gmx_tx_998877');
    const badge = formatResellerBadge(order.reseller_provider);
    expect(badge?.label).toBe('Gramix');
  });

  it('supports orders fulfilled via iStar with failover error metadata', () => {
    const adminOrder: AdminOrder = {
      id: 'ord_istar_002',
      user_id: 67890,
      username: 'vipbuyer',
      product_id: 'telegram_premium',
      variant_id: 'tg_prem_12m',
      amount_etb: 3400,
      payment_rail: 'telebirr',
      status: 'fulfilled',
      receipt_file_id: 'receipt_file_abc',
      receipt_note: 'Paid via telebirr',
      fulfillment_payload: null,
      fulfillment_proof: 'Delivered via iStar API',
      rejection_reason: null,
      target_username: 'vipbuyer',
      reseller_provider: 'istar',
      reseller_tx_id: 'ist_order_445566',
      reseller_error: 'Gramix float exhausted; cascaded to iStar successfully',
      created_at: new Date().toISOString(),
    };

    expect(adminOrder.reseller_provider).toBe('istar');
    expect(adminOrder.reseller_error).toContain('cascaded to iStar');
    const badge = formatResellerBadge(adminOrder.reseller_provider);
    expect(badge?.label).toBe('iStar');
    expect(badge?.className).toBe('reseller-pill istar');
  });
});
