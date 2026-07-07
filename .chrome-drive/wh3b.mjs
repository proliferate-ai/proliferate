import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const page = ctx.pages().find(p => p.url().includes('api.slack.com/apps/A0BFD1Z5GV7'));
await page.bringToFront();
await page.mouse.wheel(0, 1200);
await page.waitForTimeout(1000);
// try button role and partial text
const found = await page.getByRole('button', { name: /Add New Webhook/i }).count();
const linkFound = await page.getByText(/Add New Webhook/i).count();
console.log('btnCount:', found, 'textCount:', linkFound);
await shot(page, 'scrolled-webhooks');
await browser.close();
process.exit(0);
