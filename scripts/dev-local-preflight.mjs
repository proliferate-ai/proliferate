// Preflight for `make dev-local`: make the steady-state relaunch fast and the
// three launch traps loud, measured against a real timed run (2026-08-28):
//
//   1. A placeholder AnyHarness sidecar in target/debug (a desktop build on a
//      machine that had no runtime binary staged one) makes the app's sidecar
//      exit in <1s with a "failed" runtime-info and no useful error. Heal it
//      by rebuilding the real binary instead of launching a broken app.
//   2. `sdk-build` runs `cargo build -p anyharness` (~55s warm) on EVERY
//      launch just to print the OpenAPI schema. Skip it when no runtime or
//      sdk source changed since the last successful build (mtime stamp).
//   3. The renderer resolves `@proliferate/product-client/internal/*` from
//      dist/, so a stale or missing dist yields hundreds of vite
//      Pre-transform errors and a broken window. Rebuild dist when src is
//      newer (~21s), skip otherwise.
//   4. A vite dev server left over from a previous (crashed) `tauri dev`
//      holds ports 1420/1421 and kills the new launch minutes in. Fail fast
//      with the holder, or kill it automatically when it is clearly a stale
//      vite (DEV_PORTS_KILL_STALE=1 skips the prompt-free refusal).
//
// Node instead of a Makefile shell chain for the same reason
// generate-anyharness-openapi.mjs is a script: portable control flow, and one
// place that owns the stamp files. Stamps live under .dev-stamps/ (ignored).

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const stampsDir = join(repoRoot, ".dev-stamps");
mkdirSync(stampsDir, { recursive: true });

const started = Date.now();
const phase = (name, fn) => {
  const t0 = Date.now();
  const result = fn();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[dev-preflight] ${name}: ${result} (${secs}s)`);
};

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: repoRoot, ...opts });
  if (r.status !== 0) {
    console.error(`[dev-preflight] ${cmd} ${args.join(" ")} failed (${r.status})`);
    process.exit(r.status ?? 1);
  }
}

/** Newest mtime (ms) under the given roots, ignoring generated/dist/target dirs. */
function newestMtime(roots) {
  const skip = new Set(["node_modules", "dist", "target", "generated", ".dev-stamps"]);
  let newest = 0;
  const stack = roots.filter(existsSync);
  while (stack.length > 0) {
    const dir = stack.pop();
    const stat = statSync(dir);
    if (stat.isFile()) {
      if (stat.mtimeMs > newest) newest = stat.mtimeMs;
      continue;
    }
    for (const entry of execFileSync("ls", ["-A", dir], { encoding: "utf8" }).split("\n")) {
      if (!entry || skip.has(entry)) continue;
      stack.push(join(dir, entry));
    }
  }
  return newest;
}

function stale(stampName, roots) {
  const stampPath = join(stampsDir, stampName);
  if (!existsSync(stampPath)) return true;
  return newestMtime(roots) > statSync(stampPath).mtimeMs;
}

function stamp(stampName) {
  const stampPath = join(stampsDir, stampName);
  writeFileSync(stampPath, "");
  const now = new Date();
  utimesSync(stampPath, now, now);
}

// 1. Placeholder sidecar heal ------------------------------------------------
phase("runtime binary", () => {
  const bin = join(repoRoot, "target", "debug", "anyharness");
  const isPlaceholder = () => {
    try {
      return readFileSync(bin, { encoding: "utf8", flag: "r" }).includes("sidecar is not available");
    } catch {
      return false; // binary (non-utf8) or unreadable: treat as real; missing handled below
    }
  };
  if (existsSync(bin) && !isPlaceholder()) return "real";
  const reason = existsSync(bin) ? "placeholder script" : "missing";
  console.log(`[dev-preflight] target/debug/anyharness is a ${reason}; rebuilding the real runtime`);
  run("cargo", ["build", "-p", "anyharness"]);
  return "rebuilt";
});

// 2. SDK build, only when inputs changed ------------------------------------
const SDK_INPUTS = [
  "anyharness/crates/anyharness/src",
  "anyharness/crates/anyharness-lib/src",
  "anyharness/crates/anyharness-contract/src",
  "anyharness/sdk/src",
  "anyharness/sdk/package.json",
];
phase("sdk build", () => {
  if (process.env.SDK_FORCE !== "1" && !stale("sdk-build", SDK_INPUTS)) return "fresh, skipped";
  run("make", ["sdk-build"]);
  stamp("sdk-build");
  return "rebuilt";
});

// 3. product-client dist, only when src changed ------------------------------
phase("product-client dist", () => {
  const dist = join(repoRoot, "apps/packages/product-client/dist");
  if (existsSync(dist) && !stale("product-client", ["apps/packages/product-client/src"])) {
    return "fresh, skipped";
  }
  run("pnpm", ["--filter", "@proliferate/product-client", "build"]);
  stamp("product-client");
  return "rebuilt";
});

// 4. Port preflight ----------------------------------------------------------
phase("ports 1420/1421", () => {
  const out = spawnSync("lsof", ["-nP", "-iTCP:1420", "-iTCP:1421", "-sTCP:LISTEN", "-Fpc"], {
    encoding: "utf8",
  });
  const text = out.stdout ?? "";
  if (!text.trim()) return "free";
  const pids = [...text.matchAll(/^p(\d+)$/gm)].map((m) => m[1]);
  const commands = [...text.matchAll(/^c(.+)$/gm)].map((m) => m[1]);
  // A vite holder is only stale when no live desktop app owns it: killing the
  // renderer of a RUNNING dev-local would break that instance, so a live
  // `tauri dev` (or its debug binary) always refuses instead.
  const liveTauri =
    spawnSync("pgrep", ["-f", "tauri dev|target/debug/proliferate"], { encoding: "utf8" }).status === 0;
  const allVite = commands.every((c) => /node|vite/.test(c));
  if (allVite && !liveTauri && process.env.DEV_PORTS_KILL_STALE !== "0") {
    for (const pid of pids) spawnSync("kill", [pid]);
    return `killed orphaned vite (pid ${pids.join(", ")})`;
  }
  console.error(
    `[dev-preflight] ports 1420/1421 are held by: ${commands.join(", ")} (pid ${pids.join(", ")}).\n` +
      (liveTauri
        ? "A dev-local instance is already running. Stop it before launching another."
        : "Stop the holder, or set DEV_PORTS_KILL_STALE=1 to let preflight kill orphaned vite processes."),
  );
  process.exit(1);
});

console.log(`[dev-preflight] done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
