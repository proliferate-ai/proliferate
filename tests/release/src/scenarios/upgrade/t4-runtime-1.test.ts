import assert from "node:assert/strict";
import { test } from "node:test";

import { t4Runtime1 } from "./t4-runtime-1.js";
import { ScenarioBlockedError, isMatrixScenario } from "../types.js";
import type { LeafScenarioDefinition, ScenarioRunContext } from "../types.js";
import { resolveEnv, type EnvResolution } from "../../config/env-resolution.js";
import { resolveRetainedRuntimeBaseline } from "../../fixtures/retained-runtime-baseline.js";
import { executeSelectedCells } from "../../runner/execute.js";
import { buildPlannedCells } from "../../runner/plan.js";
import type { RunIdentityV1 } from "../../runner/identity.js";

const EXEC_IDENTITY: RunIdentityV1 = {
  run_id: "run-t4r",
  shard_id: "shard-1",
  attempt: 1,
  source_sha: "e".repeat(40),
  origin: { kind: "local", github_run_id: null, github_job: null },
};

// Drive T4-RUNTIME-1 through the REAL planner + runner env-resolution path
// (the authority ctx.env is built from), resolving env over an explicit source
// map — never process.env — so the assertion is hermetic. Returns the single
// cell's result. This is the T4R-CONTROL-001 regression surface: it proves
// supplied retained inputs actually reach the scenario, which a hand-built
// EnvResolution injected straight into run() cannot prove.
async function runViaRunner(source: Record<string, string>) {
  const cells = await buildPlannedCells([t4Runtime1], { desktop: "web", agents: ["all"] });
  const report = await executeSelectedCells({
    behavior: "diagnostic",
    execution: "real",
    identity: EXEC_IDENTITY,
    inputs: { targetLane: "cloud", desktop: "web", agents: "all", scenarios: "all" },
    scenarios: [t4Runtime1],
    cells,
    // The real resolver over an explicit source: exactly how the CLI wires
    // ctx.env, minus process.env ambient leakage.
    resolveNeededEnv: (names) => resolveEnv(names, source as NodeJS.ProcessEnv),
    resolveSecretValues: () => [],
  });
  const result = report.results.find((r) => r.cell_id === "T4-RUNTIME-1/sandbox");
  assert.ok(result, "expected a T4-RUNTIME-1/sandbox cell result");
  return result;
}

const RETAINED_SOURCE = {
  RELEASE_E2E_SERVER_URL: "https://qualification.example/api",
  RELEASE_E2E_RETAINED_TEMPLATE_ID: "tmpl_retained_n1",
  RELEASE_E2E_RETAINED_MANIFEST: JSON.stringify({ anyharness: { version: "0.3.11" } }),
  RELEASE_E2E_SUPERVISOR_OWNED_RUNTIME: "1",
} as const;

// T4-RUNTIME-1 is a leaf scenario; narrow once so tests can call plan()/run().
function leaf(): LeafScenarioDefinition {
  if (isMatrixScenario(t4Runtime1)) {
    throw new Error("T4-RUNTIME-1 must be a leaf scenario");
  }
  return t4Runtime1;
}

function fakeEnv(vars: Record<string, string> = {}): EnvResolution {
  const values: Record<string, string> = {
    RELEASE_E2E_SERVER_URL: "https://qualification.example/api",
    ...vars,
  };
  return {
    all: [],
    missing: [],
    present: (name) => values[name] !== undefined,
    get: (name) => values[name],
    require: (name) => {
      const value = values[name];
      if (value === undefined) {
        throw new Error(`missing required env var "${name}"`);
      }
      return value;
    },
  };
}

// The supervisor-owned confirmation now reads ctx.env (a requiredEnv var, the
// runner's single authority), so a fake env with the flag set is how these
// direct tests drive past that gate — no process.env mutation.
function envWithFlag(vars: Record<string, string> = {}): EnvResolution {
  return fakeEnv({ RELEASE_E2E_SUPERVISOR_OWNED_RUNTIME: "1", ...vars });
}

function fakeCtx(overrides: Partial<ScenarioRunContext> = {}): ScenarioRunContext {
  return {
    targetLane: "cloud",
    runtimeLane: "sandbox",
    desktop: "web",
    agents: ["claude"],
    dryRun: false,
    env: fakeEnv(),
    candidateBuildMap: null,
    runIdentity: null,
    runDir: null,
    ports: null,
    ...overrides,
  };
}

