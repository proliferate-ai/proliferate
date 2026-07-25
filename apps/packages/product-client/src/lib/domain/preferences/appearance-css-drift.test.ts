import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ICON_BUTTON_SIZE_TOKEN_IDS,
  TEXT_SIZE_TOKEN_IDS,
  twMerge,
} from "@proliferate/ui/utils/tw-merge";
import { typography } from "@proliferate/design/tokens";
import {
  DEFAULT_APPEARANCE_SIZE_ID,
  DEFAULT_UI_GLYPH_SCALE_CSS_VARIABLES,
  DEFAULT_UI_TEXT_SCALE_CSS_VARIABLES,
  READABLE_CODE_FONT_SCALES,
} from "#product/lib/domain/preferences/appearance";

/**
 * Drift lock between UI_FONT_SCALES (appearance.ts) and the GENERATED design
 * token authority.
 *
 * Token VALUES now live only in apps/packages/design/src/tokens.ts and are
 * projected into dist/theme.css by scripts/generate-theme.mjs. dom.css and
 * product.css must therefore contain no global token declarations at all, and
 * the ladder this file locks is the generated one.
 *
 * applyAppearancePreference() re-writes every --text-* token on :root at boot
 * from the appearance table, so the generated defaults are what Tailwind bakes
 * into utilities and what renders before the preference applies (and everywhere
 * in apps/web). If the two disagree, shipped CSS silently differs from what
 * users see.
 */

const testDir = dirname(fileURLToPath(import.meta.url));
const designDir = resolve(testDir, "../../../../../design");
const designCssDir = resolve(designDir, "src/css");
const generatedThemeCss = readFileSync(resolve(designDir, "dist/theme.css"), "utf8");
const domCss = readFileSync(resolve(designCssDir, "dom.css"), "utf8");
const productCss = readFileSync(resolve(designCssDir, "product.css"), "utf8");

/**
 * The closed semantic font-size vocabulary, incl. the two sanctioned aliases.
 *
 * This is EVERY emitted `--text-*` font-size id, not the subset that also has a
 * `--line-height` sibling: `chat-meta` is derived (calc off --text-chat) and has
 * no sibling metrics, but Tailwind still emits a `.text-chat-meta` utility, so
 * omitting it from this set is what let it go unregistered with twMerge.
 */
