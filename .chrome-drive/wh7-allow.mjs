import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const page = ctx.pages().find(p => p.url().includes('teamproliferate.slack.com/oauth'));
await page.bringToFront();
// Select the #alerts option
await page.getByRole('option', { name: 'alerts' }).click();
await page.waitForTimeout(1000);
await shot(page, 'channel-selected');
// Click Allow
await page.getByRole('button', { name: 'Allow' }).click();
await page.waitForTimeout(4500);
await shot(page, 'after-allow');
console.log('URL:', page.url());
await browser.close();
process.exit(0);
