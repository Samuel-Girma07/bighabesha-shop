# Bighabesha Shop — End-to-End Manual Testing Script

This script outlines the step-by-step test verification procedures for the **Bighabesha Shop** Telegram inline bot and admin dashboard.

---

## 1. Initial User Boot & Language Selection
- **Step 1:** Open [@Bighabesha_shopBot](https://t.me/Bighabesha_shopBot) and send `/start`.
- **Expected Result:**
  - Welcome banner appears with shop description.
  - Buttons: `[🛍 Browse Shop]`, `[📦 My Orders]`, `[🌐 Language]`, `[💬 Support]`, and `[⚙️ Admin Dashboard]` (if user is in `ADMIN_IDS`).
- **Step 2:** Tap `[🌐 Language]`.
- **Expected Result:** Language menu appears with English active.

---

## 2. Gemini Pro 18m (Instant Automated Delivery)
- **Step 1:** In `/admin` → **🔑 Stock Management** → **➕ Paste Activation Links**.
- **Step 2:** Paste `https://gemini.google.com/redeem/test_link_101` and submit.
- **Expected Result:** Admin receives confirmation that 1 link was added; available stock increases.
- **Step 3:** As a buyer, tap **🛍 Browse Shop** → **Gemini Pro (18 Months)** → **⚡ Buy Now**.
- **Step 4:** Choose **🏛 CBE Bank**.
- **Step 5:** Tap **📸 I Paid — Upload Receipt** and upload any photo screenshot.
- **Step 6:** In admin chat, tap **✅ Approve Receipt**.
- **Expected Result:**
  - Admin alert button updates to `✅ Order APPROVED`.
  - Buyer receives instant delivery message with `https://gemini.google.com/redeem/test_link_101` and VPN activation steps.
  - Stock decrements to 0; catalog shows `(Sold Out ❌)`.

---

## 3. Telegram Premium & Username Gate
- **Step 1:** From an account without a public `@username`, tap **⭐️ Telegram Premium** → select **3 Months Plan**.
- **Expected Result:**
  - **Username Gate** triggers: purchase is blocked; step-by-step username creation guide is displayed.
- **Step 2:** Set a username in Telegram Settings (e.g. `@mytestuser`) and tap **[🔄 I created it — recheck]**.
- **Expected Result:** Gate unblocks immediately with confirmation and proceeds to checkout rail picker.
- **Step 3:** Select **💎 Wallet Pay (TON / USDT)**.
- **Step 4:** Send `/wp_simulate <order_id>`.
- **Expected Result:** Order is simulated as paid and placed into the admin fulfillment queue.

---

## 4. Telegram Stars (Packages & Custom Amount)
- **Step 1:** Tap **🪙 Telegram Stars** → **✨ Enter Custom Stars Amount**.
- **Step 2:** Type `5` (below min 10).
- **Expected Result:** Error message stating minimum purchase is 10 Stars.
- **Step 3:** Type `500`.
- **Expected Result:** Confirmation summary appears ($500 \times 2.5 = 1,250 \text{ ETB}$).
- **Step 4:** Tap **💳 Proceed to Payment** → Select **📱 Telebirr** → Upload receipt.
- **Step 5:** Admin approves receipt.
- **Expected Result:** Order moves to admin fulfillment queue for Fragment delivery to `@mytestuser`.

---

## 5. Admin Fulfillment Queue & Proof Delivery
- **Step 1:** Send `/admin` → **📋 Orders Queue**.
- **Expected Result:** Pending Telegram Premium / Stars orders appear sorted oldest-first (FIFO).
- **Step 2:** Tap an order → **📸 Upload Proof Screenshot & Fulfill**.
- **Step 3:** Upload a confirmation screenshot.
- **Expected Result:**
  - Order status updates to `fulfilled`.
  - Buyer receives delivery confirmation along with the attached proof photo!

---

## 6. Admin Pricing, Stock CSV & Broadcast
- **Step 1:** In `/admin` → **📦 Products & Prices** → Tap variant → Enter new price `1700`.
- **Expected Result:** Variant price updates immediately in the user catalog.
- **Step 2:** In `/admin` → **📢 Broadcast Announcement** → Select **All Users** → Send message `🎉 Flash Sale on Telegram Stars!`.
- **Step 3:** Confirm broadcast.
- **Expected Result:** Announcement is dispatched to all registered users and a delivery report is shown.
