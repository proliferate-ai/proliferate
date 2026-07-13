/**
 * T4-DESKTOP-1 vertical slice: retained production N-1 Desktop -> real signed
 * Tauri update -> Desktop N -> preserved state -> installed-agent convergence ->
 * post-update turn (tier-4-scenario-contract.md "Desktop N-1 To N").
 *
 * This slice drives the world as far as the PRODUCT truly allows today and
 * preserves honest red/blocked evidence for the rest. It never fakes an update
 * and never converts a real gap into a green escape. Each step reports a
 * CellStatus-compatible outcome; the overall verdict is green only when every
 * required step ran for real under the production trust chain.
 *
 * Known hard product gaps (Current Initial Red Gaps in the contract) that this
 * slice surfaces rather than papers over:
 *  - the production updater endpoint + trusted pubkey are baked into the app, so
 *    the COMPLETE product journey has no safe isolated-feed mechanism yet; the
 *    Rust updater driver exercises the updater ENGINE against an alternate
 *    endpoint (mechanism evidence), it does not relaunch the real product;
 *  - a production-key-signed candidate N artifact does not exist locally, so the
 *    mechanism can only be exercised against a dev/throwaway-signed build, which
 *    is explicitly non-qualifying;
 *  - candidate version stamping can report the crate's hard-coded 0.1.0 (#1089);
 *  - launching Desktop N to observe bundled AnyHarness N, catalog/registry
 *    identity, per-agent reconcile, preserved state, and a post-update turn is
 *    not automatable on the host today.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

import type { CellStatus } from "../../contracts/results.js";
import { readBundleVersion } from "./install.js";
import { compareVersions, type FeedPlatformKey, type StagedArtifact } from "./feed.js";
import type { DesktopUpgradeControls, TrustChain } from "./provisioner.js";

/** A staged, already-built candidate N updater artifact (tarball + signature). */
export interface CandidateArtifactInput {
  readonly version: string;
  readonly platform: FeedPlatformKey;
  readonly tarballPath: string;
  readonly signaturePath: string;
  /**
   * Trust chain the candidate was signed under. "production" means signed by the
   * key the retained N-1 app trusts (qualifying). "throwaway" is a dev key
   * (mechanism-only, never qualification).
   */
  readonly trustChain: TrustChain;
  /** Base64 pubkey the driver supplies to the real updater engine. */
  readonly pubkey: string;
}

export interface DesktopUpgradeSliceInput {
  /** The staged candidate N artifact, when one is available locally. */
  readonly candidate: CandidateArtifactInput | null;
  /** Absolute path to the built Rust updater driver binary, when available. */
  readonly updaterDriverBin: string | null;
  /** Feed platform the staged candidate targets; defaults to darwin-aarch64. */
  readonly platform?: FeedPlatformKey;
  /**
   * Reads the installed bundle version; defaults to the real macOS PlistBuddy
   * reader. Injectable so the slice's honest-status logic is unit-testable
   * without a real `.app` on a non-macOS host.
   */
  readonly readVersion?: (appPath: string) => string;
}

/** One step's honest outcome. */
export interface SliceStep {
  readonly step: string;
  readonly status: CellStatus;
  readonly detail: string;
}

export interface SliceReport {
  readonly steps: readonly SliceStep[];
  /** Overall CellStatus: green only if every required step ran for real. */
  readonly status: CellStatus;
  /** Non-qualifying reasons; empty only for a real green. */
  readonly reasons: readonly string[];
  /** True when the update was exercised under the production trust chain. */
  readonly productionTrustChain: boolean;
}

const step = (name: string, status: CellStatus, detail: string): SliceStep => ({
  step: name,
  status,
  detail,
});

/**
 * Run the slice. Returns a structured report; throws only on a real defect in
 * the slice itself, never to mask a product gap (gaps are recorded as blocked).
 */
