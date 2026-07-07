import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const page = ctx.pages().find(p => p.url().startsWith('https://api.slack.com/apps'));
await page.bringToFront();

await page.locator('input[placeholder*="Super Service"]').fill('Proliferate Alerts');
await page.waitForTimeout(400);

// Inspect workspace select options
const opts = await page.locator('select option').allTextContents();
console.log('WORKSPACE_OPTIONS:', JSON.stringify(opts));
await shot(page, 'named');
await browser.close();
process.exit(0);
