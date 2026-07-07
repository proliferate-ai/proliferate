import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const pages = ctx.pages().filter(p => p.url().startsWith('https://app.slack.com/client'));
const page = pages[pages.length - 1];
await page.bringToFront();
await page.waitForTimeout(1000);
await shot(page, 'peek');
await browser.close();
process.exit(0);
