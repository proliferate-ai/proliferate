/**
 * DEV-ONLY: projects src/profiles.ts (compiled to dist/profiles.js) into
 * dist/theme-profiles.css as attribute-scoped override blocks, the same shape
 * the rung generator uses. Never ships; deleted with profiles.ts once a
 * direction is ruled.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { themeProfiles } from "../dist/profiles.js";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

const blocks = Object.entries(themeProfiles).map(([name, profile]) => {
  const lines = Object.entries(profile.tokens)
    .map(([token, value]) => `  ${token}: ${value};`)
    .join("\n");
  return `/* ${name}: ${profile.intent} */\n:root[data-mode="light"][data-theme-profile="${name}"] {\n${lines}\n}`;
});

const css = `/* DEV-ONLY light-mode theme profiles — generated, never shipped.
 * Flip in devtools:
 *   document.documentElement.setAttribute("data-mode", "light")
 *   document.documentElement.setAttribute("data-theme-profile", "${Object.keys(themeProfiles)[0]}")
 * Remove the attribute to return to the current light baseline.
 */

${blocks.join("\n\n")}
`;

const target = resolve(root, "dist/theme-profiles.css");
await mkdir(dirname(target), { recursive: true });
await writeFile(target, css);
console.log(`generate-profiles: ${Object.keys(themeProfiles).length} profiles -> dist/theme-profiles.css`);
