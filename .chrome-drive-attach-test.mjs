import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];
const pages = ctx.pages();
console.log(JSON.stringify(pages.map(p => ({ url: p.url().slice(0, 120) })), null, 2));
process.exit(0);
