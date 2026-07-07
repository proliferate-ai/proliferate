import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
// Find existing api.slack.com/apps tab, or open new
let page = ctx.pages().find(p => p.url().startsWith('https://api.slack.com/apps'));
if (!page) page = await ctx.newPage();
await page.bringToFront();
await page.goto('https://api.slack.com/apps', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(4000);
await shot(page, 'apps-list');
console.log('URL:', page.url());
await browser.close();
process.exit(0);
