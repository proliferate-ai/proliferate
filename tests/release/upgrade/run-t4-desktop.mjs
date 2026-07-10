#!/usr/bin/env node
// T4-DESKTOP-1 orchestrator — the slow, cache-aware runner for the tier-4
// desktop auto-update scenario. Local macOS (aarch64) only.
//
// End to end:
//   1. Ensure a fixed throwaway signing keypair (cached) so the N-1 build and
//      the N artifact are signed by the same key (the signature is verified at
//      download time — the N artifact must be signed with the key the N-1
//      build trusts).
//   2. Build a test-flavor N-1 `.app` pointed at a local feed, and a test-flavor
//      N `.app` with the same key. Both via apps/desktop/scripts/build-updater-test.sh.
//      Builds are cached by version and skipped when the bundle already exists.
//   3. Stage the N `.app.tar.gz` + `.sig` behind serve-updater-feed.mjs.
//   4. Copy the N-1 `.app` to a pristine install dir; read its Info.plist
//      version (asserts N-1).
//   5. Run the headless Rust driver (tests/release/upgrade/updater-driver): the
//      real tauri_plugin_updater check() + download_and_install(), verifying the
//      N artifact's signature against the N-1-trusted pubkey and swapping the
//      installed bundle in place.
//   6. Re-read the installed bundle's Info.plist version; assert it is now N.
//
// The Info.plist CFBundleShortVersionString is exactly what Tauri's
// getVersion() reports after a relaunch, so before(N-1)/after(N) on the
// installed bundle is the faithful "the relaunched app is version N" evidence.
//
// Usage:
//   node tests/release/upgrade/run-t4-desktop.mjs \
//     [--from 0.3.17] [--to 0.3.18] [--port 8787] [--work-dir <dir>] [--force]
//
// Env:
//   T4_FORCE_REBUILD=1   rebuild both apps even if cached bundles exist
//   T4_WORK_DIR=<dir>    override the work/cache dir (default: tests/release/.output/t4-desktop)

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  cpSync,
  copyFileSync,
  readdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const DESKTOP_DIR = join(REPO_ROOT, "apps", "desktop");
const SRC_TAURI = join(DESKTOP_DIR, "src-tauri");
const TAURI_CONF = join(SRC_TAURI, "tauri.conf.json");
const TARGET = "aarch64-apple-darwin";
// src-tauri is a member of the repo-root cargo workspace, so bundles land in
// the workspace target dir at the repo root, not under src-tauri.
const BUNDLE_OUT = join(REPO_ROOT, "target", TARGET, "release", "bundle", "macos");
const PLIST_BUDDY = "/usr/libexec/PlistBuddy";

function parseArgs() {
  const a = process.argv.slice(2);
  const o = {
    from: "0.3.17",
    to: "0.3.18",
    port: 8787,
    workDir: process.env.T4_WORK_DIR || join(REPO_ROOT, "tests", "release", ".output", "t4-desktop"),
    force: process.env.T4_FORCE_REBUILD === "1",
  };
  for (let i = 0; i < a.length; i += 1) {
    const k = a[i];
    if (k === "--force") {
      o.force = true;
      continue;
    }
    const v = a[i + 1];
    if (k === "--from") o.from = v;
    else if (k === "--to") o.to = v;
    else if (k === "--port") o.port = Number(v);
    else if (k === "--work-dir") o.workDir = resolve(v);
    else {
      console.error(`unknown flag: ${k}`);
      process.exit(2);
    }
    i += 1;
  }
  return o;
}

function assertPlatform() {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    console.error(
      `T4-DESKTOP-1 is local-macOS-aarch64-only; this host is ${process.platform}/${process.arch}. Aborting.`,
    );
    process.exit(3);
  }
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${res.status ?? res.signal}`);
  }
}

function capture(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf-8", ...opts });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}

function plistVersion(appBundle) {
  const plist = join(appBundle, "Contents", "Info.plist");
  return capture(PLIST_BUDDY, ["-c", "Print :CFBundleShortVersionString", plist]);
}

// The three externalBin sidecars are placeholder stubs in a dev checkout (the
// updater test only exercises the update mechanism, not the agent runtime — see
// the gotchas in specs/developing/testing/desktop-update-testing.md). Stage tiny
// executable placeholders so `tauri build` finds them without the ~10-min real
// anyharness runtime build.
function stageSidecarStubs() {
  const dir = join(SRC_TAURI, "binaries");
  mkdirSync(dir, { recursive: true });
  for (const name of ["anyharness", "proliferate-worker", "proliferate-debug"]) {
    const p = join(dir, `${name}-${TARGET}`);
    if (!existsSync(p)) {
      const body = `#!/bin/sh\necho "${name}: sidecar placeholder (T4 updater test build)"\n`;
      spawnSync("sh", ["-c", `printf '%s' ${JSON.stringify(body)} > ${JSON.stringify(p)} && chmod +x ${JSON.stringify(p)}`]);
    }
  }
}

