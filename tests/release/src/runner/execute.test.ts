import assert from "node:assert/strict";
import { test } from "node:test";

import type { EnvResolution, ResolvedEnvVar } from "../config/env-resolution.js";
import { validateReport } from "../evidence/schema.js";
import { gatewayJsonRpc } from "../fixtures/integration-gateway.js";
import { toFailureReports } from "../report/failure-reporter.js";
import type { ScenarioDefinition } from "../scenarios/types.js";
import { ScenarioBlockedError, ScenarioExpectedFailError } from "../scenarios/types.js";
import { executeSelectedTests, expandSelectedTests, SelectionError, type ExecuteOptions } from "./execute.js";
import type { RunIdentityV1 } from "./identity.js";

const IDENTITY: RunIdentityV1 = {
  run_id: "run-1",
  shard_id: "shard-1",
  attempt: 1,
  source_sha: "c".repeat(40),
  origin: { kind: "local", github_run_id: null, github_job: null },
};

interface FakeScenarioOptions {
  id: string;
  lanes?: Array<"local" | "sandbox">;
  requiredEnv?: string[];
  run?: ScenarioDefinition["run"];
  plan?: ScenarioDefinition["plan"];
}

function fakeScenario(options: FakeScenarioOptions): ScenarioDefinition {
  return {
    id: options.id,
    title: `${options.id} title`,
    registryFlowRef: `specs#${options.id}`,
    lanes: options.lanes ?? ["local"],
    requiredEnv: options.requiredEnv ?? [],
    plan: options.plan ?? (() => [{ description: `plan ${options.id}` }]),
    run: options.run ?? (async () => undefined),
  };
}

function fakeEnv(presentNames: string[] = [], secretValues: Record<string, string> = {}): EnvResolution {
  const names = new Set([...presentNames, ...Object.keys(secretValues)]);
  const all: ResolvedEnvVar[] = [...names].map((name) => ({
    spec: {
      name,
      description: name,
      whereItLives: "test",
      secret: name in secretValues,
    } as ResolvedEnvVar["spec"],
    value: secretValues[name] ?? "value",
    present: true,
  }));
  return {
    all,
    missing: [],
    present: (name) => names.has(name),
    get: (name) => (names.has(name) ? (secretValues[name] ?? "value") : undefined),
    require: (name) => {
      const value = secretValues[name] ?? (names.has(name) ? "value" : undefined);
      if (value === undefined) {
        throw new Error(`missing ${name}`);
      }
      return value;
    },
  };
}

function baseOptions(scenarios: ScenarioDefinition[], overrides: Partial<ExecuteOptions> = {}): ExecuteOptions {
  return {
    behavior: "diagnostic",
    execution: "real",
    identity: IDENTITY,
    inputs: { targetLane: "local", desktop: "web", agents: "all", scenarios: "all" },
    scenarios,
    resolveNeededEnv: () => fakeEnv(),
    ...overrides,
  };
}

test("expands scenarios across declared lanes with stable unique test ids", () => {
  const selected = expandSelectedTests([
    fakeScenario({ id: "A", lanes: ["local", "sandbox"] }),
    fakeScenario({ id: "B", lanes: ["sandbox"] }),
  ]);
  assert.deepEqual(
    selected.map((testEntry) => testEntry.test_id),
    ["A/local", "A/sandbox", "B/sandbox"],
  );
});

test("rejects duplicate expanded test ids before execution", () => {
  assert.throws(
    () => expandSelectedTests([fakeScenario({ id: "A" }), fakeScenario({ id: "A" })]),
    SelectionError,
  );
});

test("rejects a selection that expands to zero tests", () => {
  assert.throws(() => expandSelectedTests([]), SelectionError);
});

test("normal return normalizes to green with timestamps and duration", async () => {
  const report = await executeSelectedTests(baseOptions([fakeScenario({ id: "A" })]));
  const [result] = report.results;
  assert.equal(result.status, "green");
  assert.ok(result.started_at !== null);
  assert.ok(typeof result.duration_ms === "number");
  assert.equal(report.verdict.status, "non_qualifying");
  assert.equal(report.summary.intended_exit_code, 0);
});

