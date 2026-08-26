import { getDatabase } from '../db/index.js';
import { getNumericSetting } from './settings.service.js';

export interface StockForecast {
  productId: string;
  available: number;
  velocityPerDay: number;
  daysOfCover: number | null;
  reorderPoint: number;
  reorderNow: boolean;
}

/** Rolling fulfilled-order velocity (units/day) over the lookback window. */
export function salesVelocity(productId: string, windowDays: number = 7): number {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) AS units
    FROM orders
    WHERE product_id = ? AND status = 'fulfilled'
      AND created_at >= datetime('now', '-' || ? || ' days')
  `).get(productId, String(windowDays)) as { units: number };
  return (row?.units ?? 0) / Math.max(windowDays, 1);
}

export function forecastForStockProduct(productId: string, available: number): StockForecast {
  const leadDays = getNumericSetting('restock_lead_days', 7);
  const safetyDays = getNumericSetting('restock_safety_days', 3);
  const velocity = salesVelocity(productId, 7);
  const reorderPoint = Math.ceil(velocity * leadDays + safetyDays * Math.max(velocity, 0.14));
  const daysOfCover = velocity > 0 ? available / velocity : null;

  // Reorder when cover drops below the lead time even if absolute stock is fine.
  const reorderNow = velocity > 0 && daysOfCover !== null && daysOfCover < leadDays;

  return {
    productId,
    available,
    velocityPerDay: Math.round(velocity * 100) / 100,
    daysOfCover: daysOfCover === null ? null : Math.round(daysOfCover * 10) / 10,
    reorderPoint,
    reorderNow,
  };
}
