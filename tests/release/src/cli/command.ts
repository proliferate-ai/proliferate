import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path, { dirname } from "node:path";

import { HELP_TEXT, parseArgs, type CliArgs } from "./args.js";
import type { ScenarioDefinition } from "../scenarios/types.js";
import type { LocalWorldPorts } from "../worlds/local-workspace/ports.js";
import type { FailureReport } from "../report/types.js";
import { toFailureReports } from "../report/failure-reporter.js";
import { IdentityError, type RunIdentityV1 } from "../runner/identity.js";
import { executeSelectedCells } from "../runner/execute.js";
import { buildPlannedCells, SelectionError } from "../runner/plan.js";
import type { PlannedCellV1 } from "../runner/result.js";
import {
  BuildMapError,
  toCandidateBuildEvidence,
  type CandidateBuildEvidenceV1,
  type CandidateBuildMapV1,
} from "../artifacts/build-map.js";
import type { FinalCellResultV2, TestRunReportV3, TestRunReportV4 } from "../evidence/schema.js";
import type { QualificationWorld } from "../config/types.js";

/**
 * Testable command orchestration
 * (specs/developing/testing/candidate-build-handoff.md "Runner integration").
 * The required ordering is encoded here: parse → identity → selection →
 * candidate-build-map validation → only then local-user/gateway setup →
 * execute → write report V3 → auxiliary issue filing → persisted exit.
 * `cli/run.ts` stays a thin process adapter supplying the real side-effect
 * dependencies.
 */
export interface CommandDeps {
  resolveIdentity: (overrides: {
    runId?: string;
    shardId?: string;
    attempt?: number;
  }) => Promise<RunIdentityV1>;
  selectScenarios: (
    selector: readonly string[] | "all",
    qualificationWorld?: QualificationWorld,
  ) => ScenarioDefinition[];
  loadBuildMap: (path: string, expectedSourceSha: string) => Promise<CandidateBuildMapV1>;
  /**
   * Loads the `local-world-ports.json` sidecar the candidate builder wrote into
   * the run directory (the candidate map's directory). Returns null when the
   * sidecar is absent; a world scenario then fails closed on the missing ports.
   */
  loadLocalWorldPorts: (runDir: string) => Promise<LocalWorldPorts | null>;
  /** Local durable-user seed; fills the locallySeeded set. */
  seedLocalDurableUser: (seeded: Set<string>) => Promise<void>;
  pushLocalGatewayAuth: () => Promise<void>;
  printEnvManifestReport: () => void;
  execute: typeof executeSelectedCells;
  /**
   * Writes the combined report. `command.ts` always hands this a V4 report
   * (V3 semantics unchanged; `evidence: null` on every result that does not
   * attach report-V4 evidence) — the caller's real implementation is
   * `writeReportV4` (`evidence/write.ts`).
   */
  write: (outputDir: string, report: TestRunReportV4) => Promise<string>;
  fileIssues: (reports: readonly FailureReport[]) => Promise<string[]>;
  log: (message: string) => void;
  error: (message: string) => void;
}

