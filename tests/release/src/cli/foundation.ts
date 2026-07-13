/**
 * Foundation runner CLI entrypoint.
 *
 * Sits beside the legacy `run.ts` (which is unchanged). It wires the shared
 * lifecycle: load + validate the candidate/retained manifests, load local
 * secrets as DATA (ambient wins), build the selected-cell plan, create run/shard
 * identity, run preflight, and invoke the engine with the registered world
 * provisioners and cell collectors. During foundation construction no real
 * provisioners are registered here, so a non-dry-run reports honest readiness
 * failures rather than fabricating green; world adapters (other workstreams)
 * register themselves through `deps`.
 */

import { accessSync, constants as fsConstants, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { FOUNDATION_HELP_TEXT, parseFoundationArgs, type FoundationCliArgs } from "./foundation-args.js";
import type { CandidateManifest, PlatformKey, RetainedProductionManifest } from "../foundation/contracts/artifacts.js";
import type { WorldId } from "../foundation/contracts/identity.js";
import type { WorldProvisioner } from "../foundation/contracts/world.js";
import type { CellRunner } from "../foundation/runner/cell.js";
import { resolveManifestHash, availableCandidateSlots } from "../foundation/runner/artifacts.js";
import { buildPlan } from "../foundation/runner/plan-builder.js";
import { loadScenarioManifest } from "../foundation/manifest/load.js";
import { defaultScenarioManifestPath } from "../foundation/manifest/paths.js";
import { resolveSelection, type Tier4Trigger } from "../foundation/manifest/selectors.js";
import { createRunIdentity, createShardIdentity } from "../foundation/runner/identity.js";
import { FileCleanupLedger } from "../foundation/ledger/file-ledger.js";
import { CleanupRunner } from "../foundation/ledger/reconcile.js";
import { JsonlEvidenceSink } from "../foundation/evidence/jsonl-sink.js";
import type { PreflightSource } from "../foundation/preflight/engine.js";
import { loadReleaseEnvironment } from "../foundation/preflight/env-loader.js";
import { runFoundation } from "../foundation/runner/engine.js";
import { runAggregateCli } from "./aggregate.js";
import { SHARD_SCOPE_NONQUALIFYING_REASON } from "../foundation/contracts/evaluate.js";
import type { AggregateArtifact } from "../foundation/contracts/aggregate.js";

export interface FoundationCliDeps {
  env?: NodeJS.ProcessEnv;
  hostPlatform?: PlatformKey;
  /** Real world provisioners, keyed by world (other workstreams register these). */
  provisioners?: ReadonlyMap<WorldId, WorldProvisioner>;
  /** Real cell collectors. */
  cellRunners?: readonly CellRunner[];
  /** Injectable clock/nonce for deterministic identity. */
  now?: () => Date;
  localNonce?: string;
  /** Override the scenario-manifest path (tests point at a fixture manifest). */
  scenarioManifestPath?: string;
  /** --cells ids allowed even when absent from the manifest (test fixtures only). */
  fixtureNamespaceIds?: readonly string[];
  /** Change-triggered Tier 4 rows supplied to the release selector. */
  triggeredTier4?: readonly Tier4Trigger[];
}

export interface FoundationCliResult {
  exitCode: number;
  message: string;
}

export function detectHostPlatform(platform: string = process.platform, arch: string = process.arch): PlatformKey | string {
  const key = `${platform}-${arch}`;
  switch (key) {
    case "darwin-arm64":
      return "darwin-aarch64";
    case "darwin-x64":
      return "darwin-x86_64";
    case "linux-x64":
      return "linux-x86_64";
    case "linux-arm64":
      return "linux-aarch64";
    default:
      return key;
  }
}

function loadManifest<T>(filePath: string): T {
  if (!existsSync(filePath)) throw new Error(`manifest file not found: ${filePath}`);
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

export async function runFoundationCli(
  argv: readonly string[],
  deps: FoundationCliDeps = {},
): Promise<FoundationCliResult> {
  const args = parseFoundationArgs(argv);
  if (args.help) {
    return { exitCode: 0, message: FOUNDATION_HELP_TEXT };
  }

  const env = deps.env ?? process.env;
  const hostPlatform = deps.hostPlatform ?? detectHostPlatform();

  // Load local secrets as DATA; ambient wins. CI without an explicit file is a no-op.
  const envLoad = loadReleaseEnvironment({ env });

  if (!args.candidateManifestPath && !args.dryRun) {
    throw new Error("--candidate-manifest is required unless --dry-run");
  }

  // A dry-run may still validate a supplied manifest, but does not require one.
  let candidate: CandidateManifest;
  if (args.candidateManifestPath) {
    candidate = loadManifest<CandidateManifest>(args.candidateManifestPath);
  } else {
    throw new Error("--candidate-manifest is required to build a plan (even a dry-run needs artifact identity)");
  }
  const retained: RetainedProductionManifest | null = args.retainedManifestPath
    ? loadManifest<RetainedProductionManifest>(args.retainedManifestPath)
    : null;

  // Validate + hash (throws on malformed/mutable manifest, before any mutation).
  const candidateManifestHash = resolveManifestHash(candidate);
  const retainedManifestHash = retained ? resolveManifestHash(retained) : null;

  // Load + strictly validate the REAL core-release scenario manifest before any
  // --cells selection can be trusted, then resolve the selector against it. An
  // unknown --cells id, an empty explicit/release resolution, or a malformed
  // manifest is a hard error HERE — never a silently-accepted (and possibly
  // qualifying) plan. Every manifest-bound plan carries the real canonical hash.
  const parsedManifest = loadScenarioManifest(
    deps.scenarioManifestPath ?? defaultScenarioManifestPath(),
  );
  const resolved = resolveSelection(parsedManifest, {
    selector: args.selector,
    cellIds: args.cells,
    world: args.world,
    productHost: args.productHost,
    fixtureNamespaceIds: deps.fixtureNamespaceIds,
    triggeredTier4: deps.triggeredTier4,
  });
  const fullPlan = buildPlan({
    selector: args.selector,
    behavior: args.behavior,
    cells: resolved.cells,
    deferredScenarioIds: resolved.deferredScenarioIds,
    scenarioManifestHash: resolved.scenarioManifestHash,
  });

  const run = createRunIdentity({
    sourceSha: candidate.sourceSha,
    candidateManifestHash,
    retainedManifestHash,
    env,
    now: deps.now,
    localNonce: deps.localNonce,
  });
  const shard = createShardIdentity({ runId: run.runId, shardIndex: args.shardIndex, shardCount: args.shardCount });

  const outputRoot = path.resolve(args.outputDir);
  const ledgerPath = path.join(outputRoot, run.runId, shard.shardId, "cleanup.jsonl");
  const ledger = new CleanupRunner(new FileCleanupLedger(ledgerPath));
  const evidence = new JsonlEvidenceSink(outputRoot, run.runId, shard.shardId);

  const preflightSource: PreflightSource = {
    env,
    hostPlatform,
    fileReadable: (p) => {
      try {
        accessSync(p, fsConstants.R_OK);
        return true;
      } catch {
        return false;
      }
    },
    availableArtifactSlots: availableCandidateSlots(candidate, isPlatformKey(hostPlatform) ? hostPlatform : undefined),
  };

  const { evaluation, evidence: emitted, aggregate } = await runFoundation({
    run,
    shard,
    fullPlan,
    candidate,
    retained,
    provisioners: deps.provisioners ?? new Map(),
    cellRunners: deps.cellRunners ?? [],
    preflightSource,
    ledger,
    evidence,
    dryRun: args.dryRun,
    hostPlatform: isPlatformKey(hostPlatform) ? hostPlatform : undefined,
    secretValues: secretValuesFromLoad(env, envLoad.loadedNames, envLoad.preservedNames),
  });

  // The qualifying verdict is the AGGREGATE, never shard-scope evaluation.
  // A single-shard invocation covers the whole run, so runFoundation computed
  // it in-process; a multi-shard invocation reports its shard as an aggregate
  // input and the external aggregate command owns qualification.
  // Persist the aggregate verdict as its OWN durable artifact — qualification
  // never lives inside a shard evidence document.
  let aggregateArtifactPath: string | null = null;
  if (aggregate) {
    const artifact: AggregateArtifact = {
      schemaVersion: 1,
      kind: "aggregate-verdict",
      expected: {
        runId: run.runId,
        sourceSha: run.sourceSha,
        candidateManifestHash,
        retainedManifestHash,
        shardCount: shard.shardCount,
      },
      scenarioManifestHash: fullPlan.scenarioManifestHash,
      selector: fullPlan.selector,
      behavior: fullPlan.behavior,
      shardIds: [shard.shardId],
      evaluation: aggregate,
      emittedAt: new Date().toISOString(),
    };
    aggregateArtifactPath = path.join(outputRoot, run.runId, "aggregate-verdict.json");
    mkdirSync(path.dirname(aggregateArtifactPath), { recursive: true });
    writeFileSync(aggregateArtifactPath, JSON.stringify(artifact, null, 2));
  }

  const verdictLine = aggregate
    ? aggregate.verdict.qualifying
      ? `verdict: QUALIFYING (${aggregate.verdict.label}) [aggregate over 1 shard]`
      : `verdict: NON-QUALIFYING\n  - ${aggregate.verdict.reasons.join("\n  - ")}`
    : args.dryRun
    ? `verdict: NON-QUALIFYING\n  - ${
        evaluation.verdict.qualifying ? "dry-run/planning cannot emit green product evidence" : evaluation.verdict.reasons.join("\n  - ")
      }`
    : `verdict: SHARD INPUT (nonqualifying by contract; aggregate all ${shard.shardCount} shards to qualify)\n` +
      `  shard health: ${
        evaluation.missingCellKeys.length === 0 && evaluation.nonGreenCellKeys.length === 0 && evaluation.duplicateCellKeys.length === 0
          ? "all shard-assigned required cells green"
          : `missing=${evaluation.missingCellKeys.length} nonGreen=${evaluation.nonGreenCellKeys.length} duplicate=${evaluation.duplicateCellKeys.length}`
      }`;

  const lines = [
    `foundation: world=${args.world} selector=${args.selector} behavior=${args.behavior} shard=${shard.shardId} dryRun=${args.dryRun}`,
    `run=${run.runId} origin=${run.origin} host=${run.executionHost}`,
    `plan: manifestHash=${fullPlan.scenarioManifestHash ?? "none"} required=${
      fullPlan.cells.filter((c) => c.disposition === "required").length
    } deferred=${fullPlan.deferredScenarioIds.length}${
      fullPlan.deferredScenarioIds.length > 0 ? ` [${fullPlan.deferredScenarioIds.join(", ")}]` : ""
    }`,
    `env-file: ${envLoad.status} (${envLoad.filePath})`,
    `evidence: ${evidence.evidencePath}`,
    ...(aggregateArtifactPath ? [`aggregate-verdict: ${aggregateArtifactPath}`] : []),
    verdictLine,
  ];

  // Exit code policy:
  //  - single-shard strict: fail unless the aggregate qualifies;
  //  - multi-shard strict: fail on EVERY real shard evaluator defect,
  //    ignoring only the intentional shard-cannot-qualify-alone marker;
  //  - diagnostic is informational and exits 0 even when non-qualifying.
  const shardDefects = evaluation.verdict.qualifying
    ? []
    : evaluation.verdict.reasons.filter((r) => r !== SHARD_SCOPE_NONQUALIFYING_REASON);
  const strictFailed =
    args.behavior === "strict" &&
    (aggregate ? !aggregate.verdict.qualifying : shardDefects.length > 0);
  return { exitCode: strictFailed ? 1 : 0, message: lines.join("\n") };
}

function isPlatformKey(value: string): value is PlatformKey {
  return (
    value === "darwin-aarch64" || value === "darwin-x86_64" || value === "linux-x86_64" || value === "linux-aarch64"
  );
}

/**
 * Collects the actual secret VALUES that were materialized from the local file
 * (or already ambient) so the engine can redact them from any narrative. Names
 * only ever cross this boundary as keys; values never leave for logging.
 */
function secretValuesFromLoad(
  env: NodeJS.ProcessEnv,
  loadedNames: readonly string[],
  preservedNames: readonly string[],
): string[] {
  const values: string[] = [];
  for (const name of [...loadedNames, ...preservedNames]) {
    const value = env[name];
    // Only redact non-trivial values to avoid clobbering short, common tokens.
    if (value && value.length >= 8) values.push(value);
  }
  return values;
}

// Script guard: run only when invoked directly (not when imported by a test).
const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith("foundation.ts");
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  if (argv[0] === "aggregate") {
    // Cross-shard fan-in subcommand: the only path to a qualifying verdict.
    const result = runAggregateCli(argv.slice(1));
    console.log(result.message);
    process.exitCode = result.exitCode;
  } else {
    runFoundationCli(argv)
      .then((result) => {
        console.log(result.message);
        process.exitCode = result.exitCode;
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 2;
      });
  }
}
