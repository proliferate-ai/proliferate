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

import { accessSync, constants as fsConstants, existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { FOUNDATION_HELP_TEXT, parseFoundationArgs, type FoundationCliArgs } from "./foundation-args.js";
import type { CandidateManifest, PlatformKey, RetainedProductionManifest } from "../foundation/contracts/artifacts.js";
import type { WorldId } from "../foundation/contracts/identity.js";
import type { WorldProvisioner } from "../foundation/contracts/world.js";
import type { CellRunner } from "../foundation/runner/cell.js";
import { resolveManifestHash, availableCandidateSlots } from "../foundation/runner/artifacts.js";
import { buildPlan, type CellSpec } from "../foundation/runner/plan-builder.js";
import { createRunIdentity, createShardIdentity } from "../foundation/runner/identity.js";
import { FileCleanupLedger } from "../foundation/ledger/file-ledger.js";
import { CleanupRunner } from "../foundation/ledger/reconcile.js";
import { JsonlEvidenceSink } from "../foundation/evidence/jsonl-sink.js";
import type { PreflightSource } from "../foundation/preflight/engine.js";
import { loadReleaseEnvironment } from "../foundation/preflight/env-loader.js";
import { runFoundation } from "../foundation/runner/engine.js";

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

  const cellSpecs: CellSpec[] = args.cells.map((scenarioId) => ({
    scenarioId,
    world: args.world,
    productHost: args.productHost,
  }));
  const fullPlan = buildPlan({
    selector: args.selector,
    behavior: args.behavior,
    cells: cellSpecs,
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

  const { evaluation, evidence: emitted } = await runFoundation({
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

  const lines = [
    `foundation: world=${args.world} selector=${args.selector} behavior=${args.behavior} shard=${shard.shardId} dryRun=${args.dryRun}`,
    `run=${run.runId} origin=${run.origin} host=${run.executionHost}`,
    `env-file: ${envLoad.status} (${envLoad.filePath})`,
    `evidence: ${evidence.evidencePath}`,
    evaluation.verdict.qualifying
      ? `verdict: QUALIFYING (${evaluation.verdict.label})`
      : `verdict: NON-QUALIFYING\n  - ${evaluation.verdict.reasons.join("\n  - ")}`,
  ];

  // Exit code policy: a strict run fails the process when it does not qualify.
  // A diagnostic run is informational and exits 0 even when non-qualifying.
  const strictFailed = args.behavior === "strict" && !emitted.qualifying;
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
  runFoundationCli(process.argv.slice(2))
    .then((result) => {
      console.log(result.message);
      process.exitCode = result.exitCode;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
