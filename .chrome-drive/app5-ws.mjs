import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const page = ctx.pages().find(p => p.url().startsWith('https://api.slack.com/apps'));
await page.bringToFront();
// The select element
const sel = page.locator('select').first();
const html = await page.locator('form, .modal, body').first().evaluate(el => {
  const s = document.querySelector('select');
  if (!s) return 'NO SELECT';
  return Array.from(s.options).map(o => o.value + '=' + o.textContent).join(' | ');
});
console.log('SELECT_OPTIONS:', html);
await browser.close();
process.exit(0);
