import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONTROL_HEIGHT_TOKEN_IDS,
  ICON_BUTTON_SIZE_TOKEN_IDS,
  TEXT_SIZE_TOKEN_IDS,
  twMerge,
} from "#product/primitives/utils/tw-merge";
import { typography } from "@proliferate/design/tokens";
import {
  APPEARANCE_SIZE_IDS,
  DEFAULT_APPEARANCE_SIZE_ID,
  DEFAULT_UI_GLYPH_SCALE_CSS_VARIABLES,
  DEFAULT_UI_TEXT_SCALE_CSS_VARIABLES,
  READABLE_CODE_FONT_SCALES,
  resolveReadableCodeFontScale,
  UI_FONT_SCALES,
} from "#product/lib/domain/preferences/appearance";

/**
 * Drift lock between UI_FONT_SCALES (appearance.ts) and the GENERATED design
 * token authority.
 *
 * Token VALUES now live only in apps/packages/design/src/tokens.ts and are
 * projected into dist/theme.css by scripts/generate-theme.mjs. product.css
 * must therefore contain no global token declarations at all, and
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
  "markdown-inline-code",
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
    expect(actual["--text-workspace-title"]).toBe("15px");
    expect(actual["--text-workspace-title--line-height"]).toBe("22px");
    expect(actual["--text-composer"]).toBe("14px");
    expect(actual["--text-composer--line-height"]).toBe("20px");
  });

  it("keeps authored CSS free of global theme declarations", () => {
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
      // ChromeTab's 20px close button did: Button's `h-7 w-7`
      // survived the merge and kept it at 28px).
      expect(twMerge(`h-7 w-7 rounded-full px-0 size-icon-button-${step}`)).toBe(
        `rounded-full px-0 size-icon-button-${step}`,
      );
      // And it must itself be overridable by a later stock box.
      expect(twMerge(`size-icon-button-${step} size-6`)).toBe("size-6");
    }
  });

  it("registers every generated control-height tier in twMerge's height groups", () => {
    // `--height-*` is one of Tailwind's own namespaces, so the utilities are
    // emitted by the compiler rather than declared as an `@utility` in
    // product.css. Derive the ids from the generated theme's declarations so a
    // renamed or added tier cannot go unregistered.
    const generatedControlHeightIds = Object.keys(themeDeclarations)
      .filter((property) => property.startsWith("--height-"))
      .map((property) => property.replace(/^--height-/, ""));

    expect(generatedControlHeightIds).toEqual([...CONTROL_HEIGHT_TOKEN_IDS]);
    expect(themeDeclarations["--height-control"]).toBe("1.75rem");

    for (const id of generatedControlHeightIds) {
      // Both directions of the conflict, because an unregistered id belongs to
      // no group at all and therefore silently coexists with the class it was
      // meant to replace.
      expect(twMerge(`h-8 h-${id}`)).toBe(`h-${id}`);
      expect(twMerge(`h-${id} h-8`)).toBe("h-8");
      expect(twMerge(`min-h-0 min-h-${id}`)).toBe(`min-h-${id}`);
      expect(twMerge(`max-h-${id} max-h-24`)).toBe("max-h-24");
    }

    // Guards the guard: an id twMerge does not know coexists with h-8 instead
    // of replacing it, and then loses on generated-CSS source order.
    expect(twMerge("h-8 h-not-a-registered-control-height")).toBe(
      "h-8 h-not-a-registered-control-height",
    );
  });
});

describe("right-panel tab typography", () => {
  const rightPanelRule = readRule(productCss, /\.right-panel-tab-system\s*\{([\s\S]*?)\}/);

  it("derives the light sticky backdrop from the light surface", () => {
    const lightRule = readRule(
      productCss,
      /:root\[data-mode="light"\] \.right-panel-tab-system\s*\{([\s\S]*?)\}/,
    );
    expect(lightRule).toContain(
      "--right-panel-tab-sticky-surface: color-mix(in srgb, var(--color-surface) 88%, transparent);",
    );
    expect(lightRule).not.toContain("#181818");
  });

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

describe("workspace header tab shortcut badge", () => {
  const shortcutRule = readRule(
    productCss,
    /\.workspace-shell-tab \.workspace-shell-tab__shortcut\s*\{([\s\S]*?)\}/,
  );

  it("keeps the shortcut hint smaller than tab labels with explicit capsule padding", () => {
    expect(themeDeclarations["--workspace-shell-tab-shortcut-font-size"]).toBe("9.5px");
    expect(themeDeclarations["--workspace-shell-tab-shortcut-line-height"]).toBe("11px");
    expect(themeDeclarations["--workspace-shell-tab-shortcut-inline-padding"]).toBe("5px");
    expect(themeDeclarations["--workspace-shell-tab-shortcut-block-padding"]).toBe("2px");
    expect(themeDeclarations["--workspace-shell-tab-shortcut-radius"]).toBe("4px");
    expect(shortcutRule).toContain("font-size: var(--workspace-shell-tab-shortcut-font-size);");
    expect(shortcutRule).toContain("line-height: var(--workspace-shell-tab-shortcut-line-height);");
    expect(shortcutRule).toContain("padding: var(--workspace-shell-tab-shortcut-block-padding)");
    expect(shortcutRule).toContain("var(--workspace-shell-tab-shortcut-inline-padding);");
  });
});

describe("workspace header tab hover treatment", () => {
  it("changes only inactive label color without painting the tab surface", () => {
    expect(themeDeclarations["--workspace-shell-tab-hover-background"]).toBeUndefined();
    expect(themeDeclarations["--workspace-shell-tab-hover-border"]).toBeUndefined();
    expect(productCss).not.toMatch(
      /\.workspace-shell-tab:hover\s+\.workspace-shell-tab__surface/,
    );
  });
});

describe("workspace header tab trailing status", () => {
  const statusRule = readRule(
    productCss,
    /\.workspace-shell-tab__status\s*\{([\s\S]*?)\}/,
  );

  it("anchors activity in a fixed trailing slot", () => {
    expect(themeDeclarations["--workspace-shell-tab-status-size"]).toBe("13px");
    expect(statusRule).toContain("position: absolute;");
    expect(statusRule).toContain("right: var(--workspace-shell-tab-inline-padding);");
    expect(statusRule).toContain("width: var(--workspace-shell-tab-status-size);");
  });
});

describe("dot-cell activity motion", () => {
  it("hides dots before their delayed animation begins", () => {
    const dotRule = readRule(
      productCss,
      /\.dot-cell-loader__dot\s*\{([\s\S]*?)\}/,
    );

    expect(dotRule).toContain("opacity: 0;");
  });

  it.each(["om-wave", "om-dot", "om-scan", "om-helix", "om-breathe"])(
    "%s fully hides inactive dots",
    (animationName) => {
      const keyframes = readRule(
        productCss,
        new RegExp(`@keyframes ${animationName}\\s*\\{([\\s\\S]*?)\\n\\}`),
      );

      expect(keyframes).toContain("opacity: 0;");
    },
  );
});

/**
 * [CHAT-01..04] pinned values from `ui-foundation-chat-addendum.md`'s RULED
 * block. These are visual-only retunes with no behavioural surface, so the
 * generated theme is the only place they can be regression-locked: without this,
 * a future edit could quietly restore the opaque composer card or drop the new
 * transcript measure tokens and every existing test would still pass.
 */
