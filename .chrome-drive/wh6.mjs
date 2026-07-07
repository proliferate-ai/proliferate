import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const page = ctx.pages().find(p => p.url().includes('teamproliferate.slack.com/oauth'));
await page.bringToFront();
await page.locator('#oauth_channel_input').click();
await page.waitForTimeout(800);
await page.keyboard.type('alerts', { delay: 70 });
await page.waitForTimeout(1500);
await shot(page, 'channel-dropdown');
// dump options
const opts = await page.locator('[role="option"]').allTextContents();
console.log('OPTIONS:', JSON.stringify(opts.slice(0,20)));
await browser.close();
process.exit(0);
