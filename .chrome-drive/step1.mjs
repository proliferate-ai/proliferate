import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
// Open my own new tab for the work
const page = await ctx.newPage();
await page.goto('https://app.slack.com/client/T0BCDCZCL0Z/browse-channels', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(6000);
await shot(page, 'slack-browse');
console.log('URL:', page.url());
await browser.close();
process.exit(0);
