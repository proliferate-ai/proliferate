import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopSrc = resolve(repoRoot, "apps/desktop/src");
const ledgerPath = resolve(repoRoot, "specs/codebase/features/web-desktop-product-client-move-ledger.json");

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir).sort()) {
    const path = resolve(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      entries.push(...walk(path));
    } else {
      entries.push(path);
    }
  }
  return entries;
}

function rel(path) {
  return relative(repoRoot, path).replaceAll("\\", "/");
}

function classify(path) {
  const source = rel(path);
  const srcRelative = source.slice("apps/desktop/src/".length);
  if (
    srcRelative === "main.tsx"
    || srcRelative === "index.css"
    || srcRelative === "assets.d.ts"
    || srcRelative.startsWith("lib/access/tauri/")
    || srcRelative.startsWith("lib/access/browser/")
    || srcRelative.startsWith("providers/Desktop")
    || srcRelative === "providers/desktop-product-host.ts"
    || srcRelative === "providers/desktop-product-host.test.ts"
    || srcRelative.startsWith("test/")
  ) {
    return {
      action: "retain",
      source,
      reason: "Desktop host, native bridge, browser storage adapter, or test harness remains in the thin Desktop app.",
    };
  }
  if (
    srcRelative === "App.tsx"
    || srcRelative === "providers/ProductProviderRoot.tsx"
    || srcRelative === "providers/ProductLifecycleRoot.tsx"
    || srcRelative === "providers/ProductLifecycleRoot.test.tsx"
  ) {
    return {
      action: "split",
      source,
      target: `apps/packages/product-client/src/${srcRelative}`,
      reason: "Root composition splits into a host shell plus shared ProductClient route/provider ownership.",
    };
  }
  return {
    action: "move",
    source,
    target: `apps/packages/product-client/src/${srcRelative}`,
    reason: "Desktop product source moves mechanically into ProductClient.",
  };
}

function buildLedger() {
  return {
    schemaVersion: 1,
    generatedFrom: "scripts/migrate-desktop-product-client.mjs",
    desktopSourceRoot: "apps/desktop/src",
    productClientTargetRoot: "apps/packages/product-client/src",
    entries: walk(desktopSrc)
      .filter((path) => /\.(ts|tsx|css|json|svg|png|jpg|jpeg|webp|wav|mp3|woff2)$/.test(path))
      .map(classify),
  };
}

function writeLedger() {
  const ledger = buildLedger();
  mkdirSync(dirname(ledgerPath), { recursive: true });
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(`Wrote ${ledger.entries.length} move-ledger entries to ${rel(ledgerPath)}`);
}

function checkLedger() {
  const expected = JSON.stringify(buildLedger(), null, 2) + "\n";
  const actual = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
  if (actual !== expected) {
    throw new Error(`Move ledger is stale. Run: node scripts/migrate-desktop-product-client.mjs ledger`);
  }
  const ledger = JSON.parse(actual);
  const targets = new Map();
  for (const entry of ledger.entries) {
    if (!existsSync(resolve(repoRoot, entry.source))) {
      throw new Error(`Ledger source is missing: ${entry.source}`);
    }
    if (entry.target) {
      const previous = targets.get(entry.target);
      if (previous) {
        throw new Error(`Ledger maps two sources to ${entry.target}: ${previous} and ${entry.source}`);
      }
      targets.set(entry.target, entry.source);
    }
  }
  console.log(`Checked ${ledger.entries.length} move-ledger entries.`);
}

function loadMovedMap(root) {
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  const moved = new Map();
  for (const entry of ledger.entries) {
    if (entry.action === "move" || entry.action === "split") {
      moved.set(entry.source, entry.target);
    }
  }
  return { ledger, moved, root };
}

function resolveDesktopAlias(importer, specifier) {
  if (specifier.startsWith("@/")) {
    return `apps/desktop/src/${specifier.slice(2)}`;
  }
  if (!specifier.startsWith(".")) {
    return null;
  }
  const importerDir = dirname(importer);
  const candidate = resolve(repoRoot, importerDir, specifier);
  for (const extension of ["", ".ts", ".tsx", ".css", ".json"]) {
    const full = `${candidate}${extension}`;
    if (existsSync(full)) {
      return rel(full);
    }
  }
  return null;
}

function productSpecifierFor(target) {
  return `#product/${target.slice("apps/packages/product-client/src/".length).replace(/\.(ts|tsx)$/, "")}`;
}

function rewriteSource(importer, source, moved) {
  return source.replace(
    /from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g,
    (match, staticSpecifier, dynamicSpecifier) => {
      const specifier = staticSpecifier ?? dynamicSpecifier;
      const resolved = resolveDesktopAlias(importer, specifier);
      if (!resolved || !moved.has(resolved)) {
        return match;
      }
      const next = productSpecifierFor(moved.get(resolved));
      return staticSpecifier ? `from "${next}"` : `import("${next}")`;
    },
  );
}

function codemod({ root, apply }) {
  const { moved } = loadMovedMap(root);
  const files = walk(resolve(repoRoot, root)).filter((path) => /\.(ts|tsx)$/.test(path));
  const changes = [];
  for (const file of files) {
    const path = rel(file);
    const source = readFileSync(file, "utf8");
    const next = rewriteSource(path, source, moved);
    if (source !== next) {
      changes.push(path);
      if (apply) {
        writeFileSync(file, next);
      }
    }
  }
  if (!apply && changes.length > 0) {
    console.log(changes.join("\n"));
    throw new Error(`Codemod would update ${changes.length} files.`);
  }
  console.log(`${apply ? "Updated" : "Checked"} ${files.length} files; ${changes.length} changes.`);
}

function proveCodemod() {
  checkLedger();
  const tmp = resolve(repoRoot, ".tmp/product-client-codemod-proof");
  rmSync(tmp, { force: true, recursive: true });
  mkdirSync(dirname(tmp), { recursive: true });
  cpSync(desktopSrc, resolve(tmp, "apps/desktop/src"), { recursive: true });
  const proofRoot = relative(repoRoot, resolve(tmp, "apps/desktop/src")).replaceAll("\\", "/");
  codemod({ root: proofRoot, apply: true });
  codemod({ root: proofRoot, apply: false });
  rmSync(tmp, { force: true, recursive: true });
}

const command = process.argv[2];
switch (command) {
  case "ledger":
    writeLedger();
    break;
  case "check-ledger":
    checkLedger();
    break;
  case "codemod-check":
    checkLedger();
    codemod({ root: process.argv[3] ?? "apps/desktop/src", apply: false });
    break;
  case "codemod-apply":
    checkLedger();
    codemod({ root: process.argv[3] ?? "apps/desktop/src", apply: true });
    break;
  case "prove-codemod":
    proveCodemod();
    break;
  default:
    throw new Error("Usage: node scripts/migrate-desktop-product-client.mjs <ledger|check-ledger|codemod-check|codemod-apply|prove-codemod> [root]");
}
