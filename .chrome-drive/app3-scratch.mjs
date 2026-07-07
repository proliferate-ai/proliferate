import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const page = ctx.pages().find(p => p.url().startsWith('https://api.slack.com/apps'));
await page.bringToFront();
await page.getByText('From scratch', { exact: true }).click();
await page.waitForTimeout(2000);
await shot(page, 'from-scratch-form');
await browser.close();
process.exit(0);
