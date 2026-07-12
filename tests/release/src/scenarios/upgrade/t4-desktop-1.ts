import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import type { ScenarioDefinition } from "../types.js";
import { ScenarioBlockedError } from "../types.js";

/**
 * T4-DESKTOP-1 — desktop app auto-update (Tauri updater), N-1 -> N.
 * specs/developing/testing/scenarios.md#T4-DESKTOP-1
 *
 * Builds a test-flavor N-1 desktop `.app` pointed at a local update feed, an N
 * `.app` signed with the same key, stages N + latest.json behind
 * `tests/release/scripts/serve-updater-feed.mjs`, then drives the REAL
 * `tauri_plugin_updater` (`check()` + `download_and_install()`, the code the JS
 * wrappers in `apps/desktop/src/lib/access/tauri/updater.ts` call through) via
 * a headless Rust driver (`tests/release/upgrade/updater-driver`). The
 * signature of the N artifact is verified at download time against the pubkey
 * the N-1 build trusts, and the on-disk N-1 bundle is swapped in place; the
 * scenario asserts the installed bundle's version went N-1 -> N (the
 * Info.plist `CFBundleShortVersionString`, which is exactly what
 * `getVersion()` returns after a relaunch).
 *
 * Why the GUI is not clicked: the update UX is user-gated inside a release
 * webview (Settings -> "Desktop updates" -> check -> download -> restart), and
 * webview automation is far more brittle headlessly than invoking the same
 * updater API directly. The Rust driver is the "call the wrappers directly"
 * path from the testing README, exercising the parts that actually break
 * (manifest fetch, semver compare, minisign signature verification, real
 * macOS `.app` swap).
 *
 * This scenario is **local-macOS-aarch64-only** and gated behind an explicit
 * opt-in (`RELEASE_E2E_DESKTOP_T4=1`) because it runs two full `tauri build`s
 * (~10+ min; the orchestrator caches bundles so re-runs skip the builds). In
 * GitHub Actions / on any non-macOS-aarch64 host / without the opt-in it
 * reports `blocked` cleanly — never red — so the release gate stays green
 * while the gap (or the opt-in cost) stays visible.
 */
// src/scenarios/upgrade/ -> up three (src/scenarios/upgrade -> src/scenarios ->
// src -> tests/release) then into the top-level upgrade/ dir that holds the
// heavy build orchestrator + the Rust driver crate.
const HERE = dirname(fileURLToPath(import.meta.url));
const ORCHESTRATOR = resolve(HERE, "..", "..", "..", "upgrade", "run-t4-desktop.mjs");

function isCi(): boolean {
  return Boolean(process.env.CI || process.env.GITHUB_ACTIONS);
}

export const t4Desktop1: ScenarioDefinition = {
  id: "T4-DESKTOP-1",
  title: "desktop app auto-update, N-1 -> N",
  registryFlowRef: "specs/developing/testing/scenarios.md#T4-DESKTOP-1",
  lanes: ["local"],
  requiredEnv: [
    "RELEASE_E2E_DESKTOP_T4",
    "RELEASE_E2E_DESKTOP_UPDATE_FROM",
    "RELEASE_E2E_DESKTOP_UPDATE_TO",
  ],
  plan: () => {
    const fromVersion = process.env.RELEASE_E2E_DESKTOP_UPDATE_FROM ?? "<explicit N-1 required>";
    const toVersion = process.env.RELEASE_E2E_DESKTOP_UPDATE_TO ?? "<explicit candidate N required>";
    return [
    { description: "ensure a fixed throwaway signing keypair (both builds trust it; cached)" },
    { description: `build test-flavor N-1 (${fromVersion}) .app pointed at the local feed` },
    { description: `build test-flavor candidate N (${toVersion}) .app signed with the same key` },
    { description: "stage N .app.tar.gz + .sig behind serve-updater-feed.mjs; generate latest.json" },
    { description: "copy the N-1 .app to a pristine install dir; assert its bundle version == N-1" },
    {
      description:
        "run the headless updater driver: real tauri_plugin_updater check() (assert available == N) + " +
        "download_and_install() (verify N artifact signature against the N-1-trusted pubkey; swap the bundle)",
    },
    { description: "assert the installed bundle version is now N (== getVersion() after relaunch)" },
    ];
  },
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }

    if (isCi()) {
      throw new ScenarioBlockedError(
        "T4-DESKTOP-1/local: local-macOS-only. In CI (GitHub Actions) this scenario is blocked by " +
          "design — it needs two full macOS `tauri build`s and a real .app bundle swap on the host, " +
          "which the release gate does not provision. Run it locally on an Apple-silicon Mac with " +
          "RELEASE_E2E_DESKTOP_T4=1 (see specs/developing/testing/desktop-update-testing.md).",
      );
    }

    if (process.platform !== "darwin" || process.arch !== "arm64") {
      throw new ScenarioBlockedError(
        `T4-DESKTOP-1/local: requires macOS aarch64 (darwin-aarch64, the shipped desktop target); ` +
          `this host is ${process.platform}/${process.arch}. Blocked, not red.`,
      );
    }

    if (process.env.RELEASE_E2E_DESKTOP_T4 !== "1") {
      throw new ScenarioBlockedError(
        "T4-DESKTOP-1/local: opt-in required. This runs two full `tauri build`s (~10+ min each on a " +
          "cold cache) and is gated behind RELEASE_E2E_DESKTOP_T4=1 so `--scenarios all` runs stay fast. " +
          "Set RELEASE_E2E_DESKTOP_T4=1 to run it for real (bundles are cached across runs). See " +
          "specs/developing/testing/desktop-update-testing.md.",
      );
    }

    const fromVersion = releaseVersion(ctx.env.require("RELEASE_E2E_DESKTOP_UPDATE_FROM"), "N-1");
    const toVersion = releaseVersion(ctx.env.require("RELEASE_E2E_DESKTOP_UPDATE_TO"), "candidate N");
    if (fromVersion === toVersion) {
      throw new Error(`T4-DESKTOP-1: N-1 and candidate N are identical (${toVersion})`);
    }

    const result = spawnSync(
      "node",
      [ORCHESTRATOR, "--from", fromVersion, "--to", toVersion],
      { stdio: "inherit" },
    );
    if (result.status !== 0) {
      throw new Error(
        `T4-DESKTOP-1: orchestrator exited ${result.status ?? result.signal}. ` +
          `See the run log above and tests/release/upgrade/run-t4-desktop.mjs.`,
      );
    }
  },
};

function releaseVersion(value: string, label: string): string {
  const version = value.trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`T4-DESKTOP-1: ${label} version is not an immutable semver: ${JSON.stringify(value)}`);
  }
  return version;
}
