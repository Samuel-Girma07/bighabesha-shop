-- 001_init.sql: Initial Database Schema for Bighabesha Shop

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    language_code TEXT DEFAULT 'en',
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('stock', 'order')),
    name TEXT NOT NULL,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    meta TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS variants (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price_etb INTEGER NOT NULL CHECK (price_etb >= 0),
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    meta TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stock_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'allocated', 'invalid')),
    order_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    allocated_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_stock_items_product_status ON stock_items(product_id, status);

CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    username TEXT,
    product_id TEXT NOT NULL REFERENCES products(id),
    variant_id TEXT REFERENCES variants(id),
    quantity INTEGER DEFAULT 1,
    amount_etb INTEGER NOT NULL,
    payment_rail TEXT NOT NULL CHECK (payment_rail IN ('stars', 'wallet_pay', 'telebirr', 'cbe', 'abyssinia')),
    payment_ref TEXT,
    status TEXT NOT NULL CHECK (status IN ('new', 'awaiting_payment', 'pending_approval', 'pending_fulfillment', 'fulfilled', 'rejected', 'refunded', 'cancelled')),
    receipt_file_id TEXT,
    receipt_note TEXT,
    fulfillment_payload TEXT,
    fulfillment_proof TEXT,
    rejection_reason TEXT,
    admin_notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
