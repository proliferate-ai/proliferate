/**
 * Local driver that proves the Tier 2 world adapter + its two vertical-slice
 * cells (T2-AUTH-1, T2-BILL-1/checkout-to-grant) end to end, through the real
 * frozen contracts (world/identity/plan/preflight/cleanup/evidence/results/
 * evaluate) — not a second, ad hoc harness. This file is deliberately NOT the
 * shared runner CLI (`src/cli/run.ts`, `specs/developing/testing/README.md`'s
 * "one runner CLI" target): the target manifest/plan-selector/candidate-
 * artifact pipeline that CLI is meant to drive is other workstreams' scope.
 * What this script proves is narrower and honest about it: given a plan with
 * exactly these two required cells, the Tier2WorldProvisioner boots a real
 * world, both cells produce exactly one evidence-bound final result each, and
 * `evaluateRun` renders the correct verdict for whichever behavior was asked
 * for — using the SAME `evaluateRun` a real qualification run would use.
 *
 * Usage:
 *   pnpm --filter @proliferate/release-e2e run vertical-slice:tier2
 *   pnpm --filter @proliferate/release-e2e run vertical-slice:tier2 -- --strict
 *
 * `--strict` selects strict result behavior (preflight must be complete
 * before any world provisioning; every required cell must be green). Default
 * is diagnostic (blocked cells are tolerated and reported, evidence is always
 * marked nonqualifying) — the right default for an uncredentialed laptop.
 */

import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { RunIdentity, ShardIdentity } from "../../contracts/identity.js";
import { cellKey } from "../../contracts/identity.js";
import type { SelectedCellPlan } from "../../contracts/plan.js";
import type { CleanupExecutor } from "../../contracts/cleanup.js";
import type { FinalCellResult } from "../../contracts/results.js";
import { evaluateRun } from "../../contracts/evaluate.js";
import { WorldReadinessError } from "../../contracts/world.js";

import { Tier2WorldProvisioner, type InternalTier2WorldHandle } from "./provisioner.js";
import { resolveStripeTestSecretKey, buildTier2StripePreflight } from "./secret-preflight.js";
import { runT2Auth1Cell } from "./cells/t2-auth-1.js";
import { runT2Bill1Cell } from "./cells/t2-bill-1.js";
import { JsonlCleanupLedger } from "./support/jsonl-cleanup-ledger.js";
import { JsonlEvidenceSink } from "./support/jsonl-evidence-sink.js";
import { reconcileCleanup } from "./support/reconcile-cleanup.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// support the same relative walk intent-bridge.ts uses (tier2/ -> worlds/ -> foundation/ -> src/ -> release/ -> tests/ -> repo root)
const REPO_ROOT = path.resolve(here, "..", "..", "..", "..", "..", "..");

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