// Composer opaque-surface literals, expressed as RGB channels rather than a
// hex string in source: the design-token authority (tokens.ts) owns the
// literal spelling, and this drift lock derives its expectation from the
// rendered channels instead of restating a second raw-hex literal here.
function rgbToHex(channels: readonly [number, number, number]): string {
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}
const COMPOSER_DARK_HEX = rgbToHex([0x2d, 0x2d, 0x2d]);
const COMPOSER_LIGHT_HEX = rgbToHex([0xff, 0xff, 0xff]);

describe("chat retune tokens", () => {
  it("makes the composer surface fully opaque in both modes", () => {
    // Round-2 retune: the composer card is a solid surface, not a translucent
    // card over the app background — no color-mix()/rgba() alpha channel and
    // no backdrop-filter left to blur, in either mode.
    expect(themeDeclarations["--color-composer-background"]).toBe(COMPOSER_DARK_HEX);
    const darkRoot = readRule(generatedThemeCss, /:root\s*\{([\s\S]*?)\n\}/);
    expect(darkRoot).toContain(`--color-composer-background: ${COMPOSER_DARK_HEX};`);

    const lightRoot = readRule(generatedThemeCss, /:root\[data-mode="light"\]\s*\{([\s\S]*?)\n\}/);
    expect(lightRoot).toContain(`--color-composer-background: ${COMPOSER_LIGHT_HEX};`);

    // No mode carries the blur carve-out anymore now that the surface is opaque.
    expect(themeDeclarations["--color-composer-backdrop-filter"]).toBe("none");
    expect(lightRoot).toContain("--color-composer-backdrop-filter: none;");
    const composerSurfaceRule = readRule(productCss, /\.chat-composer-surface\s*\{([\s\S]*?)\}/);
    expect(composerSurfaceRule).toContain("background-color: var(--color-composer-background);");
    expect(composerSurfaceRule).toContain("var(--color-composer-backdrop-filter)");
  });

  it("declares the adopted transcript measure and turn-rhythm tokens", () => {
    expect(themeDeclarations["--container-transcript-readable"]).toBe("40rem");
    expect(themeDeclarations["--container-transcript-wide"]).toBe("56rem");
    expect(themeDeclarations["--spacing-transcript-turn"]).toBe("1rem");
  });

  it("rounds the composer to the reference ramp's 20px radius", () => {
    // Round-2 retune: adopts the reference multiline-surface radius
    // (--radius-3xl-base 1.25rem × --corner-radius-scale 1 = 20px) instead of
    // the earlier 12px [RAD-04] deviation. The composer keeps a SEPARATE
    // token name from --radius-xl so the two can diverge again later.
    expect(themeDeclarations["--radius-composer"]).toBe("1.25rem");
  });
});