function ensureKeypair(workDir) {
  const keyPath = join(workDir, "test-signing.key");
  const pubPath = `${keyPath}.pub`;
  if (!existsSync(keyPath) || !existsSync(pubPath)) {
    console.log("[t4] generating a fixed throwaway signing keypair (cached, both builds trust it)...");
    // -f overwrites; empty password for unattended signing.
    run("pnpm", ["tauri", "signer", "generate", "-w", keyPath, "--password", "", "-f"], {
      cwd: DESKTOP_DIR,
      env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "" },
      stdio: "ignore",
    });
  }
  // The .pub file content IS the tauri.conf pubkey value — use verbatim.
  const pubkey = readFileSync(pubPath, "utf-8").replace(/\n/g, "");
  return { keyPath, pubkey };
}

function setTauriVersion(version) {
  const conf = readFileSync(TAURI_CONF, "utf-8");
  const next = conf.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`);
  spawnSync("sh", ["-c", `cat > ${JSON.stringify(TAURI_CONF)}`], { input: next });
}

function readTauriVersion() {
  return JSON.parse(readFileSync(TAURI_CONF, "utf-8")).version;
}

function buildApp({ version, feedUrl, keyPath, pubkey }) {
  console.log(`[t4] building test-flavor app version ${version} ...`);
  setTauriVersion(version);
  run("bash", [join(DESKTOP_DIR, "scripts", "build-updater-test.sh")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      UPDATER_URL: feedUrl,
      UPDATER_PUBKEY: pubkey,
      TAURI_SIGNING_PRIVATE_KEY: keyPath,
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
      TARGET,
      BUNDLES: "app",
    },
  });
}

function findArtifact(re) {
  const f = readdirSync(BUNDLE_OUT).find((x) => re.test(x));
  if (!f) throw new Error(`no artifact matching ${re} in ${BUNDLE_OUT}`);
  return join(BUNDLE_OUT, f);
}

async function main() {
  const opts = parseArgs();
  assertPlatform();
  if (!existsSync(PLIST_BUDDY)) {
    console.error(`missing ${PLIST_BUDDY}; cannot read bundle versions`);
    process.exit(3);
  }

  const workDir = opts.workDir;
  mkdirSync(workDir, { recursive: true });
  const feedDir = join(workDir, "feed");
  const nMinus1AppCache = join(workDir, `n-minus-1-${opts.from}`, "Proliferate.app");
  const nArtifactCache = join(workDir, `n-${opts.to}`);
  const installDir = join(workDir, "install");
  const feedUrl = `http://127.0.0.1:${opts.port}/latest.json`;

  const originalVersion = readTauriVersion();
  const { keyPath, pubkey } = ensureKeypair(workDir);
  stageSidecarStubs();

  let feedProc = null;
  try {
    // --- Build (or reuse) the N-1 app ---
    if (opts.force || !existsSync(nMinus1AppCache)) {
      buildApp({ version: opts.from, feedUrl, keyPath, pubkey });
      const builtApp = findArtifact(/^Proliferate\.app$/);
      rmSync(dirname(nMinus1AppCache), { recursive: true, force: true });
      mkdirSync(dirname(nMinus1AppCache), { recursive: true });
      cpSync(builtApp, nMinus1AppCache, { recursive: true });
      console.log(`[t4] cached N-1 (${opts.from}) app -> ${nMinus1AppCache}`);
    } else {
      console.log(`[t4] reusing cached N-1 app: ${nMinus1AppCache}`);
    }

    // --- Build (or reuse) the N artifact (.app.tar.gz + .sig) ---
    const tarCache = join(nArtifactCache, `Proliferate_${opts.to}_aarch64.app.tar.gz`);
    const sigCache = `${tarCache}.sig`;
    if (opts.force || !existsSync(tarCache) || !existsSync(sigCache)) {
      buildApp({ version: opts.to, feedUrl, keyPath, pubkey });
      const tar = findArtifact(/\.app\.tar\.gz$/);
      const sig = findArtifact(/\.app\.tar\.gz\.sig$/);
      mkdirSync(nArtifactCache, { recursive: true });
      copyFileSync(tar, tarCache);
      copyFileSync(sig, sigCache);
      console.log(`[t4] cached N (${opts.to}) artifact -> ${tarCache}`);
    } else {
      console.log(`[t4] reusing cached N artifact: ${tarCache}`);
    }

    // --- Stage the feed dir ---
    rmSync(feedDir, { recursive: true, force: true });
    mkdirSync(feedDir, { recursive: true });
    copyFileSync(tarCache, join(feedDir, `Proliferate_${opts.to}_aarch64.app.tar.gz`));
    copyFileSync(sigCache, join(feedDir, `Proliferate_${opts.to}_aarch64.app.tar.gz.sig`));

    // --- Fresh pristine install copy of the N-1 app ---
    rmSync(installDir, { recursive: true, force: true });
    mkdirSync(installDir, { recursive: true });
    const installApp = join(installDir, "Proliferate.app");
    cpSync(nMinus1AppCache, installApp, { recursive: true });
    const beforeVersion = plistVersion(installApp);
    console.log(`[t4] installed bundle version BEFORE update: ${beforeVersion}`);
    if (beforeVersion !== opts.from) {
      throw new Error(`staged N-1 bundle reports ${beforeVersion}, expected ${opts.from}`);
    }

    // --- Serve the feed ---
    feedProc = spawn(
      "node",
      [
        join(REPO_ROOT, "tests", "release", "scripts", "serve-updater-feed.mjs"),
        "--dir",
        feedDir,
        "--version",
        opts.to,
        "--port",
        String(opts.port),
      ],
      { stdio: "inherit" },
    );
    await new Promise((r) => setTimeout(r, 800));

    // --- Build + run the headless driver ---
    const driverDir = join(HERE, "updater-driver");
    const driverTarget = join(workDir, "driver-target");
    console.log("[t4] building the headless updater driver (cached target dir)...");
    run("cargo", ["build", "--release", "--manifest-path", join(driverDir, "Cargo.toml")], {
      cwd: driverDir,
      env: { ...process.env, CARGO_TARGET_DIR: driverTarget },
    });
    const driverBin = join(driverTarget, "release", "t4-updater-driver");
    console.log("[t4] driving the real tauri_plugin_updater check + download_and_install...");
    run(driverBin, [
      "--feed",
      feedUrl,
      "--pubkey",
      pubkey,
      "--install-app",
      installApp,
      "--expect-version",
      opts.to,
    ]);

    // --- Assert the installed bundle is now N ---
    const afterVersion = plistVersion(installApp);
    console.log(`[t4] installed bundle version AFTER update:  ${afterVersion}`);
    if (afterVersion !== opts.to) {
      throw new Error(`update did not converge: installed bundle reports ${afterVersion}, expected ${opts.to}`);
    }

    // Structural sanity: the swapped bundle has a real Mach-O main binary.
    const mainBin = join(installApp, "Contents", "MacOS", "Proliferate");
    if (!existsSync(mainBin)) {
      throw new Error(`swapped bundle missing main binary at ${mainBin}`);
    }
    const fileKind = capture("file", ["-b", mainBin]);
    console.log(`[t4] swapped bundle main binary: ${fileKind}`);

    console.log(`\n[t4] PASS  ${beforeVersion} -> ${afterVersion}  (real signed auto-update converged)`);
  } finally {
    if (feedProc) feedProc.kill();
    // Restore the tracked tauri.conf.json version we mutated for the builds.
    if (readTauriVersion() !== originalVersion) {
      setTauriVersion(originalVersion);
    }
  }
}

main().catch((e) => {
  console.error(`\n[t4] FAIL: ${e.message}`);
  process.exit(1);
});
