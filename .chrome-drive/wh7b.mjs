import { attach, shot } from './helper.mjs';
const { browser, ctx } = await attach();
const pages = ctx.pages();
console.log(pages.map(p=>p.url().slice(0,90)).join('\n'));
await browser.close();
process.exit(0);
