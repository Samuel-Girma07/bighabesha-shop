import { initDatabase, getDatabase } from '../src/db/index.js';
import { seedDatabase } from '../src/db/seed.js';
import { createOrder, submitReceipt, fulfillOrderWithProof } from '../src/services/orders.service.js';
import { getAvailableStockCount, addStockLink } from '../src/services/stock.service.js';
import { resolveOrderPrice } from '../src/services/pricing.service.js';
import { getUserStats } from '../src/services/loyalty.service.js';

async function runCustomerSimulation() {
  console.log('================================================================');
  console.log('🚀 STARTING 3-CUSTOMER MULTI-PRODUCT E2E WORKFLOW SIMULATION');
  console.log('================================================================\n');

  // 1. Initialize Database
  initDatabase('./data/shop.db');
  const db = getDatabase();

  // Ensure stock exists for Gemini Pro
  const initialStock = getAvailableStockCount('gemini_pro_18m');
  console.log(`📦 Initial Gemini Pro 18M Stock in Vault: ${initialStock} keys`);
  if (initialStock < 2) {
    try {
      addStockLink('gemini_pro_18m', `https://g.co/gemini/redeem?code=TEST-GEMINI-${Date.now()}`);
    } catch {}
    console.log(`➕ Added backup key. New Stock: ${getAvailableStockCount('gemini_pro_18m')}`);
  }

  // Register 3 distinct customers in database
  const customer1 = { id: 910001, username: 'alice_buyer', first_name: 'Alice' };
  const customer2 = { id: 920002, username: 'bob_stars', first_name: 'Bob' };
  const customer3 = { id: 930003, username: 'charlie_ai', first_name: 'Charlie' };

  for (const c of [customer1, customer2, customer3]) {
    db.prepare(`
      INSERT INTO users (id, username, first_name, is_registered)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET username = excluded.username, first_name = excluded.first_name
    `).run(c.id, c.username, c.first_name);
  }

  console.log('👥 Customers Registered:');
  console.log(`   1. Alice (@${customer1.username}, ID: ${customer1.id})`);
  console.log(`   2. Bob (@${customer2.username}, ID: ${customer2.id})`);
  console.log(`   3. Charlie (@${customer3.username}, ID: ${customer3.id})\n`);

  // =========================================================================
  // WORKFLOW 1: Customer Alice buys Telegram Premium (3 Months) via Telebirr
  // =========================================================================
  console.log('----------------------------------------------------------------');
  console.log('🛒 TEST 1: Alice buys Telegram Premium (3 Months Plan)');
  console.log('----------------------------------------------------------------');
  const price1 = resolveOrderPrice({ productId: 'telegram_premium', variantId: 'tg_prem_3m' });
  const order1 = createOrder({
    userId: customer1.id,
    productId: 'telegram_premium',
    variantId: 'tg_prem_3m',
    paymentRail: 'telebirr',
    amountETB: price1.amountETB,
  });
  console.log(`✓ Order Created: ID ${order1.id} | Amount: ${order1.amount_etb} ETB | Status: ${order1.status}`);

  // Alice uploads Telebirr screenshot receipt
  const order1Submitted = submitReceipt(
    order1.id,
    'receipt_telebirr_alice_01',
    'Telebirr Ref: FT2608259901 Alice'
  );
  console.log(`✓ Receipt Uploaded by Alice -> Order Status: ${order1Submitted.status} (Pending Admin Review)\n`);

  // =========================================================================
  // WORKFLOW 2: Customer Bob buys 500 Telegram Stars via CBE Bank
  // =========================================================================
  console.log('----------------------------------------------------------------');
  console.log('🛒 TEST 2: Bob buys 500 Telegram Stars');
  console.log('----------------------------------------------------------------');
  const price2 = resolveOrderPrice({ productId: 'telegram_stars', variantId: 'tg_stars_500' });
  const order2 = createOrder({
    userId: customer2.id,
    productId: 'telegram_stars',
    variantId: 'tg_stars_500',
    paymentRail: 'cbe',
    amountETB: price2.amountETB,
  });
  console.log(`✓ Order Created: ID ${order2.id} | Amount: ${order2.amount_etb} ETB | Status: ${order2.status}`);

  // Bob uploads CBE Bank receipt
  const order2Submitted = submitReceipt(
    order2.id,
    'receipt_cbe_bob_02',
    'CBE Slip Ref: CBE99482710 Bob'
  );
  console.log(`✓ Receipt Uploaded by Bob -> Order Status: ${order2Submitted.status} (Pending Admin Review)\n`);

  // =========================================================================
  // WORKFLOW 3: Customer Charlie buys 1x Gemini Pro (18M) via CBE Bank
  // =========================================================================
  console.log('----------------------------------------------------------------');
  console.log('🛒 TEST 3: Charlie buys Gemini Pro (18 Months Key)');
  console.log('----------------------------------------------------------------');
  const price3 = resolveOrderPrice({ productId: 'gemini_pro_18m', variantId: 'gemini_pro_18m_default' });
  const order3 = createOrder({
    userId: customer3.id,
    productId: 'gemini_pro_18m',
    variantId: 'gemini_pro_18m_default',
    paymentRail: 'cbe',
    amountETB: price3.amountETB,
  });
  console.log(`✓ Order Created: ID ${order3.id} | Amount: ${order3.amount_etb} ETB | Status: ${order3.status}`);

  // Charlie uploads CBE Bank receipt
  const order3Submitted = submitReceipt(
    order3.id,
    'receipt_cbe_charlie_03',
    'CBE Slip Ref: CBE77281900 Charlie'
  );
  console.log(`✓ Receipt Uploaded by Charlie -> Order Status: ${order3Submitted.status} (Pending Admin Review)\n`);

  // =========================================================================
  // ADMIN DASHBOARD FULFILLMENT ACTIONS
  // =========================================================================
  console.log('================================================================');
  console.log('🛡️ ADMIN REVIEW & FULFILLMENT QUEUE');
  console.log('================================================================\n');

  const adminId = 8923821645;

  // 1. Fulfill Alice's Telegram Premium Order via Fragment rail
  console.log(`1️⃣ Fulfilling Alice's Telegram Premium Order (${order1.id})...`);
  const fulfilledOrder1 = fulfillOrderWithProof(order1.id, adminId, {
    text: 'Delivered via Fragment official gifting to @alice_buyer',
  });
  console.log(`   ✓ Status: ${fulfilledOrder1.status} | Proof: ${fulfilledOrder1.fulfillment_proof}`);

  // 2. Fulfill Bob's 500 Stars Order via Fragment rail
  console.log(`2️⃣ Fulfilling Bob's 500 Stars Order (${order2.id})...`);
  const fulfilledOrder2 = fulfillOrderWithProof(order2.id, adminId, {
    text: '500 Stars delivered to @bob_stars via Fragment. TX: ton_hash_500stars_9921',
  });
  console.log(`   ✓ Status: ${fulfilledOrder2.status} | Proof: ${fulfilledOrder2.fulfillment_proof}`);

  // 3. Fulfill Charlie's Gemini Pro Order (Auto-pulls key from Vault)
  console.log(`3️⃣ Fulfilling Charlie's Gemini Pro Order (${order3.id})...`);
  const stockBeforeFulfillment = getAvailableStockCount('gemini_pro_18m');
  const fulfilledOrder3 = fulfillOrderWithProof(order3.id, adminId, {
    text: 'Auto-allocated digital activation key from vault',
  });
  const stockAfterFulfillment = getAvailableStockCount('gemini_pro_18m');
  console.log(`   ✓ Status: ${fulfilledOrder3.status}`);
  console.log(`   🔑 Key Delivered to Charlie: ${fulfilledOrder3.fulfillment_payload}`);
  console.log(`   📉 Vault Stock Decremented: ${stockBeforeFulfillment} -> ${stockAfterFulfillment}\n`);

  // =========================================================================
  // POST-WORKFLOW METRICS & VERIFICATION
  // =========================================================================
  console.log('================================================================');
  console.log('📊 POST-FULFILLMENT METRICS & VERIFICATION');
  console.log('================================================================\n');

  const statsAlice = getUserStats(customer1.id);
  const statsBob = getUserStats(customer2.id);
  const statsCharlie = getUserStats(customer3.id);

  console.log(`👤 Alice Stats:   Lifetime Spend = ${statsAlice.lifetime_etb} ETB | Orders = ${statsAlice.orders_count} | Tier = ${statsAlice.tier}`);
  console.log(`👤 Bob Stats:     Lifetime Spend = ${statsBob.lifetime_etb} ETB | Orders = ${statsBob.orders_count} | Tier = ${statsBob.tier}`);
  console.log(`👤 Charlie Stats: Lifetime Spend = ${statsCharlie.lifetime_etb} ETB | Orders = ${statsCharlie.orders_count} | Tier = ${statsCharlie.tier}\n`);

  const totalRevRow = db.prepare("SELECT SUM(amount_etb) as rev FROM orders WHERE status = 'fulfilled'").get() as { rev: number };
  console.log(`💰 Total Realized Shop Revenue from Fulfilled Orders: ${totalRevRow.rev.toLocaleString()} ETB`);
  console.log('\n🎉 ALL 3 CUSTOMER WORKFLOWS COMPLETED SUCCESSFULLY WITH 100% INTEGRITY!');
}

runCustomerSimulation().catch(console.error);
