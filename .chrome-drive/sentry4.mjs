import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const page = ctx.pages().find(p => p.url().includes('sentry.io') && p.url().includes('projects'));
await page.bringToFront();
await page.getByText('Switch Organization', { exact: true }).hover();
await page.waitForTimeout(1800);
await shot(page, 'org-submenu');
await browser.close();
process.exit(0);
