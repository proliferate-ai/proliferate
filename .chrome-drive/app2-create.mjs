import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const page = ctx.pages().find(p => p.url().startsWith('https://api.slack.com/apps'));
await page.bringToFront();
// dismiss cookie banner if present
try { await page.getByText('REJECT ALL COOKIES').click({ timeout: 3000 }); } catch {}
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Create New App' }).click().catch(async () => {
  await page.getByText('Create New App', { exact: true }).click();
});
await page.waitForTimeout(2000);
await shot(page, 'create-app-modal');
console.log('URL:', page.url());
await browser.close();
process.exit(0);
