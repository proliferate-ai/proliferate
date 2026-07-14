#!/usr/bin/env node
// Ledger-driven import codemod for the Desktop -> @proliferate/product-client move.
//
// Reads the checked move ledger
// (specs/codebase/features/web-desktop-product-client-move-ledger.md) and, for
// every module classified `move`, rewrites the Desktop-local import/export
// specifiers (`@/...` alias and relative `./`,`../`) that resolve to another
// `move`-classified JS/TS module into package-private `#product/*` specifiers.
// Retained/split/delete targets, asset/CSS/JSON specifiers, and reaches outside
// `apps/desktop/src` are left untouched.
//
//   node scripts/migrate-desktop-product-client.mjs --check   # plan only, no writes
//   node scripts/migrate-desktop-product-client.mjs --apply   # rewrite in place
//
// Options:
//   --src <dir>      source root to operate on (default apps/desktop/src). Used by
//                    the disposable-copy proof; ledger relpaths still key off this root.
//   --ledger <path>  ledger markdown (default the checked ledger under specs/).
//
// Guarantees:
//   * Deterministic: planned rewrites print to stdout, sorted by (source, position);
//     no timestamps; edits applied end-to-first so offsets never shift.
//   * Idempotent: `#product/*` specifiers are neither `@/` nor relative, so a second
//     --apply is a no-op and a --check after --apply prints nothing.
//   * Parsing, not text replacement: specifier string-literal nodes are located with
//     the TypeScript parser (AST) and spliced by position; only the specifier token
//     is ever touched.
//
// Refuses (exit nonzero) on: a ledger parse failure; a `move` source referencing an
// under-`src` local path that has no ledger row or does not resolve to a file; or a
// computed rewrite target that is not a ledger-approved `move` path.
//
// Scope note (justified): the package `imports` map resolves `#product/*` only to
// `./dist/*.js`, so only compiled JS/TS modules are eligible for `#product/*`.
// Asset/CSS/JSON local specifiers (e.g. `@/assets/...svg?raw`, the six-level
// `catalog.json?raw` reach) are deliberately left untouched here and are enumerated
// as move-PR asset-resolution work in the ledger's "Known wrinkles"; a co-moved
// relative asset import stays correct after the move, and an aliased asset import
// cannot be expressed as `#product/*`. This keeps the codemod from ever emitting a
// broken `#product/*` asset specifier.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(SCRIPT_DIR);

// TypeScript lives in workspace package node_modules, not the repo root.
const requireFrom = createRequire(path.join(REPO_ROOT, "apps", "desktop", "package.json"));
const ts = requireFrom("typescript");

