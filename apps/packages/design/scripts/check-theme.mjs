/**
 * Independent validator for the generated token authority.
 *
 * This script never trusts `scripts/generate-theme.mjs`. It re-projects the
 * compiled authority (`dist/tokens.js`, `dist/motion.js`) through its own code
 * path, asserts the result is byte-identical to the committed generator output,
 * and then compiles that CSS through the real Tailwind pipeline so a malformed
 * `@theme`/`@utility` block fails the design build instead of a consumer app.
 *
 * It additionally pins the per-token provenance discipline, the motion values
 * shared with `motion.ts`, the React Native bridge shape, and the ownership
 * rule that global token VALUES only ever live in generated CSS — never in
 * `src/css/product.css`.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "tailwindcss";

import { motion } from "../dist/motion.js";
import { palette, paletteHexes } from "../dist/palette.js";
import { densityRungs, radiusRungs, rungAttributes, rungTokens } from "../dist/rungs.js";
import {
  colors,
  radius,
  themeTokens,
  timing,
  typography,
} from "../dist/tokens.js";
import { mobileShadow, mobileTheme } from "../dist/react-native.js";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const tokenEntries = Object.entries(themeTokens);

function assert(condition, message) {
  if (!condition) {
    console.error(`check-theme: ${message}`);
    process.exit(1);
  }
}

/* ------------------------------------------------------------------ *
 * 1. Independent re-projection + byte equality
 * ------------------------------------------------------------------ */

function project(mode) {
  const lines = [];
  for (const [name, value] of tokenEntries) {
    // Shadows carry a per-mode value only if the generated utility reads a
    // var() instead of an inlined literal — see the shadow note in
    // `generate-theme.mjs`. Re-projected here independently so the indirection
    // is pinned by this validator rather than trusted from the generator.
    if (name.startsWith("--shadow-")) {
      const twin = `--elevation-${name.slice("--shadow-".length)}`;
      if (mode === "theme") {
        lines.push(`  ${name}: var(${twin});`);
      } else {
        lines.push(`  ${twin}: ${value[mode]};`);
        lines.push(`  ${name}: var(${twin});`);
      }
      continue;
    }
    const rendered = mode === "theme" ? (value.themeFallback ?? value.dark) : value[mode];
    lines.push(`  ${name}: ${rendered};`);
  }
  return lines.join("\n");
}

function boxUtility(name, tokenName) {
  return [`@utility ${name} {`, `  width: var(--${tokenName});`, `  height: var(--${tokenName});`, "}"].join(
    "\n",
  );
}

function singleUtility(name, property) {
  return [`@utility ${name} {`, `  ${property}: var(--${name});`, "}"].join("\n");
}

const expectedUtilities = [
  "@utility rounded-inherit {\n  border-radius: inherit;\n}",
  ...["base", "raised", "sticky", "overlay", "popover", "toast", "tooltip", "top"].map((role) =>
    singleUtility(`z-${role}`, "z-index"),
  ),
  ...["hover", "enter", "exit", "disclosure", "panel", "pop", "emphasized"].map((role) =>
    singleUtility(`duration-${role}`, "transition-duration"),
  ),
  ...["out-quint", "pop", "spring", "standard", "linear"].map((role) =>
    singleUtility(`ease-${role}`, "transition-timing-function"),
  ),
  ...["sm", "md", "lg"].map((step) =>
    boxUtility(`size-icon-button-${step}`, `size-icon-button-${step}`),
  ),
];

// Non-default geometry rungs project as attribute-scoped override blocks that
// re-point the rung's tokens; the default rung is the token value itself and
// emits nothing. Re-projected here independently of the generator.
const expectedRungBlocks = [];
for (const [family, rungs] of [
  ["radius", radiusRungs],
  ["density", densityRungs],
]) {
  for (const [rungName, values] of Object.entries(rungs)) {
    if (rungName === "default") continue;
    const body = Object.entries(rungTokens[family])
      .map(([key, tokenName]) => `  ${tokenName}: ${values[key]};`)
      .join("\n");
    expectedRungBlocks.push(`:root[${rungAttributes[family]}="${rungName}"] {\n${body}\n}`);
  }
}

