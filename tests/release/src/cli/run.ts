import { HELP_TEXT, parseArgs } from "./args.js";
import { assertResolved, resolveEnv } from "../config/env-resolution.js";
import { envVarNames } from "../config/env-manifest.js";
import { selectScenarios, allScenarioIds } from "../scenarios/registry.js";
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

  printEnvManifestReport();

  const neededEnvNames = [...new Set(scenarios.flatMap((scenario) => scenario.requiredEnv))];
  const neededEnv = resolveEnv(neededEnvNames);
  assertResolved(neededEnv, { dryRun: args.dryRun });

  const agentsSelector = args.agents;
  const failures: ScenarioFailure[] = [];

  for (const scenario of scenarios) {
    for (const runtimeLane of scenario.lanes) {
      try {
        await scenario.run({
          targetLane: args.lane,
          runtimeLane,
          desktop: args.desktop,
          agents: agentsSelector === "all" ? ["all"] : agentsSelector,
          dryRun: args.dryRun,
          env: neededEnv,
        });
      } catch (error) {
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

  console.log(`\nAll ${countRuns(scenarios)} scenario run(s) completed with no failures.`);
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
