import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });

  const page = await context.newPage();

  // 1. Capture Web App Store (Mobile viewport)
  await page.setViewportSize({ width: 420, height: 860 });
  console.log('Navigating to Customer Web App Store...');
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: './scratch_store.png', fullPage: true });
  console.log('Saved scratch_store.png');

  // 2. Capture Admin Dashboard (Desktop viewport)
  await page.setViewportSize({ width: 1440, height: 900 });
  console.log('Navigating to Admin Dashboard...');
  await page.goto('http://localhost:3000/#admin', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: './scratch_admin_login.png' });
  console.log('Saved scratch_admin_login.png');

  // 3. Login to Admin Dashboard via API token in localStorage
  console.log('Injecting session and rendering full dashboard...');
  await page.evaluate(async () => {
    const res = await fetch('/api/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'Bighabesha2026!Admin' }),
    });
    const data = await res.json();
    console.log('Login res:', data);
  });

  // Verify directly with master session token
  await page.evaluate(() => {
    localStorage.setItem('bighabesha_admin_token', 'dev_admin_master_session');
  });

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: './scratch_admin_dashboard.png' });
  console.log('Saved scratch_admin_dashboard.png');

  await browser.close();
}

run().catch(console.error);
