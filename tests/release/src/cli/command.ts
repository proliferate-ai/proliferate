import { HELP_TEXT, parseArgs, type CliArgs } from "./args.js";
import type { ScenarioDefinition } from "../scenarios/types.js";
import type { FailureReport } from "../report/types.js";
import { toFailureReports } from "../report/failure-reporter.js";
import { IdentityError, type RunIdentityV1 } from "../runner/identity.js";
import { executeSelectedTests, SelectionError } from "../runner/execute.js";
import {
  BuildMapError,
  toCandidateBuildEvidence,
  type CandidateBuildEvidenceV1,
  type CandidateBuildMapV1,
} from "../artifacts/build-map.js";
import type { TestRunReportV2 } from "../evidence/schema.js";

/**
 * Testable command orchestration
 * (specs/developing/testing/candidate-build-handoff.md "Runner integration").
 * The required ordering is encoded here: parse → identity → selection →
 * candidate-build-map validation → only then local-user/gateway setup →
 * execute → write report V2 → auxiliary issue filing → persisted exit.
 * `cli/run.ts` stays a thin process adapter supplying the real side-effect
 * dependencies.
 */
export interface CommandDeps {
  resolveIdentity: (overrides: {
    runId?: string;
    shardId?: string;
    attempt?: number;
  }) => Promise<RunIdentityV1>;
  selectScenarios: (selector: readonly string[] | "all") => ScenarioDefinition[];
  loadBuildMap: (path: string, expectedSourceSha: string) => Promise<CandidateBuildMapV1>;
  /** Local durable-user seed; fills the locallySeeded set. */
  seedLocalDurableUser: (seeded: Set<string>) => Promise<void>;
  pushLocalGatewayAuth: () => Promise<void>;
  printEnvManifestReport: () => void;
  execute: typeof executeSelectedTests;
  write: (outputDir: string, report: TestRunReportV2) => Promise<string>;
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
    scenarios = deps.selectScenarios(args.scenarios);
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
  if (args.candidateBuildMap !== undefined) {
    try {
      const map = await deps.loadBuildMap(args.candidateBuildMap, identity.source_sha);
      candidateBuild = toCandidateBuildEvidence(map);
    } catch (error) {
      deps.error(error instanceof Error ? error.message : String(error));
      return 2;
    }
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

  let report: TestRunReportV2;
  try {
    report = await deps.execute({
      behavior: args.behavior,
      execution: args.dryRun ? "dry_run" : "real",
      identity,
      inputs: { targetLane: args.lane, desktop: args.desktop, agents: args.agents, scenarios: args.scenarios },
      scenarios,
      locallySeeded,
      candidateBuild,
      log: (message) => deps.log(`  ${message}`),
    });
  } catch (error) {
    if (error instanceof SelectionError || error instanceof IdentityError || error instanceof BuildMapError) {
      deps.error(error.message);
    } else {
      deps.error(`runner error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    }
    return 2;
  }

  printSummary(report, deps);

  try {
    const written = await deps.write(args.outputDir, report);
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

function printSummary(report: TestRunReportV2, deps: Pick<CommandDeps, "log" | "error">): void {
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
      deps.log(`  [${result.status}] ${result.test_id}${reason}`);
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

function formatSelector(selector: string[] | "all"): string {
  return selector === "all" ? "all" : selector.join(",");
}