test("ScenarioBlockedError, ScenarioExpectedFailError, Error, and non-Error throws normalize correctly", async () => {
  const scenarios = [
    fakeScenario({ id: "BLOCKED", run: async () => { throw new ScenarioBlockedError("gate"); } }),
    fakeScenario({ id: "XFAIL", run: async () => { throw new ScenarioExpectedFailError("known gap"); } }),
    fakeScenario({ id: "RED", run: async () => { throw new Error("assertion failed"); } }),
    fakeScenario({ id: "WEIRD", run: async () => { throw "a string"; } }),
    fakeScenario({ id: "GREEN" }),
  ];
  const report = await executeSelectedTests(baseOptions(scenarios));
  const byId = new Map(report.results.map((result) => [result.test_id, result]));
  assert.equal(byId.get("BLOCKED/local")?.status, "blocked");
  assert.equal(byId.get("BLOCKED/local")?.reason?.code, "scenario_blocked");
  assert.equal(byId.get("XFAIL/local")?.status, "expected_fail");
  assert.equal(byId.get("XFAIL/local")?.reason?.code, "known_gap");
  assert.equal(byId.get("RED/local")?.status, "failed");
  assert.equal(byId.get("RED/local")?.reason?.code, "scenario_failure");
  assert.equal(byId.get("WEIRD/local")?.status, "failed");
  // Diagnostic continues every independent sibling after each terminal state.
  assert.equal(byId.get("GREEN/local")?.status, "green");
  assert.equal(report.summary.intended_exit_code, 1);
});

test("strict also continues siblings after runtime non-green states", async () => {
  const ran: string[] = [];
  const scenarios = [
    fakeScenario({ id: "RED", run: async () => { ran.push("RED"); throw new Error("boom"); } }),
    fakeScenario({ id: "GREEN", run: async () => { ran.push("GREEN"); } }),
  ];
  const report = await executeSelectedTests(baseOptions(scenarios, { behavior: "strict" }));
  assert.deepEqual(ran, ["RED", "GREEN"]);
  assert.equal(report.verdict.status, "selected_tests_failed");
  assert.equal(report.summary.intended_exit_code, 1);
});

test("diagnostic missing requirements block only affected tests", async () => {
  const ran: string[] = [];
  const scenarios = [
    fakeScenario({ id: "NEEDY", requiredEnv: ["MISSING_VAR"], run: async () => { ran.push("NEEDY"); } }),
    fakeScenario({ id: "FREE", run: async () => { ran.push("FREE"); } }),
  ];
  const report = await executeSelectedTests(baseOptions(scenarios));
  const byId = new Map(report.results.map((result) => [result.test_id, result]));
  assert.equal(byId.get("NEEDY/local")?.status, "blocked");
  assert.equal(byId.get("NEEDY/local")?.reason?.code, "missing_requirement");
  assert.equal(byId.get("FREE/local")?.status, "green");
  assert.deepEqual(ran, ["FREE"]);
  assert.equal(report.summary.intended_exit_code, 0);
});

test("strict missing preflight executes zero test bodies, blocks affected, cancels the rest", async () => {
  const ran: string[] = [];
  const scenarios = [
    fakeScenario({ id: "NEEDY", requiredEnv: ["MISSING_VAR"], run: async () => { ran.push("NEEDY"); } }),
    fakeScenario({ id: "FREE", run: async () => { ran.push("FREE"); } }),
  ];
  const report = await executeSelectedTests(baseOptions(scenarios, { behavior: "strict" }));
  assert.deepEqual(ran, []);
  const byId = new Map(report.results.map((result) => [result.test_id, result]));
  assert.equal(byId.get("NEEDY/local")?.status, "blocked");
  assert.equal(byId.get("NEEDY/local")?.reason?.code, "missing_requirement");
  assert.equal(byId.get("FREE/local")?.status, "cancelled");
  assert.equal(byId.get("FREE/local")?.reason?.code, "strict_preflight_failed");
  assert.equal(report.verdict.status, "selected_tests_failed");
  assert.equal(report.summary.intended_exit_code, 1);
});

