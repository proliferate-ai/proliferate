#!/usr/bin/env node
/**
 * Emits, for every registry entry: a trivial `_preview/<Name>.js` module, a
 * `components/<group>/<Name>/<Name>.html` variant card (verbatim reference
 * boilerplate, only group/viewport/script-src/MODE/PRIMARY parameterized),
 * a `<Name>.jsx` (the entry's live source, types stripped, JSX preserved),
 * and a `<Name>.prompt.md` (purpose scraped from specs/DESIGN_SYSTEM.md's
 * sanctioned index, canonical import line, story list, README pointer).
 *
 * See CONTRACT.md "Card HTML" / "Preview modules" for the format this must
 * match, and registry-manifest.mjs for where the entry list + group/mode
 * come from.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadRegistryManifest, REPO_ROOT } from "./registry-manifest.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, ".out");
const TEMPLATES_DIR = path.join(HERE, "templates");
const SPEC_PATH = path.join(REPO_ROOT, "specs/DESIGN_SYSTEM.md");

const ALLOWED_GROUPS = new Set([
  "primitives", "patterns", "icons", "product-patterns",
  "composer", "toast", "sidebar", "settings", "tabs", "panel",
]);

async function loadVite() {
  // vite is a devDependency of product-client, not hoisted to the repo
  // root's node_modules, so resolve it relative to that package.
  const productClientDir = path.join(REPO_ROOT, "apps/packages/product-client");
  const require = createRequire(path.join(productClientDir, "package.json"));
  const viteEntry = require.resolve("vite");
  return import(pathToFileURL(viteEntry).href);
}

/** Extracts {name -> purpose} from every table row in the "### The sanctioned
 * index" section of DESIGN_SYSTEM.md whose first cell is a backtick-quoted
 * component name, e.g. "| `SecretManagementPanel` | [..](..) | Purpose. |".
 * The section is now split into four `#### ` sub-tables (primitives, patterns,
 * icons, domain-aware patterns) with prose between them; every one of those
 * rows counts, and a row's name is either the bare component name
 * (`ChromeTab`) or the tier-relative one the registry also uses
 * (`secrets/SecretManagementPanel`).
 *
 * Scoped to the section only — other tables in the doc (the type ramp,
 * color-role tables) also start rows with a backtick-quoted token and would
 * otherwise collide. Purpose is everything from the third cell on, so a
 * purpose containing a `|` inside a link or code span survives. */
function parseSanctionedIndex(specText) {
  const startMarker = "### The sanctioned index";
  const endMarker = "### How to add a component";
  const start = specText.indexOf(startMarker);
  const end = specText.indexOf(endMarker);
  if (start < 0 || end <= start) {
    throw new Error(
      `emit-cards: could not locate "${startMarker}" .. "${endMarker}" in ${SPEC_PATH} — the sanctioned index moved or was renamed`,
    );
  }
  const section = specText.slice(start, end);
  const purposeByName = new Map();
  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    const nameMatch = /^`([^`]+)`$/.exec(cells[0]);
    if (!nameMatch) continue;
    const purpose = cells.slice(2).join(" | ").trim();
    if (!purpose || /^-{2,}$/.test(purpose)) continue;
    purposeByName.set(nameMatch[1], purpose);
  }
  if (purposeByName.size === 0) {
    throw new Error(`emit-cards: sanctioned index parsed to zero rows — the table format changed in ${SPEC_PATH}`);
  }
  return purposeByName;
}

/** Fallback when a name has no sanctioned-index row: first sentence of the
 * source file's leading /** ... *\/ block, if any. */
function leadingJsDocSentence(source) {
  const match = /^\s*\/\*\*([\s\S]*?)\*\//.exec(source);
  if (!match) return null;
  const text = match[1]
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!text) return null;
  const period = text.indexOf(". ");
  return period > 0 ? text.slice(0, period + 1) : text;
}

/** Leading `/** ... *\/` or `// ...` file-header comment block, if any. */
function leadingHeaderComment(source) {
  const block = /^\s*\/\*[\s\S]*?\*\//.exec(source);
  if (block) return block[0];
  const lineRun = /^\s*(?:\/\/[^\n]*\n)+/.exec(source);
  return lineRun ? lineRun[0].trimEnd() : null;
}

