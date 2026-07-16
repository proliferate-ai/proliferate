import assert from "node:assert/strict";
import { test } from "node:test";

import { t4Runtime1 } from "./t4-runtime-1.js";
import { ScenarioBlockedError, isMatrixScenario } from "../types.js";
import type { LeafScenarioDefinition, ScenarioRunContext } from "../types.js";
import type { EnvResolution } from "../../config/env-resolution.js";
import { resolveRetainedRuntimeBaseline } from "../../fixtures/retained-runtime-baseline.js";

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

// Every test must clear the process-level flag it may set, so cases don't leak.
function withSupervisorFlag<T>(value: string | undefined, body: () => T): T {
  const previous = process.env.RELEASE_E2E_SUPERVISOR_OWNED_RUNTIME;
  if (value === undefined) {
    delete process.env.RELEASE_E2E_SUPERVISOR_OWNED_RUNTIME;
  } else {
    process.env.RELEASE_E2E_SUPERVISOR_OWNED_RUNTIME = value;
  }
  try {
    return body();
  } finally {
    if (previous === undefined) {
      delete process.env.RELEASE_E2E_SUPERVISOR_OWNED_RUNTIME;
    } else {
      process.env.RELEASE_E2E_SUPERVISOR_OWNED_RUNTIME = previous;
    }
  }
}

test("T4-RUNTIME-1 is a leaf sandbox scenario with the contract as its flow ref", () => {
  assert.equal(t4Runtime1.id, "T4-RUNTIME-1");
  assert.deepEqual([...t4Runtime1.lanes], ["sandbox"]);
  assert.match(t4Runtime1.registryFlowRef, /tier-4-scenario-contract\.md#T4-RUNTIME-1$/);
  assert.equal(isMatrixScenario(t4Runtime1), false);
  // Strict tier-4: no sourceBacked marker, so --source-candidate refuses it.
  assert.equal("sourceBacked" in t4Runtime1 ? t4Runtime1.sourceBacked : undefined, undefined);
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
    () => withSupervisorFlag("1", () => leaf().run(fakeCtx({ targetLane: "local" }))),
    (error: unknown) => error instanceof ScenarioBlockedError && /--lane local/.test((error as Error).message),
  );
});

test("absent retained N-1 inputs block rather than fabricate an N-1", async () => {
  await assert.rejects(
    () => withSupervisorFlag("1", () => leaf().run(fakeCtx())),
    (error: unknown) =>
      error instanceof ScenarioBlockedError &&
      /no retained-production N-1 template/.test((error as Error).message) &&
      /Refusing to fabricate an N-1/.test((error as Error).message),
  );
});

test("supervisor-owned runtime not confirmed blocks even with retained inputs", async () => {
  const env = fakeEnv({
    RELEASE_E2E_RETAINED_TEMPLATE_ID: "tmpl_retained_n1",
    RELEASE_E2E_RETAINED_MANIFEST: JSON.stringify({ anyharness: { version: "0.3.11" } }),
  });
  await assert.rejects(
    () => withSupervisorFlag(undefined, () => leaf().run(fakeCtx({ env }))),
    (error: unknown) =>
      error instanceof ScenarioBlockedError &&
      /supervisor-owned runtime topology must be active/.test((error as Error).message),
  );
});

test("retained inputs + flag on: live body not yet wired, blocks honestly (never a false green)", async () => {
  const env = fakeEnv({
    RELEASE_E2E_RETAINED_TEMPLATE_ID: "tmpl_retained_n1",
    RELEASE_E2E_RETAINED_MANIFEST: JSON.stringify({ anyharness: { version: "0.3.11" } }),
  });
  await assert.rejects(
    () => withSupervisorFlag("1", () => leaf().run(fakeCtx({ env }))),
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
      RELEASE_E2E_RETAINED_ANYHARNESS_REPORTED_VERSION: "0.1.0",
    }),
  );
  // The unstamped-binary case (issue #1089): reported truth differs from tag.
  assert.equal(overridden?.anyharnessReportedVersion, "0.1.0");
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