test("locally seeded vars do not satisfy the sandbox lane", async () => {
  const scenarios = [
    fakeScenario({ id: "A", lanes: ["local", "sandbox"], requiredEnv: ["SEEDED_VAR"] }),
  ];
  const report = await executeSelectedTests(
    baseOptions(scenarios, {
      resolveNeededEnv: () => fakeEnv(["SEEDED_VAR"]),
      locallySeeded: new Set(["SEEDED_VAR"]),
    }),
  );
  const byId = new Map(report.results.map((result) => [result.test_id, result]));
  assert.equal(byId.get("A/local")?.status, "green");
  assert.equal(byId.get("A/sandbox")?.status, "blocked");
});

test("dry-run calls each plan() exactly once, never run(), and finalizes not_run/dry_run", async () => {
  const planCalls: string[] = [];
  let runCalled = false;
  const scenarios = [
    fakeScenario({
      id: "A",
      lanes: ["local", "sandbox"],
      plan: ({ runtimeLane }) => {
        planCalls.push(`A/${runtimeLane}`);
        return [{ description: `step for ${runtimeLane}` }];
      },
      run: async () => { runCalled = true; },
    }),
  ];
  const report = await executeSelectedTests(baseOptions(scenarios, { execution: "dry_run" }));
  assert.deepEqual(planCalls, ["A/local", "A/sandbox"]);
  assert.equal(runCalled, false);
  for (const result of report.results) {
    assert.equal(result.status, "not_run");
    assert.equal(result.reason?.code, "dry_run");
    assert.equal(result.plan_steps.length, 1);
  }
  assert.equal(report.run.execution, "dry_run");
  assert.equal(report.verdict.status, "non_qualifying");
  assert.equal(report.summary.intended_exit_code, 0);
});

test("a throwing plan() becomes not_run/plan_error, records a runner error, continues, exits 2", async () => {
  const scenarios = [
    fakeScenario({ id: "BROKEN", plan: () => { throw new Error("plan bug"); } }),
    fakeScenario({ id: "FINE" }),
  ];
  const report = await executeSelectedTests(baseOptions(scenarios, { execution: "dry_run" }));
  const byId = new Map(report.results.map((result) => [result.test_id, result]));
  assert.equal(byId.get("BROKEN/local")?.status, "not_run");
  assert.equal(byId.get("BROKEN/local")?.reason?.code, "plan_error");
  assert.equal(byId.get("FINE/local")?.status, "not_run");
  assert.equal(byId.get("FINE/local")?.reason?.code, "dry_run");
  assert.equal(report.summary.runner_errors.length, 1);
  assert.equal(report.summary.by_status.failed, 0);
  assert.equal(report.verdict.status, "non_qualifying");
  assert.equal(report.summary.intended_exit_code, 2);
});

test("a post-selection runner defect finalizes every pending test and still produces a report", async () => {
  // Simulates e.g. a scenario referencing an env var that resolveEnv rejects
  // (undeclared in the manifest): the selected set must not be lost.
  const scenarios = [fakeScenario({ id: "A" }), fakeScenario({ id: "B" })];
  const report = await executeSelectedTests(
    baseOptions(scenarios, {
      resolveNeededEnv: () => { throw new Error('resolveEnv: "NOT_IN_MANIFEST" is not declared'); },
    }),
  );
  assert.equal(report.results.length, 2);
  for (const result of report.results) {
    assert.equal(result.status, "missing");
  }
  assert.equal(report.summary.runner_errors.length, 1);
  assert.match(report.summary.runner_errors[0].message, /NOT_IN_MANIFEST/);
  assert.equal(report.summary.intended_exit_code, 2);
});

test("a diagnostic dry-run runner defect still produces valid persistable evidence", async () => {
  const report = await executeSelectedTests(
    baseOptions([fakeScenario({ id: "DRY-A" }), fakeScenario({ id: "DRY-B" })], {
      execution: "dry_run",
      resolveNeededEnv: () => { throw new Error("preflight resolver failed"); },
    }),
  );

  assert.deepEqual(report.results.map((result) => result.status), ["missing", "missing"]);
  assert.equal(report.summary.runner_errors.length, 1);
  assert.equal(report.summary.integrity_errors.length, 2);
  assert.equal(report.summary.intended_exit_code, 2);
  assert.doesNotThrow(() => validateReport(report));
});