const EXPECTED_TEXT_SIZE_TOKEN_IDS = [
  "ui-sm",
  "ui",
  "chat",
  "chat-meta",
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

/** Follows named token aliases (e.g. --tracking-tight) to their literal value. */
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
  return resolveGeneratedReference(referencedValue, declarations, new Set([...seen, reference]));
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
        return [property, resolveGeneratedReference(generatedValue as string, themeDeclarations)];
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

  /**
   * Every emitted font-size id. Derived from the generated theme WITHOUT
   * requiring a `--line-height` sibling: that filter is what previously hid
   * `--text-chat-meta` (a calc off --text-chat with no sibling metrics) from
   * both assertions below, even though Tailwind emits `.text-chat-meta`.
   */
  const generatedFontSizeIds = Object.keys(generatedTextDeclarations)
    .filter((property) => !property.endsWith("--line-height"))
    .filter((property) => !property.endsWith("--letter-spacing"))
    .map((property) => property.replace(/^--text-/, ""));

  it("declares only the closed semantic font-size ids, including sanctioned aliases", () => {
    expect([...generatedFontSizeIds].sort()).toEqual([...EXPECTED_TEXT_SIZE_TOKEN_IDS].sort());
    for (const removedId of ["xs", "sm", "base", "lg", "xl"]) {
      expect(generatedFontSizeIds).not.toContain(removedId);
    }
  });

  it("registers every emitted font-size id with twMerge", () => {
    // Completeness against the GENERATED set, not against the constant's own
    // order: an id that ships a utility but is unknown to tailwind-merge is
    // classified as a text COLOR and silently dropped when a real color follows.
    expect([...TEXT_SIZE_TOKEN_IDS].sort()).toEqual([...generatedFontSizeIds].sort());
    expect(TEXT_SIZE_TOKEN_IDS).toEqual(EXPECTED_TEXT_SIZE_TOKEN_IDS);
    for (const id of generatedFontSizeIds) {
      expect(twMerge(`text-${id} text-muted-foreground`)).toBe(`text-${id} text-muted-foreground`);
    }
  });

  it("drops an unregistered size id, which is why the set must be complete", () => {
    // Guards the guard: proves the failure mode is real, so the completeness
    // assertion above cannot be dismissed as bookkeeping. An id twMerge does not
    // know is classified as a text COLOR and vanishes when a real color follows —
    // which is exactly what `text-chat-meta` did before it was registered.
    expect(TEXT_SIZE_TOKEN_IDS).not.toContain("not-a-registered-size");
    expect(twMerge("text-not-a-registered-size text-muted-foreground")).toBe(
      "text-muted-foreground",
    );
    expect(twMerge("text-chat-meta text-muted-foreground")).toBe(
      "text-chat-meta text-muted-foreground",
    );
  });

  it("registers every generated size-icon-button tier in twMerge's size group", () => {
    // The generated control-box utilities set BOTH width and height, so they
    // conflict with `size-*`, `h-*`, and `w-*` exactly as `size-5` does. Only
    // membership in the stock `size` group carries that conflict mapping.
    const generatedIconButtonSteps = [
      ...stripCssComments(generatedThemeCss).matchAll(
        /@utility size-icon-button-([a-z]+)\s*\{/g,
      ),
    ].map((match) => match[1]);

    expect(generatedIconButtonSteps.length).toBeGreaterThan(0);
    expect([...ICON_BUTTON_SIZE_TOKEN_IDS].sort()).toEqual([...generatedIconButtonSteps].sort());

    for (const step of generatedIconButtonSteps) {
      // A consumer override must WIN over a component's own box, not coexist
      // with it and lose on generated-CSS source order (which is what
      // ChromeWorkspaceTab's 20px close button did: Button's `h-7 w-7`
      // survived the merge and kept it at 28px).
      expect(twMerge(`h-7 w-7 rounded-full px-0 size-icon-button-${step}`)).toBe(
        `rounded-full px-0 size-icon-button-${step}`,
      );
      // And it must itself be overridable by a later stock box.
      expect(twMerge(`size-icon-button-${step} size-6`)).toBe("size-6");
    }
  });
});

