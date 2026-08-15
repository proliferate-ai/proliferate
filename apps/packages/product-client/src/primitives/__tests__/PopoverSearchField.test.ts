import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PopoverSearchField } from "#product/primitives/PopoverSearchField";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Plugin, type ViteDevServer } from "vite";

const WEB_ROOT = fileURLToPath(new URL("../../../../../web/", import.meta.url));
const WEB_VITE_CONFIG = fileURLToPath(
  new URL("../../../../../web/vite.config.ts", import.meta.url),
);

let viteServer: ViteDevServer;
let browser: Browser;
let fixtureUrl: string;

beforeAll(async () => {
  viteServer = await createServer({
    configFile: WEB_VITE_CONFIG,
    root: WEB_ROOT,
    logLevel: "silent",
    plugins: [fixtureRoute(renderFixtureHtml())],
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
    },
  });
  await viteServer.listen();
  const baseUrl = viteServer.resolvedUrls?.local[0];
  if (!baseUrl) {
    throw new Error("Popover search field fixture did not receive a Vite URL.");
  }
  fixtureUrl = new URL("__popover-search-field", baseUrl).href;
  browser = await chromium.launch({ channel: "chrome", headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await viteServer?.close();
}, 60_000);

// INTENTIONAL CONTRACT CHANGE (PRO-249): this replaces the #1799 pin that
// asserted the FOCUSED placeholder carried a 2px text-indent. That fix moved
// the placeholder 2px on every focus/blur of an empty native field. The new
// contract never moves the placeholder: while a native field is empty and
// focused, the native caret is suppressed (`caret-color: transparent`) and a
// 1px replacement caret is painted as a background bar at the content-box
// origin — the same 1px-caret philosophy the Lexical chat composer uses. Typing
// dismisses `:placeholder-shown` and atomically restores the native caret.
describe("empty-field replacement caret", () => {
  it("suppresses the native caret and paints a 1px bar without moving the placeholder", async () => {
    // Reduced motion disables the blink animation, so the base rule's static
    // background-image applies deterministically — never assert a mid-blink
    // computed background-image without this.
    const page = await browser.newPage({ viewport: { width: 360, height: 160 } });
    try {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(fixtureUrl, { waitUntil: "networkidle" });
      const fields = [
        page.getByPlaceholder("Search models"),
        page.getByPlaceholder("Search files"),
        page.getByPlaceholder("Add objective"),
      ];

      for (const field of fields) {
        // Park focus on the button so each field starts provably blurred,
        // regardless of where the previous loop iteration left it.
        await page.getByRole("button", { name: "Done" }).focus();

        // Blurred + empty: native caret intact, no replacement bar, no indent.
        const blurred = await field.evaluate((element) => ({
          caretColor: getComputedStyle(element).caretColor,
          backgroundImage: getComputedStyle(element).backgroundImage,
          placeholderIndent: getComputedStyle(element, "::placeholder").textIndent,
        }));
        expect(blurred.caretColor).not.toBe("rgba(0, 0, 0, 0)");
        expect(blurred.backgroundImage).toBe("none");
        expect(blurred.placeholderIndent).toBe("0px");

        // Focused + empty: native caret suppressed, 1px bar painted at the
        // content-box origin, and — the PRO-249 regression pin — the
        // placeholder does NOT move (its own and its ::placeholder text-indent
        // both stay 0px).
        await field.focus();
        const focused = await field.evaluate((element) => ({
          caretColor: getComputedStyle(element).caretColor,
          backgroundImage: getComputedStyle(element).backgroundImage,
          backgroundSize: getComputedStyle(element).backgroundSize,
          backgroundOrigin: getComputedStyle(element).backgroundOrigin,
          elementIndent: getComputedStyle(element).textIndent,
          placeholderIndent: getComputedStyle(element, "::placeholder").textIndent,
        }));
        expect(focused.caretColor).toBe("rgba(0, 0, 0, 0)");
        expect(focused.backgroundImage).toContain("linear-gradient");
        expect(focused.backgroundSize.startsWith("1px")).toBe(true);
        expect(focused.backgroundOrigin).toBe("content-box");
        expect(focused.elementIndent).toBe("0px");
        expect(focused.placeholderIndent).toBe("0px");

        // Typing dismisses the placeholder, which restores the native caret and
        // drops the replacement bar in the same style rule.
        await field.fill("entered text");
        const typed = await field.evaluate((element) => ({
          caretColor: getComputedStyle(element).caretColor,
          backgroundImage: getComputedStyle(element).backgroundImage,
        }));
        expect(typed.backgroundImage).toBe("none");
        expect(typed.caretColor).not.toBe("rgba(0, 0, 0, 0)");

        // Cleared + blurred (focus moves to the Done button): bar gone, native
        // caret restored.
        await field.fill("");
        await page.getByRole("button", { name: "Done" }).focus();
        const cleared = await field.evaluate((element) => ({
          caretColor: getComputedStyle(element).caretColor,
          backgroundImage: getComputedStyle(element).backgroundImage,
        }));
        expect(cleared.backgroundImage).toBe("none");
        expect(cleared.caretColor).not.toBe("rgba(0, 0, 0, 0)");
      }
    } finally {
      await page.close();
    }
  }, 60_000);

  it("blinks the replacement caret when motion is allowed", async () => {
    const page = await browser.newPage({ viewport: { width: 360, height: 160 } });
    try {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.goto(fixtureUrl, { waitUntil: "networkidle" });
      for (const field of [
        page.getByPlaceholder("Search models"),
        page.getByPlaceholder("Search files"),
        page.getByPlaceholder("Add objective"),
      ]) {
        await field.focus();
        expect(
          await field.evaluate((element) => getComputedStyle(element).animationName),
        ).toBe("ui-empty-field-caret-blink");
      }
    } finally {
      await page.close();
    }
  }, 60_000);
});

function renderFixtureHtml(): string {
  const searchField = renderToStaticMarkup(createElement(PopoverSearchField, {
    value: "",
    onChange: () => undefined,
    placeholder: "Search models",
  }));

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <link rel="stylesheet" href="/src/index.css" />
        <style>
          body { padding: 24px; }
          #fixture { width: 288px; }
        </style>
      </head>
      <body>
        <div id="fixture">${searchField}</div>
        <input placeholder="Search files" />
        <textarea placeholder="Add objective"></textarea>
        <button type="button">Done</button>
      </body>
    </html>`;
}

function fixtureRoute(html: string): Plugin {
  return {
    name: "popover-search-field-fixture",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url !== "/__popover-search-field") {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(html);
      });
    },
  };
}
