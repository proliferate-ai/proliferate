import assert from "node:assert/strict";

import type { ScenarioDefinition, ScenarioRunContext } from "../types.js";
import { ScenarioBlockedError } from "../types.js";
import {
  RETAINED_ANYHARNESS_REPORTED_VERSION_ENV,
  RETAINED_RELEASE_ID_ENV,
  resolveRetainedRuntimeBaseline,
  type RetainedRuntimeBaseline,
} from "../../fixtures/retained-runtime-baseline.js";

/**
 * T4-RUNTIME-1 — heartbeat-driven managed runtime update (existing sandbox).
 * Target guarantee: specs/developing/testing/tier-4-scenario-contract.md
 * §"T4-RUNTIME-1 — heartbeat-driven runtime update".
 *
 * The tier-4 assertion, in one line: a sandbox provisioned from the immutable
 * retained-production N-1 E2B template completes a baseline turn while its
 * target-scoped desired AnyHarness version is N-1; then ONLY that target's
 * desired version is set to exact candidate N; the N-1 Worker observes the
 * divergence on its heartbeat and writes ONE durable mailbox request (it never
 * downloads/replaces/kills/rolls back the runtime itself); the N-1 Supervisor
 * consumes it — verify → download → re-verify → stage → atomic activate →
 * dependency-ordered restart → health-gate N, rolling back to last-good on an
 * unhealthy activation; the Worker reconnects with its durable identity and
 * reports convergence; and a post-update turn succeeds. The mechanism is the
 * supervisor-owned update flow landed in #1223/#1241.
 *
 * WHY THIS SCENARIO CURRENTLY BLOCKS RATHER THAN RUNS (founder ruling
 * 2026-07-16, frozen spec "Retain Exact Production Artifacts for Tier 4"):
 * a truthful N-1→N proof requires a REAL retained-production N-1 baseline.
 * The retained-release receipt mechanism now exists
 * (tests/release/retained-releases/ + retained-release-set.ts): supplying
 * RELEASE_E2E_RETAINED_RELEASE_ID selects a committed receipt, which is
 * schema-, digest-, and policy-validated before `run()` continues into the
 * real live proof. Rather than fabricate an N-1 (a same-source second
 * template labelled "N-1" would prove nothing about a real cross-version
 * update), this scenario reports `blocked` until a receipt is selected. This
 * keeps the gap visible (a blocked cell is reported, never silently passed)
 * without ever claiming a green it did not earn.
 *
 * Standing blockers this scenario reports honestly rather than faking:
 *   - --lane local has no managed-cloud world and no E2B sandbox -> blocked.
 *   - no retained release id selected -> blocked
 *     (the founder-ruled default until a retained baseline is chosen).
 *   - the candidate API is not running with supervisor_owned_runtime -> blocked
 *     (a heartbeat would return the legacy direct-Worker topology, which
 *     contradicts the contract's "Worker writes the atomic mailbox request").
 *
 * Known mechanism gotcha to carry into the live proof (from T4-CLOUD-1 /
 * issue #1089): the released AnyHarness binary historically reported
 * CARGO_PKG_VERSION (hardcoded 0.1.0, never stamped at release) from both
 * `anyharness --version` and /health `version`. The supervisor health-gate and
 * the worker `--version` probe assert an exact match to the requested version
 * (R9R-001 / R9-008), so a retained N-1 or candidate N whose binary is not
 * version-stamped can never health-gate. The retained baseline resolver must
 * therefore carry the exact version each artifact actually REPORTS, not merely
 * its release tag, so the live proof asserts against observable truth.
 */

const SUPERVISOR_OWNED_RUNTIME_ENV = "RELEASE_E2E_SUPERVISOR_OWNED_RUNTIME";

