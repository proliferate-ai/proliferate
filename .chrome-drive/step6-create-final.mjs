import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const pages = ctx.pages().filter(p => p.url().startsWith('https://app.slack.com/client'));
const page = pages[pages.length - 1];
await page.bringToFront();

const createBtn = page.locator('button:has-text("Create")').last();
await createBtn.click();
await page.waitForTimeout(2500);
await shot(page, 'after-create');
await browser.close();
process.exit(0);