const expectedCss = [
  `@theme {\n  --color-*: initial;\n  --text-*: initial;\n\n${project("theme")}\n}`,
  `:root {\n${project("dark")}\n}`,
  `:root[data-mode="light"] {\n${project("light")}\n}`,
  [...expectedRungBlocks, ...expectedUtilities].join("\n\n"),
  `@keyframes proliferate-spinner-rotate {
  to {
    transform: rotate(360deg);
  }
}`,
  `/* Keep the inline layout box stationary. Rotating it changes its transformed
   bounding box throughout the cycle and makes compact tab/sidebar spinners
   appear to orbit instead of spinning in place. */
/* activity-motion */
.proliferate-spinner > svg {
  display: block;
  animation: proliferate-spinner-rotate 1.4s linear infinite;
  transform-box: view-box;
  transform-origin: center;
  will-change: transform;
}`,
  `@media (prefers-reduced-motion: reduce) {
  :root {
${["hover", "enter", "exit", "disclosure", "panel", "pop", "emphasized"]
  .map((role) => `    --duration-${role}: 0ms;`)
  .join("\n")}
  }

  .proliferate-spinner > svg {
    animation: none;
    transform: rotate(22deg);
  }
}`,
].join("\n\n");

/**
 * Read a CHECKED-OUT source file with line endings normalised to LF.
 *
 * Several assertions below compare against literals joined with `\n`. A working
 * tree carrying CRLF (a Windows editor, or a checkout predating
 * `.gitattributes`) would fail those with a message that names the CSS rather
 * than the line endings, so normalise at the read instead.
 *
 * Only for files that come out of git. Generated output is read raw, so its
 * byte-identity check stays exact.
 */
