#!/usr/bin/env node
/**
 * Emits the metadata layer of the payload: `_ds_sync.json` (internal sync
 * recipe), `.ds-build-meta.json`, `_ds_needs_recompile`, and `README.md`.
 *
 * Meant to run LAST in build.mjs's stage order, since it hashes the real
 * bytes of everything else. Run standalone (e.g. while other streams'
 * artifacts don't exist yet), it degrades gracefully: any hash input that's
 * missing on disk is skipped with a console warning rather than a hard
 * failure, so this is safe to run repeatedly while the payload assembles.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadRegistryManifest, REPO_ROOT, tierFilePath } from "./registry-manifest.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, ".out");
const TEMPLATES_DIR = path.join(HERE, "templates");
const THEME_CSS_PATH = path.join(REPO_ROOT, "apps/packages/design/dist/theme.css");

const sha256Hex = (buf) => createHash("sha256").update(buf).digest("hex");
const sha256_16 = (buf) => sha256Hex(buf).slice(0, 16);
const sha256_12 = (buf) => sha256Hex(buf).slice(0, 12);

async function tryRead(filePath) {
  try {
    return await readFile(filePath);
  } catch {
    return null;
  }
}

function warnMissing(label, filePath) {
  console.warn(`make-meta: WARNING — ${label} missing at ${filePath}, skipping (rerun make-meta once every stream has built)`);
}

function gitShortSha() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT }).toString().trim();
  } catch {
    return "unknown";
  }
}

/** Unique custom-property names out of a compiled theme.css, bucketed the
 * way the reference payload's "## Tokens" section did — computed fresh from
 * the token authority's own build output, never hand-copied. */
function tokenFacts(themeCss) {
  const names = new Set();
  for (const m of themeCss.matchAll(/--([a-z][a-z0-9-]*)\s*:/g)) names.add(m[1]);
  const startsWith = (prefix) => [...names].filter((n) => n.startsWith(prefix));
  const textRoles = [...names]
    .filter((n) => n.startsWith("text-") && !n.endsWith("--line-height") && !n.endsWith("--letter-spacing"))
    .sort();
  return {
    total: names.size,
    color: startsWith("color-").length,
    textRoles,
    radius: startsWith("radius").length,
    shadow: startsWith("shadow").length,
  };
}