/** esbuild's transform elides type-only leading imports (e.g. `import type
 * { X } from "y"`), and drops that import's attached leading comment along
 * with it — which silently eats a file's header JSDoc when it happens to
 * sit directly above the first (type-only) import. Reattach it verbatim if
 * esbuild's output lost it. */
function withHeaderCommentPreserved(rawSource, transformedCode) {
  const header = leadingHeaderComment(rawSource);
  if (!header) return transformedCode;
  if (transformedCode.includes(header)) return transformedCode;
  return `${header}\n${transformedCode}`;
}

function buildPreviewModule(rawName, displayName) {
  const nameLit = JSON.stringify(rawName);
  const missingLit = JSON.stringify(`missing demo: ${rawName}`);
  return `var __dsPreview = { Demo: (window.ProliferateUI && window.ProliferateUI.__demos ? window.ProliferateUI.__demos[${nameLit}] : null) };
if (!__dsPreview.Demo) {
  // The bootstrap only ever collects function-valued PascalCase keys off
  // window.__dsPreview, so a missing bundle demo mounts as a visible error
  // component instead of leaving the card silently blank.
  __dsPreview.Demo = function () {
    return window.React.createElement(
      "div",
      { style: { padding: "16px", color: "#b91c1c", font: "12px system-ui, sans-serif" } },
      ${missingLit}
    );
  };
}
`;
}

function buildPromptMd({ displayName, purpose, subpath }) {
  return `# ${displayName}

${purpose}

## Import

\`\`\`ts
import { ${displayName} } from "${subpath}";
\`\`\`

\`${subpath}\` is a repo-internal subpath (the \`#product/*\` alias resolves inside
\`apps/packages/product-client\`) — it is not a package specifier and is not
importable from outside this repository. Treat it as a locator for the source
file below, not an install target.

## Stories

- \`Demo\` — the registry's self-contained demo for this component (see
  \`${displayName}.html\` for the rendered card, \`${displayName}.jsx\` for source).

See the payload's \`README.md\` for token/composition rules — the type ramp,
color roles, dark-first behavior, and where the fuller composition and anatomy
truth lives (the repo's \`specs/DESIGN_SYSTEM.md\`).
`;
}

/**
 * Best-effort `.d.ts` pass (deliverable 4, timeboxed): ONE batched
 * `tsc --emitDeclarationOnly` over every entry's srcFile, reusing product-
 * client's own tsconfig. Returns entry.srcFile -> emitted .d.ts absolute
 * path for whichever entries actually got one; entries whose declaration
 * couldn't be produced (or the whole pass, if tsc itself is unusable) are
 * simply absent from the map — callers must treat this as optional.
 *
 * Observed in practice: the batched pass exits non-zero (workspace deps
 * like `@anyharness/sdk`/`@proliferate/cloud-sdk-react` aren't linked here),
 * but TypeScript still emits declarations for every reachable file that
 * doesn't itself error, which in practice is all 81 entries — so a non-zero
 * exit is expected and NOT treated as failure; only a hard spawn error or a
 * timeout skips the whole pass.
 */