test("exact resolved secret values are redacted from the report", async () => {
  const secret = "sk-super-secret-value";
  const scenarios = [
    fakeScenario({
      id: "LEAKY",
      requiredEnv: ["SECRET_VAR"],
      run: async () => { throw new Error(`request failed with key ${secret}`); },
    }),
  ];
  const report = await executeSelectedTests(
    baseOptions(scenarios, {
      resolveNeededEnv: () => fakeEnv([], { SECRET_VAR: secret }),
      resolveSecretValues: () => [secret],
    }),
  );
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes(secret));
  assert.match(report.results[0].reason!.message, /\[REDACTED\]/);
});

test("secrets are redacted even when no selected scenario declares them", async () => {
  // A fixture can use a secret opportunistically (e.g. an optional GitHub
  // token in a clone URL) without listing it in requiredEnv; redaction draws
  // from the full manifest, injected here via resolveSecretValues.
  const secret = "ghp_undeclared_token";
  const scenarios = [
    fakeScenario({ id: "LEAKY", run: async () => { throw new Error(`clone https://x:${secret}@github.com failed`); } }),
  ];
  const report = await executeSelectedTests(
    baseOptions(scenarios, { resolveSecretValues: () => [secret] }),
  );
  assert.ok(!JSON.stringify(report).includes(secret));
});

test("provider response bodies never reach the report or issue payloads", async () => {
  // The ApiRequestError/LocalRuntimeError shape: Error.message embeds the
  // complete response body. The normalized evidence must withhold it.
  const providerPayload = '{"api_key":"sk-live-9999","customer_email":"a@b.c","stack":"Traceback..."}';
  class FakeApiRequestError extends Error {
    readonly status = 500;
    readonly body = providerPayload;
    constructor() {
      super(`POST /v1/checkout -> 500: ${providerPayload}`);
      this.name = "ApiRequestError";
    }
  }
  const scenarios = [fakeScenario({ id: "PROV", run: async () => { throw new FakeApiRequestError(); } })];
  const report = await executeSelectedTests(baseOptions(scenarios));
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes("sk-live-9999"));
  assert.ok(!serialized.includes("customer_email"));
  assert.match(report.results[0].reason!.message, /POST \/v1\/checkout -> 500/);
  assert.match(report.results[0].reason!.message, /withheld from evidence/);
});