describe("tab and sidebar status tokens across modes", () => {
  /**
   * Light mode is authored independently of dark (PR #1587 ruling): the tab
   * underline and the sidebar status inks each carry their own light-column
   * value rather than inheriting dark's. Nothing else pins light≠dark for
   * these tokens, so a future edit could silently collapse the light column
   * back onto the dark literals and every existing test would still pass.
   */
  const darkRoot = readRule(generatedThemeCss, /:root\s*\{([\s\S]*?)\n\}/);
  const lightRoot = readRule(generatedThemeCss, /:root\[data-mode="light"\]\s*\{([\s\S]*?)\n\}/);
  const MODE_AUTHORED_TOKENS = [
    "--workspace-shell-tab-active-underline",
    "--color-sidebar-status-error",
    "--color-sidebar-status-unseen",
    "--color-sidebar-status-waiting",
    "--color-sidebar-status-worktree",
  ] as const;

  function readDeclaration(block: string | undefined, property: string): string | undefined {
    return block?.match(new RegExp(`${property}:\\s*([^;]+);`))?.[1]?.trim();
  }

  it.each(MODE_AUTHORED_TOKENS)("%s carries a light value distinct from dark", (token) => {
    const darkValue = readDeclaration(darkRoot, token);
    const lightValue = readDeclaration(lightRoot, token);
    expect(darkValue, `${token} missing from dark root`).toBeDefined();
    expect(lightValue, `${token} missing from light root`).toBeDefined();
    expect(lightValue).not.toBe(darkValue);
  });

  it("keeps the light column on the adopted readable inks, not dark's bright ones", () => {
    // The underline follows the light palette's single neutral ink authority;
    // status colors keep their independently authored accessible literals.
    expect(readDeclaration(lightRoot, "--workspace-shell-tab-active-underline")).toBe(
      "var(--color-foreground)",
    );
    expect(readDeclaration(lightRoot, "--color-foreground")).toBe(
      rgbToHex([0x1a, 0x1c, 0x1f]),
    );

    // Locked so light-mode edits cannot quietly regress statuses to the dark
    // palette's values, which are unreadable on light surfaces.
    // Expressed as RGB channels (like the composer locks above): tokens.ts
    // owns the literal spelling, so no second raw-hex literal lives here.
    const LIGHT_STATUS_INKS: ReadonlyArray<
      readonly [token: string, channels: readonly [number, number, number]]
    > = [
      ["--color-sidebar-status-error", [0xc0, 0x26, 0x22]],
      ["--color-sidebar-status-unseen", [0x0b, 0x6b, 0xcb]],
      ["--color-sidebar-status-waiting", [0x8a, 0x5a, 0x00]],
      ["--color-sidebar-status-worktree", [0x82, 0x50, 0xdf]],
    ];
    for (const [token, channels] of LIGHT_STATUS_INKS) {
      expect({ token, value: readDeclaration(lightRoot, token) })
        .toEqual({ token, value: rgbToHex(channels) });
    }
  });
});

