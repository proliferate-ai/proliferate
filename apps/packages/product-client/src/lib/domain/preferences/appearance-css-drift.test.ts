import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { typography } from "@proliferate/design/tokens";
import { TEXT_SIZE_TOKEN_IDS, twMerge } from "@proliferate/ui/utils/tw-merge";
import {
  DEFAULT_APPEARANCE_SIZE_ID,
  DEFAULT_UI_GLYPH_SCALE_CSS_VARIABLES,
  DEFAULT_UI_TEXT_SCALE_CSS_VARIABLES,
  READABLE_CODE_FONT_SCALES,
} from "#product/lib/domain/preferences/appearance";

const testDir = dirname(fileURLToPath(import.meta.url));
const designDir = resolve(testDir, "../../../../../design");
const designCssDir = resolve(designDir, "src/css");
const generatedThemeCss = readFileSync(resolve(designDir, "dist/theme.css"), "utf8");
const domCss = readFileSync(resolve(designCssDir, "dom.css"), "utf8");
const productCss = readFileSync(resolve(designCssDir, "product.css"), "utf8");

const EXPECTED_TEXT_SIZE_TOKEN_IDS = [
  "ui-sm",
  "ui",
  "chat",
  "composer",
  "body",
  "workspace-title",
  "body-emphasis",
  "heading",
  "title",
  "hero",
  "sidebar-nav",
  "sidebar-row",
  "sidebar-brand",
  "message",
  "readable-code",
] as const;

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Returns the contents of every top-level `@theme` block. */
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

function parseThemeDeclarations(css: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  for (const block of extractThemeBlocks(stripCssComments(css))) {
    const declarationPattern = /(--[a-z0-9-]+)\s*:\s*([^;]+);/g;
    let declaration: RegExpExecArray | null;
    while ((declaration = declarationPattern.exec(block)) !== null) {
      const property = declaration[1];
      const value = declaration[2];
      if (property && value) {
        declarations[property] = value.trim();
      }
    }
  }
  return declarations;
}

function resolveGeneratedReference(
  value: string,
  declarations: Record<string, string>,
  seen = new Set<string>(),
): string {
  const reference = value.match(/^var\((--[a-z0-9-]+)\)$/)?.[1];
  if (!reference) return value;
  if (seen.has(reference)) throw new Error(`Generated theme reference cycle at ${reference}`);
  const referencedValue = declarations[reference];
  if (referencedValue === undefined) {
    throw new Error(`Generated theme reference ${reference} is not declared`);
  }
  return resolveGeneratedReference(
    referencedValue,
    declarations,
    new Set([...seen, reference]),
  );
}

function toPx(value: string): number {
  if (value.endsWith("rem")) return Number.parseFloat(value) * 16;
  if (value.endsWith("px")) return Number.parseFloat(value);
  throw new Error(`Unsupported CSS length in text-scale variable: ${value}`);
}

