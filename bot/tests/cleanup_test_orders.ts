import { initDatabase, getDatabase } from '../src/db/index.js';

function cleanAwaitingOrders() {
  initDatabase('./data/shop.db');
  const db = getDatabase();
  const deleted = db.prepare("DELETE FROM orders WHERE status = 'awaiting_payment'").run();
  console.log(`🧹 Cleaned ${deleted.changes} uncompleted awaiting_payment ghost orders.`);
  
  const remaining = db.prepare("SELECT id, user_id, product_id, status FROM orders").all();
  console.log(`📦 Remaining Orders in DB:`, remaining);
}

cleanAwaitingOrders();
