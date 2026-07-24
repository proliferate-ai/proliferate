import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
import { motion } from "../dist/motion.js";
import { mobileShadow, mobileTheme } from "../dist/react-native.js";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const entries = Object.entries(themeTokens);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function independentDeclarations(mode, indent = "  ") {
  return entries
    .map(([name, value]) => {
      const renderedValue =
        mode === "theme" ? (value.themeFallback ?? value.dark) : value[mode];
      return `${indent}${name}: ${renderedValue};`;
    })
    .join("\n");
}

function independentUtility(name, property, tokenName = name) {
  return `@utility ${name} {
  ${property}: var(--${tokenName});
}`;
}

const expectedZUtilities = [
  "base",
  "raised",
  "sticky",
  "overlay",
  "popover",
  "toast",
  "tooltip",
  "top",
].map((name) => independentUtility(`z-${name}`, "z-index"));

const expectedDurationUtilities = [
  "hover",
  "enter",
  "exit",
  "disclosure",
  "panel",
  "emphasized",
].map((name) => independentUtility(`duration-${name}`, "transition-duration"));

const expectedEaseUtilities = [
  "out-quint",
  "spring",
  "standard",
  "linear",
].map((name) => independentUtility(`ease-${name}`, "transition-timing-function"));

const expectedSizeUtilities = ["sm", "md", "lg"].map(
  (name) => `@utility size-icon-button-${name} {
  width: var(--size-icon-button-${name});
  height: var(--size-icon-button-${name});
}`,
);

const expectedCss = `@theme {
  --color-*: initial;
  --text-*: initial;

${independentDeclarations("theme")}
}

:root {
${independentDeclarations("dark")}
}

:root[data-mode="light"] {
${independentDeclarations("light")}
}

${[
  "@utility rounded-inherit {\n  border-radius: inherit;\n}",
  ...expectedZUtilities,
  ...expectedDurationUtilities,
  ...expectedEaseUtilities,
  ...expectedSizeUtilities,
].join("\n\n")}

@keyframes proliferate-spinner-rotate {
  to {
    transform: rotate(360deg);
  }
}

/* Keep the inline layout box stationary. Rotating it changes its transformed
   bounding box throughout the cycle and makes compact tab/sidebar spinners
   appear to orbit instead of spinning in place. */
/* activity-motion */
.proliferate-spinner > svg {
  display: block;
  animation: proliferate-spinner-rotate 1.4s linear infinite;
  transform-box: view-box;
  transform-origin: center;
  will-change: transform;
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --duration-hover: 0ms;
    --duration-enter: 0ms;
    --duration-exit: 0ms;
    --duration-disclosure: 0ms;
    --duration-panel: 0ms;
    --duration-emphasized: 0ms;
  }

  .proliferate-spinner > svg {
    animation: none;
    transform: rotate(22deg);
  }
}
`;

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

const output = await readFile(resolve(root, "dist/theme.css"), "utf8");
assert(output === expectedCss, "dist/theme.css drifted from an independent authority projection");
assert(Object.keys(currentTokenDispositions).length === 285, "expected exactly 285 frozen dispositions");
assert(removedTokenNames.length === 70, "expected exactly 70 removed global names");
assert(legacyAliasNames.length === 15, "expected exactly 15 compatibility aliases");
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
assert(output.includes("  --text-*: initial;"), "semantic @theme must reset stock text tokens");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let shippedDispositions = 0;
let retunedDispositions = 0;
for (const [currentName, finalName] of Object.entries(currentTokenDispositions)) {
  if (finalName === null) {
    assert(
      !new RegExp(`^\\s*${escapeRegExp(currentName)}\\s*:`, "m").test(output),
      `${currentName} was removed but is still declared`,
    );
  } else {
    assert(finalName in themeTokens, `${currentName} maps to missing final token ${finalName}`);
    const provenance = themeTokens[finalName].provenance;
    if (provenance === "[SHIPPED]") shippedDispositions += 1;
    if (provenance.startsWith("[RETUNE:")) retunedDispositions += 1;
  }
}
assert(shippedDispositions === 176, `expected 176 shipped dispositions, got ${shippedDispositions}`);
assert(retunedDispositions === 39, `expected 39 retuned dispositions, got ${retunedDispositions}`);

