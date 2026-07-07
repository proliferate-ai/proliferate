import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
// Find the page with the open menu (last slack client tab)
const pages = ctx.pages().filter(p => p.url().startsWith('https://app.slack.com/client'));
const page = pages[pages.length - 1];
await page.bringToFront();

// Click "Create a new channel"
await page.getByText('Create a new channel', { exact: true }).click();
await page.waitForTimeout(2000);
await shot(page, 'create-dialog-1');
await browser.close();
process.exit(0);
