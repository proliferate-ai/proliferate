import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const pages = ctx.pages().filter(p => p.url().startsWith('https://app.slack.com/client'));
const page = pages[pages.length - 1];
await page.bringToFront();

await page.getByText('Add channels', { exact: true }).first().click();
await page.waitForTimeout(800);
await page.getByText('Create a new channel', { exact: true }).click();
await page.waitForTimeout(1500);

// Fill the name
const input = page.locator('input[placeholder*="plan-budget"]').first();
await input.fill('alerts');
await page.waitForTimeout(500);
await shot(page, 'filled-name');

// Click Next (button inside modal)
const nextBtn = page.locator('button:has-text("Next")').first();
await nextBtn.click();
await page.waitForTimeout(1500);
await shot(page, 'step2-visibility');
await browser.close();
process.exit(0);
