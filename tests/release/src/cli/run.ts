import { HELP_TEXT, parseArgs } from "./args.js";
import { resolveEnv } from "../config/env-resolution.js";
import { envVarNames, DEFAULT_LOCAL_RUNTIME_URL } from "../config/env-manifest.js";
import { pushGatewayAuthState } from "../fixtures/agent-auth.js";
import { selectScenarios } from "../scenarios/registry.js";
import {
  DEFAULT_LOCAL_DURABLE_USER_EMAIL,
  DEFAULT_LOCAL_DURABLE_USER_PASSWORD,
  ensureLocalDurableUser,
} from "../fixtures/identity.js";
import { toFailureReports } from "../report/failure-reporter.js";
import { fileIssuesForFailures } from "../report/issue-filer.js";
import { IdentityError, resolveRunIdentity } from "../runner/identity.js";
import { executeSelectedTests, SelectionError } from "../runner/execute.js";
import { writeReport } from "../evidence/write.js";
import type { TestRunReportV1 } from "../evidence/schema.js";

/**
 * Thin process adapter (specs/developing/testing/qualification-runner-core.md
 * "Ownership and file plan"): parse/validate, resolve identity, run the local
 * setup hooks, delegate orchestration to runner/execute.ts, write the combined
 * report, and convert the persisted intended exit into process.exitCode. No
 * scenario policy lives here.
 */