function cssRole(role: string): string {
  return role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function readRule(css: string, selector: RegExp): string | undefined {
  return stripCssComments(css).match(selector)?.[1];
}

const themeDeclarations = parseThemeDeclarations(generatedThemeCss);
const generatedTextDeclarations = Object.fromEntries(
  Object.entries(themeDeclarations).filter(([property]) => property.startsWith("--text-")),
);

describe("generated design-package semantic text tokens", () => {
  it("matches the complete appearance default table after resolving tracking aliases", () => {
    const actual = Object.fromEntries(
      Object.keys(DEFAULT_UI_TEXT_SCALE_CSS_VARIABLES).map((property) => {
        const generatedValue = themeDeclarations[property];
        expect(generatedValue, `${property} missing from generated theme`).toBeDefined();
        return [
          property,
          resolveGeneratedReference(generatedValue as string, themeDeclarations),
        ];
      }),
    );

    expect(actual).toEqual(DEFAULT_UI_TEXT_SCALE_CSS_VARIABLES);
    expect(actual["--text-workspace-title"]).toBe("14px");
    expect(actual["--text-workspace-title--line-height"]).toBe("21px");
    expect(actual["--text-composer"]).toBe("13px");
    expect(actual["--text-composer--line-height"]).toBe("20px");
  });

  it("keeps authored CSS free of global theme declarations", () => {
    expect(extractThemeBlocks(domCss)).toEqual([]);
    expect(extractThemeBlocks(productCss)).toEqual([]);
  });

  it("matches the semantic tokens.ts typography table across all three metrics", () => {
    const roleIds = Object.keys(typography.size) as Array<keyof typeof typography.size>;
    for (const id of roleIds) {
      const role = cssRole(id);
      const fontVariable = `--text-${role}`;
      const lineHeightVariable = `${fontVariable}--line-height`;
      const letterSpacingVariable = `${fontVariable}--letter-spacing`;
      const defaults = DEFAULT_UI_TEXT_SCALE_CSS_VARIABLES as Record<string, string>;

      expect({ token: fontVariable, px: typography.size[id] }).toEqual({
        token: fontVariable,
        px: toPx(defaults[fontVariable] as string),
      });
      expect({ token: lineHeightVariable, px: typography.lineHeight[id] }).toEqual({
        token: lineHeightVariable,
        px: toPx(defaults[lineHeightVariable] as string),
      });
      expect({
        token: letterSpacingVariable,
        value: resolveGeneratedReference(typography.letterSpacing[id], themeDeclarations),
      }).toEqual({
        token: letterSpacingVariable,
        value: defaults[letterSpacingVariable],
      });
    }
  });

  it("declares only the closed semantic font-size ids, including sanctioned aliases", () => {
    const generatedBaseIds = Object.keys(generatedTextDeclarations)
      .filter((property) => !property.endsWith("--line-height"))
      .filter((property) => !property.endsWith("--letter-spacing"))
      .filter((property) => `${property}--line-height` in generatedTextDeclarations)
      .map((property) => property.replace(/^--text-/, ""));

    expect([...generatedBaseIds].sort())
      .toEqual([...EXPECTED_TEXT_SIZE_TOKEN_IDS].sort());
    for (const removedId of ["xs", "sm", "base", "lg", "xl"]) {
      expect(generatedBaseIds).not.toContain(removedId);
    }
  });

  it("registers the exact semantic size set with twMerge", () => {
    expect(TEXT_SIZE_TOKEN_IDS).toEqual(EXPECTED_TEXT_SIZE_TOKEN_IDS);
    for (const id of EXPECTED_TEXT_SIZE_TOKEN_IDS) {
      expect(twMerge(`text-${id} text-muted-foreground`))
        .toBe(`text-${id} text-muted-foreground`);
    }
  });
});

describe("right-panel tab typography", () => {
  const rightPanelRule = readRule(
    productCss,
    /\.right-panel-tab-system\s*\{([\s\S]*?)\}/,
  );

  it("consumes compact UI, control-weight, and control-icon tokens", () => {
    expect(rightPanelRule).toContain("font-size: var(--text-ui-sm);");
    expect(rightPanelRule).toContain(
      "line-height: var(--text-ui-sm--line-height);",
    );
    expect(rightPanelRule).toContain("font-weight: var(--font-weight-control);");
    expect(rightPanelRule).not.toContain("--workspace-shell-tab-font-size");
    expect(rightPanelRule).not.toContain("--workspace-shell-tab-line-height");
    expect(rightPanelRule).not.toContain("--workspace-shell-tab-font-weight");

    const tabIconRule = readRule(
      productCss,
      /\.right-panel-tab-system \.ui-tab-system-tab__icon,\s*\.right-panel-tab-system \.ui-icon\s*\{([\s\S]*?)\}/,
    );
    expect(tabIconRule).toContain("width: var(--icon-control);");
    expect(tabIconRule).toContain("height: var(--icon-control);");
    expect(tabIconRule).not.toContain("var(--icon-paired)");

    const rightPanelActionIconRule = readRule(
      productCss,
      /\.right-panel-tab-system \.workspace-shell-icon-button \.ui-icon\s*\{([\s\S]*?)\}/,
    );
    expect(rightPanelActionIconRule).toContain("width: var(--icon-control);");
    expect(rightPanelActionIconRule).toContain("height: var(--icon-control);");
    expect(rightPanelActionIconRule).not.toContain("var(--icon-paired)");
    expect(productCss).toContain("width: var(--icon-status);");
    expect(rightPanelRule).toContain("--right-panel-tab-close-target-size: 1rem;");
    expect(productCss).not.toContain("--right-panel-tab-font-size");
    expect(productCss).not.toContain("--right-panel-tab-line-height");
    expect(productCss).not.toContain("--right-panel-tab-font-weight");
  });
});

describe("appearance scaling CSS defaults", () => {
  const defaultCodeScale = READABLE_CODE_FONT_SCALES[DEFAULT_APPEARANCE_SIZE_ID];

  it("keeps default code CSS aligned with the readable-code ladder", () => {
    expect(themeDeclarations["--diffs-font-size"]).toBe(defaultCodeScale.diffsFontSize);
    expect(themeDeclarations["--readable-code-font-size"]).toBe(defaultCodeScale.codeFontSize);
  });

  it("declares the approved semantic vector-glyph tiers", () => {
    for (const [property, value] of Object.entries(DEFAULT_UI_GLYPH_SCALE_CSS_VARIABLES)) {
      expect(themeDeclarations[property]).toBe(value);
      expect(domCss).toContain(`@utility ${property.replace("--", "")}`);
    }
  });

  it("loads Geist through the generated font token and gives untyped text the UI fallback", () => {
    expect(themeDeclarations["--font-sans"]).toMatch(/^"Geist",/);
    const rootRule = readRule(domCss, /:root\s*\{([\s\S]*?)\}/);
    expect(rootRule).toContain("font-family: var(--font-sans);");

    const bodyRule = readRule(domCss, /body\s*\{([\s\S]*?)\}/);
    expect(bodyRule).toContain("font-size: var(--text-ui);");
    expect(bodyRule).toContain("line-height: var(--text-ui--line-height);");
  });

  it("shares semantic caret and selection colors across text-entry renderers", () => {
    expect(themeDeclarations["--color-text-caret"]).toBe("var(--color-foreground)");
    expect(themeDeclarations["--color-text-selection"])
      .toBe("var(--color-highlight, var(--color-input))");
    expect(domCss).toContain("caret-color: var(--color-text-caret);");
    expect(domCss).toContain("background-color: var(--color-text-selection);");
    expect(productCss).toContain(".chat-selection-root ::selection");
    expect(productCss).toContain("background-color: var(--color-text-selection);");
  });

  it("keeps the spinner inline box stationary while its SVG owns motion", () => {
    const spinnerRule = readRule(
      domCss,
      /\.proliferate-spinner\s*\{([\s\S]*?)\}/,
    );
    expect(spinnerRule).toContain("animation: none !important;");
  });
});
