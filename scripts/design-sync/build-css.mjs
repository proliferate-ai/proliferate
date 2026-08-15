#!/usr/bin/env node
/**
 * Compiles the design-sync CSS bundle and fonts.
 *
 * Composes scripts/design-sync/css/ds-source.css (a template — see that
 * file's header) with the generated color/text-role safelist from
 * make-safelist.mjs, compiles it with the Tailwind v4 Node API against the
 * built design package + live product-client registry source, and writes:
 *
 *   .out/_ds_bundle.css   compiled Tailwind CSS (real utilities, not a stub)
 *   .out/styles.css       the two-line shim the payload's card HTML loads
 *   .out/fonts/*.woff2    Inter + Manrope variable subsets, Geist + GeistMono
 *   .out/fonts/fonts.css  flat @font-face rules for the above
 *
 * Run standalone: `node scripts/design-sync/build-css.mjs` (cwd-independent;
 * all paths are resolved from this file's location). Exits non-zero if the
 * compiled CSS is missing a required utility or is implausibly small — both
 * indicate the safelist or the live source scan silently broke.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateSafelistBlock } from "./make-safelist.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const designDir = path.join(repoRoot, "apps/packages/design");
const designDist = path.join(designDir, "dist");
const productCssAbs = path.join(designDist, "css/product.css");
const themeCssAbs = path.join(designDist, "theme.css");
const cssDir = path.join(here, "css");
const templatePath = path.join(cssDir, "ds-source.css");
const outDir = path.join(here, ".out");
const fontsOutDir = path.join(outDir, "fonts");

const MIN_OUTPUT_BYTES = 300 * 1024;
const REQUIRED_SELECTORS = [
  ".bg-background",
  ".text-muted-foreground",
  ".gap-1\\.5",
  ".grid-cols-3",
];
const SPOT_CHECK_SELECTORS = [
  ".text-ui-sm",
  ".bg-surface-elevated",
  ".rounded-lg",
  ".border-border",
];

function step(label) {
  console.log(`\n▶ ${label}`);
}

// ---------------------------------------------------------------------------
// 0. Ensure the design package is built (token authority -> dist/).
// ---------------------------------------------------------------------------
function ensureDesignPackageBuilt() {
  if (existsSync(productCssAbs) && existsSync(themeCssAbs)) return;
  step("apps/packages/design/dist missing — building @proliferate/design");
  execFileSync("pnpm", ["--filter", "@proliferate/design", "build"], {
    stdio: "inherit",
    cwd: repoRoot,
    env: { ...process.env, COREPACK_ENABLE_STRICT: "0" },
  });
  if (!existsSync(productCssAbs) || !existsSync(themeCssAbs)) {
    throw new Error(
      `design package build did not produce expected output (${productCssAbs} / ${themeCssAbs})`
    );
  }
}

// ---------------------------------------------------------------------------
// 1. Resolve the Tailwind v4 Node API + oxide scanner through the real
//    dependency graph: neither is a direct dependency anywhere reachable
//    from this script, but @tailwindcss/vite (in apps/web) depends on both,
//    so resolve THAT first and then resolve from its entry file. Survives
//    version bumps and never guesses at pnpm store directory naming.
// ---------------------------------------------------------------------------
function resolveTailwindNodeApi() {
  try {
    const fromWeb = createRequire(path.join(repoRoot, "apps/web/package.json"));
    const fromVitePlugin = createRequire(fromWeb.resolve("@tailwindcss/vite"));
    return {
      nodeEntry: fromVitePlugin.resolve("@tailwindcss/node"),
      oxideEntry: fromVitePlugin.resolve("@tailwindcss/oxide"),
    };
  } catch (err) {
    throw new Error(
      `could not resolve @tailwindcss/node + @tailwindcss/oxide via apps/web's @tailwindcss/vite — has \`pnpm install\` finished? (${err.message})`
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Compose ds-source.css (template) with the generated safelist.
// ---------------------------------------------------------------------------
function composeSource() {
  let template = readFileSync(templatePath, "utf8");
  const safelist = generateSafelistBlock({ themeCssPath: themeCssAbs, productCssPath: productCssAbs });
  template = template
    .replaceAll("{{PRODUCT_CSS_ABS_PATH}}", productCssAbs)
    .replaceAll("{{GENERATED_SAFELIST}}", safelist);
  if (template.includes("{{")) {
    throw new Error("ds-source.css template still contains an unsubstituted {{ }} marker");
  }
  return template;
}

// ---------------------------------------------------------------------------
// 3. Compile with the Tailwind v4 Node API.
// ---------------------------------------------------------------------------
async function compileCss() {
  const { nodeEntry, oxideEntry } = resolveTailwindNodeApi();
  const { compile } = await import(nodeEntry);
  const { Scanner } = await import(oxideEntry);

  const source = composeSource();
  const deps = new Set();
  const result = await compile(source, {
    base: cssDir,
    onDependency: (p) => deps.add(p),
  });

  const scanner = new Scanner({
    sources: result.sources.map((s) => ({ base: s.base, pattern: s.pattern, negated: s.negated })),
  });
  const candidates = scanner.scan();
  const css = result.build(candidates);

  return { css, candidateCount: candidates.length, sourceCount: result.sources.length, deps };
}

// ---------------------------------------------------------------------------
// 4. Fonts: Inter + Manrope variable subsets (fontsource) + Geist/GeistMono
//    (design package dist), all copied flat with a matching fonts.css.
// ---------------------------------------------------------------------------
function extractFontsourceFaces(indexCssPath) {
  const css = readFileSync(indexCssPath, "utf8");
  const faces = [];
  const blockRe = /@font-face\s*\{([^}]*)\}/g;
  let m;
  while ((m = blockRe.exec(css))) {
    const body = m[1];
    const srcMatch = body.match(/src:\s*url\(\.\/files\/([a-zA-Z0-9_-]+\.woff2)\)\s*format\('woff2-variations'\)/);
    if (!srcMatch) continue;
    const file = srcMatch[1];
    // Only the "wght-normal" (plain weight-axis, upright) subset files match
    // what the reference payload shipped — fontsource also generates
    // opsz/italic/"standard" variants we don't want.
    if (!/-wght-normal\.woff2$/.test(file)) continue;
    const family = body.match(/font-family:\s*'([^']+)'/)?.[1];
    const weight = body.match(/font-weight:\s*([^;]+);/)?.[1]?.trim();
    const fontStyle = body.match(/font-style:\s*([^;]+);/)?.[1]?.trim();
    const unicodeRange = body.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim();
    if (!family || !weight || !fontStyle || !unicodeRange) continue;
    faces.push({ file, family, weight, fontStyle, unicodeRange });
  }
  if (faces.length === 0) {
    throw new Error(`extracted zero -wght-normal.woff2 @font-face rules from ${indexCssPath}`);
  }
  return faces;
}

function buildFonts() {
  mkdirSync(fontsOutDir, { recursive: true });

  const interIndexCss = path.join(designDir, "node_modules/@fontsource-variable/inter/index.css");
  const interFilesDir = path.join(designDir, "node_modules/@fontsource-variable/inter/files");
  const manropeIndexCss = path.join(designDir, "node_modules/@fontsource-variable/manrope/index.css");
  const manropeFilesDir = path.join(designDir, "node_modules/@fontsource-variable/manrope/files");
  const geistDir = path.join(designDist, "fonts");

  const interFaces = extractFontsourceFaces(interIndexCss);
  const manropeFaces = extractFontsourceFaces(manropeIndexCss);

  const cssParts = [];
  let copiedCount = 0;

  for (const [faces, filesDir] of [
    [interFaces, interFilesDir],
    [manropeFaces, manropeFilesDir],
  ]) {
    for (const face of faces) {
      copyFileSync(path.join(filesDir, face.file), path.join(fontsOutDir, face.file));
      copiedCount++;
      cssParts.push(
        [
          "@font-face {",
          `  font-family: '${face.family}';`,
          `  font-style: ${face.fontStyle};`,
          "  font-display: swap;",
          `  font-weight: ${face.weight};`,
          `  src: url(./${face.file}) format('woff2-variations');`,
          `  unicode-range: ${face.unicodeRange};`,
          "}",
        ].join("\n")
      );
    }
  }

  const geistFiles = [
    { src: "Geist-Variable.woff2", family: "Geist" },
    { src: "GeistMono-Variable.woff2", family: "Geist Mono" },
  ];
  for (const { src, family } of geistFiles) {
    const from = path.join(geistDir, src);
    if (!existsSync(from)) {
      throw new Error(`missing ${from} — did the @proliferate/design build run copy-css.mjs?`);
    }
    copyFileSync(from, path.join(fontsOutDir, src));
    copiedCount++;
    cssParts.push(
      [
        "@font-face {",
        `  font-family: "${family}";`,
        `  src: url(./${src}) format("woff2");`,
        "  font-weight: 100 900;",
        "  font-style: normal;",
        "  font-display: swap;",
        "}",
      ].join("\n")
    );
  }

  const fontsCss = cssParts.join("\n\n") + "\n";
  writeFileSync(path.join(fontsOutDir, "fonts.css"), fontsCss);

  return { copiedCount, fontsCssBytes: Buffer.byteLength(fontsCss) };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  ensureDesignPackageBuilt();
  mkdirSync(outDir, { recursive: true });

  step("compiling Tailwind CSS (tailwindcss v4 Node API)");
  const t0 = Date.now();
  const { css, candidateCount, sourceCount, deps } = await compileCss();
  const compileMs = Date.now() - t0;

  const missing = REQUIRED_SELECTORS.filter((sel) => !css.includes(sel));
  const bytes = Buffer.byteLength(css);

  if (missing.length > 0) {
    throw new Error(`compiled CSS is missing required selectors: ${missing.join(", ")}`);
  }
  if (bytes < MIN_OUTPUT_BYTES) {
    throw new Error(
      `compiled CSS is only ${bytes} bytes (expected >= ${MIN_OUTPUT_BYTES}) — safelist or source scan likely broken`
    );
  }
  const htmlOverridePresent = /html,\s*\n?\s*html body\s*\{/.test(css);
  if (!htmlOverridePresent) {
    throw new Error("compiled CSS is missing the `html, html body { background: ... }` override rule");
  }

  writeFileSync(path.join(outDir, "_ds_bundle.css"), css);
  writeFileSync(path.join(outDir, "styles.css"), '@import "./fonts/fonts.css";\n@import "./_ds_bundle.css";\n');

  step("copying fonts");
  const { copiedCount, fontsCssBytes } = buildFonts();

  const spotCheckMisses = SPOT_CHECK_SELECTORS.filter((sel) => !css.includes(sel));

  console.log("\n--- build-css summary ---");
  console.log(`compile:            ${compileMs}ms`);
  console.log(`@source globs:      ${sourceCount}`);
  console.log(`candidates scanned: ${candidateCount}`);
  console.log(`onDependency calls: ${deps.size}`);
  console.log(`_ds_bundle.css:     ${bytes} bytes (${(bytes / 1024).toFixed(1)} KB)`);
  console.log(`required selectors: OK (${REQUIRED_SELECTORS.join(", ")})`);
  console.log(`html override rule: OK`);
  console.log(
    `spot-check selectors: ${
      spotCheckMisses.length === 0 ? "OK (" + SPOT_CHECK_SELECTORS.join(", ") + ")" : "MISSING: " + spotCheckMisses.join(", ")
    }`
  );
  console.log(`fonts copied:       ${copiedCount} woff2 files`);
  console.log(`fonts.css:          ${fontsCssBytes} bytes`);
  console.log(`styles.css:         written (2-line shim)`);

  if (spotCheckMisses.length > 0) {
    console.error(`\nWARNING: registry-demo spot-check selectors missing: ${spotCheckMisses.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("\nbuild-css failed:", err.stack ?? err.message);
  process.exit(1);
});
