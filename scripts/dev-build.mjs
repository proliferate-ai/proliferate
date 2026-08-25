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
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Dependency order. `upstream` lists packages whose output this package
// compiles against, and `extra` lists repo-relative paths it reads from outside
// its own directory. Both have to invalidate it, or a stale dist survives a
// change it should have been rebuilt for.
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
    // apps/packages/product-client/scripts/copy-product-client-assets.mjs
    // generates src/generated/agent-registry.json
    // from this file, which lives outside the package.
    extra: ["catalogs/agents/registry.json"],
  },
];

// dist and node_modules are outputs and inputs-by-version respectively; the rest
// are test and tool artifacts that land inside a package tree and would otherwise
// invalidate it for no reason. Running a qualification suite must not cost a
// rebuild.
const IGNORED = new Set([
  "node_modules",
  "dist",
  ".turbo",
  ".vite",
  "coverage",
  "test-results",
  "playwright-report",
  "blob-report",
  "__pycache__",
  "htmlcov",
]);

// Files a package's own build writes back into its source tree. Hashing them
// would make the first build after a clean checkout dirty its own inputs, so the
// second run rebuilds and only the third is quiet.
const SELF_GENERATED = new Set([
  path.join("apps", "packages", "product-client", "src", "generated", "agent-registry.json"),
  path.join("apps", "packages", "product-client", "src", "generated", "agent-catalog.json"),
]);

// A resolution change inside an existing semver range is invisible to every
// package.json, so the lockfile salts every key.
function lockfileSalt() {
  const lock = path.join(repoRoot, "pnpm-lock.yaml");
  return fs.existsSync(lock) ? createHash("sha256").update(fs.readFileSync(lock)).digest("hex") : "";
}

// One build at a time. Two concurrent runs racing into the same dist would
// interleave their output and then both stamp it valid, which is the one failure
// that survives across runs.
function acquireLock() {
  const lockPath = path.join(os.tmpdir(), "proliferate-dev-build.lock");
  for (let attempt = 0; ; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      const release = () => { try { fs.unlinkSync(lockPath); } catch {} };
      process.on("exit", release);
      for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
        process.on(sig, () => { release(); process.exit(1); });
      }
      return;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      // A crash can leave the file behind, so a lock whose owner is gone is stale.
      const owner = Number(fs.readFileSync(lockPath, "utf8").trim());
      let alive = true;
      try { process.kill(owner, 0); } catch { alive = false; }
      if (!alive) { fs.unlinkSync(lockPath); continue; }
      if (attempt === 0) console.log(`waiting      another dev-build is running (pid ${owner})`);
      execFileSync(process.execPath, ["-e", "setTimeout(()=>{},1000)"]);
    }
  }
}

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
        const rel = path.relative(repoRoot, full);
        if (SELF_GENERATED.has(rel)) continue;
        hash.update(path.relative(absDir, full));
        hash.update("\0");
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

// The AnyHarness schema is a function of the runtime binary rather than of any
// source file, so it keys on that binary. It has to be the binary that will
// actually be asked for the schema: a constant key here means editing a Rust
// route silently leaves the whole SDK chain on the old shape, which is the exact
// failure this script exists to prevent.
function ensureOpenapi() {
  const generated = path.join(repoRoot, "anyharness/sdk/generated/openapi.json");
  const stamp = path.join(repoRoot, "anyharness/sdk/generated/.dev-build-key");

  // Same resolution order as the Makefile for the env vars it checks: an
  // explicit prebuilt runtime wins, otherwise the binary cargo just produced.
  // main() runs build-rust before calling this, so in the cargo case that file
  // is fresh by the time we get here. This does not handle a [build]
  // target-dir set in .cargo/config.toml, unlike the Makefile's cargo-metadata
  // resolution; the only consequence is a missed warm path (the schema
  // regenerates on every launch instead of being skipped), never a stale one.
  const explicit = process.env.ANYHARNESS_DEV_RUNTIME_BIN;
  const targetDir =
    process.env.CARGO_TARGET_DIR || process.env.CARGO_BUILD_TARGET_DIR || path.join(repoRoot, "target");
  const built = path.join(targetDir, "debug/anyharness");
  const source = explicit && fs.existsSync(explicit) ? explicit : built;

  let key;
  if (fs.existsSync(source)) {
    const stat = fs.statSync(source);
    key = `${source}:${stat.size}:${stat.mtimeMs}`;
  } else {
    // No binary to fingerprint. Regenerating is the safe answer, and
    // sdk-generate will fail loudly if it cannot produce one.
    key = `absent:${Date.now()}`;
  }

  if (fs.existsSync(generated) && fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === key) {
    console.log("up to date  openapi schema");
    return;
  }
  console.log("generating  openapi schema");
  fs.rmSync(stamp, { force: true });
  run("make", ["sdk-generate"]);
  fs.writeFileSync(stamp, key);
}