test("plain integration-gateway response bodies never reach evidence or issue payloads", async () => {
  const providerPayload = '{"access_token":"RAW_GATEWAY_TOKEN","detail":"provider traceback"}';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(providerPayload, { status: 502 });
  try {
    const scenario = fakeScenario({
      id: "GATEWAY",
      run: async () => {
        await gatewayJsonRpc(
          {
            workerId: "worker-1",
            desktopInstallId: "desktop-1",
            mcpUrl: "https://gateway.example.test/mcp",
            authorization: "Bearer worker-token",
          },
          { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        );
      },
    });
    const report = await executeSelectedTests(baseOptions([scenario], { resolveSecretValues: () => [] }));
    const issues = toFailureReports(report.results);

    assert.equal(report.results[0].status, "failed");
    assert.ok(!JSON.stringify(report).includes("RAW_GATEWAY_TOKEN"));
    assert.ok(!JSON.stringify(issues).includes("RAW_GATEWAY_TOKEN"));
    assert.match(report.results[0].reason!.message, /response body withheld from evidence/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider payloads stay out of blocked and expected-fail evidence", async () => {
  const blockedPayload = "RAW_BLOCKED_PROVIDER_BODY";
  const expectedPayload = "RAW_EXPECTED_PROVIDER_BODY";
  const report = await executeSelectedTests(
    baseOptions([
      fakeScenario({
        id: "BLOCKED-PAYLOAD",
        run: async () => {
          throw new ScenarioBlockedError(`gateway unavailable -> 503: ${blockedPayload}`);
        },
      }),
      fakeScenario({
        id: "EXPECTED-PAYLOAD",
        run: async () => {
          throw new ScenarioExpectedFailError(`provisioning failed: ${expectedPayload}`);
        },
      }),
    ]),
  );
  const serialized = JSON.stringify(report);

  assert.ok(!serialized.includes(blockedPayload));
  assert.ok(!serialized.includes(expectedPayload));
  assert.equal(report.results[0].status, "blocked");
  assert.equal(report.results[1].status, "expected_fail");
});

test("runtime-discovered URL credentials are scrubbed even when unknown to the redactor", async () => {
  // A `gh auth token` embedded in a clone URL is not in the env manifest, so
  // exact-value redaction cannot know it; the URL-userinfo scrub must catch it.
  const token = "ghp_dynamicallyDiscovered123";
  const scenarios = [
    fakeScenario({
      id: "GIT",
      run: async () => {
        throw new Error(
          `git clone https://x-access-token:${token}@github.com/o/r.git failed (128): ` +
            `fatal: unable to access 'https://x-access-token:${token}@github.com/o/r.git'`,
        );
      },
    }),
  ];
  const report = await executeSelectedTests(baseOptions(scenarios, { resolveSecretValues: () => [] }));
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes(token));
  assert.match(report.results[0].reason!.message, /\[REDACTED\]@github\.com/);
});

test("rejects duplicate scenario ids even with disjoint lanes", () => {
  assert.throws(
    () =>
      expandSelectedTests([
        fakeScenario({ id: "A", lanes: ["local"] }),
        fakeScenario({ id: "A", lanes: ["sandbox"] }),
      ]),
    SelectionError,
  );
});

test("overlong messages are bounded to 4096 code points", async () => {
  const scenarios = [
    fakeScenario({ id: "LOUD", run: async () => { throw new Error("x".repeat(10_000)); } }),
  ];
  const report = await executeSelectedTests(baseOptions(scenarios));
  assert.ok([...report.results[0].reason!.message].length <= 4096);
});

test("the report records identity, inputs, behavior, and selected/result equality", async () => {
  const report = await executeSelectedTests(
    baseOptions([fakeScenario({ id: "A", lanes: ["local", "sandbox"] })], {
      inputs: { targetLane: "staging", desktop: "native", agents: ["claude"], scenarios: ["A"] },
    }),
  );
  assert.equal(report.run.run_id, "run-1");
  assert.equal(report.run.behavior, "diagnostic");
  assert.equal(report.inputs.target_lane, "staging");
  assert.deepEqual(report.inputs.agents, ["claude"]);
  assert.deepEqual(
    report.selected_tests.map((testEntry) => testEntry.test_id).sort(),
    report.results.map((result) => result.test_id).sort(),
  );
  assert.equal(report.summary.selected, report.summary.finalized);
});

test("strict all-green is the only strict exit-0 result", async () => {
  const report = await executeSelectedTests(
    baseOptions([fakeScenario({ id: "A" }), fakeScenario({ id: "B" })], { behavior: "strict" }),
  );
  assert.equal(report.verdict.status, "selected_tests_passed");
  assert.equal(report.verdict.scope, "selected_tests");
  assert.equal(report.verdict.completeness, "partial");
  assert.equal(report.summary.intended_exit_code, 0);
});

test("the report carries the supplied candidate evidence, or explicit null when omitted", async () => {
  const omitted = await executeSelectedTests(baseOptions([fakeScenario({ id: "A" })]));
  assert.equal(omitted.schema_version, 2);
  assert.equal(omitted.candidate_build, null);

  const evidence = {
    artifacts: [{ artifact_id: "anyharness/test-host", version: "9.9.9", sha256: "e".repeat(64) }],
  };
  const carried = await executeSelectedTests(
    baseOptions([fakeScenario({ id: "A" })], { candidateBuild: evidence }),
  );
  assert.deepEqual(carried.candidate_build, evidence);
});
