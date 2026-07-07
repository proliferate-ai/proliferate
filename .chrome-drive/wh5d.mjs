import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const page = ctx.pages().find(p => p.url().includes('teamproliferate.slack.com/oauth'));
await page.bringToFront();
await page.waitForTimeout(500);
// List all comboboxes
const combos = await page.locator('[role="combobox"]').all();
console.log('combos:', combos.length);
for (let i=0;i<combos.length;i++){
  const label = await combos[i].getAttribute('aria-label');
  const dis = await combos[i].getAttribute('aria-disabled');
  const id = await combos[i].getAttribute('id');
  console.log(i, id, label, 'disabled='+dis);
}
await browser.close();
process.exit(0);
