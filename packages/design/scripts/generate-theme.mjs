import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  colors,
  radius,
  shadows,
  typography,
} from "../dist/tokens.js";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

function kebab(value) {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function px(value) {
  return `${value / 16}rem`;
}

const colorLines = Object.entries(colors)
  .map(([name, value]) => `  --color-${kebab(name)}: ${value};`)
  .join("\n");

const radiusLines = [
  `  --radius: ${px(radius.lg)};`,
  `  --radius-sm: ${px(radius.sm)};`,
  `  --radius-md: ${px(radius.md)};`,
  `  --radius-lg: ${px(radius.lg)};`,
  `  --radius-xl: ${px(radius.xl)};`,
  "  --radius-full: 9999px;",
  `  --radius-composer: ${px(radius.lg)};`,
].join("\n");

const fontSizeLines = Object.entries(typography.size)
  .flatMap(([name, value]) => {
    const lineHeight = typography.lineHeight[name];
    const tokenName = kebab(name);
    return [
      `  --text-${tokenName}: ${px(value)};`,
      `  --text-${tokenName}--line-height: ${px(lineHeight)};`,
    ];
  })
  .join("\n");

const shadowLines = Object.entries(shadows)
  .map(([name, value]) => `  --shadow-${kebab(name)}: ${value};`)
  .join("\n");

const css = `@theme {
  --color-*: initial;

  --font-sans: ${typography.fontSans};
  --font-mono: ${typography.fontMono};

${colorLines}

${radiusLines}

${fontSizeLines}

${shadowLines}
}

@keyframes proliferate-spinner-rotate {
  to {
    transform: rotate(360deg);
  }
}

.proliferate-spinner {
  animation: proliferate-spinner-rotate 1.1s linear infinite;
  transform-origin: center;
  will-change: transform;
}

@media (prefers-reduced-motion: reduce) {
  .proliferate-spinner {
    animation: none;
    transform: rotate(45deg);
    will-change: auto;
  }
}
`;

const target = resolve(root, "dist/theme.css");
await mkdir(dirname(target), { recursive: true });
await writeFile(target, css);