export async function runDesktopUpgradeSlice(
  controls: DesktopUpgradeControls,
  input: DesktopUpgradeSliceInput,
): Promise<SliceReport> {
  const steps: SliceStep[] = [];
  const reasons: string[] = [];
  const n1Version = controls.retained.productVersion;
  const readVersion = input.readVersion ?? readBundleVersion;

  // --- Baseline: identities we can record from the installed N-1 bundle ---
  const beforeVersion = readVersion(controls.installedAppPath);
  if (beforeVersion !== n1Version) {
    steps.push(step("baseline.version", "failed", `installed ${beforeVersion} != retained N-1 ${n1Version}`));
    reasons.push("baseline installed version did not match retained N-1");
  } else {
    steps.push(step("baseline.version", "green", `retained N-1 ${n1Version} installed and readable`));
  }

  // The real product baseline (launch app, authenticate, create workspace/session,
  // wait for AnyHarness readiness + seed hydration + reconcile, complete a bounded
  // turn on the cheapest model) cannot be driven headlessly on the host today.
  steps.push(
    step(
      "baseline.launch-auth-session-turn",
      "blocked",
      "launching the retained production .app to authenticate, create a workspace/session, reach " +
        "AnyHarness readiness, and complete a bounded turn is not automatable on the host; needs a GUI-drivable " +
        "product journey + candidate API + provider route (Current Initial Red Gaps).",
    ),
  );
  reasons.push("baseline product journey (launch/auth/session/turn) not driveable yet");

  // --- Upgrade: drive the REAL Tauri updater engine against the isolated feed ---
  if (!input.candidate || !input.updaterDriverBin) {
    steps.push(
      step(
        "upgrade.mechanism",
        "blocked",
        "no staged candidate N artifact and/or built updater driver available; the exact already-built " +
          "signed candidate N (tarball + signature) and the Rust updater driver binary must be supplied. " +
          "A production-key-signed candidate N does not exist locally.",
      ),
    );
    reasons.push("no candidate N artifact / updater driver to exercise the mechanism");
    return finalize(steps, reasons, false);
  }

  const candidate = input.candidate;
  if (compareVersions(candidate.version, n1Version) <= 0) {
    steps.push(
      step("upgrade.mechanism", "failed", `candidate ${candidate.version} not newer than N-1 ${n1Version}`),
    );
    reasons.push("candidate version is not strictly newer than N-1");
    return finalize(steps, reasons, false);
  }
  if (!existsSync(candidate.tarballPath) || !existsSync(candidate.signaturePath)) {
    steps.push(step("upgrade.mechanism", "blocked", "staged candidate tarball/signature missing on disk"));
    reasons.push("staged candidate artifact files missing");
    return finalize(steps, reasons, false);
  }
  if (!existsSync(input.updaterDriverBin)) {
    steps.push(step("upgrade.mechanism", "blocked", `updater driver binary missing: ${input.updaterDriverBin}`));
    reasons.push("updater driver binary missing");
    return finalize(steps, reasons, false);
  }

  // Flip the isolated feed to advertise the exact candidate N under the supplied
  // trust chain. Nothing is written to any public feed.
  const staged: StagedArtifact = {
    platform: input.platform ?? candidate.platform,
    tarballPath: candidate.tarballPath,
    signaturePath: candidate.signaturePath,
  };
  // The feed serves the tarball bytes by basename out of its staged dir, so it
  // must be the directory the candidate tarball actually lives in (its detached
  // .sig is co-located). No bytes are copied and nothing touches the public feed.
  controls.feed.advertiseCandidate(candidate.version, dirname(candidate.tarballPath), [staged]);

  const productionTrust = candidate.trustChain === "production";

  // Drive the REAL tauri_plugin_updater check() + download_and_install() via the
  // headless Rust driver, supplying ONLY the alternate endpoint + the trust key.
  // The N-1 disposable bundle bytes are never patched; the updater swaps them.
  const driver = spawnSync(
    input.updaterDriverBin,
    [
      "--feed",
      controls.feed.feedUrl(),
      "--pubkey",
      candidate.pubkey,
      "--install-app",
      controls.installedAppPath,
      "--expect-version",
      candidate.version,
    ],
    { encoding: "utf-8" },
  );

  if (driver.status !== 0) {
    steps.push(
      step(
        "upgrade.mechanism",
        "failed",
        `updater engine failed (exit ${driver.status ?? driver.signal}): ${(driver.stderr || driver.stdout || "").trim()}`,
      ),
    );
    reasons.push("real Tauri updater engine failed to check/download/verify/swap");
    return finalize(steps, reasons, false);
  }

  // Production trust that verifies + swaps is a genuine mechanism pass. A
  // throwaway trust chain is out-of-band non-qualifying (no production-signed
  // candidate N exists locally) — recorded as blocked, never as an invented
  // expected-fail and never as green.
  const mechStatus: CellStatus = productionTrust ? "green" : "blocked";
  steps.push(
    step(
      "upgrade.mechanism",
      mechStatus,
      productionTrust
        ? "real updater engine checked, verified the production-key signature, and swapped the bundle"
        : "real updater engine mechanism exercised under a THROWAWAY trust chain (mechanism evidence only, " +
            "cannot qualify a production artifact)",
    ),
  );
  if (!productionTrust) {
    reasons.push(
      "update exercised under throwaway trust chain; a production-key-signed candidate N is required to qualify",
    );
  }

  // The disposable bundle swapped in place: prove N-1 -> N on it.
  const afterVersion = readVersion(controls.installedAppPath);
  if (afterVersion === candidate.version) {
    steps.push(
      step("upgrade.installed-version", productionTrust ? "green" : "blocked", `${beforeVersion} -> ${afterVersion}`),
    );
  } else {
    steps.push(
      step("upgrade.installed-version", "failed", `bundle reports ${afterVersion}, expected ${candidate.version}`),
    );
    reasons.push("swapped bundle version did not converge to candidate N");
  }

  // --- Post-relaunch product assertions: not observable on the host today ---
  for (const [name, why] of POST_RELAUNCH_GAPS) {
    steps.push(step(name, "blocked", why));
    reasons.push(`${name} not observable yet`);
  }

  return finalize(steps, reasons, productionTrust);
}

