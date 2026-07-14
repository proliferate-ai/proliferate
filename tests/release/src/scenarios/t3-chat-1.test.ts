import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { chatCellSpecs, collectChatOutcomes, shippedHarnessKinds, t3Chat1 } from "./t3-chat-1.js";
import { buildPlannedCells } from "../runner/plan.js";
import { executeSelectedCells } from "../runner/execute.js";
import type { EnvResolution } from "../config/env-resolution.js";

async function catalogKinds(): Promise<string[]> {
  const catalogPath = path.resolve(import.meta.dirname, "../../../../catalogs/agents/catalog.json");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as { agents?: Array<{ kind?: string }> };
  return (catalog.agents ?? []).map((agent) => agent.kind).filter((kind): kind is string => Boolean(kind));
}

test("--agents all derives the shipped harness kinds from the catalog, not a hand-written list", async () => {
  const expected = await catalogKinds();
  assert.ok(expected.length >= 5);
  assert.deepEqual(await shippedHarnessKinds(), expected);
  const specs = await chatCellSpecs(["all"]);
  assert.deepEqual(
    specs.map((spec) => spec.dimensions.harness),
    expected,
  );
});

test("explicit --agents selection produces one cell per selected harness", async () => {
  const specs = await chatCellSpecs(["codex", "claude"]);
  assert.deepEqual(
    specs.map((spec) => spec.dimensions.harness),
    ["codex", "claude"],
  );
});

test("T3-CHAT-1 --agents all plans every catalog harness exactly once per lane", async () => {
  const expected = await catalogKinds();
  const cells = await buildPlannedCells([t3Chat1], { desktop: "web", agents: ["all"] });
  assert.equal(cells.length, expected.length * 2);
  for (const lane of ["local", "sandbox"] as const) {
    const laneCells = cells.filter((cell) => cell.runtime_lane === lane);
    assert.deepEqual(
      laneCells.map((cell) => cell.dimensions.harness).sort(),
      [...expected].sort(),
    );
    for (const cell of laneCells) {
      assert.equal(cell.cell_id, `T3-CHAT-1/${lane}/harness=${cell.dimensions.harness}`);
    }
  }
});

test("planCell steps name the cell's own harness", () => {
  const steps = t3Chat1.planCell(
    { runtimeLane: "local", desktop: "web", agents: ["all"] },
    {
      cell_id: "T3-CHAT-1/local/harness=codex",
      scenario_id: "T3-CHAT-1",
      registry_flow_ref: t3Chat1.registryFlowRef,
      runtime_lane: "local",
      dimensions: { harness: "codex" },
      required_env: [],
    },
  );
  assert.ok(steps.length > 0);
  for (const step of steps) {
    assert.match(step.description, /\[codex\]/);
  }
});

test("the sandbox implementation gap becomes explicit non-green children, not one green parent", async () => {
  const allCells = await buildPlannedCells([t3Chat1], { desktop: "web", agents: ["all"] });
  const sandboxCells = allCells.filter((cell) => cell.runtime_lane === "sandbox");
  const fakeEnv: EnvResolution = {
    all: [],
    missing: [],
    present: () => true,
    get: () => undefined,
    require: () => {
      throw new Error("not used");
    },
  };
  const report = await executeSelectedCells({
    behavior: "diagnostic",
    execution: "real",
    identity: {
      run_id: "run-1",
      shard_id: "shard-1",
      attempt: 1,
      source_sha: "c".repeat(40),
      origin: { kind: "local", github_run_id: null, github_job: null },
    },
    inputs: { targetLane: "local", desktop: "web", agents: "all", scenarios: ["T3-CHAT-1"] },
    scenarios: [t3Chat1],
    cells: sandboxCells,
    resolveNeededEnv: () => fakeEnv,
    resolveSecretValues: () => [],
  });
  assert.equal(report.results.length, sandboxCells.length);
  for (const result of report.results) {
    assert.equal(result.status, "expected_fail");
    assert.equal(result.reason?.code, "known_gap");
  }
  assert.equal(report.summary.integrity_errors.length, 0);
});

test("one shared workspace yields green/failed/blocked cells with exactly one create/delete (ETM-005)", async () => {
  const cells = (await buildPlannedCells([t3Chat1], { desktop: "web", agents: ["claude", "codex", "grok"] }))
    .filter((cell) => cell.runtime_lane === "local");
  assert.equal(cells.length, 3);

  let opened = 0;
  let closed = 0;
  const outcomes = await collectChatOutcomes(cells, {
    // grok has no compatible model; claude and codex do.
    resolveChoices: async () =>
      new Map([
        ["claude", { harnessKind: "claude", modelCandidates: ["haiku"], catalogPinVersion: undefined }],
        ["codex", { harnessKind: "codex", modelCandidates: ["gpt-cheap"], catalogPinVersion: undefined }],
      ]),
    openWorkspace: async () => {
      opened += 1;
      return {
        workspaceId: "ws-1",
        close: async () => {
          closed += 1;
        },
      };
    },
    candidatesFor: async (_harness, catalogCandidates) => [...catalogCandidates],
    attemptModel: async (workspaceId, choice) => {
      assert.equal(workspaceId, "ws-1");
      if (choice.harnessKind === "codex") {
        throw new Error("turn failed: SESSION_MODEL_GATED");
      }
    },
  });

  assert.equal(opened, 1);
  assert.equal(closed, 1);
  const byId = new Map(outcomes.map((outcome) => [outcome.cellId, outcome]));
  assert.equal(byId.get("T3-CHAT-1/local/harness=claude")?.status, "green");
  assert.equal(byId.get("T3-CHAT-1/local/harness=codex")?.status, "failed");
  assert.match(byId.get("T3-CHAT-1/local/harness=codex")?.reason?.message ?? "", /SESSION_MODEL_GATED/);
  assert.equal(byId.get("T3-CHAT-1/local/harness=grok")?.status, "blocked");
  assert.equal(outcomes.length, 3);
});

test("the workspace closes exactly once even when the mapping throws mid-batch (ETM-005)", async () => {
  const cells = (await buildPlannedCells([t3Chat1], { desktop: "web", agents: ["claude"] }))
    .filter((cell) => cell.runtime_lane === "local");
  let closed = 0;
  await assert.rejects(
    collectChatOutcomes(cells, {
      resolveChoices: async () =>
        new Map([["claude", { harnessKind: "claude", modelCandidates: ["haiku"], catalogPinVersion: undefined }]]),
      openWorkspace: async () => ({
        workspaceId: "ws-1",
        close: async () => {
          closed += 1;
        },
      }),
      candidatesFor: async () => {
        throw new Error("probe endpoint exploded");
      },
      attemptModel: async () => undefined,
    }),
    /probe endpoint exploded/,
  );
  assert.equal(closed, 1);
});