test("T4-RUNTIME-1 is a leaf sandbox scenario with the contract as its flow ref", () => {
  assert.equal(t4Runtime1.id, "T4-RUNTIME-1");
  assert.deepEqual([...t4Runtime1.lanes], ["sandbox"]);
  assert.match(t4Runtime1.registryFlowRef, /tier-4-scenario-contract\.md#T4-RUNTIME-1$/);
  assert.equal(isMatrixScenario(t4Runtime1), false);
  // Strict tier-4: no sourceBacked marker, so --source-candidate refuses it.
  assert.equal("sourceBacked" in t4Runtime1 ? t4Runtime1.sourceBacked : undefined, undefined);
});

test("declares its gating inputs in requiredEnv so the runner surfaces them in ctx.env", () => {
  // Regression for T4R-CONTROL-001: a gating var the scenario reads via ctx.env
  // but omits from requiredEnv is invisible to the real runner. All three gates
  // (server URL, the retained baseline inputs, the supervisor flag) must be
  // declared. The optional reported-version override must NOT be, so a stamped
  // binary that needs no override is not spuriously blocked as missing.
  assert.deepEqual(
    [...t4Runtime1.requiredEnv].sort(),
    [
      "RELEASE_E2E_RETAINED_MANIFEST",
      "RELEASE_E2E_RETAINED_TEMPLATE_ID",
      "RELEASE_E2E_SERVER_URL",
      "RELEASE_E2E_SUPERVISOR_OWNED_RUNTIME",
    ],
  );
  assert.equal(
    t4Runtime1.requiredEnv.includes("RELEASE_E2E_RETAINED_ANYHARNESS_REPORTED_VERSION"),
    false,
  );
});

test("plan() names the baseline + upgrade + continuity beats verbatim under dry-run", () => {
  const steps = leaf().plan({ runtimeLane: "sandbox", desktop: "web", agents: ["claude"] });
  const text = steps.map((step) => step.description).join("\n");
  assert.match(text, /retained-production N-1 template/);
  assert.match(text, /supervisor_owned_runtime/);
  assert.match(text, /one durable mailbox request/);
  assert.match(text, /rollback on unhealthy/i);
  assert.match(text, /immutable N-1 E2B image/);
});

test("dry-run performs no work and never throws", async () => {
  await leaf().run(fakeCtx({ dryRun: true }));
});

test("--lane local blocks: no managed-cloud world / E2B sandbox there", async () => {
  await assert.rejects(
    () => leaf().run(fakeCtx({ targetLane: "local", env: envWithFlag() })),
    (error: unknown) => error instanceof ScenarioBlockedError && /--lane local/.test((error as Error).message),
  );
});

test("absent retained N-1 inputs block rather than fabricate an N-1", async () => {
  await assert.rejects(
    () => leaf().run(fakeCtx({ env: envWithFlag() })),
    (error: unknown) =>
      error instanceof ScenarioBlockedError &&
      /no retained-production N-1 template/.test((error as Error).message) &&
      /Refusing to fabricate an N-1/.test((error as Error).message),
  );
});

test("supervisor-owned runtime not confirmed blocks even with retained inputs", async () => {
  // Flag absent from ctx.env (not declared "1"): the confirmation gate fires.
  const env = fakeEnv({
    RELEASE_E2E_RETAINED_TEMPLATE_ID: "tmpl_retained_n1",
    RELEASE_E2E_RETAINED_MANIFEST: JSON.stringify({ anyharness: { version: "0.3.11" } }),
  });
  await assert.rejects(
    () => leaf().run(fakeCtx({ env })),
    (error: unknown) =>
      error instanceof ScenarioBlockedError &&
      /supervisor-owned runtime topology must be active/.test((error as Error).message),
  );
});

test("retained inputs + flag on: live body not yet wired, blocks honestly (never a false green)", async () => {
  const env = envWithFlag({
    RELEASE_E2E_RETAINED_TEMPLATE_ID: "tmpl_retained_n1",
    RELEASE_E2E_RETAINED_MANIFEST: JSON.stringify({ anyharness: { version: "0.3.11" } }),
  });
  await assert.rejects(
    () => leaf().run(fakeCtx({ env })),
    (error: unknown) =>
      error instanceof ScenarioBlockedError && /live-proof body is not yet wired/.test((error as Error).message),
  );
});

test("resolver returns null when either retained input is missing", () => {
  assert.equal(resolveRetainedRuntimeBaseline(fakeEnv()), null);
  assert.equal(
    resolveRetainedRuntimeBaseline(fakeEnv({ RELEASE_E2E_RETAINED_TEMPLATE_ID: "tmpl_only" })),
    null,
  );
  assert.equal(
    resolveRetainedRuntimeBaseline(fakeEnv({ RELEASE_E2E_RETAINED_MANIFEST: "{}" })),
    null,
  );
  // Whitespace-only counts as absent.
  assert.equal(
    resolveRetainedRuntimeBaseline(
      fakeEnv({ RELEASE_E2E_RETAINED_TEMPLATE_ID: "   ", RELEASE_E2E_RETAINED_MANIFEST: "{}" }),
    ),
    null,
  );
});

test("resolver derives the reported version from the manifest, override wins", () => {
  const derived = resolveRetainedRuntimeBaseline(
    fakeEnv({
      RELEASE_E2E_RETAINED_TEMPLATE_ID: "tmpl_retained_n1",
      RELEASE_E2E_RETAINED_MANIFEST: JSON.stringify({ anyharness: { version: "0.3.11" } }),
    }),
  );
  assert.ok(derived);
  assert.equal(derived?.templateId, "tmpl_retained_n1");
  assert.equal(derived?.anyharnessReportedVersion, "0.3.11");

  const overridden = resolveRetainedRuntimeBaseline(
    fakeEnv({
      RELEASE_E2E_RETAINED_TEMPLATE_ID: "tmpl_retained_n1",
      RELEASE_E2E_RETAINED_MANIFEST: JSON.stringify({ anyharness: { version: "0.3.11" } }),
    }),
    // The override is now an explicit argument, not an env read: it is optional
    // (not a requiredEnv gate), so the scenario reads it via the optional-var
    // idiom and hands it here (T4R-CONTROL-001).
    "0.1.0",
  );
  // The unstamped-binary case (issue #1089): reported truth differs from tag.
  assert.equal(overridden?.anyharnessReportedVersion, "0.1.0");

  // A blank/whitespace override falls back to the manifest-derived version.
  const blankOverride = resolveRetainedRuntimeBaseline(
    fakeEnv({
      RELEASE_E2E_RETAINED_TEMPLATE_ID: "tmpl_retained_n1",
      RELEASE_E2E_RETAINED_MANIFEST: JSON.stringify({ anyharness: { version: "0.3.11" } }),
    }),
    "   ",
  );
  assert.equal(blankOverride?.anyharnessReportedVersion, "0.3.11");
});

test("resolver tolerates a flat anyharnessVersion field and an unparseable manifest", () => {
  const flat = resolveRetainedRuntimeBaseline(
    fakeEnv({
      RELEASE_E2E_RETAINED_TEMPLATE_ID: "tmpl_retained_n1",
      RELEASE_E2E_RETAINED_MANIFEST: JSON.stringify({ anyharnessVersion: "0.3.10" }),
    }),
  );
  assert.equal(flat?.anyharnessReportedVersion, "0.3.10");

  const garbage = resolveRetainedRuntimeBaseline(
    fakeEnv({
      RELEASE_E2E_RETAINED_TEMPLATE_ID: "tmpl_retained_n1",
      RELEASE_E2E_RETAINED_MANIFEST: "not json {",
    }),
  );
  // Non-null (both inputs present) but empty reported version, which the
  // scenario asserts against so a malformed baseline blocks rather than guesses.
  assert.ok(garbage);
  assert.equal(garbage?.anyharnessReportedVersion, "");
});

// ---------------------------------------------------------------------------
// Execution-level regressions (T4R-CONTROL-001): drive the scenario through the
// real planner + runner env-resolution, the only path that proves supplied
// retained inputs actually reach ctx.env. No E2B, no flag activation, no
// fabricated N-1 — every case still terminates blocked.
// ---------------------------------------------------------------------------

test("REGRESSION T4R-CONTROL-001: supplied retained inputs reach the scenario and advance to the terminal honest block", async () => {
  const result = await runViaRunner(RETAINED_SOURCE);
  // Before the fix, ctx.env carried only RELEASE_E2E_SERVER_URL, so the retained
  // gate always fired "no retained-production N-1 template" even with the inputs
  // set. Now the inputs are visible and control reaches the LAST honest gate.
  assert.equal(result.status, "blocked");
  assert.equal(result.reason?.code, "scenario_blocked");
  assert.match(result.reason!.message, /live-proof body is not yet wired/);
});

test("REGRESSION T4R-CONTROL-001: absent retained inputs are surfaced as a missing requirement (still blocked, never green)", async () => {
  // Flag + server URL present, retained inputs absent: because the retained vars
  // are declared in requiredEnv, the runner's own preflight blocks the cell as a
  // missing requirement — an honest block, not a false green, and not a silent
  // "reached the scenario and read undefined".
  const result = await runViaRunner({
    RELEASE_E2E_SERVER_URL: "https://qualification.example/api",
    RELEASE_E2E_SUPERVISOR_OWNED_RUNTIME: "1",
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason?.code, "missing_requirement");
  assert.match(result.reason!.message, /RELEASE_E2E_RETAINED_TEMPLATE_ID/);
  assert.match(result.reason!.message, /RELEASE_E2E_RETAINED_MANIFEST/);
});

test("REGRESSION T4R-CONTROL-001: retained inputs present but flag unset blocks as a missing requirement", async () => {
  // The supervisor flag is now a declared requiredEnv gate too, so an absent flag
  // blocks at preflight rather than through a divergent process.env read.
  const result = await runViaRunner({
    RELEASE_E2E_SERVER_URL: "https://qualification.example/api",
    RELEASE_E2E_RETAINED_TEMPLATE_ID: "tmpl_retained_n1",
    RELEASE_E2E_RETAINED_MANIFEST: JSON.stringify({ anyharness: { version: "0.3.11" } }),
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason?.code, "missing_requirement");
  assert.match(result.reason!.message, /RELEASE_E2E_SUPERVISOR_OWNED_RUNTIME/);
});
