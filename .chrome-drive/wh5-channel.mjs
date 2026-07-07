import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const page = ctx.pages().find(p => p.url().includes('teamproliferate.slack.com/oauth'));
await page.bringToFront();
// Click channel search
await page.getByText('Search for a channel...', { exact: true }).click();
await page.waitForTimeout(800);
await page.keyboard.type('alerts', { delay: 60 });
await page.waitForTimeout(1500);
await shot(page, 'channel-search');
await browser.close();
process.exit(0);
