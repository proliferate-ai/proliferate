/**
 * Projects the TypeScript token authority into `dist/theme.css`.
 *
 * Build-order law: `tsc` runs first, so this script imports the compiled
 * `dist/tokens.js` rather than re-parsing source. `scripts/check-theme.mjs`
 * re-projects the same authority independently and asserts byte equality.
 *
 * Emitted structure:
 *   @theme                  Tailwind's design-token surface. `color-mix()` is
 *                           illegal here, so every mix value renders through
 *                           its `themeFallback` literal.
 *   :root                   dark runtime values (relative `color-mix()` form).
 *   :root[data-mode=light]  one flattened light root (no second light block).
 *
 * Shadows are the one namespace that cannot use that scheme. Tailwind inlines a
 * `shadow-*` utility's value into `--tw-shadow` at build time, so whatever
 * `@theme` holds is what every call site paints in BOTH modes — redeclaring
 * `--shadow-*` under `[data-mode=light]` changes nothing, because no utility
 * reads it. So each `--shadow-*` is emitted into `@theme` as a `var()` pointing
 * at a parallel `--elevation-*` property, and the two roots carry the real
 * per-mode values under that name. The utility then inlines the indirection
 * instead of a literal and resolves per mode at runtime.
 *   @utility …              semantic z / duration / ease / icon-button/radius
 *                           utilities generated from the same names.
 *   keyframes + reduced motion.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { densityRungs, radiusRungs, rungAttributes, rungTokens } from "../dist/rungs.js";
import { themeTokens } from "../dist/tokens.js";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const entries = Object.entries(themeTokens);

/**
 * `--shadow-x` in `@theme` becomes `var(--elevation-x)`; the per-mode literal
 * moves to `--elevation-x` in each root. See the shadow note in the file header
 * for why this namespace needs the indirection and the others do not.
 */
const ELEVATION_PREFIX = "--elevation-";
const SHADOW_PREFIX = "--shadow-";

function elevationName(shadowName) {
  return `${ELEVATION_PREFIX}${shadowName.slice(SHADOW_PREFIX.length)}`;
}

function declarations(mode, indent = "  ") {
  return entries
    .flatMap(([name, value]) => {
      if (name.startsWith(SHADOW_PREFIX)) {
        // In `@theme` the token points at its elevation twin so the generated
        // utility inlines a var() rather than one mode's literal. In a mode root
        // the twin carries that mode's value, and the token itself is kept as an
        // alias so `var(--shadow-*)` in hand-authored CSS still resolves.
        return mode === "theme"
          ? [`${indent}${name}: var(${elevationName(name)});`]
          : [
              `${indent}${elevationName(name)}: ${value[mode]};`,
              `${indent}${name}: var(${elevationName(name)});`,
            ];
      }

      const renderedValue = mode === "theme" ? (value.themeFallback ?? value.dark) : value[mode];
      return [`${indent}${name}: ${renderedValue};`];
    })
    .join("\n");
}

function utility(name, property, tokenName = name) {
  return `@utility ${name} {
  ${property}: var(--${tokenName});
}`;
}

const zUtilities = [
  "base",
  "raised",
  "sticky",
  "overlay",
  "popover",
  "toast",
  "tooltip",
  "top",
].map((name) => utility(`z-${name}`, "z-index"));

const durationUtilities = ["hover", "enter", "exit", "disclosure", "panel", "pop", "emphasized"].map(
  (name) => utility(`duration-${name}`, "transition-duration"),
);

const easeUtilities = ["out-quint", "pop", "spring", "standard", "linear"].map((name) =>
  utility(`ease-${name}`, "transition-timing-function"),
);

const iconButtonSizeUtilities = ["sm", "md", "lg"].map(
  (name) => `@utility size-icon-button-${name} {
  width: var(--size-icon-button-${name});
  height: var(--size-icon-button-${name});
}`,
);

/**
 * Geometry rungs. The `default` rung IS the token value (tokens.ts reads it),
 * so it needs no block. Every other rung re-points the same tokens under the
 * attribute the app sets on the document element — the density/radius twin of
 * `:root[data-mode="light"]`. No alternate rung is populated today, so this
 * emits nothing; populating one in rungs.ts is the whole change.
 */
function rungBlocks() {
  const families = [
    ["radius", radiusRungs],
    ["density", densityRungs],
  ];
  const blocks = [];
  for (const [family, rungs] of families) {
    for (const [rungName, values] of Object.entries(rungs)) {
      if (rungName === "default") continue;
      const lines = Object.entries(rungTokens[family]).map(
        ([key, tokenName]) => `  ${tokenName}: ${values[key]};`,
      );
      blocks.push(`:root[${rungAttributes[family]}="${rungName}"] {\n${lines.join("\n")}\n}`);
    }
  }
  return blocks;
}

const css = `@theme {
  --color-*: initial;
  --text-*: initial;

${declarations("theme")}
}

:root {
${declarations("dark")}
}

:root[data-mode="light"] {
${declarations("light")}
}

${[
  ...rungBlocks(),
  "@utility rounded-inherit {\n  border-radius: inherit;\n}",
  ...zUtilities,
  ...durationUtilities,
  ...easeUtilities,
  ...iconButtonSizeUtilities,
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
    --duration-pop: 0ms;
    --duration-emphasized: 0ms;
  }

  .proliferate-spinner > svg {
    animation: none;
    transform: rotate(22deg);
  }
}
`;

const target = resolve(root, "dist/theme.css");
await mkdir(dirname(target), { recursive: true });
await writeFile(target, css);
