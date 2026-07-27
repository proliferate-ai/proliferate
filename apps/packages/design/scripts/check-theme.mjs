/**
 * Independent validator for the generated token authority.
 *
 * This script never trusts `scripts/generate-theme.mjs`. It re-projects the
 * compiled authority (`dist/tokens.js`, `dist/motion.js`) through its own code
 * path, asserts the result is byte-identical to the committed generator output,
 * and then compiles that CSS through the real Tailwind pipeline so a malformed
 * `@theme`/`@utility` block fails the design build instead of a consumer app.
 *
 * It additionally pins the frozen census numbers (dispositions / removals /
 * aliases / provenance tags), the motion values shared with `motion.ts`, the
 * React Native bridge shape, and the ownership rule that global token VALUES
 * only ever live in generated CSS — never in `src/css/dom.css` or
 * `src/css/product.css`.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "tailwindcss";

import { motion } from "../dist/motion.js";
import {
  colors,
  currentTokenDispositions,
  legacyAliasNames,
  radius,
  removedTokenNames,
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
  ...["hover", "enter", "exit", "disclosure", "panel", "emphasized"].map((role) =>
    singleUtility(`duration-${role}`, "transition-duration"),
  ),
  ...["out-quint", "spring", "standard", "linear"].map((role) =>
    singleUtility(`ease-${role}`, "transition-timing-function"),
  ),
  ...["sm", "md", "lg"].map((step) =>
    boxUtility(`size-icon-button-${step}`, `size-icon-button-${step}`),
  ),
];

const expectedCss = [
  `@theme {\n  --color-*: initial;\n  --text-*: initial;\n\n${project("theme")}\n}`,
  `:root {\n${project("dark")}\n}`,
  `:root[data-mode="light"] {\n${project("light")}\n}`,
  expectedUtilities.join("\n\n"),
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
${["hover", "enter", "exit", "disclosure", "panel", "emphasized"]
  .map((role) => `    --duration-${role}: 0ms;`)
  .join("\n")}
  }

  .proliferate-spinner > svg {
    animation: none;
    transform: rotate(22deg);
  }
}`,
].join("\n\n");

const generated = await readFile(resolve(root, "dist/theme.css"), "utf8");
assert(
  generated === `${expectedCss}\n`,
  "dist/theme.css drifted from an independent projection of the token authority",
);

// LAW §4.1: the generated stylesheet must survive the real Tailwind compiler
// from commit one, so a bad @theme/@utility never reaches a consumer build.
await compile(generated, { base: root });

/* ------------------------------------------------------------------ *
 * 2. Frozen census: dispositions, removals, aliases, provenance
 * ------------------------------------------------------------------ */

