import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const page = ctx.pages().find(p => p.url().startsWith('https://api.slack.com/apps'));
await page.bringToFront();
// Click the "Select a workspace" custom dropdown
await page.getByText('Select a workspace', { exact: true }).click();
await page.waitForTimeout(1200);
await shot(page, 'ws-dropdown');
// Dump visible text of dropdown items
const items = await page.locator('[role="option"], li, .select_options li').allTextContents();
console.log('ITEMS:', JSON.stringify(items.filter(t=>t.trim()).slice(0,20)));
await browser.close();
process.exit(0);
