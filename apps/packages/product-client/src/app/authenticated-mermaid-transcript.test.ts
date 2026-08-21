import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import {
  MERMAID_FLOWCHART,
  MERMAID_SECOND,
} from "./authenticated-mermaid-transcript-content";

const FIXTURE_VITE_CONFIG = fileURLToPath(
  new URL("../../qualification/mermaid-transcript/vite.config.ts", import.meta.url),
);

let viteServer: ViteDevServer;
let browser: Browser;
let fixtureUrl: string;

beforeAll(async () => {
  viteServer = await createServer({
    configFile: FIXTURE_VITE_CONFIG,
    logLevel: "silent",
  });
  await viteServer.listen();
  const baseUrl = viteServer.resolvedUrls?.local[0];
  if (!baseUrl) {
    throw new Error("Mermaid transcript fixture did not receive a Vite URL.");
  }
  fixtureUrl = baseUrl;
  browser = await chromium.launch({ channel: "chrome", headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await viteServer?.close();
}, 60_000);

describe("authenticated mermaid transcript diagrams", () => {
  it("fits the chat column, maps theme tokens, and copies mermaid source", async () => {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 1200 },
    });
    const pageErrors: string[] = [];
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    try {
      page.on("pageerror", (error) => {
        pageErrors.push(error.message);
      });
      page.on("requestfailed", (request) => {
        pageErrors.push(`${request.failure()?.errorText ?? "failed"}: ${request.url()}`);
      });
      page.on("console", (message) => {
        if (message.type() === "error") {
          pageErrors.push(message.text());
        }
      });
      await page.goto(fixtureUrl, { waitUntil: "networkidle" });
      await page.waitForFunction(() => {
        const columns = document.querySelectorAll("[data-transcript-column='true']");
        return columns.length === 2
          && Array.from(columns).every((column) =>
            column.querySelectorAll("[data-mermaid-diagram='true'] svg").length === 2
          );
      }, undefined, { timeout: 45_000 }).catch((error: unknown) => {
        throw new Error(
          `Mermaid diagrams did not mount. Page errors: ${pageErrors.join(" | ") || "none"}. ${String(error)}`,
        );
      });

      const overflow = await page.evaluate(() => {
        const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
        const measure = (parentId: string) => {
          const parent = document.getElementById(parentId);
          const column = parent?.querySelector<HTMLElement>("[data-transcript-column='true']");
          if (!parent || !column) {
            throw new Error(`${parentId} transcript column was not rendered.`);
          }
          const shells = Array.from(
            column.querySelectorAll<HTMLElement>("[data-markdown-code-block='true']"),
          );
          const diagrams = Array.from(
            column.querySelectorAll<HTMLElement>("[data-mermaid-diagram='true']"),
          );
          const proseAfterFirstDiagram = Array.from(column.querySelectorAll("p")).find((node) =>
            node.textContent?.includes("Next steps"),
          );
          if (shells.length !== 2 || diagrams.length !== 2 || !proseAfterFirstDiagram) {
            throw new Error(`${parentId} did not render two diagrams and prose.`);
          }
          return {
            parentWidth: parent.getBoundingClientRect().width,
            columnWidth: column.getBoundingClientRect().width,
            shellWidths: shells.map((shell) => shell.getBoundingClientRect().width),
            diagramWidths: diagrams.map((diagram) => diagram.getBoundingClientRect().width),
            proseAfterFirstTop: proseAfterFirstDiagram.getBoundingClientRect().top,
            firstShellBottom: shells[0]!.getBoundingClientRect().bottom,
          };
        };
        return {
          rem,
          narrow: measure("narrow-parent"),
          desktop: measure("desktop-parent"),
        };
      });

      expect(overflow.narrow.parentWidth).toBeCloseTo(320, 0);
      expect(overflow.desktop.parentWidth / overflow.rem).toBeCloseTo(48, 0);
      for (const column of [overflow.narrow, overflow.desktop]) {
        expect(column.columnWidth).toBeLessThanOrEqual(column.parentWidth + 0.5);
        for (const width of [...column.shellWidths, ...column.diagramWidths]) {
          expect(width).toBeLessThanOrEqual(column.columnWidth + 0.5);
        }
        expect(column.firstShellBottom).toBeLessThanOrEqual(column.proseAfterFirstTop + 0.5);
      }

      const lightTheme = await page.evaluate(readThemeOnSvg);
      expect(lightTheme.mode).toBe("light");
      expect(lightTheme.foreground).not.toBe("");
      expect(lightTheme.background).not.toBe("");
      expect(lightTheme.svgMarkup).toContain(lightTheme.foreground);
      expect(lightTheme.svgMarkup).toContain(lightTheme.background);

      await page.evaluate(() => {
        document.documentElement.dataset.mode = "dark";
      });
      await page.waitForFunction((lightForeground) => {
        const svg = document.querySelector("[data-mermaid-diagram='true'] svg");
        const darkForeground = getComputedStyle(document.documentElement)
          .getPropertyValue("--color-foreground")
          .trim();
        const markup = svg?.outerHTML ?? "";
        return Boolean(
          svg
          && darkForeground
          && darkForeground !== lightForeground
          && markup.includes(darkForeground),
        );
      }, lightTheme.foreground, { timeout: 20_000 });

      const darkTheme = await page.evaluate(readThemeOnSvg);
      expect(darkTheme.mode).toBe("dark");
      expect(darkTheme.foreground).not.toBe(lightTheme.foreground);
      expect(darkTheme.svgMarkup).toContain(darkTheme.foreground);
      expect(darkTheme.svgMarkup).toContain(darkTheme.background);

      const copied = await page.evaluate(async () => {
        const writes: string[] = [];
        const clipboard = navigator.clipboard;
        if (clipboard) {
          clipboard.writeText = async (value: string) => {
            writes.push(value);
          };
        }
        document.execCommand = ((command: string) => {
          if (command !== "copy") {
            return false;
          }
          const selected = document.getSelection()?.toString() ?? "";
          if (selected) {
            writes.push(selected);
          }
          return writes.length > 0;
        }) as typeof document.execCommand;
        const button = document.querySelector<HTMLButtonElement>(
          "#narrow-parent [aria-label='Copy code']",
        );
        button?.click();
        await new Promise((resolve) => setTimeout(resolve, 50));
        return writes[0] ?? "";
      });
      expect(copied).toBe(MERMAID_FLOWCHART);
      expect(copied).not.toContain("<svg");
      expect(copied).not.toBe(MERMAID_SECOND);
    } finally {
      await page.close();
    }
  }, 60_000);
});

function readThemeOnSvg() {
  const css = getComputedStyle(document.documentElement);
  const svg = document.querySelector("[data-mermaid-diagram='true'] svg");
  if (!svg) {
    throw new Error("Mermaid SVG was not rendered.");
  }
  return {
    mode: document.documentElement.dataset.mode ?? "",
    foreground: css.getPropertyValue("--color-foreground").trim(),
    background: css.getPropertyValue("--color-background").trim(),
    svgMarkup: svg.outerHTML,
  };
}