function buildRunIdentity(): RunIdentity {
  return {
    runId: `tf-tier2-vslice-${randomUUID()}`,
    sourceSha: git(["rev-parse", "HEAD"]),
    // The real content-addressed CANDIDATE MANIFEST (server image, Web/Desktop
    // builds, AnyHarness/Worker/Supervisor binaries, catalog, E2B template,
    // self-host bundle, LiteLLM identity) is a different workstream's scope
    // (release-worlds-and-fixtures.md "Candidate Artifacts"). This local proof
    // does not build or claim one; it hashes the git tree so at least the
    // source identity is real and verifiable, and is explicit that this is
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

async function main(): Promise<void> {
  const strict = process.argv.includes("--strict");
  const behavior = strict ? "strict" : "diagnostic";
  const run = buildRunIdentity();
  const shard = buildShardIdentity(run.runId);

  const outputBase = path.join(REPO_ROOT, "tests", "release", ".vertical-slice-output", run.runId);
  const ledger = new JsonlCleanupLedger(`${outputBase}.cleanup.jsonl`);
  const evidence = new JsonlEvidenceSink(outputBase);

  console.log(`[tier2-vertical-slice] run=${run.runId} behavior=${behavior} sourceSha=${run.sourceSha}`);

  // ── Plan: exactly the two required cells this workstream owns. ──
  const authCellIdentity = { scenarioId: "T2-AUTH-1", world: "tier-2" as const, productHost: "desktop-web" as const, dimensions: {} };
  const billingCellIdentity = {
    scenarioId: "T2-BILL-1",
    world: "tier-2" as const,
    productHost: "desktop-web" as const,
    dimensions: { slice: "checkout-to-grant" },
  };
  const authCellKey = cellKey(authCellIdentity);
  const billingCellKey = cellKey(billingCellIdentity);

  const plan: SelectedCellPlan = {
    selector: "explicit",
    behavior,
    worlds: ["tier-2"],
    cells: [
      { cell: authCellIdentity, cellKey: authCellKey, disposition: "required", legacy: false },
      { cell: billingCellIdentity, cellKey: billingCellKey, disposition: "required", legacy: false },
    ],
    deferredScenarioIds: [],
  };

  // ── Trusted secret preflight (real resolution this time, not a fake) —
  // runs BEFORE world provisioning, per the preflight contract. ──
  const stripeResolution = resolveStripeTestSecretKey();
  const preflight = buildTier2StripePreflight([billingCellKey], stripeResolution);
  console.log(`[tier2-vertical-slice] stripe preflight: ${preflight.complete ? "satisfied" : "NOT satisfied"} (${stripeResolution.detail})`);

  if (strict && !preflight.complete) {
    // Strict fails BEFORE any external mutation — never boots the world.
    const evaluation = evaluateRun({
      plan,
      preflight,
      finals: [],
      cleanup: { attempted: 0, cleaned: 0, alreadyAbsent: 0, failed: [], complete: true },
      dryRun: false,
    });
    await evidence.append({ kind: "strict-preflight-fail-fast" });
    console.error("[tier2-vertical-slice] STRICT run failed at preflight (no world was provisioned):");
    if (!evaluation.verdict.qualifying) {
      for (const reason of evaluation.verdict.reasons) console.error(`  - ${reason}`);
    }
    process.exitCode = 1;
    return;
  }

  const provisioner = new Tier2WorldProvisioner();
  let handle: InternalTier2WorldHandle | undefined;
  const executors = new Map<number, CleanupExecutor>();
  const finals: FinalCellResult[] = [];

  try {
    handle = await provisioner.prepareInternal({
      run,
      shard,
      // No real candidate/retained manifest for this local proof — see
      // buildRunIdentity's comment. Cast is safe: the provisioner never reads
      // ctx.candidate/ctx.retained.
      candidate: undefined as never,
      retained: null,
      ledger,
      evidence,
    });
    console.log(`[tier2-vertical-slice] world ready: server=${handle.serverUrl} web=${handle.webUrl} stripeTestMode=${handle.stripeTestMode}`);
    executors.set(handle.cleanupSequence, async () => {
      await handle!.stackTeardown();
    });

    const authResult = await runT2Auth1Cell(handle, evidence);
    finals.push(authResult);
    console.log(`[tier2-vertical-slice] ${authResult.cellKey} -> ${authResult.status}`);

    const billingResult = await runT2Bill1Cell(handle, evidence, ledger);
    finals.push(billingResult);
    console.log(`[tier2-vertical-slice] ${billingResult.cellKey} -> ${billingResult.status}`);
  } catch (error) {
    if (error instanceof WorldReadinessError) {
      console.error(`[tier2-vertical-slice] world failed readiness: ${error.message}`);
      for (const observation of error.observations) {
        console.error(`  - [${observation.ok ? "ok" : "FAIL"}] ${observation.check}: ${observation.detail}`);
      }
    } else {
      console.error(`[tier2-vertical-slice] unexpected error: ${error instanceof Error ? error.stack : String(error)}`);
    }
    process.exitCode = 1;
  }

  const cleanup = await reconcileCleanup(ledger, executors);
  console.log(`[tier2-vertical-slice] cleanup: attempted=${cleanup.attempted} cleaned=${cleanup.cleaned} failed=${cleanup.failed.length}`);

  const evaluation = evaluateRun({ plan, preflight, finals, cleanup, dryRun: false });
  await evidence.finalize({
    schemaVersion: 1,
    run,
    shard,
    behavior,
    qualifying: evaluation.verdict.qualifying,
    dryRun: false,
    plan,
    preflight,
    worlds: handle ? [{ world: "tier-2", readiness: handle.readiness, observedArtifacts: {} }] : [],
    finals,
    cleanup,
    evaluation,
    emittedAt: new Date().toISOString(),
  });

  console.log(`[tier2-vertical-slice] verdict: ${JSON.stringify(evaluation.verdict)}`);
  console.log(`[tier2-vertical-slice] evidence written under ${outputBase}.*`);

  if (!evaluation.verdict.qualifying && strict) {
    process.exitCode = 1;
  }
}

await main();
