import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const page = ctx.pages().find(p => p.url().includes('sentry.io') && p.url().includes('projects'));
await page.bringToFront();
await page.locator('[data-test-id="sidebar-dropdown"]').first().click().catch(async()=>{
  await page.locator('.sidebar-dropdown, [aria-haspopup]').first().click();
});
await page.waitForTimeout(1200);
await page.getByText('Switch Organization', { exact: true }).hover();
await page.waitForTimeout(2000);
await shot(page, 'org-submenu2');
// grab org links
const links = await page.locator('a[href*="sentry.io"], [role="menuitem"]').evaluateAll(els => els.map(e => e.textContent.trim()).filter(Boolean).slice(0,40));
console.log('LINKS:', JSON.stringify(links));
await browser.close();
process.exit(0);