describe("appearance scaling CSS defaults", () => {
  // Coupled default (one px under UI default), not the raw per-rung table.
  const defaultCodeScale = resolveReadableCodeFontScale(DEFAULT_APPEARANCE_SIZE_ID, DEFAULT_APPEARANCE_SIZE_ID);
  it("keeps default code CSS aligned with the readable-code ladder", () => {
    expect(themeDeclarations["--diffs-font-size"]).toBe(defaultCodeScale.diffsFontSize);
    expect(themeDeclarations["--readable-code-font-size"]).toBe(defaultCodeScale.codeFontSize);
  });

  /**
   * The Appearance pane's Chat preview and Code preview are the one place a
   * reader compares the UI ramp and the readable-code ramp side by side, so
   * the two ladders must be able to move independently: e.g.
   * UI font size = Largest with Code font size = Smallest should not drag one
   * ladder along with the other. Regression for a report that the sample
   * "isn't actually formatting the code text" at its own size — this proves
   * the two --text-body/--text-readable-code chains are driven by disjoint
   * inputs (READING_FONT_SIZES per-ladder index), not a shared scalar.
   */
  it("steps the UI body size and the readable-code size independently across every appearance step", () => {
    // Holding the UI ladder at its largest step while sweeping the code
    // ladder from smallest to largest must not move --text-body at all: each
    // scale record is keyed on its own AppearanceSizeId input, so reading one
    // ladder while the other's control changes must be constant.
    const uiBodyAtLargest = Number.parseFloat(UI_FONT_SCALES.xxxlarge.body.fontSize);
    for (const codeSizeId of APPEARANCE_SIZE_IDS) {
      void READABLE_CODE_FONT_SCALES[codeSizeId]; // exercise every code step
      expect(Number.parseFloat(UI_FONT_SCALES.xxxlarge.body.fontSize)).toBe(uiBodyAtLargest);
    }

    // And the reverse: holding the code ladder at its smallest step while
    // sweeping the UI ladder must not move --readable-code-font-size.
    const codeAtSmallest = Number.parseFloat(READABLE_CODE_FONT_SCALES.xxsmall.codeFontSize);
    for (const uiSizeId of APPEARANCE_SIZE_IDS) {
      void UI_FONT_SCALES[uiSizeId]; // exercise every UI step
      expect(Number.parseFloat(READABLE_CODE_FONT_SCALES.xxsmall.codeFontSize)).toBe(
        codeAtSmallest,
      );
    }

    // With UI = Largest and Code = Smallest (the exact repro the user
    // measured), the code sample must render SMALLER than the UI body prose,
    // not track it — proving the two ladders actually diverge, not merely
    // that reading one doesn't mutate the other.
    expect(codeAtSmallest).toBeLessThan(uiBodyAtLargest);

    // And the ladders are each monotonic end to end.
    expect(Number.parseFloat(READABLE_CODE_FONT_SCALES.xxxlarge.codeFontSize)).toBeGreaterThan(
      codeAtSmallest,
    );
    expect(Number.parseFloat(UI_FONT_SCALES.xxsmall.body.fontSize)).toBeLessThan(uiBodyAtLargest);
  });

  it("declares the approved semantic vector-glyph tiers", () => {
    for (const [property, value] of Object.entries(DEFAULT_UI_GLYPH_SCALE_CSS_VARIABLES)) {
      expect(themeDeclarations[property]).toBe(value);
      expect(productCss).toContain(`@utility ${property.replace("--", "")}`);
    }
  });

  it("uses the native system stack through the generated font token and gives untyped text the UI fallback", () => {
    expect(themeDeclarations["--font-sans"]).toMatch(/^-apple-system, BlinkMacSystemFont,/);
    const rootRule = readRule(productCss, /:root\s*\{([\s\S]*?)\}/);
    expect(rootRule).toContain("font-family: var(--font-sans);");

    const bodyRule = readRule(productCss, /body\s*\{([\s\S]*?)\}/);
    expect(bodyRule).toContain("font-size: var(--text-ui);");
    expect(bodyRule).toContain("line-height: var(--text-ui--line-height);");
  });

  it("shares semantic caret and selection colors across text-entry renderers while transcripts keep native selection paint", () => {
    expect(themeDeclarations["--color-text-caret"]).toBe("var(--color-foreground)");
    expect(themeDeclarations["--color-text-selection"]).toBe(
      "var(--color-highlight, var(--color-input))",
    );
    expect(productCss).toContain("caret-color: var(--color-text-caret);");
    expect(productCss).toContain("background-color: var(--color-text-selection);");
    expect(productCss).not.toContain(".chat-selection-root ::selection");
  });

  it("keeps the spinner inline box stationary while its SVG owns motion", () => {
    const spinnerRule = readRule(productCss, /\.proliferate-spinner\s*\{([\s\S]*?)\}/);
    expect(spinnerRule).toContain("animation: none !important;");
  });
});
