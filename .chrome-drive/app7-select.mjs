import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const page = ctx.pages().find(p => p.url().startsWith('https://api.slack.com/apps'));
await page.bringToFront();

// Re-fill name cleanly
const nameInput = page.locator('input[placeholder*="Super Service"]');
await nameInput.click();
await nameInput.fill('');
await nameInput.fill('Proliferate Alerts');
await page.waitForTimeout(300);

// Open dropdown and select Team Proliferate (matches T0BCDCZCL0Z where #alerts lives)
await page.getByText('Select a workspace', { exact: true }).click();
await page.waitForTimeout(800);
await page.getByText('Team Proliferate', { exact: true }).click();
await page.waitForTimeout(800);
await shot(page, 'ws-selected');
console.log('NAME:', await nameInput.inputValue());
await browser.close();
process.exit(0);