async function readText(path) {
  return (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
}

// Deliberately NOT readText: dist/theme.css is untracked, gitignored, and
// written fresh by generate-theme.mjs from an in-memory string moments earlier,
// so a git checkout can never give it CRLF. Normalising here would only loosen
// the byte-identity check this script exists to make.
const generated = await readFile(resolve(root, "dist/theme.css"), "utf8");
assert(
  generated === `${expectedCss}\n`,
  "dist/theme.css drifted from an independent projection of the token authority",
);

// LAW §4.1: the generated stylesheet must survive the real Tailwind compiler
// from commit one, so a bad @theme/@utility never reaches a consumer build.
await compile(generated, { base: root });

/* ------------------------------------------------------------------ *
 * 2. Ramp resets, provenance, @theme fallback discipline
 * ------------------------------------------------------------------ */

assert(generated.includes("  --text-*: initial;"), "the closed ramp must reset stock text tokens");
assert(generated.includes("  --color-*: initial;"), "the mono palette must reset stock colors");

for (const [name, value] of tokenEntries) {
  assert(value.provenance.length > 0, `${name} is missing provenance`);
  if (!value.dark.includes("color-mix(")) continue;
  assert(value.themeFallback, `${name} needs a literal @theme fallback (color-mix is illegal there)`);
  assert(
    !/color-mix\(|var\(/.test(value.themeFallback),
    `${name} @theme fallback must be a resolved literal, got ${value.themeFallback}`,
  );
}

// Light neutrals come from one ink. The retired opaque slate literals are
// checked across the whole light column so a peripheral role (for example a
// tab underline) cannot reintroduce the old ramp outside the core color group.
for (const retired of [
  "#edf0f2",
  "#d5d9de",
  "#dde1e6",
  "#e9ecef",
  "#f2f4f6",
  "#f7f8fa",
  "#e4e7ea",
  "#dbdfe4",
  "#bfc5cc",
  "#c6ccd2",
  "#5a5f66",
  "#646a72",
  "#16181b",
]) {
  for (const [name, value] of tokenEntries) {
    assert(
      !value.light.toLowerCase().includes(retired),
      `${name} reintroduced retired light neutral ${retired}`,
    );
  }
}

for (const [name, expected] of Object.entries({
  "--color-foreground": "#1a1c1f",
  "--color-background": "#ffffff",
  "--color-surface": "#ffffff",
  "--color-surface-elevated": "#ffffff",
  "--color-card": "#ffffff",
  "--color-popover": "#ffffff",
  "--color-surface-under": "#f6f6f6",
  "--color-sidebar": "#f6f6f6",
  "--color-sidebar-background": "#f6f6f6",
  "--color-surface-editor": "#fafafa",
  "--color-primary": "#1a1c1f",
  "--color-primary-foreground": "#ffffff",
  // Off-white, not the #ffffff plane: borderless composer chrome means the
  // fill alone separates the composer from the page (see tokens.ts). It reuses
  // the rail plane above rather than introducing a fourth opaque light plane.
  "--color-composer-background": "#f6f6f6",
  "--color-composer-backdrop-filter": "none",
  "--color-composer-control-foreground": "var(--color-muted-foreground)",
  "--color-composer-control-muted-foreground": "var(--color-faint)",
  "--color-composer-control-active-foreground": "var(--color-foreground)",
  "--color-composer-send-background": "var(--color-primary)",
  "--color-composer-send-foreground": "var(--color-primary-foreground)",
  "--color-link-foreground": "#0b6bcb",
  "--color-info": "#0b6bcb",
  "--color-special": "#0b6bcb",
  "--color-ring": "#0b6bcb",
  "--color-highlight-muted": "#0b6bcb",
  "--color-highlight": "#e5f2ff",
  "--color-sidebar-ring": "var(--color-ring)",
  "--color-diff-main-surface": "var(--color-surface)",
  "--color-diff-code-surface": "var(--color-surface-editor)",
  "--shadow-composer": "0 0 0 1px var(--color-border-heavy), 0 2px 5px rgba(26, 28, 31, 0.10), 0 8px 20px rgba(26, 28, 31, 0.07)",
  "--shadow-subtle": "0 1px 2px rgba(26, 28, 31, 0.06)",
  "--shadow-popover": "0 0 0 0.5px rgba(26, 28, 31, 0.05), 0 4px 12px rgba(26, 28, 31, 0.1)",
  "--shadow-modal": "0 16px 40px rgba(26, 28, 31, 0.18)",
  "--shadow-user-message": "0 1px 2px rgba(26, 28, 31, 0.05)",
})) {
  assert(themeTokens[name]?.light === expected, `${name} drifted from the light palette planes`);
}

for (const [name, expected] of Object.entries({
  "--color-foreground-secondary": "rgba(26, 28, 31, 0.65)",
  "--color-foreground-tertiary": "rgba(26, 28, 31, 0.62)",
  "--color-muted-foreground": "rgba(26, 28, 31, 0.65)",
  "--color-faint": "rgba(26, 28, 31, 0.62)",
  "--color-border-light": "rgba(26, 28, 31, 0.114)",
  "--color-border": "rgba(26, 28, 31, 0.14)",
  "--color-border-heavy": "rgba(26, 28, 31, 0.18)",
  "--color-input": "rgba(26, 28, 31, 0.2)",
  "--color-hover": "rgba(26, 28, 31, 0.053)",
  "--color-selected": "rgba(26, 28, 31, 0.065)",
  "--color-active": "rgba(26, 28, 31, 0.078)",
  "--color-sidebar-foreground": "rgba(26, 28, 31, 0.85)",
  "--color-sidebar-muted-foreground": "rgba(26, 28, 31, 0.62)",
  "--color-surface-control": "rgba(26, 28, 31, 0.049)",
  "--color-surface-elevated-secondary": "rgba(26, 28, 31, 0.049)",
  "--color-muted": "rgba(26, 28, 31, 0.049)",
  "--color-diff-panel-surface": "rgba(26, 28, 31, 0.03)",
  "--color-scrollbar-thumb": "rgba(26, 28, 31, 0.12)",
  "--color-scrollbar-thumb-active": "rgba(26, 28, 31, 0.24)",
})) {
  assert(
    themeTokens[name]?.light === expected,
    `${name} drifted from its single-ink light palette rung`,
  );
}

/* ------------------------------------------------------------------ *
 * 2b. Layers: raw -> semantic -> component, never backwards
 * ------------------------------------------------------------------ */

const PALETTE_HEXES = paletteHexes();
const TOKEN_LAYERS = new Set(["semantic", "component"]);

/** Every color literal in a value, normalised to lowercase 6-digit hex. */
function colorLiterals(value) {
  const found = [];
  for (const hex of value.matchAll(/#([0-9a-f]{6})\b/gi)) found.push(`#${hex[1].toLowerCase()}`);
  for (const rgb of value.matchAll(/rgba?\(\s*(\d+)\s*,?\s*(\d+)\s*,?\s*(\d+)/g)) {
    found.push(
      "#" + [rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join(""),
    );
  }
  return found;
}

for (const [name, value] of tokenEntries) {
  assert(TOKEN_LAYERS.has(value.layer), `${name} has no layer (semantic | component)`);
  if (value.layer !== "semantic") continue;
  for (const field of ["dark", "light", "themeFallback"]) {
    const rendered = value[field];
    if (!rendered) continue;
    for (const hex of colorLiterals(rendered)) {
      assert(
        PALETTE_HEXES.has(hex),
        `${name} (semantic) paints ${hex} in ${field}, which the raw layer (palette.ts) does not own`,
      );
    }
    for (const ref of rendered.matchAll(/var\((--[a-z0-9-]+)/g)) {
      const target = themeTokens[ref[1]];
      if (!target) continue; // consumer-provided fallbacks such as --markdown-font-size
      assert(
        target.layer === "semantic",
        `${name} (semantic) reaches down into component token ${ref[1]}; only component tokens may reference component tokens`,
      );
    }
  }
}

assert(palette.ink === "#1a1c1f" && palette.paper === "#ffffff", "raw layer anchors drifted");
assert(
  palette.inkAlpha(0.65) === "rgba(26, 28, 31, 0.65)" &&
    palette.paperAlpha(0.7) === "rgba(255, 255, 255, 0.7)" &&
    palette.paperMix(70) === "color-mix(in oklab, #ffffff 70%, transparent)",
  "raw-layer alpha helpers must render the exact shipped literal forms",
);

// The default rung IS the token value: one record, not two numbers kept in step.
for (const [family, rungs] of [
  ["radius", radiusRungs],
  ["density", densityRungs],
]) {
  assert(rungs.default, `${family} rungs must carry a default rung`);
  for (const [key, tokenName] of Object.entries(rungTokens[family])) {
    const token = themeTokens[tokenName];
    assert(token, `${family} rung key ${key} points at unknown token ${tokenName}`);
    assert(
      token.dark === rungs.default[key] && token.light === rungs.default[key],
      `${tokenName} drifted from the default ${family} rung (${rungs.default[key]})`,
    );
  }
  for (const [rungName, values] of Object.entries(rungs)) {
    for (const key of Object.keys(rungTokens[family])) {
      assert(typeof values[key] === "string" && values[key].length > 0, `${family} rung ${rungName} is missing ${key}`);
    }
  }
}
assert(themeTokens["--radius"].dark === radiusRungs.default.md, "--radius must stay the md rung");

/* ------------------------------------------------------------------ *
 * 3. Motion authority
 * ------------------------------------------------------------------ */

for (const [path, expected] of [
  ["duration.hoverMs", 120],
  ["duration.enterMs", 160],
  ["duration.exitMs", 120],
  ["duration.disclosureMs", 200],
  ["duration.panelMs", 240],
  ["duration.popMs", 280],
  ["duration.emphasizedMs", 300],
  ["activity.thinkingCycleMs", 1800],
  ["activity.streamRevealFadeMs", 320],
  ["activity.streamRevealHandoffDelayMs", 160],
  ["delay.autoHideScrollbarMs", 700],
  ["delay.hoverCardHideMs", 120],
  ["delay.levelBarStaggerMs", 110],
]) {
  const [group, key] = path.split(".");
  assert(motion[group][key] === expected, `motion.${path} drifted (${motion[group][key]})`);
}
assert(motion.cssMs(37) === "37ms", "motion.cssMs must be the single owner of the ms suffix");

for (const [tokenName, expected] of [
  ["--duration-hover", motion.cssMs(motion.duration.hoverMs)],
  ["--duration-enter", motion.cssMs(motion.duration.enterMs)],
  ["--duration-exit", motion.cssMs(motion.duration.exitMs)],
  ["--duration-disclosure", motion.cssMs(motion.duration.disclosureMs)],
  ["--duration-panel", motion.cssMs(motion.duration.panelMs)],
  ["--duration-pop", motion.cssMs(motion.duration.popMs)],
  ["--duration-emphasized", motion.cssMs(motion.duration.emphasizedMs)],
  ["--ease-out-quint", motion.ease.outQuint],
  ["--ease-pop", motion.ease.pop],
  ["--ease-spring", motion.ease.spring],
  ["--ease-standard", motion.ease.standard],
  ["--ease-linear", motion.ease.linear],
  ["--activity-stream-reveal-fade", motion.cssMs(motion.activity.streamRevealFadeMs)],
]) {
  assert(themeTokens[tokenName]?.dark === expected, `${tokenName} drifted from motion.ts`);
  assert(themeTokens[tokenName]?.light === expected, `${tokenName} light half drifted from motion.ts`);
}

/* ------------------------------------------------------------------ *
 * 4. Native bridge (React Native derives from the same authority)
 * ------------------------------------------------------------------ */

function literal(name) {
  const token = themeTokens[name];
  if (token.themeFallback) return token.themeFallback;
  const alias = token.dark.match(/^var\((--[a-z0-9-]+)\)$/);
  return alias?.[1] ? literal(alias[1]) : token.dark;
}

for (const [key, tokenName] of Object.entries({
  background: "--color-background",
  foreground: "--color-foreground",
  primary: "--color-primary",
  primaryForeground: "--color-primary-foreground",
  accent: "--color-hover",
  muted: "--color-muted",
  mutedForeground: "--color-muted-foreground",
  faint: "--color-faint",
  card: "--color-card",
  popover: "--color-popover",
  popoverAccent: "--color-hover",
  popoverRing: "--color-border",
  border: "--color-border",
  borderLight: "--color-border-light",
  borderHeavy: "--color-border-heavy",
  input: "--color-input",
  ring: "--color-ring",
  destructive: "--color-destructive",
  success: "--color-success",
  warning: "--color-warning",
  sidebar: "--color-sidebar",
  sidebarForeground: "--color-sidebar-foreground",
  sidebarAccent: "--color-hover",
  sidebarBorder: "--color-border",
})) {
  assert(colors[key] === literal(tokenName), `native ${key} drifted from ${tokenName}`);
}

assert(
  JSON.stringify(Object.keys(colors)) ===
    JSON.stringify([
      "background",
      "foreground",
      "overlay",
      "overlayStrong",
      "primary",
      "primaryForeground",
      "secondary",
      "secondaryForeground",
      "accent",
      "accentForeground",
      "muted",
      "mutedForeground",
      "faint",
      "helper",
      "card",
      "cardForeground",
      "popover",
      "popoverForeground",
      "popoverAccent",
      "popoverRing",
      "border",
      "borderLight",
      "borderHeavy",
      "input",
      "ring",
      "surface",
      "surfaceControl",
      "surfaceElevated",
      "destructive",
      "destructiveSubtle",
      "destructiveForeground",
      "success",
      "successSubtle",
      "successForeground",
      "warning",
      "warningSubtle",
      "warningForeground",
      "info",
      "infoSubtle",
      "infoForeground",
      "sidebar",
      "sidebarBackground",
      "sidebarForeground",
      "sidebarMutedForeground",
      "sidebarAccent",
      "sidebarAccentForeground",
      "sidebarBorder",
      "sidebarBlue",
    ]),
  "native color bridge public keys drifted",
);
assert(colors.overlayStrong === "rgba(0,0,0,0.58)", "mobile-only overlay scrim drifted");
assert(colors.infoSubtle === "rgba(51,156,255,0.14)", "mobile-only info tint drifted");
for (const [key, value] of Object.entries(colors)) {
  assert(!/var\(|color-mix\(/.test(value), `native ${key} must be a literal, got ${value}`);
}

assert(
  JSON.stringify(Object.keys(radius)) === JSON.stringify(["sm", "md", "lg", "xl", "2xl", "full"]),
  "native radius bridge must expose the complete ruled scale",
);
assert(radius["2xl"] === 16, `native 2xl radius must resolve to 16px, got ${radius["2xl"]}`);
assert(
  JSON.stringify(Object.keys(timing)) === JSON.stringify(["fast", "normal", "slow"]),
  "native timing bridge public keys drifted",
);
assert(
  JSON.stringify(Object.keys(mobileShadow)) === JSON.stringify(["subtle", "floating"]),
  "native shadow bridge public keys drifted",
);
assert(
  JSON.stringify(Object.keys(mobileTheme)) ===
    JSON.stringify(["colors", "spacing", "radius", "typography", "timing", "shadow"]),
  "mobileTheme public shape drifted",
);
assert(
  JSON.stringify(Object.keys(mobileTheme.typography)) === JSON.stringify(["size", "lineHeight"]),
  "mobile typography bridge must remain size/lineHeight only",
);
assert(mobileTheme.colors === colors, "mobile colors must reuse the design projection");
assert(mobileTheme.radius === radius, "mobile radius must reuse the design projection");
assert(mobileTheme.timing === timing, "mobile timing must reuse the design projection");
assert(mobileTheme.shadow === mobileShadow, "mobile shadow must reuse the native shadow objects");

const semanticTypeRoles = [
  "uiSm",
  "ui",
  "chat",
  "composer",
  "body",
  "bodyEmphasis",
  "workspaceTitle",
  "heading",
  "title",
  "hero",
  "sidebarNav",
  "sidebarRow",
  "sidebarBrand",
];
for (const metric of ["size", "lineHeight", "letterSpacing"]) {
  assert(
    JSON.stringify(Object.keys(typography[metric])) === JSON.stringify(semanticTypeRoles),
    `typography.${metric} drifted from the closed semantic ramp`,
  );
}
// Closed-ramp invariants: transcript prose gets the more generous reading
// leading while the composer stays compact inside its fixed-height surface.
assert(
  typography.size.chat === typography.size.ui + 1,
  "chat font-size must stay exactly one step above compact UI text",
);
assert(
  typography.size.composer === typography.size.chat,
  "composer and chat font-size must stay on the same reading rung",
);
assert(
  typography.lineHeight.chat === typography.size.chat + 8,
  "chat line-height must stay chat font-size + 8",
);
assert(
  typography.lineHeight.composer === typography.size.composer + 6,
  "composer line-height must stay composer font-size + 6",
);

/* ------------------------------------------------------------------ *
 * 5. Ownership: hand-authored CSS never declares a global token value
 * ------------------------------------------------------------------ */

function topLevelBlocks(css) {
  const blocks = [];
  let cursor = 0;
  let depth = 0;
  let blockStart = -1;
  let selectorStart = 0;
  let quote = null;
  let comment = false;
  while (cursor < css.length) {
    const current = css[cursor];
    const next = css[cursor + 1];
    if (comment) {
      if (current === "*" && next === "/") {
        comment = false;
        cursor += 2;
        continue;
      }
      cursor += 1;
      continue;
    }
    if (!quote && current === "/" && next === "*") {
      comment = true;
      cursor += 2;
      continue;
    }
    if (quote) {
      if (current === quote && css[cursor - 1] !== "\\") quote = null;
      cursor += 1;
      continue;
    }
    if (current === '"' || current === "'") {
      quote = current;
      cursor += 1;
      continue;
    }
    if (current === "{") {
      if (depth === 0) blockStart = cursor;
      depth += 1;
    } else if (current === "}") {
      depth -= 1;
      if (depth === 0 && blockStart >= 0) {
        blocks.push({
          selector: css.slice(selectorStart, blockStart).trim(),
          body: css.slice(blockStart + 1, cursor),
        });
        selectorStart = cursor + 1;
        blockStart = -1;
      }
    } else if (depth === 0 && current === ";") {
      selectorStart = cursor + 1;
    }
    cursor += 1;
  }
  return blocks;
}

assert(
  topLevelBlocks(generated).filter(({ selector }) => selector === ':root[data-mode="light"]')
    .length === 1,
  "the generated theme must contain exactly one flattened light root",
);

const productCss = await readText(resolve(root, "src/css/product.css"));
for (const { selector, body } of topLevelBlocks(productCss)) {
  const ownsGlobalScope =
    selector.startsWith("@theme") ||
    /(^|\s):root(\[data-mode="(light|dark)"\])?$/.test(selector.trim());
  if (!ownsGlobalScope) continue;
  assert(
    !/^\s*--[a-z0-9-]+\s*:/m.test(body),
    `product.css re-introduces hand-authored global token values in ${selector.trim()}`,
  );
}

const tailwindImport = productCss.indexOf('@import "tailwindcss";');
const themeImport = productCss.indexOf('@import "../theme.css";');
// Line-anchored so prose in a comment can mention the at-rule without becoming
// the "first @source" position.
const firstSource = productCss.search(/^@source\s/m);
assert(tailwindImport >= 0, "product.css must import tailwindcss");
assert(
  themeImport > tailwindImport,
  "product.css must import the generated theme after tailwindcss",
);
assert(
  firstSource < 0 || themeImport < firstSource,
  "product.css must import the generated theme before the first @source (CSS import-order law)",
);
const productRoot =
  topLevelBlocks(productCss).find(({ selector }) => selector === ":root")?.body ?? "";
assert(
  /font-family:\s*var\(--font-sans\);/.test(productRoot),
  "product.css :root must use var(--font-sans)",
);
assert(!/\bInter\b/.test(productRoot), "product.css :root must not hand-author a font stack");

/* ------------------------------------------------------------------ *
 * 6. Motion ownership inside the design package's own CSS
 * ------------------------------------------------------------------ */

for (const declaration of [
  "animation: content-fade-in var(--duration-enter) var(--ease-out-quint);",
  "animation: stream-word-in var(--activity-stream-reveal-fade) linear both;",
  "animation: brand-mark-settle var(--duration-emphasized) var(--ease-standard);",
  "animation: web-sidebar-panel-slide-in var(--duration-panel) var(--ease-spring);",
  "animation: modal-overlay-in var(--duration-enter) var(--ease-out-quint);",
  "animation: modal-overlay-out var(--duration-exit) var(--ease-standard) forwards;",
  "animation: modal-panel-in var(--duration-enter) var(--ease-out-quint);",
  "animation: modal-panel-out var(--duration-exit) var(--ease-standard) forwards;",
  "animation: composer-dock-card-enter var(--duration-emphasized) var(--ease-spring) both;",
  "animation: composer-dock-card-exit var(--duration-exit) var(--ease-out-quint) both;",
  "animation: composer-value-enter var(--duration-panel) var(--ease-spring);",
  "animation: composer-value-exit var(--duration-panel) var(--ease-spring) forwards;",
  "animation: chip-enter var(--duration-emphasized) var(--ease-spring) both;",
  "animation: subagent-spawn-chip-enter var(--duration-pop) var(--ease-pop) both;",
  "animation: status-crossfade var(--duration-enter) var(--ease-out-quint);",
  "animation: transcript-activity-in var(--duration-enter) var(--ease-out-quint) both;",
  "animation: dialog-pop-in var(--duration-enter) var(--ease-out-quint);",
  "transition: opacity var(--duration-hover) var(--ease-standard);",
  "transition-duration: var(--duration-hover);",
  "transition-timing-function: var(--ease-standard);",
  "transition: background-color var(--duration-hover) var(--ease-standard);",
  "background-color var(--duration-hover) var(--ease-standard),\n" +
    "    color var(--duration-hover) var(--ease-standard),\n" +
    "    border-color var(--duration-hover) var(--ease-standard);",
]) {
  assert(
    productCss.includes(declaration),
    `product.css lost the exact motion declaration: ${declaration}`,
  );
}

/**
 * Raw numeric time is legal only inside a rule that carries the exact
 * `/* activity-motion *\/` marker AND declares an infinite animation. Finite
 * interaction motion and finite activity cadence must flow through generated
 * variables. Ordinary prose comments are not authority.
 */
function checkRawMotionAuthority(css, sourceName) {
  for (const match of css.matchAll(/((?:\/\*[\s\S]*?\*\/\s*)?[^{}]+)\{([^{}]*)\}/g)) {
    const owner = match[1];
    const body = match[2];
    for (const declaration of body.matchAll(
      /\b(animation(?:-delay)?|transition(?:-[a-z-]+)?)\s*:\s*([^;]+);/g,
    )) {
      const [, property, value] = declaration;
      if (!/(?:^|[ (,:])(?:\d+(?:\.\d+)?|\.\d+)(?:ms|s)\b/.test(value)) continue;
      const ownsInfiniteActivity =
        property.startsWith("animation") &&
        /\banimation\s*:[^;]*\binfinite\b/.test(body) &&
        owner.includes("/* activity-motion */");
      assert(
        ownsInfiniteActivity,
        `${sourceName} has unowned raw motion in ${owner.trim()}: ${property}: ${value}`,
      );
    }
  }
}

checkRawMotionAuthority(productCss, "product.css");
checkRawMotionAuthority(generated, "dist/theme.css");

/* ------------------------------------------------------------------ *
 * 7. One authority entry per token name in the source manifest
 * ------------------------------------------------------------------ */

const tokenSource = await readText(resolve(root, "src/tokens.ts"));
const manifest =
  tokenSource
    .split("export const themeTokens = {")[1]
    ?.split("} as const satisfies Record<string, ThemeTokenValue>;")[0] ?? "";
assert(manifest.length > 0, "could not locate the themeTokens manifest in src/tokens.ts");
const duplicated = [];
const seen = new Set();
for (const entry of manifest.matchAll(/^ {2}"(--[a-z0-9-]+)":\s*\{/gm)) {
  if (seen.has(entry[1])) duplicated.push(entry[1]);
  seen.add(entry[1]);
}
assert(
  duplicated.length === 0,
  `duplicate authority entries in themeTokens: ${duplicated.join(", ")}`,
);
assert(
  seen.size === tokenEntries.length,
  `manifest entry count (${seen.size}) does not match themeTokens (${tokenEntries.length})`,
);

const semanticCount = tokenEntries.filter(([, value]) => value.layer === "semantic").length;
console.log(
  `check-theme: ok (${tokenEntries.length} live tokens: ${semanticCount} semantic, ${tokenEntries.length - semanticCount} component; ${PALETTE_HEXES.size} raw colors)`,
);
