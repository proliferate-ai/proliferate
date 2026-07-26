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
 *   @utility …              semantic z / duration / ease / icon-button/radius
 *                           utilities generated from the same names.
 *   keyframes + reduced motion.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { themeTokens } from "../dist/tokens.js";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const entries = Object.entries(themeTokens);

function declarations(mode, indent = "  ") {
  return entries
    .map(([name, value]) => {
      const renderedValue = mode === "theme" ? (value.themeFallback ?? value.dark) : value[mode];
      return `${indent}${name}: ${renderedValue};`;
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

const durationUtilities = ["hover", "enter", "exit", "disclosure", "panel", "emphasized"].map(
  (name) => utility(`duration-${name}`, "transition-duration"),
);

const easeUtilities = ["out-quint", "spring", "standard", "linear"].map((name) =>
  utility(`ease-${name}`, "transition-timing-function"),
);

const iconButtonSizeUtilities = ["sm", "md", "lg"].map(
  (name) => `@utility size-icon-button-${name} {
  width: var(--size-icon-button-${name});
  height: var(--size-icon-button-${name});
}`,
);

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
