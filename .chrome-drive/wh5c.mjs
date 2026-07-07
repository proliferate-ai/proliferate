import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const page = ctx.pages().find(p => p.url().includes('teamproliferate.slack.com/oauth'));
await page.bringToFront();
await page.waitForTimeout(500);
// Find combobox / dropdown trigger for channel
const combo = page.locator('[role="combobox"], [data-qa="channel_select"], .c-select_button, button[aria-haspopup="listbox"]').first();
const cnt = await combo.count();
console.log('comboCount:', cnt);
if (cnt) {
  await combo.click();
  await page.waitForTimeout(800);
  await page.keyboard.type('alerts', { delay: 60 });
  await page.waitForTimeout(1500);
}
await shot(page, 'channel-search2');
await browser.close();
process.exit(0);
