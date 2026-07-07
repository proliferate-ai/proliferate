import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const page = ctx.pages().find(p => p.url().includes('teamproliferate.slack.com/oauth'));
await page.bringToFront();
await page.waitForTimeout(500);
// This is a native select for channel. Inspect selects.
const info = await page.evaluate(() => {
  const selects = Array.from(document.querySelectorAll('select')).map(s => ({
    id: s.id, name: s.name,
    options: Array.from(s.options).map(o => o.value + '=' + o.textContent).slice(0,50)
  }));
  return selects;
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
process.exit(0);
