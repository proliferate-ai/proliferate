import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
// Reuse the tab I opened (slack client tab that I created). Find a slack client tab that isn't the user's original one... 
// Safer: open a fresh tab.
const page = await ctx.newPage();
await page.goto('https://app.slack.com/client/T0BCDCZCL0Z', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(6000);

// Click "Add channels"
await page.getByText('Add channels', { exact: true }).first().click();
await page.waitForTimeout(1500);
await shot(page, 'add-channels-menu');
await browser.close();
process.exit(0);