async function main(): Promise<void> {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }

  if (args.help) {
    console.log(HELP_TEXT);
    return;
  }

  let identity;
  try {
    identity = await resolveRunIdentity({
      overrides: { runId: args.runId, shardId: args.shardId, attempt: args.attempt },
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }

  console.log(
    `release-e2e: behavior=${args.behavior} lane=${args.lane} desktop=${args.desktop} ` +
      `agents=${formatSelector(args.agents)} scenarios=${formatSelector(args.scenarios)} ` +
      `dryRun=${args.dryRun} run=${identity.run_id} shard=${identity.shard_id} attempt=${identity.attempt}`,
  );

  let scenarios;
  try {
    scenarios = selectScenarios(args.scenarios);
    if (scenarios.length === 0) {
      throw new SelectionError("Selection resolved to zero scenarios.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }

  // Local lane self-seeds its durable user per run (Part 2 of #1069): the CI
  // local lane boots a fresh, ephemeral server, so it mints the durable
  // identity through the real /setup claim instead of depending on a repo
  // secret. Only local — staging keeps the durable-user env as its mechanism.
  const locallySeeded = new Set<string>();
  if (args.lane === "local" && !args.dryRun) {
    await seedLocalDurableUser(locallySeeded);
    await pushLocalGatewayAuth();
  }

  printEnvManifestReport();

  let report: TestRunReportV1;
  try {
    report = await executeSelectedTests({
      behavior: args.behavior,
      execution: args.dryRun ? "dry_run" : "real",
      identity,
      inputs: { targetLane: args.lane, desktop: args.desktop, agents: args.agents, scenarios: args.scenarios },
      scenarios,
      locallySeeded,
      fileIssues: args.fileIssues
        ? async (failed) => {
            const urls = await fileIssuesForFailures(toFailureReports(failed));
            for (const url of urls) {
              console.error(`Filed issue: ${url}`);
            }
          }
        : undefined,
      log: (message) => console.log(`  ${message}`),
    });
  } catch (error) {
    if (error instanceof SelectionError || error instanceof IdentityError) {
      console.error(error.message);
    } else {
      console.error(`runner error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    }
    process.exitCode = 2;
    return;
  }

  printSummary(report);

  try {
    const written = await writeReport(args.outputDir, report);
    console.log(`Combined report written: ${written}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }

  if (report.summary.intended_exit_code !== 0) {
    process.exitCode = report.summary.intended_exit_code;
  }
}

function printSummary(report: TestRunReportV1): void {
  const counts = report.summary.by_status;
  console.log(
    `\n${counts.green} green, ${counts.failed} failed, ${counts.blocked} blocked, ` +
      `${counts.expected_fail} expected-fail, ${counts.cancelled} cancelled, ` +
      `${counts.not_run} not-run, ${counts.missing} missing ` +
      `(verdict: ${report.verdict.status}, intended exit ${report.summary.intended_exit_code}).`,
  );
  for (const result of report.results) {
    if (result.status !== "green") {
      const reason = result.reason ? ` — ${firstLine(result.reason.message)}` : "";
      console.log(`  [${result.status}] ${result.test_id}${reason}`);
    }
  }
  for (const error of report.summary.integrity_errors) {
    console.error(`  integrity error: ${error.message}`);
  }
  for (const error of report.summary.runner_errors) {
    console.error(`  runner error (${error.code}): ${error.message}`);
  }
}

function firstLine(message: string): string {
  return message.split("\n")[0];
}

/**
 * Mints (or reuses) the local-lane durable user through the real /setup claim,
 * then exports the resolved credentials into the environment so downstream env
 * resolution and scenarios see them present. Best-effort: if the seed cannot
 * complete (e.g. no SETUP_TOKEN_FILE, or the server is unreachable), the
 * durable-dependent scenarios simply report blocked, as they would have with
 * the credentials absent. Names it actually seeds (that were not already set
 * from a real secret) are recorded in `seeded` so sandbox-lane runs still
 * treat them as unsatisfied.
 */
async function seedLocalDurableUser(seeded: Set<string>): Promise<void> {
  const serverUrl = process.env.RELEASE_E2E_SERVER_URL;
  if (!serverUrl || serverUrl.trim().length === 0) {
    console.log("[seed] RELEASE_E2E_SERVER_URL not set — skipping local durable-user seed.");
    return;
  }
  const emailPreset = nonEmpty(process.env.RELEASE_E2E_DURABLE_USER_EMAIL);
  const passwordPreset = nonEmpty(process.env.RELEASE_E2E_DURABLE_USER_PASSWORD);
  const email = emailPreset ?? DEFAULT_LOCAL_DURABLE_USER_EMAIL;
  const password = passwordPreset ?? DEFAULT_LOCAL_DURABLE_USER_PASSWORD;
  try {
    const creds = await ensureLocalDurableUser({ serverUrl, email, password, organizationId: "" });
    process.env.RELEASE_E2E_DURABLE_USER_EMAIL = creds.email;
    process.env.RELEASE_E2E_DURABLE_USER_PASSWORD = creds.password;
    if (!nonEmpty(process.env.RELEASE_E2E_DURABLE_ORG_ID)) {
      process.env.RELEASE_E2E_DURABLE_ORG_ID = creds.organizationId;
      if (!emailPreset) {
        seeded.add("RELEASE_E2E_DURABLE_ORG_ID");
      }
    }
    // Only credentials that came from the per-run seed (not a real secret) are
    // marked seeded, so an operator who supplies a real durable identity for a
    // local run keeps it usable across lanes.
    if (!emailPreset) {
      seeded.add("RELEASE_E2E_DURABLE_USER_EMAIL");
    }
    if (!passwordPreset) {
      seeded.add("RELEASE_E2E_DURABLE_USER_PASSWORD");
    }
    console.log(`[seed] local durable user ready (${creds.email}, org ${creds.organizationId}).`);
  } catch (error) {
    console.warn(
      `[seed] could not seed the local durable user (${error instanceof Error ? error.message : String(error)}). ` +
        "Durable-user-dependent scenarios will report blocked.",
    );
  }
}

/**
 * When both the gateway virtual key and its public base URL are set for a
 * --lane local run, push a gateway-keyed agent-auth state document to the
 * local AnyHarness runtime so harnesses can chat with no native CLI login
 * (the CI path — the runner has no ~/.claude login). Best-effort like the
 * durable-user seed: without it, chat scenarios keep whatever credential the
 * runtime already resolves (a laptop's native login) or report their own
 * per-harness failure.
 */
async function pushLocalGatewayAuth(): Promise<void> {
  const gatewayKey = nonEmpty(process.env.RELEASE_E2E_GATEWAY_TEST_KEY);
  const gatewayBaseUrl = nonEmpty(process.env.RELEASE_E2E_GATEWAY_BASE_URL);
  if (!gatewayKey || !gatewayBaseUrl) {
    console.log(
      "[seed] RELEASE_E2E_GATEWAY_TEST_KEY / RELEASE_E2E_GATEWAY_BASE_URL not both set — " +
        "not pushing gateway agent-auth to the local runtime (native CLI login, if any, applies).",
    );
    return;
  }
  const runtimeUrl = process.env.RELEASE_E2E_LOCAL_RUNTIME_URL ?? DEFAULT_LOCAL_RUNTIME_URL;
  try {
    await pushGatewayAuthState({ runtimeUrl, gatewayBaseUrl, gatewayKey });
    console.log(`[seed] gateway agent-auth pushed to the local runtime (${gatewayBaseUrl}).`);
  } catch (error) {
    console.warn(
      `[seed] could not push gateway agent-auth to the local runtime ` +
        `(${error instanceof Error ? error.message : String(error)}). Chat scenarios fall back to ` +
        "whatever credential the runtime already resolves.",
    );
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}

function printEnvManifestReport(): void {
  const resolution = resolveEnv(envVarNames());
  console.log("\nEnv manifest:");
  for (const entry of resolution.all) {
    const status = entry.present ? "present" : "MISSING";
    const shown = entry.present && !entry.spec.secret ? ` = ${entry.value}` : "";
    console.log(`  [${status}] ${entry.spec.name}${shown}`);
  }
}

function formatSelector(selector: string[] | "all"): string {
  return selector === "all" ? "all" : selector.join(",");
}

await main();
