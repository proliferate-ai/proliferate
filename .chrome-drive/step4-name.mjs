import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const pages = ctx.pages().filter(p => p.url().startsWith('https://app.slack.com/client'));
const page = pages[pages.length - 1];
await page.bringToFront();

const input = page.locator('input[placeholder*="plan-budget"], .p-create_channel_modal input[type="text"]').first();
await input.fill('alerts');
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Next' }).click();
await page.waitForTimeout(2000);
await shot(page, 'create-dialog-2');
await browser.close();
process.exit(0);