export const t4Runtime1: ScenarioDefinition = {
  id: "T4-RUNTIME-1",
  title: "heartbeat-driven managed runtime update (existing sandbox, N-1 -> N)",
  registryFlowRef: "specs/developing/testing/tier-4-scenario-contract.md#T4-RUNTIME-1",
  lanes: ["sandbox"],
  // Every input the gates below read must be declared here: the runner builds
  // ctx.env from the union of the selected cells' requiredEnv (execute.ts), so a
  // var the scenario reaches for via ctx.env but does not declare is invisible
  // to the real runner (resolves undefined) even when the operator supplied it
  // — the retained inputs would then always read absent (T4R-CONTROL-001). The
  // reported-version override is deliberately NOT here: it is optional (the
  // manifest supplies a default), and a required var would wrongly block when a
  // stamped binary needs no override.
  // The receipt id is THE required baseline input: it names a committed,
  // fully validated retained-release receipt. The legacy template/manifest
  // pair is a deprecated diagnostic override and is deliberately NOT here —
  // requiredEnv vars block the cell when absent, and the pair is an
  // alternative, not a requirement; it is read through the optional-var idiom
  // below (same as the reported-version override).
  requiredEnv: [
    "RELEASE_E2E_SERVER_URL",
    RETAINED_RELEASE_ID_ENV,
    SUPERVISOR_OWNED_RUNTIME_ENV,
  ],
  plan: () => [
    { description: "resolve the immutable retained-production N-1 template + manifest (else block)" },
    { description: "confirm the candidate API runs with supervisor_owned_runtime (else block)" },
    { description: "authenticate a disposable actor; provision its sandbox from the N-1 template" },
    { description: "assert N-1 Supervisor/Worker/AnyHarness + bundled catalog/registry + agent identities" },
    { description: "create a cloud workspace/session; complete one bounded baseline turn" },
    { description: "record Worker identity/revisions/cursor/pending-results/runtime-home/session/transcript" },
    { description: "set ONLY this target's desired AnyHarness version N-1 -> exact candidate N" },
    { description: "observe the Worker write exactly one durable mailbox request (no direct swap/kill)" },
    { description: "observe the Supervisor verify/stage/activate/health-gate N (rollback on unhealthy)" },
    { description: "assert AnyHarness N healthy + reports exact candidate version/digest; unrelated targets unchanged" },
    { description: "assert Worker reconnects with durable identity and reports convergence to N" },
    { description: "assert workspace/session/transcript continuity + monotonic events across restart" },
    { description: "assert per-agent native/ACP artifacts match N catalog pins (changed downloaded, unchanged no-op)" },
    { description: "complete one additional cheap turn in the existing session" },
    { description: "assert the sandbox remains on its immutable N-1 E2B image; strict cleanup" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    await runReal(ctx);
  },
};

async function runReal(ctx: ScenarioRunContext): Promise<void> {
  if (ctx.targetLane === "local") {
    throw new ScenarioBlockedError(
      "T4-RUNTIME-1: the heartbeat-driven update runs against a real managed-cloud E2B sandbox with a " +
        "Supervisor-parented Worker/AnyHarness; --lane local has neither the managed-cloud world nor an " +
        "E2B sandbox. Run with --lane sandbox.",
    );
  }

  // Founder-ruled gate (2026-07-16): a truthful N-1 -> N proof needs a REAL
  // retained-production N-1 template + manifest. Absent those inputs, block
  // rather than fabricate an N-1. The gating inputs are read from ctx.env (the
  // runner's single env-resolution authority) — the scenario declares both in
  // requiredEnv so they actually reach here (T4R-CONTROL-001). The optional
  // reported-version override is read through the optional-var idiom
  // (process.env with a manifest-derived default — matching T3-INT-1/T3-WT-1),
  // NOT ctx.env: it is intentionally absent from requiredEnv, so ctx.env would
  // never surface it. It is handed to the resolver explicitly.
  const reportedVersionOverride = process.env[RETAINED_ANYHARNESS_REPORTED_VERSION_ENV];
  const retained: RetainedRuntimeBaseline | null = resolveRetainedRuntimeBaseline(
    ctx.env,
    reportedVersionOverride,
  );
  if (!retained) {
    throw new ScenarioBlockedError(
      "T4-RUNTIME-1: no retained-production N-1 baseline selected. A truthful N-1 -> N update proof " +
        "requires the immutable retained artifacts of a real production release. Supply " +
        `${RETAINED_RELEASE_ID_ENV} naming a committed retained-release receipt ` +
        "(tests/release/retained-releases/index.json — the founder-ruled bootstrap_unqualified v0.3.38 " +
        "baseline is the current entry). Refusing to fabricate an N-1 (a same-source second template " +
        "proves nothing about a real cross-version update).",
    );
  }

  // Read from ctx.env (the single runner authority), not process.env: the flag
  // is declared in requiredEnv, so the runner surfaces it here and there is no
  // second, divergent input path (T4R-CONTROL-001).
  if (ctx.env.get(SUPERVISOR_OWNED_RUNTIME_ENV)?.trim() !== "1") {
    throw new ScenarioBlockedError(
      "T4-RUNTIME-1: the supervisor-owned runtime topology must be active on the candidate API for the " +
        "heartbeat to return desiredTopology=supervisor_owned and for the Worker to write the durable " +
        "mailbox request rather than swapping the binary itself (server default is OFF). Deploy the " +
        `candidate API with PROLIFERATE_SUPERVISOR_OWNED_RUNTIME=1 and set ${SUPERVISOR_OWNED_RUNTIME_ENV}=1 ` +
        "to confirm it. Without it the observed behavior would be the legacy direct-Worker path, which " +
        "contradicts the T4-RUNTIME-1 contract.",
    );
  }

  // The live proof body is gated behind the retained-baseline availability
  // above. It is implemented incrementally as the retained-template mechanism
  // lands; today no environment supplies the inputs, so control never reaches
  // here in CI or dispatch. The assertion below documents the invariant that
  // the baseline carries observable versions (not mere release tags) so the
  // eventual health-gate assertion compares against reported truth (issue
  // #1089 gotcha).
  assert.ok(
    retained.anyharnessReportedVersion.length > 0,
    "T4-RUNTIME-1: retained baseline must carry the version AnyHarness actually reports, not just a tag",
  );
  throw new ScenarioBlockedError(
    "T4-RUNTIME-1: retained baseline inputs were supplied but the live-proof body is not yet wired in this " +
      "PR (frozen scope: author the collector + honest block; the live N-1 -> N drive lands when a real " +
      "retained template exists and the founder rules the baseline-turn-vs-#1261 policy). Reporting blocked " +
      "rather than a false green.",
  );
}