const POST_RELAUNCH_GAPS: readonly (readonly [string, string])[] = [
  [
    "relaunch.desktop-n-and-bundle-digest",
    "launching the swapped Desktop N and asserting its installed bundle digest matches the candidate " +
      "manifest requires a GUI relaunch + candidate manifest binding not wired on the host.",
  ],
  [
    "relaunch.anyharness-n-runtime-home",
    "bundled AnyHarness N starting against the existing runtime home and reading the prior workspace/" +
      "session/transcript is not observable without the real relaunch; candidate version stamping may also " +
      "report 0.1.0 (#1089).",
  ],
  [
    "relaunch.seed-hydration",
    "N seed hydration terminal state is asynchronous/best-effort and not inspectable headlessly today.",
  ],
  [
    "relaunch.agent-reconciliation",
    "installed-only per-agent native CLI + ACP reconciliation to N pins (terminal, zero-failed) requires a " +
      "running AnyHarness N; the local/Desktop catalog convergence path after relaunch is not implemented.",
  ],
  [
    "relaunch.catalog-registry-identity",
    "active bundled catalog + trusted registry identity == N is not readable without the running app.",
  ],
  [
    "relaunch.state-continuity",
    "auth/app/runtime/workspace/session/transcript continuity across the real relaunch is not observable yet.",
  ],
  [
    "relaunch.post-update-turn",
    "one additional bounded turn without duplicated transcript events requires the running Desktop N + provider route.",
  ],
  [
    "relaunch.idempotent-reconcile",
    "a second idempotent reconcile requires the running AnyHarness N.",
  ],
];

function finalize(
  steps: readonly SliceStep[],
  reasons: readonly string[],
  productionTrustChain: boolean,
): SliceReport {
  const anyFailed = steps.some((s) => s.status === "failed");
  const anyBlocked = steps.some((s) => s.status === "blocked");
  const anyExpectedFail = steps.some((s) => s.status === "expected_fail");
  let status: CellStatus;
  if (anyFailed) status = "failed";
  else if (anyBlocked) status = "blocked";
  else if (anyExpectedFail) status = "expected_fail";
  else status = "green";
  return { steps, status, reasons, productionTrustChain };
}
