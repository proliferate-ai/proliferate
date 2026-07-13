/**
 * Foundation runner engine — the one shared lifecycle from
 * release-worlds-and-fixtures.md "Shared Lifecycle":
 *
 *   resolve selected cells + artifact receipts
 *     -> run/shard identity (created by the caller, carried through here)
 *     -> preflight required local capabilities
 *     -> prepare the selected world(s) via injected WorldProvisioner(s)
 *     -> prove readiness and return a typed ready-world handle
 *     -> execute cells and record every final result
 *     -> reconcile the cleanup ledger
 *     -> evaluate diagnostic|strict via contracts/evaluate.ts
 *     -> emit evidence via an EvidenceSink
 *
 * Hard invariants enforced here:
 * - a malformed/mutable candidate manifest is rejected before ANY provisioning;
 * - strict + incomplete preflight performs ZERO provider mutation (no provisioner
 *   is even asked to prepare);
 * - dry-run never provisions and never emits a green product result;
 * - evidence is emitted on every terminal path (success, blocked preflight,
 *   readiness failure, assertion failure, cleanup failure);
 * - the pass/fail verdict is delegated to the frozen contracts/evaluate.ts.
 */

import type { RunIdentity, ShardIdentity, WorldId, AttemptIdentity } from "../contracts/identity.js";
import type { CandidateManifest, RetainedProductionManifest, PlatformKey } from "../contracts/artifacts.js";
import type { SelectedCellPlan, PlannedCell } from "../contracts/plan.js";
import type { WorldProvisioner, WorldContext, ReadyWorldHandle } from "../contracts/world.js";
import { WorldReadinessError } from "../contracts/world.js";
import type { EvidenceSink, RunEvidence, WorldEvidence } from "../contracts/evidence.js";
import type { CellAttempt, CellStatus, FinalCellResult, RunEvaluation } from "../contracts/results.js";
import { evaluateRun } from "../contracts/evaluate.js";

import { CleanupRunner } from "../ledger/reconcile.js";
import { runPreflight, deriveRequirements, type PreflightSource } from "../preflight/engine.js";
import { resolveManifestHash } from "./artifacts.js";
import { shardScopedPlan } from "./plan-builder.js";
import { verifyReadyHandle } from "./readiness.js";
import { CellBlockedError, CellExpectedFailError, type CellExecutionContext, type CellRunner } from "./cell.js";
import { redactSecrets } from "../preflight/redaction.js";

export interface FoundationRunInput {
  readonly run: RunIdentity;
  readonly shard: ShardIdentity;
  /** The complete (unsharded) selected plan. */
  readonly fullPlan: SelectedCellPlan;
  readonly candidate: CandidateManifest;
  readonly retained: RetainedProductionManifest | null;
  readonly provisioners: ReadonlyMap<WorldId, WorldProvisioner>;
  readonly cellRunners: readonly CellRunner[];
  readonly preflightSource: PreflightSource;
  readonly ledger: CleanupRunner;
  readonly evidence: EvidenceSink;
  readonly dryRun: boolean;
  readonly previousBlockedCellKeys?: readonly string[];
  readonly hostPlatform?: PlatformKey;
  /** Secret VALUES to redact from any narrative surfaced into evidence. */
  readonly secretValues?: readonly string[];
  readonly now?: () => string;
  readonly attemptIdFactory?: (cellKey: string, attemptNumber: number) => string;
}

export interface FoundationRunResult {
  readonly evidence: RunEvidence;
  readonly evaluation: RunEvaluation;
}