async function tryEmitDeclarations(entries) {
  const productClientDir = path.join(REPO_ROOT, "apps/packages/product-client");
  const tscBin = path.join(productClientDir, "node_modules/.bin/tsc");
  const dtsScratchDir = path.join(OUT_DIR, ".dts-scratch");
  const tsconfigPath = path.join(OUT_DIR, ".ds-dts.tsconfig.json");
  const emptyResult = new Map();

  if (!existsSync(tscBin)) {
    console.warn(`emit-cards: .d.ts skipped — tsc not found at ${tscBin}`);
    return emptyResult;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const srcRoot = path.join(productClientDir, "src");
  const tsconfig = {
    extends: path.join(productClientDir, "tsconfig.json"),
    compilerOptions: {
      noEmit: false,
      emitDeclarationOnly: true,
      declaration: true,
      declarationMap: false,
      sourceMap: false,
      skipLibCheck: true,
      outDir: dtsScratchDir,
      rootDir: srcRoot,
    },
    include: entries.map((e) => e.srcFile),
  };
  await writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2), "utf8");

  try {
    execFileSync(tscBin, ["-p", tsconfigPath], { timeout: 5 * 60 * 1000, stdio: "pipe" });
  } catch (err) {
    if (err.signal || /ETIMEDOUT/.test(String(err.message))) {
      console.warn(`emit-cards: .d.ts pass skipped — tsc timed out or was killed (${err.message})`);
      await rm(tsconfigPath, { force: true });
      return emptyResult;
    }
    // Non-zero exit from real type errors elsewhere in the reachable graph
    // is expected (see doc comment) — fall through and harvest whatever
    // landed on disk per entry.
  }

  const dtsByEntrySrc = new Map();
  for (const entry of entries) {
    const rel = path.relative(srcRoot, entry.srcFile).replace(/\.tsx?$/, ".d.ts");
    const dtsPath = path.join(dtsScratchDir, rel);
    if (existsSync(dtsPath)) dtsByEntrySrc.set(entry.srcFile, dtsPath);
  }
  return dtsByEntrySrc;
}