// The cloud client is generated by booting the FastAPI app and dumping its
// schema, so every Python source under server/ is an input. make build reached
// this through cloud-sdk-build; dev-build has to do it explicitly or a changed
// Pydantic model ships stale types.
function ensureCloudOpenapi() {
  const generated = path.join(repoRoot, "cloud/sdk/src/generated/openapi.ts");
  const stamp = path.join(repoRoot, "cloud/sdk/src/generated/.dev-build-key");
  const serverSrc = path.join(repoRoot, "server/proliferate");

  if (!fs.existsSync(serverSrc)) return;

  const key = createHash("sha256")
    .update(hashSources(serverSrc))
    .update(fs.existsSync(path.join(repoRoot, "server/pyproject.toml"))
      ? fs.readFileSync(path.join(repoRoot, "server/pyproject.toml"))
      : "")
    .digest("hex");

  if (fs.existsSync(generated) && fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === key) {
    console.log("up to date  cloud schema");
    return;
  }

  // Generation needs the server venv. Skipping quietly here would be the same
  // silent staleness we are fixing, so say so and leave the stamp absent, which
  // makes the next run with a venv regenerate.
  if (!fs.existsSync(path.join(repoRoot, "server/.venv"))) {
    console.log("SKIPPED     cloud schema: server/.venv missing, run `make server-install`");
    console.log("            cloud-sdk types may be stale against server/");
    return;
  }

  console.log("generating  cloud schema");
  fs.rmSync(stamp, { force: true });
  run("make", ["cloud-client-generate"]);
  fs.writeFileSync(stamp, key);
}

function main() {
  const force = process.argv.includes("--force");

  // The lock is taken before the Rust build, not just around the package
  // builds. Several profiles launching at once would otherwise start several
  // cargo builds, which is the shape that exhausts memory on a developer
  // machine, and the reason this is inside the script rather than a Makefile
  // prerequisite.
  acquireLock();
  run("make", ["--no-print-directory", "build-rust"]);
  ensureOpenapi();
  ensureCloudOpenapi();

  const salt = lockfileSalt();
  const resolved = new Map();
  let built = 0;

  for (const pkg of PACKAGES) {
    const absDir = path.join(repoRoot, pkg.dir);
    const dist = path.join(absDir, "dist");
    const stamp = path.join(dist, ".dev-build-hash");

    const hash = createHash("sha256");
    hash.update(salt);
    hash.update(hashSources(absDir));
    for (const up of pkg.upstream) {
      const upKey = resolved.get(up);
      // PACKAGES is in dependency order. If that ever stops being true, failing
      // here beats silently dropping the edge and never invalidating.
      if (upKey === undefined) throw new Error(`${pkg.dir} lists upstream ${up}, which has not been resolved yet`);
      hash.update(upKey);
    }
    for (const extra of pkg.extra ?? []) {
      const full = path.join(repoRoot, extra);
      hash.update(extra);
      hash.update(fs.existsSync(full) ? fs.readFileSync(full) : "");
    }
    const key = hash.digest("hex");
    resolved.set(pkg.dir, key);

    const current = fs.existsSync(stamp) ? fs.readFileSync(stamp, "utf8") : null;
    if (!force && fs.existsSync(dist) && current === key) {
      console.log(`up to date  ${pkg.filter}`);
      continue;
    }

    console.log(`building    ${pkg.filter}`);
    // Clear first. On the normal path the stamp already disagrees, but under
    // --force it matches, and an interrupted build would otherwise leave a torn
    // dist under a stamp that validates.
    fs.rmSync(stamp, { force: true });
    run("pnpm", ["--filter", pkg.filter, "build"]);
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(stamp, key);
    built += 1;
  }

  console.log(built === 0 ? "nothing to build" : `built ${built} package(s)`);
}

main();
