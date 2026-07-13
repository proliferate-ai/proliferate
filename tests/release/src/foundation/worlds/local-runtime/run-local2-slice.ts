/**
 * Local driver that proves the tier-3 local-runtime world adapter + the LOCAL-2
 * managed-gateway vertical slice (one harness) end to end, through the real
 * frozen contracts (world/identity/plan/cleanup/evidence/results/evaluate) —
 * the same `evaluateRun` a real qualification run uses. It is the local-runtime
 * twin of `../tier2/run-vertical-slice.ts` and is deliberately NOT the shared
 * runner CLI: it selects exactly one required cell (LOCAL-2 for the chosen
 * harness), boots the real local-runtime world (candidate server + AnyHarness +
 * qualification LiteLLM), runs the cell, reconciles cleanup (deleting the
 * run-scoped virtual key), and renders the verdict.
 *
 * Usage:
 *   pnpm --filter @proliferate/release-e2e run vertical-slice:local2
 *   pnpm --filter @proliferate/release-e2e run vertical-slice:local2 -- --strict
 *   LOCAL_2_HARNESS=claude ... (harness selection; defaults to claude)
 *
 * `--strict` requires the cell green AND cleanup complete for a qualifying
 * verdict. Default is diagnostic (blocked cells tolerated + reported, evidence
 * marked nonqualifying) — the right default for an uncredentialed laptop.
 */

import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { RunIdentity, ShardIdentity } from "../../contracts/identity.js";
import { cellKey } from "../../contracts/identity.js";
import type { SelectedCellPlan } from "../../contracts/plan.js";
import type { CleanupExecutor, CleanupEntry } from "../../contracts/cleanup.js";
import type { FinalCellResult } from "../../contracts/results.js";
import type { WorldContext } from "../../contracts/world.js";
import { evaluateRun } from "../../contracts/evaluate.js";
import { WorldReadinessError } from "../../contracts/world.js";

import { LocalRuntimeWorldProvisioner } from "./provisioner.js";
import { local2CellIdentity, runLocal2Cell } from "./local-2.js";
import { probeDeleteKey } from "./spend.js";
import { JsonlCleanupLedger } from "../tier2/support/jsonl-cleanup-ledger.js";
import { JsonlEvidenceSink } from "../tier2/support/jsonl-evidence-sink.js";
import { reconcileCleanup } from "../tier2/support/reconcile-cleanup.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// local-runtime/ -> worlds/ -> foundation/ -> src/ -> release/ -> tests/ -> repo root
const REPO_ROOT = path.resolve(here, "..", "..", "..", "..", "..", "..");

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

function buildRunIdentity(): RunIdentity {
  return {
    runId: `tf-local2-vslice-${randomUUID()}`,
    sourceSha: git(["rev-parse", "HEAD"]),
    // Same honesty as the tier2 driver: no content-addressed candidate manifest
    // is built here (that is a separate workstream's scope). Hash the git tree
    // so source identity is real and verifiable, and be explicit that this is
    // NOT a qualification-grade candidate manifest hash.
    candidateManifestHash: `unresolved-candidate-manifest:tree:${git(["rev-parse", "HEAD^{tree}"])}`,
    retainedManifestHash: null,
    executionHost: "local",
    origin: `local:${process.env.HOSTNAME ?? process.env.USER ?? "unknown-host"}`,
    createdAt: new Date().toISOString(),
  };
}

function buildShardIdentity(runId: string): ShardIdentity {
  return { runId, shardId: "shard-1-of-1", shardIndex: 0, shardCount: 1 };
}

/** Cleanup executor for one ledger entry, honest per resource type. */
function executorFor(entry: CleanupEntry): CleanupExecutor {
  if (entry.resourceType === "litellm-virtual-key") {
    return async () => {
      const result = await probeDeleteKey(entry.resourceId);
      if (result.error && result.error !== "litellm_unconfigured") {
        throw new Error(`litellm key delete failed: ${result.error} ${result.detail ?? ""}`);
      }
    };
  }
  // product-user: the cell's own inline teardown (actor.teardown) already
  // removed the fresh member from the inviting org; the ledger entry is the
  // durable record of that run-scoped resource. Mark reconciled.
  return async () => undefined;
}

