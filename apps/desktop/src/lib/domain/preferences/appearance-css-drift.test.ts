import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TEXT_SIZE_TOKEN_IDS, twMerge } from "@proliferate/ui/utils/tw-merge";
import { typography } from "../../../../../packages/design/src/tokens";
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

// Cascade order matters: product.css imports dom.css on its first line, so
// product.css's own @theme declarations override dom.css's.
const DESIGN_CSS_SOURCES = ["dom.css", "product.css"] as const;

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

  it("matches the tokens.ts typography table that generates theme.css (no tokens↔table drift)", () => {
    // dom.css line 4 imports theme.css, which scripts/generate-theme.mjs
    // regenerates from tokens.ts (px ÷ 16 → rem) on every design build — that
    // file is what apps/web renders, but it is gitignored build output, so we
    // lock the SOURCE table instead. Every token in tokens.ts must equal the
    // appearance default preset, normalized to px at the 16px root the
    // generator assumes.
    const toPx = (value: string): number => {
      if (value.endsWith("rem")) return Number.parseFloat(value) * 16;
      if (value.endsWith("px")) return Number.parseFloat(value);
      throw new Error(`Unsupported CSS length in text-scale variable: ${value}`);
    };
    const defaults: Record<string, string> = DEFAULT_UI_TEXT_SCALE_CSS_VARIABLES;
    const tokenIds = Object.keys(typography.size) as Array<keyof typeof typography.size>;
    for (const id of tokenIds) {
      const fontVariable = `--text-${id}`;
      const lineHeightVariable = `--text-${id}--line-height`;
      expect(defaults[fontVariable], `${fontVariable} missing from appearance table`).toBeDefined();
      expect(defaults[lineHeightVariable], `${lineHeightVariable} missing from appearance table`).toBeDefined();
      expect(
        { token: fontVariable, px: typography.size[id] },
      ).toEqual({ token: fontVariable, px: toPx(defaults[fontVariable] as string) });
      expect(
        { token: lineHeightVariable, px: typography.lineHeight[id] },
      ).toEqual({ token: lineHeightVariable, px: toPx(defaults[lineHeightVariable] as string) });
    }
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
