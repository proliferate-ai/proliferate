#!/usr/bin/env node
// Build only the artifacts `make run` consumes, and only the ones whose sources
// actually changed.
//
// The build targets in the Makefile are all phony, so `make build` rebuilds
// everything every time. Measured on a 16 vCPU box that is 86 seconds to
// produce output byte-identical to what was already on disk, which is most of
// the wait before a dev profile starts.
//
// Staleness is decided by content hash rather than mtime, because the case that
// hurts most is switching branches: git rewrites mtimes on files whose contents
// it restored unchanged, so an mtime check rebuilds precisely when a rebuild is
// least necessary.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Dependency order. `upstream` lists packages whose output this package
// compiles against, so a change there has to invalidate this one too.
const PACKAGES = [
  { dir: "cloud/sdk", filter: "@proliferate/cloud-sdk", upstream: [] },
  { dir: "cloud/sdk-react", filter: "@proliferate/cloud-sdk-react", upstream: ["cloud/sdk"] },
  { dir: "anyharness/sdk", filter: "@anyharness/sdk", upstream: [] },
  { dir: "anyharness/sdk-react", filter: "@anyharness/sdk-react", upstream: ["anyharness/sdk"] },
  { dir: "apps/packages/design", filter: "@proliferate/design", upstream: [] },
  {
    dir: "apps/packages/product-client",
    filter: "@proliferate/product-client",
    upstream: ["cloud/sdk", "cloud/sdk-react", "anyharness/sdk", "anyharness/sdk-react", "apps/packages/design"],
  },
];

const IGNORED = new Set(["node_modules", "dist", ".turbo", ".vite", "coverage"]);

function hashSources(absDir) {
  const hash = createHash("sha256");
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      if (entry.name.startsWith(".") || IGNORED.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        hash.update(path.relative(absDir, full));
        hash.update(fs.readFileSync(full));
      }
    }
  };
  walk(absDir);
  return hash.digest("hex");
}

function run(command, args, cwd = repoRoot) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

// The generated OpenAPI client is a function of the runtime binary, not of any
// source file, so it gets its own key.
function ensureOpenapi() {
  const generated = path.join(repoRoot, "anyharness/sdk/generated/openapi.json");
  const stamp = path.join(repoRoot, "anyharness/sdk/generated/.dev-build-key");
  const runtimeBin = process.env.ANYHARNESS_DEV_RUNTIME_BIN;

  let key;
  if (runtimeBin && fs.existsSync(runtimeBin)) {
    const stat = fs.statSync(runtimeBin);
    key = `${runtimeBin}:${stat.size}:${stat.mtimeMs}`;
  } else {
    key = "cargo";
  }

  if (fs.existsSync(generated) && fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === key) {
    console.log("up to date  openapi schema");
    return;
  }
  console.log("generating  openapi schema");
  run("make", ["sdk-generate"]);
  fs.writeFileSync(stamp, key);
}

function main() {
  const force = process.argv.includes("--force");
  ensureOpenapi();

  const resolved = new Map();
  let built = 0;

  for (const pkg of PACKAGES) {
    const absDir = path.join(repoRoot, pkg.dir);
    const dist = path.join(absDir, "dist");
    const stamp = path.join(dist, ".dev-build-hash");

    const hash = createHash("sha256");
    hash.update(hashSources(absDir));
    for (const up of pkg.upstream) hash.update(resolved.get(up) ?? "");
    const key = hash.digest("hex");
    resolved.set(pkg.dir, key);

    const current = fs.existsSync(stamp) ? fs.readFileSync(stamp, "utf8") : null;
    if (!force && fs.existsSync(dist) && current === key) {
      console.log(`up to date  ${pkg.filter}`);
      continue;
    }

    console.log(`building    ${pkg.filter}`);
    run("pnpm", ["--filter", pkg.filter, "build"]);
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(stamp, key);
    built += 1;
  }

  console.log(built === 0 ? "nothing to build" : `built ${built} package(s)`);
}

main();