describe("right-panel tab typography", () => {
  const rightPanelRule = readRule(productCss, /\.right-panel-tab-system\s*\{([\s\S]*?)\}/);

  it("consumes compact UI, control-weight, and control-icon tokens", () => {
    expect(rightPanelRule).toContain("font-size: var(--text-ui-sm);");
    expect(rightPanelRule).toContain("line-height: var(--text-ui-sm--line-height);");
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

/**
 * [CHAT-01..04] pinned values from `ui-foundation-chat-addendum.md`'s RULED
 * block. These are visual-only retunes with no behavioural surface, so the
 * generated theme is the only place they can be regression-locked: without this,
 * a future edit could quietly restore the opaque composer card or drop the new
 * transcript measure tokens and every existing test would still pass.
 */
describe("chat retune tokens", () => {
  it("keeps the composer surface translucent over the app background", () => {
    // The exact ink is locked by the @theme half, which must carry a resolved
    // literal because color-mix() is illegal inside @theme: rgba(45,45,45,.96)
    // is Codex's input-surface role verbatim.
    expect(themeDeclarations["--color-composer-background"]).toBe("rgba(45, 45, 45, 0.96)");

    // The dark `:root` half is the authored color-mix() form of that same
    // value, and nothing in the generator ties the two spellings together — so
    // this derives the expected mix FROM the resolved literal above rather than
    // restating it. It fails both if dark drifts off the fallback and if anyone
    // restores an opaque single-color card, which is what shipped before this
    // retune.
    const [, red, green, blue, alpha] =
      /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(
        themeDeclarations["--color-composer-background"] as string,
      ) as RegExpExecArray;
    const expectedHex = [red, green, blue]
      .map((channel) => Number(channel).toString(16).padStart(2, "0"))
      .join("");
    const darkRoot = readRule(generatedThemeCss, /:root\s*\{([\s\S]*?)\n\}/);
    expect(darkRoot).toContain(
      `--color-composer-background: color-mix(in oklab, #${expectedHex} ${
        Number(alpha) * 100
      }%, transparent);`,
    );

    // Light was already translucent, so the addendum found no light-mode gap;
    // it keeps its shipped alpha because light is also the only mode carrying
    // the composer's blur, and raising it to dark's 96% would cancel that blur
    // rather than derive from it.
    const lightRoot = readRule(generatedThemeCss, /:root\[data-mode="light"\]\s*\{([\s\S]*?)\n\}/);
    expect(lightRoot).toContain("--color-composer-background: rgba(255, 255, 255, 0.864);");

    // The composer is the sole owner of the authored blur carve-out, and dark
    // deliberately opts out (WKWebView re-blurs the whole transcript on every
    // keystroke — see ChatComposerDock's PERF note).
    expect(themeDeclarations["--color-composer-backdrop-filter"]).toBe("none");
    expect(lightRoot).toContain("--color-composer-backdrop-filter: blur(16px);");
    const composerSurfaceRule = readRule(productCss, /\.chat-composer-surface\s*\{([\s\S]*?)\}/);
    expect(composerSurfaceRule).toContain("background-color: var(--color-composer-background);");
    expect(composerSurfaceRule).toContain("var(--color-composer-backdrop-filter)");
  });

  it("declares the adopted transcript measure and turn-rhythm tokens", () => {
    expect(themeDeclarations["--container-transcript-readable"]).toBe("40rem");
    expect(themeDeclarations["--container-transcript-wide"]).toBe("64rem");
    expect(themeDeclarations["--spacing-transcript-turn"]).toBe("0.75rem");
  });

  it("keeps the composer radius on its own 12px role", () => {
    // [RAD-04] conscious deviation from Codex's authored 20px, ruled to stay
    // 12px. rounded-xl resolves to the same length today, so the assertion that
    // matters is that the composer keeps a SEPARATE name to retune.
    expect(themeDeclarations["--radius-composer"]).toBe("0.75rem");
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

  it("uses the Codex native system stack through the generated font token and gives untyped text the UI fallback", () => {
    expect(themeDeclarations["--font-sans"]).toMatch(/^-apple-system, BlinkMacSystemFont,/);
    const rootRule = readRule(domCss, /:root\s*\{([\s\S]*?)\}/);
    expect(rootRule).toContain("font-family: var(--font-sans);");

    const bodyRule = readRule(domCss, /body\s*\{([\s\S]*?)\}/);
    expect(bodyRule).toContain("font-size: var(--text-ui);");
    expect(bodyRule).toContain("line-height: var(--text-ui--line-height);");
  });

  it("shares semantic caret and selection colors across text-entry renderers", () => {
    expect(themeDeclarations["--color-text-caret"]).toBe("var(--color-foreground)");
    expect(themeDeclarations["--color-text-selection"]).toBe(
      "var(--color-highlight, var(--color-input))",
    );
    expect(domCss).toContain("caret-color: var(--color-text-caret);");
    expect(domCss).toContain("background-color: var(--color-text-selection);");
    expect(productCss).toContain(".chat-selection-root ::selection");
    expect(productCss).toContain("background-color: var(--color-text-selection);");
  });

  it("keeps the spinner inline box stationary while its SVG owns motion", () => {
    const spinnerRule = readRule(domCss, /\.proliferate-spinner\s*\{([\s\S]*?)\}/);
    expect(spinnerRule).toContain("animation: none !important;");
  });
});
