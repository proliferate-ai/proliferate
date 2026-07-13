/**
 * `pnpm -C tests/release run foundation aggregate <evidence.json>...`
 * (also `pnpm -C tests/release run aggregate <evidence.json>...`)
 *
 * The cross-shard fan-in: reads N shard evidence documents and runs the frozen
 * contracts/aggregate.ts `evaluateAggregate` — the ONLY path to a qualifying
 * verdict. A single shard document is a nonqualifying input by contract; this
 * command is what CI's fan-in job calls after every shard has emitted evidence.
 *
 * It never trusts a shard's own `qualifying` flag: it re-derives the verdict
 * from the union of finals and the reconstructed full plan, and exits nonzero
 * when a STRICT run does not qualify. Diagnostic aggregates are informational.
 */

import { readFileSync } from "node:fs";

import { evaluateAggregate } from "../foundation/contracts/aggregate.js";
import type { RunEvidence } from "../foundation/contracts/evidence.js";
import type { PlannedCell, SelectedCellPlan } from "../foundation/contracts/plan.js";

export interface AggregateCliResult {
  readonly exitCode: number;
  readonly message: string;
}

export interface AggregateCliDeps {
  /** Injectable reader so tests can stub the filesystem; defaults to readFileSync. */
  readFile?: (path: string) => string;
}

/**
 * Reconstruct the one full plan the run resolved from, out of the shard-scoped
 * plans each evidence document carries. Selector/behavior/manifest-hash/deferred
 * are identical across shards (the aggregate contract voids the run otherwise);
 * only the cell membership was partitioned, so the union of shard cells rebuilds
 * the complete required set. A shard document that is entirely missing shows up
 * as a coverage defect in the aggregate, not as a silently smaller plan.
 */
function reconstructFullPlan(shards: readonly RunEvidence[]): SelectedCellPlan {
  const base = shards[0].plan;
  const byKey = new Map<string, PlannedCell>();
  for (const shard of shards) {
    for (const cell of shard.plan.cells) {
      if (!byKey.has(cell.cellKey)) byKey.set(cell.cellKey, cell);
    }
  }
  const cells = [...byKey.values()];
  const worlds = [...new Set(cells.map((c) => c.cell.world))];
  return { ...base, cells, worlds };
}

function isRunEvidence(value: unknown): value is RunEvidence {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { schemaVersion?: unknown }).schemaVersion === 1 &&
    typeof (value as { plan?: unknown }).plan === "object"
  );
}

export function runAggregateCli(
  argv: readonly string[],
  deps: AggregateCliDeps = {},
): AggregateCliResult {
  const readFile = deps.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  const paths = argv.filter((a) => !a.startsWith("--"));
  if (paths.length === 0) {
    return {
      exitCode: 2,
      message:
        "aggregate: no shard evidence files given\n" +
        "usage: foundation aggregate <shard-evidence.json>...",
    };
  }

  const shards: RunEvidence[] = [];
  for (const path of paths) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFile(path));
    } catch (error) {
      return {
        exitCode: 2,
        message: `aggregate: cannot read/parse ${path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
    if (!isRunEvidence(raw)) {
      return { exitCode: 2, message: `aggregate: ${path} is not a v1 run evidence document` };
    }
    shards.push(raw);
  }

  const fullPlan = reconstructFullPlan(shards);
  // INTERIM (queued rewrite): expected identities are echoed from the shard
  // set rather than consumed from independently prepared trusted receipts.
  // This preserves every cross-shard coherence/coverage check but NOT the
  // forged-set defense — the trusted-receipt input is the next bounded slice.
  // Until then this command is fan-in plumbing, not a promotion gate.
  const first = shards[0];
  const evaluation = evaluateAggregate({
    plan: fullPlan,
    expected: {
      runId: first.run.runId,
      sourceSha: first.run.sourceSha,
      candidateManifestHash: first.run.candidateManifestHash,
      retainedManifestHash: first.run.retainedManifestHash,
      shardCount: first.shard.shardCount,
    },
    shards,
  });

  const runId = shards[0].run.runId;
  const behavior = fullPlan.behavior;
  const header = `aggregate: run=${runId} selector=${fullPlan.selector} behavior=${behavior} shards=${shards.length}`;
  const planLine = `plan: manifestHash=${fullPlan.scenarioManifestHash ?? "none"} required=${
    fullPlan.cells.filter((c) => c.disposition === "required").length
  } deferred=${fullPlan.deferredScenarioIds.length}`;

  const verdict = evaluation.verdict;
  const verdictLine = verdict.qualifying
    ? `verdict: QUALIFYING (${verdict.label})`
    : `verdict: NON-QUALIFYING\n  - ${verdict.reasons.join("\n  - ")}`;

  // Exit policy: a STRICT run that does not qualify fails the fan-in job.
  // A diagnostic aggregate is informational and exits 0 even when non-qualifying.
  const exitCode = behavior === "strict" && !verdict.qualifying ? 1 : 0;

  return { exitCode, message: [header, planLine, verdictLine].join("\n") };
}

// Script guard: run only when invoked directly (not when imported by a test).
const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith("aggregate.ts");
if (invokedDirectly) {
  const result = runAggregateCli(process.argv.slice(2));
  console.log(result.message);
  process.exitCode = result.exitCode;
}
