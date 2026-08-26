-- Migration 004: Persist Wallet Pay quote metadata on orders.
-- Required so webhook events and the reconciliation worker can verify that
-- the paid crypto amount/currency match what was quoted at payment creation,
-- and so status checks query Wallet Pay using the provider payment_ref
-- instead of falling back to the internal order id.

ALTER TABLE orders ADD COLUMN crypto_amount REAL;
ALTER TABLE orders ADD COLUMN crypto_currency TEXT;
