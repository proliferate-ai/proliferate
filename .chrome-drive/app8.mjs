import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const page = ctx.pages().find(p => p.url().startsWith('https://api.slack.com/apps'));
await page.bringToFront();

// Dropdown popover is open. Select Team Proliferate.
try {
  await page.getByText('Team Proliferate', { exact: true }).click({ timeout: 5000 });
} catch (e) {
  // maybe closed; open then select
  await page.getByText('Select a workspace', { exact: true }).click();
  await page.waitForTimeout(600);
  await page.getByText('Team Proliferate', { exact: true }).click();
}
await page.waitForTimeout(600);

// Now fix the name
const nameInput = page.locator('#app_name');
await nameInput.fill('Proliferate Alerts');
await page.waitForTimeout(400);
await shot(page, 'ready-to-create');
console.log('NAME:', await nameInput.inputValue());
await browser.close();
process.exit(0);