assert(
  Object.keys(currentTokenDispositions).length === 285,
  `expected 285 frozen dispositions, got ${Object.keys(currentTokenDispositions).length}`,
);
assert(removedTokenNames.length === 70, `expected 70 removed names, got ${removedTokenNames.length}`);
assert(
  legacyAliasNames.length === 15,
  `expected 15 compatibility aliases, got ${legacyAliasNames.length}`,
);
assert(
  JSON.stringify([...legacyAliasNames].sort()) ===
    JSON.stringify([
      "--color-accent",
      "--color-composer-border",
      "--color-composer-control-hover",
      "--color-list-hover",
      "--color-popover-accent",
      "--color-popover-ring",
      "--color-sidebar-accent",
      "--color-sidebar-border",
      "--shadow-composer",
      "--shadow-floating",
      "--shadow-floating-dark",
      "--workspace-shell-action-hover-background",
      "--workspace-shell-tab-active-background",
      "--workspace-shell-tab-hover-background",
      "--workspace-shell-tab-selected-background",
    ]),
  "compatibility alias set drifted from the frozen 15-name census",
);
assert(generated.includes("  --text-*: initial;"), "the closed ramp must reset stock text tokens");
assert(generated.includes("  --color-*: initial;"), "the mono palette must reset stock colors");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let shipped = 0;
let retuned = 0;
for (const [currentName, finalName] of Object.entries(currentTokenDispositions)) {
  if (finalName === null) {
    assert(
      !new RegExp(`^\\s*${escapeRegExp(currentName)}\\s*:`, "m").test(generated),
      `${currentName} is disposed but still declared in generated CSS`,
    );
    continue;
  }
  assert(finalName in themeTokens, `${currentName} maps to missing final token ${finalName}`);
  const { provenance } = themeTokens[finalName];
  if (provenance === "[SHIPPED]") shipped += 1;
  if (provenance.startsWith("[RETUNE:")) retuned += 1;
}
// `--color-composer-background` moved from [SHIPPED] to
// [RETUNE:surface/composer-opaque], `--color-composer-backdrop-filter`
// followed it (the composer-goes-opaque follow-on: light's blur has nothing
// left to blur once the surface is opaque), and `--color-sidebar` moved from
// [SHIPPED] to [RETUNE:sidebar/reference-surface] (round-2 sidebar retune,
// previously [RETUNE:sidebar/surface-recess]). The session-header retune
// ([RETUNE:header/quiet-active-tab]) aliases
// `--workspace-shell-tab-active-background` onto `--color-selected` (it
// was already in the retuned tally as [RETUNE:state/overlay], so the tag
// changes but no disposition crosses) and `--workspace-shell-tab-active-border`
// onto `--color-border`, moving one more disposition from shipped into
// retuned — four crossings in total.
// The 285-name disposition census itself is unchanged: the three
// transcript-measure/turn-rhythm additions are net-new tokens, and this map
// is frozen to the names that existed BEFORE the retune.
assert(shipped === 172, `expected 172 shipped dispositions, got ${shipped}`);
assert(retuned === 43, `expected 43 retuned dispositions, got ${retuned}`);