for (const [name, value] of entries) {
  if (!value.dark.includes("color-mix(")) continue;
  assert(value.themeFallback, `${name} needs an authoritative literal @theme fallback`);
  assert(
    !/color-mix\(|var\(/.test(value.themeFallback),
    `${name} @theme fallback must be a literal color`,
  );
}

for (const aliasName of legacyAliasNames) {
  const value = themeTokens[aliasName];
  assert(value.dark === value.light, `${aliasName} must not vary by color mode`);
  assert(
    /^var\(--[a-z0-9-]+\) \/\* legacy-alias \*\/$/.test(value.dark),
    `${aliasName} must be an exact tagged var() alias`,
  );
}

assert(motion.duration.hoverMs === 120, "motion hover duration drifted");
assert(motion.duration.enterMs === 160, "motion enter duration drifted");
assert(motion.duration.exitMs === 120, "motion exit duration drifted");
assert(motion.duration.disclosureMs === 200, "motion disclosure duration drifted");
assert(motion.duration.panelMs === 240, "motion panel duration drifted");
assert(motion.duration.emphasizedMs === 300, "motion emphasized duration drifted");
assert(motion.activity.thinkingCycleMs === 1800, "thinking activity cadence drifted");
assert(motion.activity.streamRevealFadeMs === 320, "stream reveal activity cadence drifted");
assert(motion.activity.streamRevealHandoffDelayMs === 160, "stream handoff delay drifted");
assert(motion.activity.updateReadySweepMs === 700, "update-ready activity cadence drifted");
assert(motion.delay.autoHideScrollbarMs === 700, "auto-hide delay drifted");
assert(motion.delay.hoverCardHideMs === 120, "hover-card delay drifted");
assert(motion.delay.levelBarStaggerMs === 110, "level-bar stagger drifted");
assert(motion.cssMs(37) === "37ms", "motion.cssMs must own the CSS unit suffix");

for (const [tokenName, value] of [
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
  assert(themeTokens[tokenName]?.dark === value, `${tokenName} drifted from motion.ts`);
  assert(themeTokens[tokenName]?.light === value, `${tokenName} light value drifted from motion.ts`);
}

function nativeProjection(name) {
  const token = themeTokens[name];
  if (token.themeFallback) return token.themeFallback;
  const alias = token.dark.match(/^var\((--[a-z0-9-]+)\)(?: \/\* legacy-alias \*\/)?$/);
  return alias?.[1] ? nativeProjection(alias[1]) : token.dark;
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
  assert(colors[key] === nativeProjection(tokenName), `native ${key} drifted from ${tokenName}`);
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
assert(
  JSON.stringify(Object.keys(radius)) === JSON.stringify(["sm", "md", "lg", "xl", "2xl", "full"]),
  "native radius bridge must expose the complete ruled scale",
);
assert(radius["2xl"] === 16, "native 2xl radius must resolve to 16px");
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
assert(
  JSON.stringify(Object.keys(timing)) === JSON.stringify(["fast", "normal", "slow"]),
  "native timing bridge public keys drifted",
);
assert(
  JSON.stringify(Object.keys(mobileShadow)) === JSON.stringify(["subtle", "floating"]),
  "native shadow bridge public keys drifted",
);
assert(
  JSON.stringify(Object.keys(typography.size)) ===
    JSON.stringify([
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
    ]),
  "semantic native typography size bridge drifted",
);

const generatedBlocks = topLevelBlocks(output);
assert(
  generatedBlocks.filter(({ selector }) => selector === ':root[data-mode="light"]').length === 1,
  "generated theme must contain exactly one global light root",
);

const cssSources = {};
for (const sourceName of ["dom.css", "product.css"]) {
  const source = await readFile(resolve(root, "src/css", sourceName), "utf8");
  cssSources[sourceName] = source;
  for (const { selector, body } of topLevelBlocks(source)) {
    const isGlobalTokenOwner =
      selector.startsWith("@theme") ||
      selector === ":root" ||
      selector === ':root[data-mode="light"]';
    if (isGlobalTokenOwner) {
      assert(
        !/^\s*--[a-z0-9-]+\s*:/m.test(body),
        `${sourceName} reintroduces global token declarations in ${selector}`,
      );
    }
  }
}

const domCss = cssSources["dom.css"];
const productCss = cssSources["product.css"];
const domRoot = topLevelBlocks(domCss).find(({ selector }) => selector === ":root")?.body ?? "";
assert(
  /font-family:\s*var\(--font-sans\);/.test(domRoot),
  "dom.css :root must consume var(--font-sans)",
);
assert(!/\bInter\b/.test(domRoot), "dom.css :root must not retain an Inter-leading fallback stack");

for (const declaration of [
  "animation: content-fade-in var(--duration-enter) var(--ease-out-quint);",
  "animation: stream-word-in var(--activity-stream-reveal-fade) linear both;",
  "animation: brand-mark-settle var(--duration-emphasized) var(--ease-standard);",
  "animation: web-sidebar-panel-slide-in var(--duration-panel) var(--ease-spring);",
]) {
  assert(domCss.includes(declaration), `dom.css is missing exact motion declaration: ${declaration}`);
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
]) {
  assert(productCss.includes(declaration), `product.css is missing exact motion declaration: ${declaration}`);
}

assert(
  productCss.includes(
    "background-color var(--duration-hover) var(--ease-standard),\n" +
      "    color var(--duration-hover) var(--ease-standard),\n" +
      "    border-color var(--duration-hover) var(--ease-standard);",
  ),
  "workspace-shell transitions must use the hover duration and standard ease",
);

function checkRawMotionAuthority(css, sourceName) {
  const rulePattern = /((?:\/\*[\s\S]*?\*\/\s*)?[^{}]+)\{([^{}]*)\}/g;
  for (const match of css.matchAll(rulePattern)) {
    const owner = match[1];
    const body = match[2];
    const declarations =
      body.matchAll(/\b(animation(?:-delay)?|transition(?:-[a-z-]+)?)\s*:\s*([^;]+);/g);
    for (const declaration of declarations) {
      const property = declaration[1];
      const value = declaration[2];
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
checkRawMotionAuthority(output, "theme.css");

const tokenSource = await readFile(resolve(root, "src/tokens.ts"), "utf8");
const manifestSource = tokenSource.split("export const themeTokens = {")[1]?.split(
  "} as const satisfies Record<string, ThemeTokenValue>;",
)[0] ?? "";
assert(
  (manifestSource.match(/^\s*"--workspace-shell-action-foreground":\s*\{/gm) ?? []).length === 1,
  "workspace-shell action foreground must have exactly one authority entry",
);

console.log(
  `theme drift check passed (${entries.length} live tokens, 176 shipped, 39 retuned, ${removedTokenNames.length} removals, ${legacyAliasNames.length} aliases)`,
);
