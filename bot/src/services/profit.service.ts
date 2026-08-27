import { getDatabase } from '../db/index.js';
import type { Order } from './orders.service.js';
import { getNumericSetting } from './settings.service.js';

export interface ProfitBreakdown {
  revenueEtb: number;
  discountEtb: number;
  netRevenueEtb: number;
  cogsEtb: number | null;
  railFeeEtb: number;
  netProfitEtb: number | null;
  marginPct: number | null;
}

/** Rail-specific fee assumptions (settings-driven, ETB). */
export function railFeeEtb(order: Pick<Order, 'payment_rail' | 'amount_etb' | 'discount_etb'>): number {
  const net = order.amount_etb - (order.discount_etb || 0);
  switch (order.payment_rail) {
    case 'chapa':
      return Math.round((net * getNumericSetting('chapa_fee_pct', 2)) / 100);
    case 'wallet_pay':
    case 'ton_connect': {
      const gasBps = getNumericSetting('wallet_gas_bps', 30);
      return Math.max(1, Math.round((net * gasBps) / 10000));
    }
    default:
      return 0; // manual rails settle directly into merchant accounts
  }
}

export function profitForOrder(order: Order): ProfitBreakdown {
  const discount = order.discount_etb || 0;
  const netRevenue = order.amount_etb - discount;
  const fx = order.fx_rate_at_sale ?? null;
  const cogs =
    order.cost_basis_usd !== null && fx && fx > 0
      ? Math.round(order.cost_basis_usd * fx)
      : null;

  const fee = railFeeEtb(order);
  const netProfit = cogs === null ? null : netRevenue - cogs - fee;
  const margin = netProfit === null ? null : netRevenue > 0 ? Math.round((netProfit / netRevenue) * 1000) / 10 : null;

  return {
    revenueEtb: order.amount_etb,
    discountEtb: discount,
    netRevenueEtb: netRevenue,
    cogsEtb: cogs,
    railFeeEtb: fee,
    netProfitEtb: netProfit,
    marginPct: margin,
  };
}

export interface PnlRow {
  period: string;          // YYYY-MM
  orders: number;
  grossEtb: number;
  discountsEtb: number;
  cogsKnownOrders: number;
  cogsEtb: number;         // only orders with a cost snapshot
  railFeesEtb: number;
  netProfitEtb: number;    // only where COGS known
}

/** Monthly P&L rollup over fulfilled orders (fees computed per-order in JS). */
export function monthlyPnl(months: number = 12): PnlRow[] {
  const db = getDatabase();
  const orders = db.prepare(`
    SELECT * FROM orders
    WHERE status = 'fulfilled'
      AND created_at >= datetime('now', '-' || ? || ' months')
    ORDER BY created_at ASC
  `).all(String(months)) as unknown as Order[];

  const byPeriod = new Map<string, PnlRow>();
  for (const order of orders) {
    const period = String(order.created_at).slice(0, 7);
    const row = byPeriod.get(period) ?? {
      period, orders: 0, grossEtb: 0, discountsEtb: 0,
      cogsKnownOrders: 0, cogsEtb: 0, railFeesEtb: 0, netProfitEtb: 0,
    };

    const p = profitForOrder(order);
    row.orders += 1;
    row.grossEtb += p.revenueEtb;
    row.discountsEtb += p.discountEtb;
    row.railFeesEtb += p.railFeeEtb;
    if (p.cogsEtb !== null) {
      row.cogsKnownOrders += 1;
      row.cogsEtb += p.cogsEtb;
      row.netProfitEtb += p.netProfitEtb ?? 0;
    }

    byPeriod.set(period, row);
  }
  return [...byPeriod.values()];
}
