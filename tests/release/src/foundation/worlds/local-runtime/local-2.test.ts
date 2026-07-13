import assert from "node:assert/strict";
import { test } from "node:test";

import { local2CellIdentity, runLocal2Cell } from "./local-2.js";
import { cellKey } from "../../contracts/identity.js";
import type {
  CleanupEntry,
  CleanupLedger,
  CleanupState,
} from "../../contracts/cleanup.js";
import type { EvidenceSink, RunEvidence } from "../../contracts/evidence.js";
import type { WorldContext, LocalRuntimeWorldHandle } from "../../contracts/world.js";
import type { CandidateManifest } from "../../contracts/artifacts.js";
import type { FinalCellResult } from "../../contracts/results.js";
import type { SelectedCellPlan } from "../../contracts/plan.js";
import { evaluateRun } from "../../contracts/evaluate.js";

class InMemoryLedger implements CleanupLedger {
  readonly rows: CleanupEntry[] = [];
  async register(
    entry: Omit<
      CleanupEntry,
      "sequence" | "state" | "attempts" | "registeredAt" | "updatedAt" | "lastError"
    >,
  ): Promise<number> {
    const sequence = this.rows.length + 1;
    const at = new Date().toISOString();
    this.rows.push({
      ...entry,
      sequence,
      state: "registered",
      attempts: 0,
      registeredAt: at,
      updatedAt: at,
      lastError: null,
    });
    return sequence;
  }
  async transition(sequence: number, state: CleanupState, error?: string): Promise<void> {
    const row = this.rows.find((r) => r.sequence === sequence);
    if (row) {
      Object.assign(row, { state, lastError: error ?? null, updatedAt: new Date().toISOString() });
    }
  }
  async entries(): Promise<readonly CleanupEntry[]> {
    return this.rows;
  }
}

class InMemoryEvidence implements EvidenceSink {
  readonly events: Array<Record<string, unknown>> = [];
  finalized: RunEvidence | null = null;
  async append(event: Readonly<Record<string, unknown>>): Promise<void> {
    this.events.push({ ...event });
  }
  async finalize(evidence: RunEvidence): Promise<void> {
    this.finalized = evidence;
  }
}

function stubContext(): { ctx: WorldContext; ledger: InMemoryLedger; evidence: InMemoryEvidence } {
  const ledger = new InMemoryLedger();
  const evidence = new InMemoryEvidence();
  const run = {
    runId: "run-test",
    sourceSha: "deadbeef",
    candidateManifestHash: "hash",
    retainedManifestHash: null,
    executionHost: "local" as const,
    origin: "local:test",
    createdAt: new Date().toISOString(),
  };
  const shard = { runId: "run-test", shardId: "shard-1-of-1", shardIndex: 0, shardCount: 1 };
  const candidate = { kind: "candidate", sourceSha: "deadbeef" } as unknown as CandidateManifest;
  const ctx: WorldContext = { run, shard, candidate, retained: null, ledger, evidence };
  return { ctx, ledger, evidence };
}

function localRuntimeHandle(gatewayOrigin: string, ctx: WorldContext): LocalRuntimeWorldHandle {
  return {
    world: "local-runtime",
    run: ctx.run,
    shard: ctx.shard,
    readiness: [],
    serverUrl: "http://127.0.0.1:8086",
    webUrl: "http://127.0.0.1:8542",
    databaseUrl: "postgresql://[REDACTED]@127.0.0.1:5432/x",
    anyharnessUrl: "http://127.0.0.1:8542",
    gatewayOrigin,
    gatewayIdentity: gatewayOrigin ? "qualification-litellm:gw" : "gateway-absent",
  };
}

test("cell identity is stable and carries the managed-gateway route", () => {
  const cell = local2CellIdentity("claude");
  assert.equal(cell.scenarioId, "LOCAL-2");
  assert.equal(cell.world, "local-runtime");
  assert.equal(cell.productHost, "desktop-web");
  assert.deepEqual(cell.dimensions, { harness: "claude", route: "managed-gateway" });
  assert.equal(
    cellKey(cell),
    "local-runtime/LOCAL-2/desktop-web/harness=claude,route=managed-gateway",
  );
});

test("emits a blocked FinalCellResult (never green) when no gateway is configured", async () => {
  const { ctx, evidence } = stubContext();
  const handle = localRuntimeHandle("", ctx); // no gateway origin
  const result = await runLocal2Cell(handle, ctx, { env: {}, harness: "claude" });
  assert.equal(result.status, "blocked");
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].status, "blocked");
  assert.match(result.attempts[0].detail, /no qualification LiteLLM gateway resolved/);
  // Evidence for the final cell was emitted.
  assert.ok(evidence.events.some((e) => e.kind === "cell-final" && e.status === "blocked"));
});

test("a blocked cell cannot qualify a strict run (evaluate treats blocked as non-green)", async () => {
  const { ctx } = stubContext();
  const handle = localRuntimeHandle("", ctx);
  const result = await runLocal2Cell(handle, ctx, { env: {}, harness: "claude" });
  const plan: SelectedCellPlan = {
    selector: "explicit",
    behavior: "strict",
    worlds: ["local-runtime"],
    cells: [{ cell: result.cell, cellKey: result.cellKey, disposition: "required", legacy: false }],
    deferredScenarioIds: [],
  };
  const evaluation = evaluateRun({
    plan,
    preflight: { results: [], blockedCellKeys: [], complete: true },
    finals: [result],
    cleanup: { attempted: 0, cleaned: 0, alreadyAbsent: 0, failed: [], complete: true },
    dryRun: false,
  });
  assert.equal(evaluation.verdict.qualifying, false);
  assert.ok(evaluation.nonGreenCellKeys.includes(result.cellKey));
});

test("a synthetic green result for the cell qualifies a strict run", () => {
  const cell = local2CellIdentity("claude");
  const key = cellKey(cell);
  const green: FinalCellResult = {
    cellKey: key,
    cell,
    status: "green",
    attempts: [
      {
        attemptId: "a1",
        attemptNumber: 1,
        cellKey: key,
        cell,
        status: "green",
        detail: "ok",
        correlationIds: ["token_id:hash", "litellm_request:req-1"],
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        superseded: false,
      },
    ],
  };
  const plan: SelectedCellPlan = {
    selector: "release",
    behavior: "strict",
    worlds: ["local-runtime"],
    cells: [{ cell, cellKey: key, disposition: "required", legacy: false }],
    deferredScenarioIds: [],
  };
  const evaluation = evaluateRun({
    plan,
    preflight: { results: [], blockedCellKeys: [], complete: true },
    finals: [green],
    cleanup: { attempted: 0, cleaned: 0, alreadyAbsent: 0, failed: [], complete: true },
    dryRun: false,
  });
  assert.equal(evaluation.verdict.qualifying, true);
});
