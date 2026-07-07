import { chromium } from 'playwright';

export async function attach() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  return { browser, ctx };
}

export async function shot(page, name) {
  const p = `/Users/pablohansen/proliferate/.chrome-drive/${name}.png`;
  await page.screenshot({ path: p });
  console.log('SCREENSHOT: ' + p);
}