async function main(): Promise<void> {
  const strict = process.argv.includes("--strict");
  const behavior = strict ? "strict" : "diagnostic";
  const harness = process.env.LOCAL_2_HARNESS ?? "claude";
  const run = buildRunIdentity();
  const shard = buildShardIdentity(run.runId);

  const outputBase = path.join(REPO_ROOT, "tests", "release", ".vertical-slice-output", run.runId);
  const ledger = new JsonlCleanupLedger(`${outputBase}.cleanup.jsonl`);
  const evidence = new JsonlEvidenceSink(outputBase);

  console.log(`[local2-vertical-slice] run=${run.runId} behavior=${behavior} harness=${harness} sourceSha=${run.sourceSha}`);

  const cell = local2CellIdentity(harness);
  const key = cellKey(cell);
  const plan: SelectedCellPlan = {
    selector: "explicit",
    behavior,
    worlds: ["local-runtime"],
    cells: [{ cell, cellKey: key, disposition: "required", legacy: false }],
    deferredScenarioIds: [],
  };

  const ctx: WorldContext = {
    run,
    shard,
    // The local provisioner never reads ctx.candidate/ctx.retained (see its
    // module docstring); same safe cast the tier2 driver uses.
    candidate: undefined as never,
    retained: null,
    ledger,
    evidence,
  };

  const provisioner = new LocalRuntimeWorldProvisioner();
  const finals: FinalCellResult[] = [];
  let handle: Awaited<ReturnType<LocalRuntimeWorldProvisioner["prepare"]>> | undefined;

  try {
    handle = await provisioner.prepare(ctx);
    console.log(
      `[local2-vertical-slice] world ready: server=${handle.serverUrl} anyharness=${handle.anyharnessUrl} ` +
        `gateway=${handle.gatewayIdentity} (${handle.gatewayOrigin || "absent"})`,
    );

    const result = await runLocal2Cell(handle, ctx, { harness });
    finals.push(result);
    console.log(`[local2-vertical-slice] ${result.cellKey} -> ${result.status}`);
    console.log(`[local2-vertical-slice]   detail: ${result.attempts.at(-1)?.detail ?? ""}`);
  } catch (error) {
    if (error instanceof WorldReadinessError) {
      console.error(`[local2-vertical-slice] world failed readiness: ${error.message}`);
      for (const obs of error.observations) {
        console.error(`  - [${obs.ok ? "ok" : "FAIL"}] ${obs.check}: ${obs.detail}`);
      }
    } else {
      console.error(`[local2-vertical-slice] unexpected error: ${error instanceof Error ? error.stack : String(error)}`);
    }
    process.exitCode = 1;
  }

  // Build executors for every registered ledger entry so cleanup reconciles.
  const executors = new Map<number, CleanupExecutor>();
  for (const entry of await ledger.entries()) {
    executors.set(entry.sequence, executorFor(entry));
  }
  const cleanup = await reconcileCleanup(ledger, executors);
  console.log(
    `[local2-vertical-slice] cleanup: attempted=${cleanup.attempted} cleaned=${cleanup.cleaned} ` +
      `alreadyAbsent=${cleanup.alreadyAbsent} failed=${cleanup.failed.length}`,
  );

  const evaluation = evaluateRun({ plan, preflight: { results: [], blockedCellKeys: [], complete: true }, finals, cleanup, dryRun: false });
  await evidence.finalize({
    schemaVersion: 1,
    run,
    shard,
    behavior,
    qualifying: evaluation.verdict.qualifying,
    dryRun: false,
    plan,
    preflight: { results: [], blockedCellKeys: [], complete: true },
    worlds: handle ? [{ world: "local-runtime", readiness: handle.readiness, observedArtifacts: {} }] : [],
    finals,
    cleanup,
    evaluation,
    emittedAt: new Date().toISOString(),
  });

  console.log(`[local2-vertical-slice] verdict: ${JSON.stringify(evaluation.verdict)}`);
  console.log(`[local2-vertical-slice] evidence written under ${outputBase}.*`);

  if (strict && !evaluation.verdict.qualifying) {
    process.exitCode = 1;
  }
}

await main();
