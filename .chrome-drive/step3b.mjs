import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const pages = ctx.pages().filter(p => p.url().startsWith('https://app.slack.com/client'));
const page = pages[pages.length - 1];
await page.bringToFront();

await page.getByText('Add channels', { exact: true }).first().click();
await page.waitForTimeout(1000);
await page.getByText('Create a new channel', { exact: true }).click();
await page.waitForTimeout(2000);
await shot(page, 'create-dialog-1');
await browser.close();
process.exit(0);
