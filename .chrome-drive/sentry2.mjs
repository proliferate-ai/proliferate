import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const page = ctx.pages().find(p => p.url().includes('sentry.io/organizations/test-9mk/projects'));
await page.bringToFront();
// dismiss modal
try { await page.getByText('Maybe later', {exact:true}).click({timeout:4000}); } catch {}
await page.waitForTimeout(1000);
// Click the org switcher (top-left avatar/T)
await page.locator('[data-test-id="sidebar-dropdown"], [aria-label*="organization" i]').first().click().catch(()=>{});
await page.waitForTimeout(1500);
await shot(page, 'org-switcher');
await browser.close();
process.exit(0);