for (const [name, value] of tokenEntries) {
  assert(value.provenance.length > 0, `${name} is missing provenance`);
  if (!value.dark.includes("color-mix(")) continue;
  assert(value.themeFallback, `${name} needs a literal @theme fallback (color-mix is illegal there)`);
  assert(
    !/color-mix\(|var\(/.test(value.themeFallback),
    `${name} @theme fallback must be a resolved literal, got ${value.themeFallback}`,
  );
}

for (const aliasName of legacyAliasNames) {
  const value = themeTokens[aliasName];
  assert(value.dark === value.light, `${aliasName} is an alias and must not vary by mode`);
  assert(
    /^var\(--[a-z0-9-]+\) \/\* legacy-alias \*\/$/.test(value.dark),
    `${aliasName} must be an exact tagged var() alias, got ${value.dark}`,
  );
}

/* ------------------------------------------------------------------ *
 * 3. Motion authority
 * ------------------------------------------------------------------ */

for (const [path, expected] of [
  ["duration.hoverMs", 120],
  ["duration.enterMs", 160],
  ["duration.exitMs", 120],
  ["duration.disclosureMs", 200],
  ["duration.panelMs", 240],
  ["duration.emphasizedMs", 300],
  ["activity.thinkingCycleMs", 1800],
  ["activity.streamRevealFadeMs", 320],
  ["activity.streamRevealHandoffDelayMs", 160],
  ["activity.updateReadySweepMs", 700],
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
  ["--duration-emphasized", motion.cssMs(motion.duration.emphasizedMs)],
  ["--ease-out-quint", motion.ease.outQuint],
  ["--ease-spring", motion.ease.spring],
  ["--ease-standard", motion.ease.standard],
  ["--ease-linear", motion.ease.linear],
  ["--activity-stream-reveal-fade", motion.cssMs(motion.activity.streamRevealFadeMs)],
  ["--activity-update-ready-sweep", motion.cssMs(motion.activity.updateReadySweepMs)],
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
  const alias = token.dark.match(/^var\((--[a-z0-9-]+)\)(?: \/\* legacy-alias \*\/)?$/);
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
// Closed-ramp invariant: chat prose leads the composer by exactly 7px.
assert(
  typography.lineHeight.chat === typography.size.composer + 7,
  "chat line-height must stay composer font-size + 7",
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

const sources = {};
for (const name of ["dom.css", "product.css"]) {
  const source = await readFile(resolve(root, "src/css", name), "utf8");
  sources[name] = source;
  for (const { selector, body } of topLevelBlocks(source)) {
    const ownsGlobalScope =
      selector.startsWith("@theme") ||
      /(^|\s):root(\[data-mode="(light|dark)"\])?$/.test(selector.trim());
    if (!ownsGlobalScope) continue;
    assert(
      !/^\s*--[a-z0-9-]+\s*:/m.test(body),
      `${name} re-introduces hand-authored global token values in ${selector.trim()}`,
    );
  }
}

const domCss = sources["dom.css"];
const productCss = sources["product.css"];
const tailwindImport = domCss.indexOf('@import "tailwindcss";');
const themeImport = domCss.indexOf('@import "../theme.css";');
// Line-anchored so prose in a comment can mention the at-rule without becoming
// the "first @source" position.
const firstSource = domCss.search(/^@source\s/m);
assert(tailwindImport >= 0, "dom.css must import tailwindcss");
assert(themeImport > tailwindImport, "dom.css must import the generated theme after tailwindcss");
assert(
  firstSource < 0 || themeImport < firstSource,
  "dom.css must import the generated theme before the first @source (CSS import-order law)",
);
const domRoot = topLevelBlocks(domCss).find(({ selector }) => selector === ":root")?.body ?? "";
assert(/font-family:\s*var\(--font-sans\);/.test(domRoot), "dom.css :root must use var(--font-sans)");
assert(!/\bInter\b/.test(domRoot), "dom.css :root must not hand-author a font stack");

/* ------------------------------------------------------------------ *
 * 6. Motion ownership inside the design package's own CSS
 * ------------------------------------------------------------------ */

for (const declaration of [
  "animation: content-fade-in var(--duration-enter) var(--ease-out-quint);",
  "animation: stream-word-in var(--activity-stream-reveal-fade) linear both;",
  "animation: brand-mark-settle var(--duration-emphasized) var(--ease-standard);",
  "animation: web-sidebar-panel-slide-in var(--duration-panel) var(--ease-spring);",
]) {
  assert(domCss.includes(declaration), `dom.css lost the exact motion declaration: ${declaration}`);
}

for (const declaration of [
  "animation: panel-in var(--duration-panel) var(--ease-out-quint);",
  "animation: modal-overlay-in var(--duration-enter) var(--ease-out-quint);",
  "animation: modal-overlay-out var(--duration-exit) var(--ease-standard) forwards;",
  "animation: modal-panel-in var(--duration-enter) var(--ease-out-quint);",
  "animation: modal-panel-out var(--duration-exit) var(--ease-standard) forwards;",
  "animation: composer-dock-card-enter var(--duration-emphasized) var(--ease-spring) both;",
  "animation: composer-dock-card-exit var(--duration-exit) var(--ease-out-quint) both;",
  "animation: composer-value-enter var(--duration-panel) var(--ease-spring);",
  "animation: composer-value-exit var(--duration-panel) var(--ease-spring) forwards;",
  "animation: chip-enter var(--duration-emphasized) var(--ease-spring) both;",
  "animation: status-crossfade var(--duration-enter) var(--ease-out-quint);",
  "animation: transcript-activity-in var(--duration-enter) var(--ease-out-quint) both;",
  "animation: thinking-band-sweep var(--activity-update-ready-sweep) ease-in-out 1 both;",
  "animation: thinking-band-glyphs-sweep var(--activity-update-ready-sweep) ease-in-out 1 both;",
  "animation: update-pill-in var(--duration-emphasized) var(--ease-spring);",
  "animation: toast-in var(--duration-enter) var(--ease-out-quint);",
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

checkRawMotionAuthority(domCss, "dom.css");
checkRawMotionAuthority(productCss, "product.css");
checkRawMotionAuthority(generated, "dist/theme.css");

/* ------------------------------------------------------------------ *
 * 7. One authority entry per token name in the source manifest
 * ------------------------------------------------------------------ */

const tokenSource = await readFile(resolve(root, "src/tokens.ts"), "utf8");
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

console.log(
  `check-theme: ok (${tokenEntries.length} live tokens, ${shipped} shipped, ${retuned} retuned, ` +
    `${removedTokenNames.length} removals, ${legacyAliasNames.length} aliases)`,
);
