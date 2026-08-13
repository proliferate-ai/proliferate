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

describe("native placeholder caret spacing", () => {
  it("keeps focused input and textarea placeholders clear without shifting entered text", async () => {
    const page = await browser.newPage({ viewport: { width: 360, height: 160 } });
    try {
      await page.goto(fixtureUrl, { waitUntil: "networkidle" });
      const fields = [
        page.getByPlaceholder("Search models"),
        page.getByPlaceholder("Search files"),
        page.getByPlaceholder("Add objective"),
      ];

      for (const field of fields) {
        await field.focus();
        const focusedIndent = await field.evaluate((element) => ({
          input: getComputedStyle(element).textIndent,
          placeholder: getComputedStyle(element, "::placeholder").textIndent,
        }));
        expect(focusedIndent).toEqual({
          input: "0px",
          placeholder: "2px",
        });

        await field.fill("entered text");
        expect(
          await field.evaluate((element) => getComputedStyle(element).textIndent),
        ).toBe("0px");

        await field.fill("");
        await page.getByRole("button", { name: "Done" }).focus();
        expect(
          await field.evaluate(
            (element) => getComputedStyle(element, "::placeholder").textIndent,
          ),
        ).toBe("0px");
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
