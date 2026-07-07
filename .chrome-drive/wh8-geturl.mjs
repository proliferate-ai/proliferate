import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const page = ctx.pages().find(p => p.url().includes('A0BFD1Z5GV7/incoming-webhooks'));
await page.bringToFront();
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await page.mouse.wheel(0, 1200);
await page.waitForTimeout(800);
await shot(page, 'webhook-url-page');
// Extract webhook URL from any input or copy field
const url = await page.evaluate(() => {
  const inputs = Array.from(document.querySelectorAll('input'));
  for (const i of inputs) { if (i.value && i.value.includes('hooks.slack.com')) return i.value; }
  const texts = Array.from(document.querySelectorAll('code, .apps_incoming_webhook_url, td'));
  for (const t of texts) { if (t.textContent && t.textContent.includes('hooks.slack.com')) return t.textContent.trim(); }
  const m = document.body.innerText.match(/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9\/]+/);
  return m ? m[0] : 'NOT FOUND';
});
console.log('WEBHOOK_URL:', url);
await browser.close();
process.exit(0);
