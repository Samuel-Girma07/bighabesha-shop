import { getProductById, getVariantById, Product, Variant } from './catalog.service.js';
import { getNumericSetting } from './settings.service.js';
import { tierDiscountPct, type Tier } from './loyalty.service.js';
import { logger } from '../logger/index.js';

export interface ResolvedPrice {
  amountETB: number;
  quantity: number;
  productName: string;
  product: Product;
  variant: Variant | null;
  /** Set when an active flash-sale price was used instead of the base price. */
  saleApplied?: boolean;
}

export interface ResolveOrderPriceParams {
  productId: string;
  variantId?: string | null;
  customStars?: number | null;
  /** Buyer's loyalty tier — applies the server-side tier discount. */
  userTier?: Tier | null;
}

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingError';
  }
}

/**
 * Validates that an amount is a strictly positive integer ETB price.
 * Defense-in-depth guard: every order creation path must pass through this.
 */
export function assertPositiveIntegerETB(amount: unknown): asserts amount is number {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
    throw new PricingError(`Order amount must be a positive integer in ETB (received: ${JSON.stringify(amount)})`);
  }
}

/**
 * Reads an active flash-sale price from a variant's meta JSON, if within the
 * configured window. Returns null when no sale is currently running.
 */
function activeSalePrice(variant: Variant, nowMs: number): number | null {
  try {
    const meta = JSON.parse(variant.meta || '{}') as {
      sale_price?: number; sale_starts_at?: string; sale_ends_at?: string;
    };
    if (!meta.sale_price || meta.sale_price <= 0) return null;

    const startMs = meta.sale_starts_at ? Date.parse(meta.sale_starts_at) : 0;
    const endMs = meta.sale_ends_at ? Date.parse(meta.sale_ends_at) : Infinity;
    if (Number.isFinite(startMs) && nowMs < startMs) return null;
    if (Number.isFinite(endMs) && nowMs > endMs) return null;
    if (meta.sale_price >= variant.price_etb) return null; // "sales" never raise prices

    return Math.ceil(meta.sale_price);
  } catch {
    return null;
  }
}

/**
 * Computes the authoritative price for an order from the server-side catalog
 * and rate engine. Client-supplied amounts are NEVER trusted.
 *
 * Precedence: active flash sale → catalog price → loyalty tier discount.
 */
export function resolveOrderPrice(params: ResolveOrderPriceParams): ResolvedPrice {
  const product = getProductById(params.productId);
  if (!product) {
    throw new PricingError(`Product not found: ${params.productId}`);
  }
  if (!product.is_active) {
    throw new PricingError(`Product is not available: ${product.name}`);
  }

  if (params.variantId) {
    const variant = getVariantById(params.variantId);
    if (!variant) {
      throw new PricingError(`Variant not found: ${params.variantId}`);
    }
    if (!variant.is_active) {
      throw new PricingError(`This plan is currently unavailable: ${variant.name}`);
    }
    if (variant.product_id !== product.id) {
      throw new PricingError(`Variant ${variant.id} does not belong to product ${product.id}`);
    }

    const nowMs = Date.now();
    const sale = activeSalePrice(variant, nowMs);
    const baseAmount = sale ?? variant.price_etb;
    const tierPct = params.userTier ? tierDiscountPct(params.userTier) : 0;
    const amountETB = Math.max(1, Math.ceil(baseAmount * (1 - tierPct / 100)));

    assertPositiveIntegerETB(amountETB);

    return {
      amountETB,
      quantity: 1,
      productName: `${product.name} (${variant.name})`,
      product,
      variant,
      saleApplied: sale !== null && tierPct === 0 ? true : sale !== null,
    };
  }

  if (params.customStars !== undefined && params.customStars !== null) {
    if (product.id !== 'telegram_stars') {
      throw new PricingError(`Custom amounts are only supported for Telegram Stars`);
    }

    const stars = params.customStars;
    if (typeof stars !== 'number' || !Number.isFinite(stars) || !Number.isInteger(stars) || stars <= 0) {
      throw new PricingError('Stars amount must be a positive whole number.');
    }

    const minStars = getNumericSetting('stars_min', 10);
    const maxStars = getNumericSetting('stars_max', 100000);
    if (stars < minStars || stars > maxStars) {
      throw new PricingError(
        `Custom Stars orders must be between ${minStars.toLocaleString('en-US')} and ${maxStars.toLocaleString('en-US')} Stars.`
      );
    }

    const etbPerStar = getNumericSetting('etb_per_star', 2.5);
    if (!(etbPerStar > 0)) {
      logger.error({ etbPerStar }, 'etb_per_star setting is invalid; refusing to price order');
      throw new PricingError('Store pricing is temporarily unavailable. Please contact support.');
    }

    const amountETB = Math.ceil(stars * etbPerStar);
    assertPositiveIntegerETB(amountETB);

    return {
      amountETB,
      quantity: stars,
      productName: `${stars.toLocaleString('en-US')} Telegram Stars`,
      product,
      variant: null,
    };
  }

  throw new PricingError('Order requires either a valid plan variant or a custom Stars amount.');
}
