import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const pages = ctx.pages().filter(p => p.url().startsWith('https://app.slack.com/client'));
const page = pages[pages.length - 1];
await page.bringToFront();
// Close the add-people dialog
const close = page.locator('button[aria-label="Close"]').first();
await close.click();
await page.waitForTimeout(1000);
await shot(page, 'alerts-created');
console.log('URL:', page.url());
await browser.close();
process.exit(0);