async function main() {
  const entries = await loadRegistryManifest();
  const vite = await loadVite();
  const cardTemplate = await readFile(path.join(TEMPLATES_DIR, "card.html.tmpl"), "utf8");
  if (!existsSync(SPEC_PATH)) {
    throw new Error(`emit-cards: ${SPEC_PATH} is missing — the sanctioned index is the purpose authority`);
  }
  const specText = await readFile(SPEC_PATH, "utf8");
  const purposeByName = parseSanctionedIndex(specText);

  // Resolve every purpose BEFORE the prune below. A purpose-less entry is a
  // build failure, and failing after the prune would replace a good payload
  // with a partial one — which make-meta.mjs, run standalone, would happily
  // hash and ship.
  const fallbackPurposeNames = [];
  const purposeByEntry = new Map();
  {
    const missing = [];
    for (const entry of entries) {
      let purpose = purposeByName.get(entry.name) ?? purposeByName.get(entry.displayName);
      if (!purpose) {
        purpose = leadingJsDocSentence(await readFile(entry.srcFile, "utf8"));
        if (purpose) fallbackPurposeNames.push(entry.name);
      }
      if (!purpose) {
        missing.push(entry.name);
        continue;
      }
      purposeByEntry.set(entry.name, purpose);
    }
    if (missing.length > 0) {
      throw new Error(
        `emit-cards: ${missing.length} entr${missing.length === 1 ? "y has" : "ies have"} no purpose — ` +
          `add a row to specs/DESIGN_SYSTEM.md's sanctioned index (or a header JSDoc on the source file) for:\n` +
          missing.map((n) => `  - ${n}`).join("\n"),
      );
    }
  }

  // Emit into a clean tree: entries get retired and kits move between groups
  // (PaneOptionsMenuItem: patterns -> panel), and a stale card directory from
  // a previous build would otherwise ship as a real component.
  const previewDir = path.join(OUT_DIR, "_preview");
  await rm(previewDir, { recursive: true, force: true });
  await rm(path.join(OUT_DIR, "components"), { recursive: true, force: true });
  mkdirSync(previewDir, { recursive: true });

  let dtsByEntrySrc;
  try {
    dtsByEntrySrc = await tryEmitDeclarations(entries);
  } catch (err) {
    console.warn(`emit-cards: .d.ts pass skipped — unexpected error: ${err.message || err}`);
    dtsByEntrySrc = new Map();
  }

  const seenDirs = new Set();
  let dtsCount = 0;

  for (const entry of entries) {
    const { name, displayName, subpath, group, mode, primary, srcFile } = entry;

    if (!ALLOWED_GROUPS.has(group)) {
      throw new Error(`emit-cards: entry "${name}" has unexpected group "${group}"`);
    }
    if (/[/\s]/.test(displayName)) {
      throw new Error(`emit-cards: display name "${displayName}" (from "${name}") is not path-safe`);
    }

    // 1. preview module
    const previewJs = buildPreviewModule(name, displayName);
    await writeFile(path.join(previewDir, `${displayName}.js`), previewJs, "utf8");

    // 2. component directory
    const dir = path.join(OUT_DIR, "components", group, displayName);
    if (seenDirs.has(dir)) {
      throw new Error(`emit-cards: duplicate component directory ${dir} (name collision across tiers?)`);
    }
    seenDirs.add(dir);
    mkdirSync(dir, { recursive: true });

    // 2a. <Name>.html (dark, the default) and <Name>.light.html.
    // Both cards mount the same demo off the same preview module; the light
    // one only sets data-mode="light" on <html>, which is where the token
    // authority scopes its light palette (:root[data-mode="light"]). Its
    // group is suffixed so the picker keeps the two modes as sibling
    // sections instead of interleaving them.
    const viewportAttr = mode === "grid" ? "" : ` viewport="900x700"`;
    const renderCard = (cardGroup, rootAttr) =>
      cardTemplate
        .replaceAll("__DS_GROUP__", cardGroup)
        .replaceAll("__DS_ROOT_ATTR__", rootAttr)
        .replaceAll("__DS_VIEWPORT_ATTR__", viewportAttr)
        .replaceAll("__DS_NAME__", displayName)
        .replaceAll("__DS_MODE__", mode)
        .replaceAll("__DS_PRIMARY__", primary);
    const cards = [
      { file: `${displayName}.html`, html: renderCard(group, "") },
      { file: `${displayName}.light.html`, html: renderCard(`${group} (light)`, ` data-mode="light"`) },
    ];
    for (const card of cards) {
      const firstLine = card.html.split("\n", 1)[0];
      if (!/^<!-- @dsCard group="[^"]+"( viewport="\d+x\d+")? -->$/.test(firstLine)) {
        throw new Error(`emit-cards: generated card first line failed @dsCard regex for "${name}": ${firstLine}`);
      }
      await writeFile(path.join(dir, card.file), card.html, "utf8");
    }

    // 2b. <Name>.jsx — live source, types stripped, JSX preserved, header comments kept
    const rawSource = await readFile(srcFile, "utf8");
    const transformed = await vite.transformWithEsbuild(rawSource, srcFile, {
      loader: "tsx",
      jsx: "preserve",
      target: "esnext",
    });
    const jsxOut = withHeaderCommentPreserved(rawSource, transformed.code);
    await writeFile(path.join(dir, `${displayName}.jsx`), jsxOut, "utf8");

    // 2c. <Name>.d.ts — best effort, see tryEmitDeclarations
    const dtsPath = dtsByEntrySrc.get(srcFile);
    if (dtsPath) {
      const dtsContent = await readFile(dtsPath, "utf8");
      await writeFile(path.join(dir, `${displayName}.d.ts`), dtsContent, "utf8");
      dtsCount += 1;
    }

    // 2d. <Name>.prompt.md — purpose resolved in the pre-pass above.
    const promptMd = buildPromptMd({ displayName, purpose: purposeByEntry.get(name), subpath });
    await writeFile(path.join(dir, `${displayName}.prompt.md`), promptMd, "utf8");
  }

  // Scratch tsc output/tsconfig are not part of the shipped payload — only
  // the per-component copies harvested above are.
  await rm(path.join(OUT_DIR, ".dts-scratch"), { recursive: true, force: true });
  await rm(path.join(OUT_DIR, ".ds-dts.tsconfig.json"), { force: true });

  console.log(
    `emit-cards: wrote ${entries.length} previews + component dirs (${entries.length * 2} cards: dark + light) -> ${OUT_DIR}`,
  );
  console.log(
    `emit-cards: ${entries.length - fallbackPurposeNames.length} purposes from sanctioned index, ` +
      `${fallbackPurposeNames.length} from JSDoc fallback${fallbackPurposeNames.length ? ` (${fallbackPurposeNames.join(", ")})` : ""}`,
  );
  console.log(`emit-cards: ${dtsCount}/${entries.length} entries got a .d.ts`);
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
