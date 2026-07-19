import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CodeBlock } from "@proliferate/product-ui/code/CodeBlock";
import { MarkdownBody } from "@proliferate/product-ui/chat/transcript/MarkdownBody";
import { PlanMarkdownBody } from "@proliferate/product-ui/chat/transcript/PlanMarkdownBody";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Plugin, type ViteDevServer } from "vite";

const WEB_ROOT = fileURLToPath(new URL("../../../../web/", import.meta.url));
const WEB_VITE_CONFIG = fileURLToPath(
  new URL("../../../../web/vite.config.ts", import.meta.url),
);
const AUTHENTICATED_CSS = fileURLToPath(
  new URL("./authenticated.css", import.meta.url),
);

const MARKDOWN_FIXTURE = [
  "# Transcript title",
  "",
  "## Section heading",
  "",
  "### Supporting heading",
  "",
  "Prose with `inline code`.",
  "",
  "```ts",
  "const parity = true;",
  "```",
  "",
  "| Surface | Long value |",
  "| --- | --- |",
  "| Transcript | " +
    "this_unbroken_value_forces_table_local_horizontal_overflow_without_widening_the_fixture |",
].join("\n");

const PROPOSAL_FIXTURE = [
  "# Proposal title",
  "",
  "## Proposal section",
  "",
  "### Proposal micro-label",
  "",
  "Proposal prose.",
].join("\n");

let viteServer: ViteDevServer;
let browser: Browser;
let fixtureUrl: string;

