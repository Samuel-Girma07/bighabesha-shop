import crypto from 'crypto';
import { getDatabase } from '../db/index.js';
import { logger } from '../logger/index.js';
import { allocateStock } from './stock.service.js';
import { getProductById } from './catalog.service.js';

export type PaymentRail = 'stars' | 'wallet_pay' | 'telebirr' | 'cbe' | 'abyssinia';
export type OrderStatus =
  | 'new'
  | 'awaiting_payment'
  | 'pending_approval'
  | 'pending_fulfillment'
  | 'fulfilled'
  | 'rejected'
  | 'refunded'
  | 'cancelled';

export interface Order {
  id: string;
  user_id: number;
  username: string | null;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  amount_etb: number;
  payment_rail: PaymentRail;
  payment_ref: string | null;
  status: OrderStatus;
  receipt_file_id: string | null;
  receipt_note: string | null;
  fulfillment_payload: string | null;
  fulfillment_proof: string | null;
  rejection_reason: string | null;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateOrderInput {
  userId: number;
  username?: string | null;
  productId: string;
  variantId?: string | null;
  quantity?: number;
  amountETB: number;
  paymentRail: PaymentRail;
  paymentRef?: string | null;
  status?: OrderStatus;
}

export function generateOrderId(): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `ORD-${timestamp}-${rand}`;
}

export function createOrder(input: CreateOrderInput): Order {
  const db = getDatabase();
  const orderId = generateOrderId();
  const status: OrderStatus = input.status || 'awaiting_payment';

  // Ensure user exists in users table to satisfy foreign key
  db.prepare(`
    INSERT INTO users (id, username, first_name)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      username = COALESCE(excluded.username, users.username),
      updated_at = CURRENT_TIMESTAMP
  `).run(input.userId, input.username || null, input.username || 'Buyer');

  const stmt = db.prepare(`
    INSERT INTO orders (
      id, user_id, username, product_id, variant_id, quantity,
      amount_etb, payment_rail, payment_ref, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    orderId,
    input.userId,
    input.username || null,
    input.productId,
    input.variantId || null,
    input.quantity || 1,
    input.amountETB,
    input.paymentRail,
    input.paymentRef || null,
    status
  );

  logger.info({ orderId, userId: input.userId, productId: input.productId, amountETB: input.amountETB }, 'Order created');
  const order = getOrderById(orderId);
  if (!order) throw new Error(`Failed to retrieve newly created order ${orderId}`);
  return order;
}

export function getOrderById(orderId: string): Order | undefined {
  try {
    const db = getDatabase();
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as Order | undefined;
  } catch (err) {
    logger.error({ err, orderId }, 'Failed to get order by ID');
    return undefined;
  }
}

export function getOrdersByUserId(userId: number, limit: number = 20): Order[] {
  try {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM orders
      WHERE user_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?
    `).all(userId, limit) as Order[];
  } catch (err) {
    logger.error({ err, userId }, 'Failed to fetch user orders');
    return [];
  }
}

export function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  updates: Partial<Order> = {}
): Order {
  const db = getDatabase();
  const current = getOrderById(orderId);
  if (!current) {
    throw new Error(`Order ${orderId} not found`);
  }

  const fields: string[] = ['status = ?', 'updated_at = CURRENT_TIMESTAMP'];
  const values: any[] = [status];

  if (updates.payment_ref !== undefined) {
    fields.push('payment_ref = ?');
    values.push(updates.payment_ref);
  }
  if (updates.receipt_file_id !== undefined) {
    fields.push('receipt_file_id = ?');
    values.push(updates.receipt_file_id);
  }
  if (updates.receipt_note !== undefined) {
    fields.push('receipt_note = ?');
    values.push(updates.receipt_note);
  }
  if (updates.fulfillment_payload !== undefined) {
    fields.push('fulfillment_payload = ?');
    values.push(updates.fulfillment_payload);
  }
  if (updates.fulfillment_proof !== undefined) {
    fields.push('fulfillment_proof = ?');
    values.push(updates.fulfillment_proof);
  }
  if (updates.rejection_reason !== undefined) {
    fields.push('rejection_reason = ?');
    values.push(updates.rejection_reason);
  }
  if (updates.admin_notes !== undefined) {
    fields.push('admin_notes = ?');
    values.push(updates.admin_notes);
  }

  values.push(orderId);

  db.prepare(`UPDATE orders SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  logger.info({ orderId, previousStatus: current.status, newStatus: status }, 'Order status updated');

  const updated = getOrderById(orderId);
  if (!updated) throw new Error(`Failed to fetch updated order ${orderId}`);
  return updated;
}

export function submitReceipt(orderId: string, fileId: string, note?: string): Order {
  return updateOrderStatus(orderId, 'pending_approval', {
    receipt_file_id: fileId,
    receipt_note: note || null,
  });
}

export function approveReceipt(
  orderId: string,
  adminId: number
): { order: Order; autoDeliveredItem: any | null } {
  const order = getOrderById(orderId);
  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  if (order.status !== 'pending_approval' && order.status !== 'awaiting_payment') {
    throw new Error(`Order ${orderId} is in status "${order.status}" and cannot be approved.`);
  }

  const product = getProductById(order.product_id);
  let autoDeliveredItem: any = null;

  if (product && product.type === 'stock') {
    // Gemini Pro stock auto-allocation
    const alloc = allocateStock(order.product_id, order.id);
    if (alloc.item) {
      autoDeliveredItem = alloc.item;
      const updated = updateOrderStatus(order.id, 'fulfilled', {
        fulfillment_payload: alloc.item.payload,
        admin_notes: `Approved by Admin ${adminId} (Auto-fulfilled stock item #${alloc.item.id})`,
      });
      return { order: updated, autoDeliveredItem };
    }
  }

  // Telegram Premium or Stars (semi-automated queue)
  const updated = updateOrderStatus(order.id, 'pending_fulfillment', {
    admin_notes: `Approved by Admin ${adminId}`,
  });

  return { order: updated, autoDeliveredItem: null };
}

export function getFulfillmentQueue(): Order[] {
  try {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM orders
      WHERE status = 'pending_fulfillment'
      ORDER BY created_at ASC, rowid ASC
    `).all() as Order[];
  } catch (err) {
    logger.error({ err }, 'Failed to fetch fulfillment queue');
    return [];
  }
}

export function fulfillOrderWithProof(
  orderId: string,
  adminId: number,
  proof?: { text?: string; fileId?: string }
): Order {
  const order = getOrderById(orderId);
  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  const proofText = proof?.text || (proof?.fileId ? 'Screenshot Proof Attached' : null);

  return updateOrderStatus(orderId, 'fulfilled', {
    fulfillment_proof: proofText || null,
    receipt_file_id: proof?.fileId || order.receipt_file_id,
    admin_notes: `Fulfilled by Admin ${adminId}`,
  });
}

export function refundOrder(orderId: string, adminId: number, reason?: string): Order {
  const order = getOrderById(orderId);
  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  return updateOrderStatus(orderId, 'refunded', {
    rejection_reason: reason || 'Refunded by administrator',
    admin_notes: `Refunded by Admin ${adminId}: ${reason || 'Manual refund'}`,
  });
}

export function rejectReceipt(orderId: string, adminId: number, reason: string): Order {
  const order = getOrderById(orderId);
  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  return updateOrderStatus(orderId, 'rejected', {
    rejection_reason: reason,
    admin_notes: `Rejected by Admin ${adminId}: ${reason}`,
  });
}
