import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TEXT_SIZE_TOKEN_IDS, twMerge } from "@proliferate/ui/utils/tw-merge";
import { DEFAULT_UI_TEXT_SCALE_CSS_VARIABLES } from "./appearance";

/**
 * Drift lock between UI_FONT_SCALES (appearance.ts) and the design-package
 * @theme token defaults.
 *
 * applyAppearancePreference() re-writes every --text-* token on :root at boot
 * from the table, so the CSS @theme values are dead at runtime in desktop —
 * but they ARE what Tailwind bakes into utilities and what renders before the
 * preference applies (and everywhere in apps/web). If the two ever disagree,
 * what ships in CSS silently differs from what users actually see. This test
 * parses the CSS sources from disk and pins them to the table's default
 * preset exactly.
 */

const testDir = dirname(fileURLToPath(import.meta.url));
const designCssDir = resolve(testDir, "../../../../../packages/design/src/css");

// Cascade order matters: desktop.css imports dom.css on its first line, so
// desktop.css's own @theme declarations override dom.css's.
const DESIGN_CSS_SOURCES = ["dom.css", "desktop.css"] as const;

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Returns the contents of every top-level `@theme` block (incl. `@theme inline`). */
function extractThemeBlocks(css: string): string[] {
  const blocks: string[] = [];
  const pattern = /@theme[^{]*\{/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (index < css.length && depth > 0) {
      const char = css[index];
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      index += 1;
    }
    blocks.push(css.slice(start, index - 1));
  }
  return blocks;
}

function parseThemeTextTokens(css: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const block of extractThemeBlocks(stripCssComments(css))) {
    const declarationPattern = /(--text-[a-z0-9-]+)\s*:\s*([^;]+);/g;
    let declaration: RegExpExecArray | null;
    while ((declaration = declarationPattern.exec(block)) !== null) {
      const property = declaration[1];
      const value = declaration[2];
      if (property && value) {
        tokens[property] = value.trim();
      }
    }
  }
  return tokens;
}

describe("design-package @theme --text-* tokens", () => {
  const tokensByFile = DESIGN_CSS_SOURCES.map((file) => ({
    file,
    tokens: parseThemeTextTokens(readFileSync(resolve(designCssDir, file), "utf8")),
  }));

  it("declares no conflicting values for tokens present in multiple files", () => {
    const seen = new Map<string, { file: string; value: string }>();
    for (const { file, tokens } of tokensByFile) {
      for (const [property, value] of Object.entries(tokens)) {
        const previous = seen.get(property);
        if (previous) {
          expect(
            { property, file, value },
          ).toEqual({ property, file, value: previous.value });
        } else {
          seen.set(property, { file, value });
        }
      }
    }
  });

  it("matches DEFAULT_UI_TEXT_SCALE_CSS_VARIABLES exactly (no table↔CSS drift)", () => {
    const merged: Record<string, string> = {};
    for (const { tokens } of tokensByFile) {
      Object.assign(merged, tokens);
    }
    expect(merged).toEqual(DEFAULT_UI_TEXT_SCALE_CSS_VARIABLES);
  });

  it("registers every custom size token with the configured twMerge (or merges drop it)", () => {
    // tailwind-merge classifies unknown text-* classes as colors and deletes
    // them on conflict; every custom font-size token must be in the shared
    // config's list. Stock Tailwind sizes (xs/sm/base/lg/xl) are known to
    // tailwind-merge already and are exempt.
    const stockSizes = new Set(["xs", "sm", "base", "lg", "xl"]);
    const customIds = Object.keys(DEFAULT_UI_TEXT_SCALE_CSS_VARIABLES)
      .filter((name) => !name.endsWith("--line-height"))
      .map((name) => name.replace(/^--text-/, ""))
      .filter((id) => !stockSizes.has(id));
    for (const id of customIds) {
      expect(TEXT_SIZE_TOKEN_IDS).toContain(id);
    }
    // and the merge must actually preserve them against a color conflict
    for (const id of customIds) {
      expect(twMerge(`text-${id} text-muted-foreground`)).toBe(`text-${id} text-muted-foreground`);
    }
  });
});