function componentsSection(entries) {
  const byGroup = new Map();
  for (const entry of entries) {
    if (!byGroup.has(entry.group)) byGroup.set(entry.group, []);
    byGroup.get(entry.group).push(entry.displayName);
  }
  const groupOrder = ["primitives", "patterns", "icons", "product-patterns", "composer", "toast", "sidebar", "settings"];
  const lines = [];
  for (const group of groupOrder) {
    const names = byGroup.get(group);
    if (!names || names.length === 0) continue;
    lines.push(`### ${group}`, "");
    for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
      lines.push(`- \`${name}\``);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

async function buildReadme(entries) {
  const template = await readFile(path.join(TEMPLATES_DIR, "README.md.tmpl"), "utf8");
  const themeCss = existsSync(THEME_CSS_PATH) ? await readFile(THEME_CSS_PATH, "utf8") : "";
  if (!themeCss) warnMissing("theme.css (token counts will read 0)", THEME_CSS_PATH);
  const facts = tokenFacts(themeCss);
  const textRolesList = facts.textRoles.map((r) => `\`${r}\``).join(", ") + ".";
  const readme = template
    .replaceAll("__DS_TEXT_ROLE_COUNT__", String(facts.textRoles.length))
    .replaceAll("__DS_TEXT_ROLES_LIST__", textRolesList)
    .replaceAll("__DS_GIT_SHA__", gitShortSha())
    .replaceAll("__DS_COMPONENT_COUNT__", String(entries.length))
    .replaceAll("__DS_TOTAL_TOKEN_COUNT__", String(facts.total))
    .replaceAll("__DS_COLOR_COUNT__", String(facts.color))
    .replaceAll("__DS_RADIUS_COUNT__", String(facts.radius))
    .replaceAll("__DS_SHADOW_COUNT__", String(facts.shadow))
    .replaceAll("__DS_COMPONENTS_SECTION__", componentsSection(entries));
  return readme;
}

async function computeSourceHashes(entries) {
  const sourceHashes = {};
  const exts = [".jsx", ".prompt.md", ".d.ts"];
  for (const entry of entries) {
    const dir = path.join(OUT_DIR, "components", entry.group, entry.displayName);
    for (const ext of exts) {
      const rel = `components/${entry.group}/${entry.displayName}/${entry.displayName}${ext}`;
      const abs = path.join(dir, `${entry.displayName}${ext}`);
      const buf = await tryRead(abs);
      if (buf === null) {
        if (ext !== ".d.ts") warnMissing(rel, abs); // .d.ts is best-effort; silent skip
        continue;
      }
      sourceHashes[rel] = sha256_12(buf);
    }
  }
  return sourceHashes;
}

async function computeRenderAndSourceKeys(entries) {
  const renderHashes = {};
  const sourceKeys = {};
  const tierFileCache = new Map();
  for (const entry of entries) {
    const srcBuf = await tryRead(entry.srcFile);
    if (srcBuf === null) {
      warnMissing(`entry src for ${entry.name}`, entry.srcFile);
      continue;
    }
    sourceKeys[entry.name] = sha256_16(srcBuf);

    let tierBuf = tierFileCache.get(entry.tierId);
    if (tierBuf === undefined) {
      tierBuf = await tryRead(tierFilePath(entry.tierId));
      tierFileCache.set(entry.tierId, tierBuf);
    }
    if (tierBuf === null) {
      warnMissing(`tier file for ${entry.tierId}`, tierFilePath(entry.tierId));
      continue;
    }
    renderHashes[entry.name] = sha256_16(Buffer.concat([tierBuf, srcBuf]));
  }
  return { renderHashes, sourceKeys };
}

async function computeScriptsSha() {
  // Everything that shapes the payload bytes: top-level scripts, the React
  // shims, the card/README templates, and the CSS inputs. Skips .out/.
  const all = await readdir(HERE, { recursive: true });
  const files = all
    .filter((f) => !f.startsWith(".out"))
    .filter(
      (f) =>
        f.endsWith(".mjs") ||
        f.startsWith(`templates${path.sep}`) ||
        f.startsWith(`css${path.sep}`),
    )
    .sort();
  const buffers = await Promise.all(files.map((f) => readFile(path.join(HERE, f))));
  return sha256_16(Buffer.concat(buffers));
}

async function main() {
  const entries = await loadRegistryManifest();

  // README first — auxSha below needs its final bytes.
  const readme = await buildReadme(entries);
  await writeFile(path.join(OUT_DIR, "README.md"), readme, "utf8");

  const bundleCssBuf = await tryRead(path.join(OUT_DIR, "_ds_bundle.css"));
  if (bundleCssBuf === null) warnMissing("_ds_bundle.css", path.join(OUT_DIR, "_ds_bundle.css"));
  const styleSha = bundleCssBuf === null ? null : sha256Hex(bundleCssBuf);

  const bundleJsBuf = await tryRead(path.join(OUT_DIR, "_ds_bundle.js"));
  if (bundleJsBuf === null) warnMissing("_ds_bundle.js", path.join(OUT_DIR, "_ds_bundle.js"));
  const bundleSha12 = bundleJsBuf === null ? null : sha256_12(bundleJsBuf);

  const stylesCssBuf = (await tryRead(path.join(OUT_DIR, "styles.css"))) ?? Buffer.alloc(0);
  const fontsCssBuf = (await tryRead(path.join(OUT_DIR, "fonts", "fonts.css"))) ?? Buffer.alloc(0);
  if (stylesCssBuf.length === 0) warnMissing("styles.css", path.join(OUT_DIR, "styles.css"));
  if (fontsCssBuf.length === 0) warnMissing("fonts/fonts.css", path.join(OUT_DIR, "fonts", "fonts.css"));
  const auxSha = sha256_16(Buffer.concat([Buffer.from(readme, "utf8"), stylesCssBuf, fontsCssBuf]));

  const { renderHashes, sourceKeys } = await computeRenderAndSourceKeys(entries);
  const sourceHashes = await computeSourceHashes(entries);
  const scriptsSha = await computeScriptsSha();

  const dsSync = {
    shape: "registry",
    styleSha,
    renderHashes,
    sourceKeys,
    keyRecipe: 8,
    scriptsSha,
    sourceHashes,
    auxSha,
    bundleSha12,
  };
  await writeFile(path.join(OUT_DIR, "_ds_sync.json"), `${JSON.stringify(dsSync, null, 2)}\n`, "utf8");

  const buildMeta = {
    namespace: "ProliferateUI",
    source: `library-registry@${gitShortSha()}`,
    shape: "registry",
    provider: null,
    componentCount: entries.length,
    skippedStoryIds: [],
    runtimeFontPrefixes: [],
  };
  await writeFile(path.join(OUT_DIR, ".ds-build-meta.json"), `${JSON.stringify(buildMeta, null, 2)}\n`, "utf8");

  // Exact 24 bytes, no trailing newline.
  const needsRecompile = `{"by":"design-sync-cli"}`;
  if (Buffer.byteLength(needsRecompile, "utf8") !== 24) {
    throw new Error(`make-meta: _ds_needs_recompile payload is ${Buffer.byteLength(needsRecompile, "utf8")} bytes, expected 24`);
  }
  await writeFile(path.join(OUT_DIR, "_ds_needs_recompile"), needsRecompile, "utf8");

  console.log(`make-meta: wrote _ds_sync.json (${Object.keys(renderHashes).length}/${entries.length} renderHashes, ${Object.keys(sourceKeys).length}/${entries.length} sourceKeys, ${Object.keys(sourceHashes).length} sourceHashes)`);
  console.log(`make-meta: styleSha=${styleSha ? "ok" : "MISSING"} bundleSha12=${bundleSha12 ? "ok" : "MISSING"} auxSha=${auxSha}`);
  console.log("make-meta: wrote .ds-build-meta.json, _ds_needs_recompile, README.md");
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