export async function runFoundation(input: FoundationRunInput): Promise<FoundationRunResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const secretValues = input.secretValues ?? [];

  // 1. Resolve artifact receipts. Validation happens inside resolveManifestHash,
  //    so a malformed or mutable manifest throws HERE — before any provisioning.
  const candidateHash = resolveManifestHash(input.candidate);
  if (candidateHash !== input.run.candidateManifestHash) {
    throw new Error(
      `candidate manifest hash mismatch: manifest hashes to ${candidateHash} but run identity carries ${input.run.candidateManifestHash}`,
    );
  }
  if (input.retained) {
    const retainedHash = resolveManifestHash(input.retained);
    if (retainedHash !== input.run.retainedManifestHash) {
      throw new Error(
        `retained manifest hash mismatch: manifest hashes to ${retainedHash} but run identity carries ${String(input.run.retainedManifestHash)}`,
      );
    }
  }

  const plan = shardScopedPlan(input.fullPlan, input.shard);
  const behavior = plan.behavior;

  // 2. Preflight (local only, value-free). Emitted for traceability.
  const requirements = deriveRequirements(plan);
  const preflight = runPreflight(requirements, input.preflightSource);
  await safeAppend(input.evidence, {
    event: "preflight",
    complete: preflight.complete,
    blockedCellKeys: preflight.blockedCellKeys,
    results: preflight.results.map((r) => ({
      kind: r.requirement.kind,
      name: r.requirement.name,
      shape: r.requirement.shape,
      status: r.status,
      detail: r.detail,
    })),
  });

  const requiredCells = plan.cells.filter((c) => c.disposition === "required");
  const worldEvidence: WorldEvidence[] = [];
  let finals: FinalCellResult[] = [];

  const strictBlockedByPreflight = behavior === "strict" && !preflight.complete;

  if (input.dryRun) {
    // 3a. Dry-run: emit the plan, never provision, never produce a green result.
    await safeAppend(input.evidence, { event: "dry-run", note: "planning only; no provider mutation" });
  } else if (strictBlockedByPreflight) {
    // 3b. Strict + incomplete preflight: fail before ANY external mutation.
    await safeAppend(input.evidence, {
      event: "strict-preflight-blocked",
      note: "strict run stops before provisioning; missing local capabilities can never produce green",
    });
  } else {
    // 3c. Prepare worlds and execute cells.
    finals = await executeWorlds({
      input,
      plan,
      requiredCells,
      preflightBlocked: new Set(preflight.blockedCellKeys),
      worldEvidence,
      now,
      secretValues,
    });
  }

  // 4. Reconcile the cleanup ledger on every path.
  const cleanup = await input.ledger.reconcile();
  await safeAppend(input.evidence, {
    event: "cleanup",
    complete: cleanup.complete,
    attempted: cleanup.attempted,
    cleaned: cleanup.cleaned,
    alreadyAbsent: cleanup.alreadyAbsent,
    failedCount: cleanup.failed.length,
  });

  // 5. Evaluate via the frozen contract.
  const evaluation = evaluateRun({
    plan,
    preflight,
    finals,
    cleanup,
    dryRun: input.dryRun,
    previousBlockedCellKeys: input.previousBlockedCellKeys,
  });

  // 6. Emit immutable evidence exactly once.
  const evidence: RunEvidence = {
    schemaVersion: 1,
    run: input.run,
    shard: input.shard,
    behavior,
    // Defense in depth: qualifying is true ONLY for a strict, non-dry-run pass.
    qualifying: evaluation.verdict.qualifying && behavior === "strict" && !input.dryRun,
    dryRun: input.dryRun,
    plan,
    preflight,
    worlds: worldEvidence,
    finals,
    cleanup,
    evaluation,
    emittedAt: now(),
  };
  await input.evidence.finalize(evidence);

  return { evidence, evaluation };
}

interface ExecuteWorldsArgs {
  input: FoundationRunInput;
  plan: SelectedCellPlan;
  requiredCells: readonly PlannedCell[];
  preflightBlocked: ReadonlySet<string>;
  worldEvidence: WorldEvidence[];
  now: () => string;
  secretValues: readonly string[];
}

async function executeWorlds(args: ExecuteWorldsArgs): Promise<FinalCellResult[]> {
  const { input, requiredCells, preflightBlocked, worldEvidence, now, secretValues } = args;
  const finals: FinalCellResult[] = [];
  const runnersByKey = groupRunners(input.cellRunners);

  // Blocked cells (diagnostic) get a blocked final without any provisioning.
  for (const planned of requiredCells) {
    if (preflightBlocked.has(planned.cellKey)) {
      finals.push(
        makeSimpleFinal(planned, "blocked", "blocked by unsatisfied preflight requirement", now, input),
      );
    }
  }

  const runnable = requiredCells.filter((c) => !preflightBlocked.has(c.cellKey));
  const byWorld = new Map<WorldId, PlannedCell[]>();
  for (const planned of runnable) {
    const list = byWorld.get(planned.cell.world) ?? [];
    list.push(planned);
    byWorld.set(planned.cell.world, list);
  }

  for (const [world, cells] of byWorld) {
    const provisioner = input.provisioners.get(world);
    if (!provisioner) {
      for (const planned of cells) {
        finals.push(
          makeSimpleFinal(planned, "readiness_failed", `no provisioner registered for world "${world}"`, now, input),
        );
      }
      continue;
    }

    let handle: ReadyWorldHandle;
    try {
      const ctx: WorldContext = {
        run: input.run,
        shard: input.shard,
        candidate: input.candidate,
        retained: input.retained,
        ledger: input.ledger,
        evidence: input.evidence,
      };
      handle = await provisioner.prepare(ctx);
      verifyReadyHandle(handle, input.run, input.shard, world);
    } catch (error) {
      const detail = redactSecrets(describeError(error), secretValues);
      await safeAppend(input.evidence, { event: "world-readiness-failed", world, detail });
      const observations = error instanceof WorldReadinessError ? error.observations : [];
      worldEvidence.push({ world, readiness: observations, observedArtifacts: {} });
      for (const planned of cells) {
        finals.push(makeSimpleFinal(planned, "readiness_failed", detail, now, input));
      }
      continue;
    }

    worldEvidence.push({
      world,
      readiness: handle.readiness,
      observedArtifacts: observedArtifactsFor(handle),
    });

    for (const planned of cells) {
      const runners = runnersByKey.get(planned.cellKey) ?? [];
      if (runners.length === 0) {
        // No collector for a required cell => a missing final result (evaluate flags it).
        await safeAppend(input.evidence, {
          event: "missing-collector",
          cellKey: planned.cellKey,
          note: "required cell has no registered collector",
        });
        continue;
      }
      // Two runners claiming one cellKey => two finals => duplicate (evaluate flags it).
      for (let i = 0; i < runners.length; i += 1) {
        finals.push(await executeCell(runners[i], planned, handle, i + 1, args));
      }
    }
  }

  return finals;
}

