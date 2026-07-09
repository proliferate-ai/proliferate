import { HELP_TEXT, parseArgs } from "./args.js";
import { resolveEnv, type EnvResolution } from "../config/env-resolution.js";
import { envVarNames, findEnvVarSpec } from "../config/env-manifest.js";
import { selectScenarios, allScenarioIds } from "../scenarios/registry.js";
import type { ScenarioDefinition } from "../scenarios/types.js";
import { ScenarioBlockedError, ScenarioExpectedFailError } from "../scenarios/types.js";
import type { RuntimeLane } from "../config/types.js";
import {
  DEFAULT_LOCAL_DURABLE_USER_EMAIL,
  DEFAULT_LOCAL_DURABLE_USER_PASSWORD,
  ensureLocalDurableUser,
} from "../fixtures/identity.js";
import type { ScenarioFailure } from "../report/types.js";
import { writeFailureReports, toFailureReport } from "../report/failure-reporter.js";
import { fileIssuesForFailures } from "../report/issue-filer.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP_TEXT);
    return;
  }

  console.log(
    `release-e2e: lane=${args.lane} desktop=${args.desktop} agents=${formatSelector(args.agents)} ` +
      `scenarios=${formatSelector(args.scenarios)} dryRun=${args.dryRun}`,
  );

  const scenarios = selectScenarios(args.scenarios);
  if (scenarios.length === 0) {
    console.log(`No scenarios selected. Known scenarios: ${allScenarioIds().join(", ")}`);
    return;
  }

  // Local lane self-seeds its durable user per run (Part 2 of #1069): the CI
  // local lane boots a fresh, ephemeral server, so it mints the durable
  // identity through the real /setup claim instead of depending on a repo
  // secret. Only local — staging keeps the durable-user env as its mechanism.
  const locallySeeded = new Set<string>();
  if (args.lane === "local" && !args.dryRun) {
    await seedLocalDurableUser(locallySeeded);
  }

  printEnvManifestReport();

  const neededEnvNames = [...new Set(scenarios.flatMap((scenario) => scenario.requiredEnv))];
  const neededEnv = resolveEnv(neededEnvNames);

  const agentsSelector = args.agents;
  const failures: ScenarioFailure[] = [];
  const blocked: Array<{ scenarioId: string; lane: string; reason: string }> = [];
  const expectedFail: Array<{ scenarioId: string; lane: string; diagnosis: string }> = [];
  let greenCount = 0;

  for (const scenario of scenarios) {
    for (const runtimeLane of scenario.lanes) {
      // A missing required credential blocks just the scenarios/lanes that need
      // it (#1069), instead of the old run-fatal env gate. Reported as blocked
      // — the same convention as an out-of-band gate — so the run still exits
      // success when everything non-green is blocked/expected-fail.
      const missingEnv = args.dryRun ? [] : missingEnvForLane(scenario, runtimeLane, neededEnv, locallySeeded);
      if (missingEnv.length > 0) {
        blocked.push({ scenarioId: scenario.id, lane: runtimeLane, reason: missingEnvBlockedReason(scenario.id, runtimeLane, missingEnv, locallySeeded) });
        continue;
      }
      try {
        await scenario.run({
          targetLane: args.lane,
          runtimeLane,
          desktop: args.desktop,
          agents: agentsSelector === "all" ? ["all"] : agentsSelector,
          dryRun: args.dryRun,
          env: neededEnv,
        });
        greenCount += 1;
      } catch (error) {
        if (error instanceof ScenarioBlockedError) {
          blocked.push({ scenarioId: scenario.id, lane: runtimeLane, reason: error.reason });
          continue;
        }
        if (error instanceof ScenarioExpectedFailError) {
          expectedFail.push({ scenarioId: scenario.id, lane: runtimeLane, diagnosis: error.diagnosis });
          continue;
        }
        failures.push({
          scenarioId: scenario.id,
          registryFlowRef: scenario.registryFlowRef,
          lane: runtimeLane,
          expected: `${scenario.title} completes without error`,
          error,
        });
      }
    }
  }

  if (!args.dryRun) {
    console.log(`\n${greenCount} scenario run(s) green.`);
    if (blocked.length > 0) {
      console.log(`${blocked.length} scenario run(s) blocked (known gate, not a fresh failure):`);
      for (const entry of blocked) {
        console.log(`  - [${entry.scenarioId}/${entry.lane}] ${entry.reason}`);
      }
    }
    if (expectedFail.length > 0) {
      console.log(`${expectedFail.length} scenario run(s) expected-fail (diagnosed, tracked, not blocking):`);
      for (const entry of expectedFail) {
        console.log(`  - [${entry.scenarioId}/${entry.lane}] ${entry.diagnosis}`);
      }
    }
  }

  if (failures.length > 0) {
    const reports = failures.map(toFailureReport);
    const written = await writeFailureReports(failures, args.outputDir);
    console.error(`\n${failures.length} scenario run(s) failed. Reports written:`);
    for (const filePath of written) {
      console.error(`  - ${filePath}`);
    }
    if (args.fileIssues) {
      const urls = await fileIssuesForFailures(reports);
      console.error("Filed issues:");
      for (const url of urls) {
        console.error(`  - ${url}`);
      }
    }
    if (!args.dryRun) {
      process.exitCode = 1;
    }
    return;
  }

  if (args.dryRun) {
    console.log(`\nAll ${countRuns(scenarios)} scenario run(s) completed with no failures.`);
  } else {
    console.log(`\nNo red scenario runs (${greenCount} green, ${blocked.length} blocked, ${expectedFail.length} expected-fail).`);
  }
}

/**
 * Required env for `scenario` on `runtimeLane` that is not satisfied. A var is
 * unsatisfied when it is absent, OR when it was only supplied by this run's
 * local durable-user seeding but the lane is not `local`: a per-run seeded
 * fresh user cannot stand in for the sandbox lane's needs (the durable
 * staging identity's warm, persistent sandbox plus E2B + a publicly reachable
 * server URL), so sandbox-lane durable-dependent scenarios stay blocked.
 */
function missingEnvForLane(
  scenario: ScenarioDefinition,
  runtimeLane: RuntimeLane,
  env: EnvResolution,
  locallySeeded: ReadonlySet<string>,
): string[] {
  return scenario.requiredEnv.filter((name) => {
    if (!env.present(name)) {
      return true;
    }
    return runtimeLane !== "local" && locallySeeded.has(name);
  });
}

function missingEnvBlockedReason(
  scenarioId: string,
  runtimeLane: RuntimeLane,
  missing: readonly string[],
  locallySeeded: ReadonlySet<string>,
): string {
  const lines = missing.map((name) => {
    const spec = findEnvVarSpec(name);
    const suffix = spec ? ` — ${spec.description} (${spec.whereItLives})` : "";
    const seededNote = locallySeeded.has(name)
      ? " [set for this run by local durable-user seeding, which does not satisfy the sandbox lane]"
      : "";
    return `${name}${seededNote}${suffix}`;
  });
  return (
    `${scenarioId}/${runtimeLane}: blocked on absent credential(s) — set the following to run it for real:\n` +
    lines.map((line) => `      - ${line}`).join("\n")
  );
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

function countRuns(scenarios: ReturnType<typeof selectScenarios>): number {
  return scenarios.reduce((total, scenario) => total + scenario.lanes.length, 0);
}

function formatSelector(selector: string[] | "all"): string {
  return selector === "all" ? "all" : selector.join(",");
}

await main();