const FENCE = "```ledger";
const VALID_CLASS = new Set(["move", "split", "retain", "delete"]);
const MODULE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
// Order mirrors bundler/TS module resolution preference; assets resolve via exact path.
const RESOLVE_EXTS = [".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".cjs"];
const INDEX_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

class LedgerError extends Error {}
class MigrationError extends Error {}

function parseArgs(argv) {
  const opts = { mode: null, src: null, ledger: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") opts.mode = "check";
    else if (a === "--apply") opts.mode = "apply";
    else if (a === "--src") opts.src = argv[++i];
    else if (a === "--ledger") opts.ledger = argv[++i];
    else throw new MigrationError(`unknown argument: ${a}`);
  }
  if (!opts.mode) throw new MigrationError("mode required: pass --check or --apply");
  return opts;
}

// Mirrors scripts/check-product-client-move-ledger.py parse_ledger semantics: the
// fenced ```ledger block, tab-split rows, >=4 fields, valid classification.
function parseLedger(ledgerPath) {
  const text = fs.readFileSync(ledgerPath, "utf8");
  const lines = text.split(/\r?\n/);
  const rows = new Map(); // src -> { cls, tgt }
  let inside = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!inside) {
      if (trimmed === FENCE) inside = true;
      continue;
    }
    if (trimmed === "```") {
      inside = false;
      continue;
    }
    if (trimmed === "") continue;
    const parts = line.split("\t");
    if (parts.length < 4) {
      throw new LedgerError(`ledger L${i + 1}: expected >=4 tab fields, got ${parts.length}`);
    }
    const [src, cls, tgt] = parts;
    if (!VALID_CLASS.has(cls)) {
      throw new LedgerError(`ledger L${i + 1}: invalid classification ${JSON.stringify(cls)} for ${src}`);
    }
    if (rows.has(src)) {
      throw new LedgerError(`ledger L${i + 1}: source classified more than once: ${src}`);
    }
    rows.set(src, { cls, tgt });
  }
  if (inside) throw new LedgerError("ledger: unterminated ```ledger block");
  if (rows.size === 0) throw new LedgerError("ledger: no rows parsed (missing ```ledger block?)");
  return rows;
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function stripQuery(spec) {
  const q = spec.search(/[?#]/);
  return q >= 0 ? { base: spec.slice(0, q), query: spec.slice(q) } : { base: spec, query: "" };
}

function isModuleExt(rel) {
  if (rel.endsWith(".d.ts")) return false;
  return MODULE_EXTS.some((e) => rel.endsWith(e));
}

function stripModuleExt(rel) {
  for (const e of MODULE_EXTS) {
    if (rel.endsWith(e)) return rel.slice(0, -e.length);
  }
  return rel;
}

// Resolve a local (@/ or relative) specifier base to a concrete on-disk file.
// Returns { external: true } for reaches outside srcRoot, or { relpath } (posix,
// relative to srcRoot) for an under-src resolution, or null if unresolved.
function resolveLocal(base, fileAbs, srcRoot) {
  let targetAbs;
  if (base.startsWith("@/")) {
    targetAbs = path.join(srcRoot, base.slice(2));
  } else if (base === "." || base === ".." || base.startsWith("./") || base.startsWith("../")) {
    targetAbs = path.resolve(path.dirname(fileAbs), base);
  } else {
    return { bare: true }; // external package specifier; ignore
  }

  const relCheck = path.relative(srcRoot, targetAbs);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    return { external: true };
  }

  const candidates = [];
  const isFile = (p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  const isDir = (p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  };

  if (isFile(targetAbs)) candidates.push(targetAbs);
  // .js-family specifier pointing at a .ts-family source (ESM style)
  const jsSwap = { ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] };
  const ext = path.extname(targetAbs);
  if (jsSwap[ext]) {
    for (const alt of jsSwap[ext]) {
      const swapped = targetAbs.slice(0, -ext.length) + alt;
      if (isFile(swapped)) candidates.push(swapped);
    }
  }
  for (const e of RESOLVE_EXTS) {
    if (isFile(targetAbs + e)) candidates.push(targetAbs + e);
  }
  if (isDir(targetAbs)) {
    for (const e of INDEX_EXTS) {
      const idx = path.join(targetAbs, "index" + e);
      if (isFile(idx)) candidates.push(idx);
    }
  }
  if (candidates.length === 0) return null;
  return { relpath: toPosix(path.relative(srcRoot, candidates[0])) };
}

// Collect module-specifier string-literal nodes (import/export/dynamic-import/
// require/import-type/import-equals) with their exact span.
function collectSpecifiers(sourceFile) {
  const found = [];
  const visit = (node) => {
    let lit = null;
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      lit = node.moduleSpecifier;
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      lit = node.arguments[0];
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      lit = node.argument.literal;
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      lit = node.moduleReference.expression;
    }
    if (lit) {
      found.push({ start: lit.getStart(sourceFile), end: lit.getEnd(), value: lit.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function scriptKindFor(rel) {
  if (rel.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (rel.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (rel.endsWith(".js") || rel.endsWith(".mjs") || rel.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function planFile(srcRel, srcRoot, ledger) {
  const fileAbs = path.join(srcRoot, srcRel);
  const text = fs.readFileSync(fileAbs, "utf8");
  const sf = ts.createSourceFile(srcRel, text, ts.ScriptTarget.Latest, true, scriptKindFor(srcRel));
  const edits = [];
  for (const spec of collectSpecifiers(sf)) {
    const { base, query } = stripQuery(spec.value);
    const resolved = resolveLocal(base, fileAbs, srcRoot);
    if (!resolved || resolved.bare || resolved.external) {
      if (resolved === null) {
        throw new MigrationError(
          `${srcRel}: local import ${JSON.stringify(spec.value)} does not resolve to a file under ${toPosix(path.relative(REPO_ROOT, srcRoot))}`
        );
      }
      continue; // bare package or reach outside src
    }
    const row = ledger.get(resolved.relpath);
    if (!row) {
      throw new MigrationError(
        `${srcRel}: import ${JSON.stringify(spec.value)} resolves to ${resolved.relpath}, which has no ledger row`
      );
    }
    // Only move-classified JS/TS modules become #product/*.
    if (row.cls !== "move" || !isModuleExt(resolved.relpath)) continue;
    const newSpec = "#product/" + stripModuleExt(resolved.relpath) + query;
    // Defensive: the rewrite target must be a ledger-approved move path.
    const approved = ledger.get(resolved.relpath);
    if (!approved || approved.cls !== "move") {
      throw new MigrationError(`${srcRel}: refusing rewrite to non-approved target ${resolved.relpath}`);
    }
    const quote = text[spec.start]; // preserve original quote char
    edits.push({
      start: spec.start,
      end: spec.end,
      oldSpec: spec.value,
      newSpec,
      replacement: quote + newSpec + quote,
    });
  }
  edits.sort((a, b) => a.start - b.start);
  return { fileAbs, text, edits };
}

function applyEdits(text, edits) {
  let out = text;
  // Splice end-to-first so earlier offsets stay valid.
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const srcRoot = opts.src ? path.resolve(opts.src) : path.join(REPO_ROOT, "apps", "desktop", "src");
  const ledgerPath = opts.ledger
    ? path.resolve(opts.ledger)
    : path.join(REPO_ROOT, "specs", "codebase", "features", "web-desktop-product-client-move-ledger.md");

  if (!fs.existsSync(srcRoot)) throw new MigrationError(`source root not found: ${srcRoot}`);
  const ledger = parseLedger(ledgerPath); // throws LedgerError on parse failure

  // Sources to rewrite: move-classified JS/TS modules, in stable path order.
  const moveModules = [];
  for (const [src, row] of ledger) {
    if (row.cls === "move" && isModuleExt(src)) moveModules.push(src);
  }
  moveModules.sort();

  const planned = []; // { srcRel, edits, fileAbs, text }
  for (const srcRel of moveModules) {
    if (!fs.existsSync(path.join(srcRoot, srcRel))) continue; // ledger-vs-copy tolerance; existence gated by checker
    const p = planFile(srcRel, srcRoot, ledger);
    if (p.edits.length > 0) planned.push({ srcRel, ...p });
  }

  // Stable sorted output: by source path, then by in-file position.
  planned.sort((a, b) => (a.srcRel < b.srcRel ? -1 : a.srcRel > b.srcRel ? 1 : 0));

  const outLines = [];
  let rewriteCount = 0;
  for (const f of planned) {
    for (const e of f.edits) {
      outLines.push(`${f.srcRel}\t${e.oldSpec}\t${e.newSpec}`);
      rewriteCount++;
    }
  }

  if (opts.mode === "apply") {
    for (const f of planned) {
      fs.writeFileSync(f.fileAbs, applyEdits(f.text, f.edits));
    }
  }

  if (outLines.length > 0) process.stdout.write(outLines.join("\n") + "\n");
  process.stderr.write(
    `${opts.mode}: ${rewriteCount} specifier rewrite(s) across ${planned.length} file(s) ` +
      `(${moveModules.length} move modules scanned)\n`
  );
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  if (err instanceof LedgerError) {
    process.stderr.write(`LEDGER PARSE ERROR: ${err.message}\n`);
  } else if (err instanceof MigrationError) {
    process.stderr.write(`MIGRATION ERROR: ${err.message}\n`);
  } else {
    process.stderr.write(`UNEXPECTED ERROR: ${err && err.stack ? err.stack : err}\n`);
  }
  process.exit(1);
}
