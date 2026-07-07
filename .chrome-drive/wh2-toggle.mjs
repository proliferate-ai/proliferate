import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const page = ctx.pages().find(p => p.url().includes('api.slack.com/apps/A0BFD1Z5GV7'));
await page.bringToFront();
// Click the Off toggle
await page.getByText('Off', { exact: true }).click();
await page.waitForTimeout(3000);
await shot(page, 'webhooks-on');
console.log('URL:', page.url());
await browser.close();
process.exit(0);
