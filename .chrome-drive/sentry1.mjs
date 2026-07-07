import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const page = await ctx.newPage();
await page.goto('https://sentry.io/organizations/proliferate/projects/', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(6000);
await shot(page, 'sentry-projects');
console.log('URL:', page.url());
await browser.close();
process.exit(0);