beforeAll(async () => {
  const html = renderFixtureHtml();
  viteServer = await createServer({
    configFile: WEB_VITE_CONFIG,
    root: WEB_ROOT,
    logLevel: "silent",
    plugins: [fixtureRoute(html)],
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
    },
  });
  await viteServer.listen();
  const baseUrl = viteServer.resolvedUrls?.local[0];
  if (!baseUrl) {
    throw new Error("Markdown cascade fixture did not receive a Vite URL.");
  }
  fixtureUrl = new URL("__markdown-cascade", baseUrl).href;
  browser = await chromium.launch({ channel: "chrome", headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await viteServer?.close();
});

describe("authenticated Markdown stylesheet cascade", () => {
  it("preserves transcript semantics and explicit proposal hierarchy", async () => {
    const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
    try {
      await page.goto(fixtureUrl, { waitUntil: "networkidle" });

      const result = await page.evaluate(() => {
        const px = (element: Element | null) => {
          if (!element) throw new Error("Expected fixture element was not rendered.");
          return Number.parseFloat(getComputedStyle(element).fontSize);
        };
        const metrics = (id: string) => {
          const container = document.querySelector<HTMLElement>(`#${id}`);
          const root = container?.querySelector<HTMLElement>(".chat-markdown");
          if (!container || !root) throw new Error(`${id} fixture was not rendered.`);
          return {
            prose: px(root.querySelector("p")),
            inlineCode: px(root.querySelector('[data-markdown-inline-code="true"]')),
            fencedCode: px(root.querySelector('[data-markdown-code-content="true"]')),
            headings: [
              px(root.querySelector("h1")),
              px(root.querySelector("h2")),
              px(root.querySelector("h3")),
            ],
          };
        };
        const headings = (id: string) => {
          const root = document.querySelector<HTMLElement>(`#${id} .chat-markdown`);
          if (!root) throw new Error(`${id} fixture was not rendered.`);
          return [
            px(root.querySelector("h1")),
            px(root.querySelector("h2")),
            px(root.querySelector("h3")),
          ];
        };

        const tableRoot = document.querySelector<HTMLElement>("#ordinary-default .chat-markdown");
        const tableShell = tableRoot?.querySelector<HTMLElement>(
          '[data-markdown-table-shell="true"]',
        );
        const tableScroller = tableShell?.querySelector<HTMLElement>("div");
        if (!tableRoot || !tableShell || !tableScroller) {
          throw new Error("Table overflow fixture was not rendered.");
        }

        return {
          stylesheets: Array.from(
            document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
          ).map((link) => link.dataset.sheet),
          defaultTranscript: metrics("ordinary-default"),
          largeTranscript: metrics("ordinary-large"),
          highlightedDefault: metrics("highlighted-default"),
          highlightedLarge: metrics("highlighted-large"),
          proposalHeadings: headings("proposal-default"),
          table: {
            rootWidth: tableRoot.clientWidth,
            shellWidth: tableShell.clientWidth,
            clientWidth: tableScroller.clientWidth,
            scrollWidth: tableScroller.scrollWidth,
            overflowX: getComputedStyle(tableScroller).overflowX,
            overscrollBehaviorX: getComputedStyle(tableScroller).overscrollBehaviorX,
          },
        };
      });

      expect(result.stylesheets).toEqual(["eager", "authenticated"]);
      expect(result.defaultTranscript.headings).toEqual([18, 15, 14.0004]);
      expect(result.largeTranscript.headings).toEqual([19, 16, 15.1671]);
      expect(result.proposalHeadings).toEqual([11, 11, 10]);

      expect(result.defaultTranscript.prose).toBe(12);
      expect(result.defaultTranscript.inlineCode).toBe(12);
      expect(result.defaultTranscript.fencedCode).toBe(12);
      expect(result.highlightedDefault.fencedCode).toBe(12);

      expect(result.largeTranscript.prose).toBe(13);
      expect(result.largeTranscript.inlineCode).toBe(13);
      expect(result.largeTranscript.fencedCode).toBe(13);
      expect(result.highlightedLarge.fencedCode).toBe(13);

      expect(result.table.shellWidth).toBeLessThanOrEqual(result.table.rootWidth);
      expect(result.table.scrollWidth).toBeGreaterThan(result.table.clientWidth);
      expect(result.table.overflowX).toBe("auto");
      expect(result.table.overscrollBehaviorX).toBe("none");
    } finally {
      await page.close();
    }
  }, 60_000);
});

function renderFixtureHtml(): string {
  const fallback = renderToStaticMarkup(createElement(MarkdownBody, {
    content: MARKDOWN_FIXTURE,
  }));
  const highlighted = renderToStaticMarkup(createElement(MarkdownBody, {
    content: MARKDOWN_FIXTURE,
    renderCodeBlock: ({ code, language }) => createElement(CodeBlock, {
      code,
      label: language,
      tokens: [[{ content: code }]],
    }),
  }));
  const proposal = renderToStaticMarkup(createElement(PlanMarkdownBody, {
    content: PROPOSAL_FIXTURE,
    presentation: "proposal",
  }));
  const sheetPath = `/@fs${AUTHENTICATED_CSS}`;

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <link rel="stylesheet" data-sheet="eager" href="/src/index.css" />
        <link rel="stylesheet" data-sheet="authenticated" href="${sheetPath}" />
        <style>
          body { overflow: auto; padding: 24px; }
          section { margin-bottom: 24px; width: 320px; }
          .default-scale {
            --text-ui: 11px;
            --text-ui-sm: 10px;
            --text-chat: 10px;
            --text-chat--line-height: 18px;
            --text-title: 18px;
            --prose-text-size: 12px;
            --prose-text-line-height: 20px;
          }
          .large-scale {
            --text-ui: 12px;
            --text-ui-sm: 11px;
            --text-chat: 11px;
            --text-chat--line-height: 19px;
            --text-title: 19px;
            --prose-text-size: 13px;
            --prose-text-line-height: 21px;
          }
          .proposal-scale {
            --text-ui: 11px;
            --text-ui-sm: 10px;
            --text-chat: 10px;
            --text-chat--line-height: 18px;
            --text-title: 18px;
          }
        </style>
      </head>
      <body>
        <section id="ordinary-default" class="default-scale">${fallback}</section>
        <section id="ordinary-large" class="large-scale">${fallback}</section>
        <section id="highlighted-default" class="default-scale">${highlighted}</section>
        <section id="highlighted-large" class="large-scale">${highlighted}</section>
        <section id="proposal-default" class="proposal-scale">${proposal}</section>
      </body>
    </html>`;
}

function fixtureRoute(html: string): Plugin {
  return {
    name: "markdown-cascade-fixture",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url !== "/__markdown-cascade") {
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