async function executeCell(
  runner: CellRunner,
  planned: PlannedCell,
  handle: ReadyWorldHandle,
  attemptNumber: number,
  args: ExecuteWorldsArgs,
): Promise<FinalCellResult> {
  const { input, now, secretValues } = args;
  const startedAt = now();
  const attempt: AttemptIdentity = {
    runId: input.run.runId,
    shardId: input.shard.shardId,
    cellKey: planned.cellKey,
    attemptNumber,
    attemptId:
      input.attemptIdFactory?.(planned.cellKey, attemptNumber) ??
      `${input.run.runId}:${input.shard.shardId}:${planned.cellKey}#${attemptNumber}`,
  };
  const ctx: CellExecutionContext = {
    cell: planned.cell,
    cellKey: planned.cellKey,
    attempt,
    world: handle,
    ledger: input.ledger,
    evidence: input.evidence,
    behavior: args.plan.behavior,
    dryRun: input.dryRun,
  };

  let status: CellStatus;
  let detail = "";
  let correlationIds: readonly string[] = [];
  try {
    const outcome = await runner.run(ctx);
    status = "green";
    correlationIds = outcome?.correlationIds ?? [];
  } catch (error) {
    if (error instanceof CellBlockedError) {
      status = "blocked";
      detail = error.reason;
      correlationIds = error.correlationIds;
    } else if (error instanceof CellExpectedFailError) {
      status = "expected_fail";
      detail = error.diagnosis;
      correlationIds = error.correlationIds;
    } else {
      status = "failed";
      detail = describeError(error);
    }
  }
  detail = redactSecrets(detail, secretValues);
  const finishedAt = now();
  const cellAttempt: CellAttempt = {
    attemptId: attempt.attemptId,
    attemptNumber,
    cellKey: planned.cellKey,
    cell: planned.cell,
    status,
    detail,
    correlationIds,
    startedAt,
    finishedAt,
    superseded: false,
  };
  await safeAppend(input.evidence, {
    event: "cell-attempt",
    cellKey: planned.cellKey,
    status,
    attemptId: attempt.attemptId,
  });
  return { cellKey: planned.cellKey, cell: planned.cell, status, attempts: [cellAttempt] };
}

function makeSimpleFinal(
  planned: PlannedCell,
  status: CellStatus,
  detail: string,
  now: () => string,
  input: FoundationRunInput,
): FinalCellResult {
  const at = now();
  const attemptId =
    input.attemptIdFactory?.(planned.cellKey, 1) ??
    `${input.run.runId}:${input.shard.shardId}:${planned.cellKey}#1`;
  const attempt: CellAttempt = {
    attemptId,
    attemptNumber: 1,
    cellKey: planned.cellKey,
    cell: planned.cell,
    status,
    detail,
    correlationIds: [],
    startedAt: at,
    finishedAt: at,
    superseded: false,
  };
  return { cellKey: planned.cellKey, cell: planned.cell, status, attempts: [attempt] };
}

function groupRunners(runners: readonly CellRunner[]): Map<string, CellRunner[]> {
  const map = new Map<string, CellRunner[]>();
  for (const runner of runners) {
    const list = map.get(runner.cellKey) ?? [];
    list.push(runner);
    map.set(runner.cellKey, list);
  }
  return map;
}

function observedArtifactsFor(handle: ReadyWorldHandle): Record<string, string> {
  switch (handle.world) {
    case "local-runtime":
      return { gatewayIdentity: handle.gatewayIdentity };
    case "managed-cloud":
      return { templateId: handle.template.templateId, templateInputHash: handle.template.inputHash };
    case "self-host":
      return { bundleDigest: handle.bundleDigest };
    case "desktop-upgrade":
      return { retainedProductVersion: handle.retained.productVersion };
    case "managed-cloud-upgrade":
      return {
        retainedTemplateId: handle.retainedTemplate.templateId,
        candidateArtifactRoute: handle.candidateArtifactRoute,
      };
    default:
      return {};
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

async function safeAppend(sink: EvidenceSink, event: Readonly<Record<string, unknown>>): Promise<void> {
  await sink.append(event);
}