export async function runReleaseCommand(argv: readonly string[], deps: CommandDeps): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    deps.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  if (args.help) {
    deps.log(HELP_TEXT);
    return 0;
  }

  let identity: RunIdentityV1;
  try {
    identity = await deps.resolveIdentity({
      runId: args.runId,
      shardId: args.shardId,
      attempt: args.attempt,
    });
  } catch (error) {
    deps.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  deps.log(
    `release-e2e: behavior=${args.behavior} lane=${args.lane} desktop=${args.desktop} ` +
      `agents=${formatSelector(args.agents)} scenarios=${formatSelector(args.scenarios)} ` +
      `dryRun=${args.dryRun} run=${identity.run_id} shard=${identity.shard_id} attempt=${identity.attempt}`,
  );

  let scenarios: ScenarioDefinition[];
  try {
    scenarios = deps.selectScenarios(args.scenarios, args.qualificationWorld);
    if (scenarios.length === 0) {
      throw new SelectionError("Selection resolved to zero scenarios.");
    }
  } catch (error) {
    deps.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  // Candidate build map validation happens before any setup side effect: an
  // invalid map exits 2 with zero user/gateway/provider/fixture/scenario work
  // and no report. Diagnostic omission is recorded explicitly as null.
  let candidateBuild: CandidateBuildEvidenceV1 | null = null;
  // The full validated, path-bearing map — retained (not just its bounded
  // evidence projection) so a world constructor can materialize the exact
  // artifacts it names. In-memory only; never serialized into the report.
  let candidateBuildMap: CandidateBuildMapV1 | null = null;
  // The run/shard-scoped run directory and pre-allocated ports a world
  // constructor needs. Both derived from the candidate map (its directory is the
  // run dir; the ports sidecar sits next to it) so an invalid map still yields
  // no world side effects. Null in a diagnostic run without a map.
  let runDir: string | null = null;
  let ports: LocalWorldPorts | null = null;
  if (args.candidateBuildMap !== undefined) {
    try {
      const map = await deps.loadBuildMap(args.candidateBuildMap, identity.source_sha);
      candidateBuild = toCandidateBuildEvidence(map);
      candidateBuildMap = map;
      runDir = path.dirname(path.resolve(args.candidateBuildMap));
      ports = await deps.loadLocalWorldPorts(runDir);
    } catch (error) {
      deps.error(error instanceof Error ? error.message : String(error));
      return 2;
    }
  } else if (args.sourceCandidate) {
    // No candidate-build-map machinery: this run boots the Server from source
    // (Tier-2). `candidateBuildMap`/`runDir`/`ports` stay null — no world
    // materialization is claimed — while `candidateBuild` still carries a
    // non-null, honest identity so a strict report is not rejected.
    //
    // T2R-R01: only source-backed (Tier-2) scenarios may run this way. A
    // strict Tier-3/Tier-4 invocation must never substitute a synthetic
    // source identity for the exact candidate-build map.
    const nonSourceBacked = scenarios.filter((s) => s.sourceBacked !== true);
    if (nonSourceBacked.length > 0) {
      deps.error(
        `--source-candidate is restricted to source-backed Tier-2 scenarios; ` +
          `refusing: ${nonSourceBacked.map((s) => s.id).join(", ")}. ` +
          `Use --candidate-build-map for exact-candidate scenarios.`,
      );
      return 2;
    }
    try {
      candidateBuild = synthesizeSourceCandidateBuild(identity.source_sha);
    } catch (error) {
      deps.error(error instanceof Error ? error.message : String(error));
      return 2;
    }
  }

  // The exact test plan is expanded and validated deterministically after
  // the candidate map and before any setup side effect: invalid, empty, or
  // duplicate expansion exits 2, writes no report, and runs zero
  // user/gateway/provider/fixture/scenario setup.
  let cells: PlannedCellV1[];
  try {
    cells = await buildPlannedCells(scenarios, {
      desktop: args.desktop,
      agents: args.agents === "all" ? ["all"] : args.agents,
      // `--lane local` plans only the local runtime lane (decision #5): the
      // world-backed qualification path has no publicly-reachable server for
      // sandbox-runtime cells to call back into.
      targetLane: args.lane,
      // Broad `all` is a world-compatibility sweep and may filter scenarios.
      // An explicit selector is a request for every named scenario, so none
      // may disappear without a terminal result.
      requireEveryScenario: args.scenarios !== "all",
    });
  } catch (error) {
    deps.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  // Optional matrix-cell filter (--cells): narrows by SCENARIO OWNERSHIP, not by
  // presence/absence of a `cell` dimension (PR7-CONTROL-005). Within a scenario
  // that OWNS at least one wanted cell, keep only its wanted cells; a scenario
  // that owns NONE of the wanted cells keeps ALL of its cells untouched. So
  // `--scenarios SELFHOST-INSTALL-1,SELFHOST-QUAL-1 --cells SH-GATEWAY` runs
  // SELFHOST-INSTALL-1's four baseline cells (it owns none of the wanted cells)
  // AND only SELFHOST-QUAL-1's SH-GATEWAY cell — even though INSTALL-1 is a
  // matrix whose cells all carry a `cell` dimension. At least one cell overall
  // must match a wanted name, else the selector picked nothing and we fail
  // closed. The filter never resurrects an unselected scenario.
  if (args.cells !== "all") {
    const wanted = new Set(args.cells);
    const cellName = (cell: (typeof cells)[number]): string | undefined => cell.dimensions.cell;
    // Which scenarios own at least one wanted cell — those are the only ones the
    // filter narrows.
    const scenariosOwningWanted = new Set(
      cells.filter((cell) => cellName(cell) !== undefined && wanted.has(cellName(cell) as string)).map((c) => c.scenario_id),
    );
    if (scenariosOwningWanted.size === 0) {
      deps.error(
        `--cells ${formatSelector(args.cells)} matched no planned cell ` +
          `(selected scenarios: ${scenarios.map((s) => s.id).join(", ")}).`,
      );
      return 2;
    }
    cells = cells.filter((cell) => {
      if (!scenariosOwningWanted.has(cell.scenario_id)) {
        return true; // scenario owns none of the wanted cells → keep it whole
      }
      const name = cellName(cell);
      return name !== undefined && wanted.has(name); // narrow within an owning scenario
    });
  }

  // Local lane self-seeds its durable user per run (Part 2 of #1069): the CI
  // local lane boots a fresh, ephemeral server, so it mints the durable
  // identity through the real /setup claim instead of depending on a repo
  // secret. Only local — staging keeps the durable-user env as its mechanism.
  const locallySeeded = new Set<string>();
  if (args.lane === "local" && !args.dryRun) {
    await deps.seedLocalDurableUser(locallySeeded);
    await deps.pushLocalGatewayAuth();
  }

  deps.printEnvManifestReport();

  let report: TestRunReportV3;
  try {
    // The executor threads `candidateBuildMap` into every `ScenarioRunContext`
    // (BRIEF §7a) so a world constructor can materialize the exact artifacts it
    // names; it is in-memory only and never serialized into the report.
    const executeOptions = {
      behavior: args.behavior,
      execution: (args.dryRun ? "dry_run" : "real") as "real" | "dry_run",
      identity,
      inputs: { targetLane: args.lane, desktop: args.desktop, agents: args.agents, scenarios: args.scenarios },
      scenarios,
      cells,
      locallySeeded,
      candidateBuild,
      candidateBuildMap,
      runDir,
      ports,
      log: (message: string) => deps.log(`  ${message}`),
    };
    report = await deps.execute(executeOptions);
  } catch (error) {
    if (error instanceof SelectionError || error instanceof IdentityError || error instanceof BuildMapError) {
      deps.error(error.message);
    } else {
      deps.error(`runner error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    }
    return 2;
  }

  printSummary(report, deps);

  // Report V4 (spec "Aggregate evidence"): schema_version 4, plus each
  // result's bounded evidence attachment. `ResultTracker` (runner/result.ts)
  // always sets `evidence` (defaulting `null`), so every result already
  // carries it at runtime even where `report.results` is still statically
  // typed `FinalCellResultV1[]`; a scenario that never attaches evidence
  // (every existing scenario) round-trips as `null`, unchanged V3 semantics.
  const reportV4: TestRunReportV4 = {
    ...report,
    schema_version: 4,
    results: report.results.map((result) => ({
      ...result,
      evidence: (result as FinalCellResultV2).evidence ?? null,
    })),
  };

  try {
    const written = await deps.write(args.outputDir, reportV4);
    deps.log(`Combined report written: ${written}`);
  } catch (error) {
    deps.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  // Issue filing is auxiliary and runs after the authoritative report is
  // persisted, from the report's own sanitized failed results. A filing
  // failure keeps its existing semantics: reported, never rewriting the
  // already-derived verdict or exit.
  if (args.fileIssues) {
    const payloads = toFailureReports(report.results);
    if (payloads.length > 0) {
      try {
        const urls = await deps.fileIssues(payloads);
        for (const url of urls) {
          deps.error(`Filed issue: ${url}`);
        }
      } catch (error) {
        deps.error(
          `Issue filing failed (verdict unchanged): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return report.summary.intended_exit_code;
}

function printSummary(report: TestRunReportV3, deps: Pick<CommandDeps, "log" | "error">): void {
  const counts = report.summary.by_status;
  deps.log(
    `\n${counts.green} green, ${counts.failed} failed, ${counts.blocked} blocked, ` +
      `${counts.expected_fail} expected-fail, ${counts.cancelled} cancelled, ` +
      `${counts.not_run} not-run, ${counts.missing} missing ` +
      `(verdict: ${report.verdict.status}, intended exit ${report.summary.intended_exit_code}).`,
  );
  for (const result of report.results) {
    if (result.status !== "green") {
      const reason = result.reason ? ` — ${firstLine(result.reason.message)}` : "";
      deps.log(`  [${result.status}] ${result.cell_id}${reason}`);
    }
  }
  for (const error of report.summary.integrity_errors) {
    deps.error(`  integrity error: ${error.message}`);
  }
  for (const error of report.summary.runner_errors) {
    deps.error(`  runner error (${error.code}): ${error.message}`);
  }
}

function firstLine(message: string): string {
  return message.split("\n")[0];
}

// src/cli -> up four to repo root VERSION (same convention as
// scenarios/upgrade/t4-sh-1.ts's VERSION_FILE resolution).
const HERE = dirname(fileURLToPath(import.meta.url));
const VERSION_FILE = path.resolve(HERE, "..", "..", "..", "..", "VERSION");

/**
 * Synthesizes `CandidateBuildEvidenceV1` for a Tier-2-style run that boots the
 * Server from source (venv uvicorn) rather than a packaged candidate build
 * (BRIEF §1/§7 deviation 1). Honest identity: names the exact Server commit
 * under test without materializing or claiming any build artifact. Reuses the
 * existing `server/<platform>` artifact id (adds no new id); the version is
 * the repo VERSION file; the digest binds the source commit + artifact id so
 * two different commits never collide.
 */
export function synthesizeSourceCandidateBuild(sourceSha: string): CandidateBuildEvidenceV1 {
  const version = readFileSync(VERSION_FILE, "utf8").trim();
  const artifactId = `server/${process.platform}`;
  const sha256 = createHash("sha256").update(`${sourceSha}/${artifactId}`).digest("hex");
  return { artifacts: [{ artifact_id: artifactId, version, sha256 }] };
}

function formatSelector(selector: string[] | "all"): string {
  return selector === "all" ? "all" : selector.join(",");
}
