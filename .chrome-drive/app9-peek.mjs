import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const page = ctx.pages().find(p => p.url().startsWith('https://api.slack.com/apps'));
await page.bringToFront();
await page.waitForTimeout(500);
await shot(page, 'app-peek');
console.log('URL:', page.url());
await browser.close();
process.exit(0);
