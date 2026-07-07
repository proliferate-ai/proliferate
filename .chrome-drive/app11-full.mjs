import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const page = ctx.pages().find(p => p.url().startsWith('https://api.slack.com/apps'));
await page.bringToFront();

await page.getByRole('button', { name: 'Create New App' }).click();
await page.waitForTimeout(1500);
await page.getByText('From scratch', { exact: true }).click();
await page.waitForTimeout(1800);

await page.locator('#app_name').fill('Proliferate Alerts');
await page.waitForTimeout(400);

await page.getByText('Select a workspace', { exact: true }).click();
await page.waitForTimeout(900);
await page.getByText('Team Proliferate', { exact: true }).click();
await page.waitForTimeout(800);

const nm = await page.locator('#app_name').inputValue();
console.log('NAME:', nm);
await shot(page, 'full-ready');
await browser.close();
process.exit(0);
