import { HELP_TEXT, parseArgs } from "./args.js";
import {
  resolveEnv,
  missingRequiredForLane,
  blockedReasonForMissingEnv,
  requiredEnvForTargetLane,
  scenarioUsesDurableIdentity,
} from "../config/env-resolution.js";
import { ENV_MANIFEST, envVarNames, DEFAULT_LOCAL_RUNTIME_URL } from "../config/env-manifest.js";
import { pushGatewayAuthState } from "../fixtures/agent-auth.js";
import { stagingSessionAvailable } from "../fixtures/staging-session.js";
import { selectScenarios, allScenarioIds } from "../scenarios/registry.js";
import { ScenarioBlockedError, ScenarioExpectedFailError } from "../scenarios/types.js";
import {
  DEFAULT_LOCAL_DURABLE_USER_EMAIL,
  DEFAULT_LOCAL_DURABLE_USER_PASSWORD,
  ensureLocalDurableUser,
} from "../fixtures/identity.js";
import type { ScenarioFailure } from "../report/types.js";
import { writeFailureReports, toFailureReport } from "../report/failure-reporter.js";
import { fileIssuesForFailures } from "../report/issue-filer.js";
import type { RuntimeLane } from "../config/types.js";
import {
  evaluate,
  loadRequiredManifest,
  RELEASE_POLICY_ENV,
  type ResultRow,
  type ScenarioStatus,
} from "../runner/workflow-policy.js";
import { buildSummary, validateSummary } from "../runner/summary-artifact.js";
import {
  SCENARIO_DEADLINE_MS,
  ScenarioRunGuard,
  scenarioCorrelationId,
  withDeadline,
} from "../runner/live-scenario-policy.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  loadReleaseEnvironment,
  ReleaseEnvironmentFileError,
  type ReleaseEnvironmentLoadResult,
} from "../config/local-environment.js";
import {
  assertLocalProfileTargetLaneCompatibility,
  loadLocalProfileEnvironment,
  LocalProfileConfigurationError,
  type LocalProfileLoadResult,
} from "../config/local-profile.js";
import {
  preflightLocalProfileServices,
  type LocalServiceCheck,
} from "../config/local-preflight.js";

/**
 * Maps a runtime lane onto the release manifest's lane vocabulary
 * (required-workflows.json uses `cloud`/`desktop`). The sandbox runtime lane is
 * the cloud target; the local runtime lane is the Desktop target. The final
 * scenario-to-lane binding is WS10b-owned content; this is the provisional
 * mapping the runner uses to compare results against the required manifest.
 */
function runtimeLaneToReleaseLane(runtimeLane: RuntimeLane): string {
  return runtimeLane === "sandbox" ? "cloud" : "desktop";
}

const WORKFLOW_SUMMARY_FILENAME = "workflow-release-summary.json";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // Parse routing flags before touching the credential file. Scenario
  // selection is CLI-only, so it gives the loader the least-privilege set of
  // secrets this invocation may materialize. Parse once more after loading so
  // RELEASE_POLICY from the file remains a supported default.
  const preliminaryArgs = parseArgs(argv);
  if (preliminaryArgs.help) {
    console.log(HELP_TEXT);
    return;
  }
  const preliminaryScenarios = selectScenarios(preliminaryArgs.scenarios);
  if (preliminaryScenarios.length === 0) {
    console.log(`No scenarios selected. Known scenarios: ${allScenarioIds().join(", ")}`);
    return;
  }

  const ambientEnvironmentNames = new Set(Object.keys(process.env));
  const environmentLoad = loadReleaseEnvironment({
    allowedNames: environmentFileNamesForSelection(preliminaryScenarios, preliminaryArgs.lane),
  });
  const args = parseArgs(argv);
  assertLocalProfileTargetLaneCompatibility(args.lane);
  const profileLoad = args.lane === "local"
    ? loadLocalProfileEnvironment({ preserveNames: ambientEnvironmentNames })
    : undefined;

  printLocalEnvironmentSources(environmentLoad, profileLoad);

  console.log(
    `release-e2e: lane=${args.lane} desktop=${args.desktop} agents=${formatSelector(args.agents)} ` +
      `scenarios=${formatSelector(args.scenarios)} policy=${args.policy} dryRun=${args.dryRun}`,
  );

  const scenarios = preliminaryScenarios;
  const selectedRequiredEnv = new Set(scenarios.flatMap(allScenarioRequiredEnv));
  const needsLocalDurableIdentity =
    args.lane === "local" && selectedRequiredEnv.has("RELEASE_E2E_DURABLE_USER_EMAIL");
  const needsLocalIdentityAutoSeed =
    needsLocalDurableIdentity &&
    (!nonEmpty(process.env.RELEASE_E2E_DURABLE_USER_EMAIL) ||
      !nonEmpty(process.env.RELEASE_E2E_DURABLE_USER_PASSWORD));
  if (needsLocalIdentityAutoSeed && profileLoad && !profileLoad.singleOrgMode) {
    throw new LocalProfileConfigurationError(
      `Dev profile "${profileLoad.profile}" was not launched in the single-org first-run posture needed ` +
        "to seed a fresh local qualification identity. Restart it with: " +
        `make run PROFILE=${profileLoad.profile} RELEASE_E2E=1`,
    );
  }

  const sandboxCallbackIssue = configureLocalSandboxCallback(
    args,
    scenarios,
    profileLoad,
    ambientEnvironmentNames,
  );
  if (sandboxCallbackIssue && !args.dryRun) {
    throw new LocalProfileConfigurationError(sandboxCallbackIssue);
  }
  const neededEnvNames = [...selectedRequiredEnv];
  const preflightEnvNames = new Set(neededEnvNames);
  if (args.lane === "local" && selectedRequiredEnv.has("RELEASE_E2E_DURABLE_USER_EMAIL")) {
    // Local durable identity creation/login is runner infrastructure even for
    // scenarios whose own body only reads the profile DB.
    preflightEnvNames.add("RELEASE_E2E_SERVER_URL");
  }
  if (
    args.lane === "local" &&
    (selectedRequiredEnv.has("RELEASE_E2E_GATEWAY_TEST_KEY") ||
      selectedRequiredEnv.has("RELEASE_E2E_GATEWAY_BASE_URL"))
  ) {
    preflightEnvNames.add("RELEASE_E2E_LOCAL_RUNTIME_URL");
  }

  const preSeedEnv = resolveEnv(neededEnvNames);
  const localServiceChecks = args.lane === "local"
    ? await preflightLocalProfileServices([...preflightEnvNames])
    : [];
  printEnvManifestReport();
  printLocalServiceChecks(localServiceChecks);

  if (args.dryRun) {
    printDryRunPlan(
      args,
      scenarios,
      preSeedEnv,
      localServiceChecks,
      profileLoad !== undefined,
      sandboxCallbackIssue,
    );
    return;
  }
  const unavailableServices = localServiceChecks.filter((check) => !check.ready);
  if (unavailableServices.length > 0) {
    const profileHint = profileLoad
      ? ` Start it with make run PROFILE=${profileLoad.profile} SINGLE_ORG_MODE=true and retry.`
      : " Start the explicitly configured local services (or select a dev PROFILE) and retry.";
    throw new LocalProfileConfigurationError(
      `${profileLoad ? `Dev profile "${profileLoad.profile}"` : "Local target"} is not ready for the selected scenarios: ` +
        unavailableServices.map((check) => `${check.name} (${check.target})`).join(", ") +
        `.${profileHint}`,
    );
  }

  // Local lane self-seeds its durable user per run (Part 2 of #1069): the CI
  // local lane boots a fresh, ephemeral server, so it mints the durable
  // identity through the real /setup claim instead of depending on a repo
  // secret. Only local — staging keeps the durable-user env as its mechanism.
  const locallySeeded = new Set<string>();
  if (args.lane === "local" && !args.dryRun) {
    if (selectedRequiredEnv.has("RELEASE_E2E_DURABLE_USER_EMAIL")) {
      await seedLocalDurableUser(locallySeeded);
    }
    if (
      selectedRequiredEnv.has("RELEASE_E2E_GATEWAY_TEST_KEY") ||
      selectedRequiredEnv.has("RELEASE_E2E_GATEWAY_BASE_URL")
    ) {
      await pushLocalGatewayAuth();
    }
  }

  // Seeding can materialize the durable email/password/org, so scenario
  // resolution must happen after it. All non-mutating profile/service checks
  // above intentionally happened first.
  const neededEnv = resolveEnv(neededEnvNames);

  const agentsSelector = args.agents;
  const failures: ScenarioFailure[] = [];
  const blocked: Array<{ scenarioId: string; lane: string; reason: string }> = [];
  const expectedFail: Array<{ scenarioId: string; lane: string; diagnosis: string }> = [];
  // Result rows in the release-lane vocabulary, for the WS10a policy gate.
  const results: ResultRow[] = [];
  // Structural no-retry-after-external-effect guard (WS10a): each scenario/lane
  // is driven exactly once — a second attempt throws.
  const runGuard = new ScenarioRunGuard();
  const recordResult = (id: string, runtimeLane: RuntimeLane, status: ScenarioStatus): void => {
    results.push({ id, lane: runtimeLaneToReleaseLane(runtimeLane), status });
  };
  let greenCount = 0;

  for (const scenario of scenarios) {
    for (const runtimeLane of scenario.lanes) {
      // The `local` RUNTIME lane drives a local AnyHarness runtime (desktop
      // web-port mode) that is not paired with any remote server — it creates
      // local workspaces/sessions on the machine the runner runs on. There is
      // no such runtime standing up against the staging deployment, so on
      // `--lane staging` the local runtime lane is reported blocked (run it
      // under `--lane local`); only the sandbox runtime lane targets staging.
      if (!args.dryRun && args.lane === "staging" && runtimeLane === "local") {
        blocked.push({
          scenarioId: scenario.id,
          lane: runtimeLane,
          reason:
            `${scenario.id}/local: the local runtime lane drives a local AnyHarness runtime on the runner ` +
            "host, which has no staging pairing — run it under `--lane local`. On `--lane staging` only the " +
            "sandbox runtime lane targets the staging deployment.",
        });
        recordResult(scenario.id, runtimeLane, "blocked");
        continue;
      }

      // A missing required credential blocks just the scenarios/lanes that need
      // it (#1069), instead of the old run-fatal env gate. Reported as blocked
      // — the same convention as an out-of-band gate — so the run still exits
      // success when everything non-green is blocked/expected-fail.
      // `requiredEnvForTargetLane` drops the durable user's email/password on
      // the staging target (there it authenticates via the rotating product
      // session, not a password), and the staging session's own availability is
      // checked right after.
      const runtimeRequired = scenarioRequiredEnvForRuntimeLane(scenario, runtimeLane);
      const effectiveRequired = requiredEnvForTargetLane(runtimeRequired, args.lane);
      const missingEnv = args.dryRun
        ? []
        : missingRequiredForLane(effectiveRequired, runtimeLane, neededEnv, locallySeeded);
      if (
        !args.dryRun &&
        args.lane === "staging" &&
        scenarioUsesDurableIdentity(runtimeRequired) &&
        !stagingSessionAvailable()
      ) {
        missingEnv.push("RELEASE_E2E_STAGING_SESSION_REFRESH_TOKEN");
      }
      if (missingEnv.length > 0) {
        blocked.push({
          scenarioId: scenario.id,
          lane: runtimeLane,
          reason: blockedReasonForMissingEnv(scenario.id, runtimeLane, missingEnv, locallySeeded),
        });
        recordResult(scenario.id, runtimeLane, "blocked");
        continue;
      }
      // WS10a live-scenario policy: each scenario/lane runs exactly once (the
      // guard throws on a re-drive), under a unique correlation ID and a fixed
      // deadline.
      runGuard.begin(scenario.id, runtimeLane);
      const correlationId = scenarioCorrelationId(scenario.id, runtimeLane);
      if (!args.dryRun) {
        console.log(`  [${scenario.id}/${runtimeLane}] correlation=${correlationId}`);
      }
      try {
        await withDeadline(
          scenario.run({
            targetLane: args.lane,
            runtimeLane,
            desktop: args.desktop,
            agents: agentsSelector === "all" ? ["all"] : agentsSelector,
            dryRun: args.dryRun,
            env: neededEnv,
            correlationId,
            deadlineMs: SCENARIO_DEADLINE_MS,
          }),
          SCENARIO_DEADLINE_MS,
          `${scenario.id}/${runtimeLane}`,
        );
        greenCount += 1;
        recordResult(scenario.id, runtimeLane, "green");
      } catch (error) {
        if (error instanceof ScenarioBlockedError) {
          blocked.push({ scenarioId: scenario.id, lane: runtimeLane, reason: error.reason });
          recordResult(scenario.id, runtimeLane, "blocked");
          continue;
        }
        if (error instanceof ScenarioExpectedFailError) {
          expectedFail.push({ scenarioId: scenario.id, lane: runtimeLane, diagnosis: error.diagnosis });
          recordResult(scenario.id, runtimeLane, "expected-fail");
          continue;
        }
        failures.push({
          scenarioId: scenario.id,
          registryFlowRef: scenario.registryFlowRef,
          lane: runtimeLane,
          expected: `${scenario.title} completes without error`,
          error,
        });
        recordResult(scenario.id, runtimeLane, "failed");
      }
    }
  }

  // WS10a release gate: in `release` policy the required-scenario manifest
  // gates missing work, every emitted registered result must also be unique
  // and green, and a signed summary artifact is emitted. In `signal` policy
  // this is skipped entirely so behavior is unchanged from today.
  if (args.policy === "release" && !args.dryRun) {
    await runReleaseGate(args, results);
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
    console.error(`\n${failures.length} scenario run(s) failed:`);
    for (const report of reports) {
      // First line of the observed error, inline in the log — the JSON reports
      // are the full record, but the runner is often read straight from the CI
      // log (where the report artifact may not be fetched), so surface the
      // reason there too.
      const firstLine = report.observed.split("\n")[0];
      console.error(`  - [${report.scenario_id}/${report.lane}] ${firstLine}`);
    }
    const written = await writeFailureReports(failures, args.outputDir);
    console.error("Reports written:");
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
 * WS10a release gate. Loads the required-scenario manifest, evaluates the
 * collected results strictly, emits the signed summary artifact, and sets a
 * nonzero exit code if any required row is not green or the summary fails
 * validation (an unknown/absent identity field, a nonzero non-green counter).
 * A malformed manifest throws `ManifestConfigError` and fails the run loudly.
 */
async function runReleaseGate(
  args: import("./args.js").CliArgs,
  results: ResultRow[],
): Promise<void> {
  const manifest = loadRequiredManifest();
  const evaluation = evaluate(manifest, results, "release");

  console.log("\nRelease policy: strict manifest gate");
  for (const row of evaluation.rows) {
    const mark = row.verdict === "green" ? "ok" : "FAIL";
    console.log(`  [${mark}] ${row.id}/${row.lane} — ${row.verdict} (${row.detail})`);
  }
  console.log(
    `  counters: missing=${evaluation.counters.missing} skipped=${evaluation.counters.skipped} ` +
      `blocked=${evaluation.counters.blocked} expectedFail=${evaluation.counters.expectedFail} ` +
      `cancelled=${evaluation.counters.cancelled} duplicate=${evaluation.counters.duplicate} ` +
      `failed=${evaluation.counters.failed}`,
  );

  const summary = buildSummary({
    policy: "release",
    target: args.lane,
    manifest,
    results,
    evaluation,
  });
  const summaryValidation = validateSummary(summary, "release");

  await mkdir(args.outputDir, { recursive: true });
  const summaryPath = path.join(args.outputDir, WORKFLOW_SUMMARY_FILENAME);
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`  summary artifact: ${summaryPath}`);

  if (!evaluation.ok) {
    console.error("\nRelease policy FAILED — required scenarios not all green:");
    for (const violation of evaluation.violations) {
      console.error(`  - ${violation}`);
    }
    process.exitCode = 1;
  }
  if (!summaryValidation.ok) {
    console.error("\nRelease summary artifact INVALID:");
    for (const error of summaryValidation.errors) {
      console.error(`  - ${error}`);
    }
    process.exitCode = 1;
  }
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
    // The organization id is a record in this profile's database. A shared
    // local dotenv may contain an id from another profile, so the identity
    // returned by the real claim/login flow is authoritative every run.
    process.env.RELEASE_E2E_DURABLE_ORG_ID = creds.organizationId;
    if (!emailPreset) {
      seeded.add("RELEASE_E2E_DURABLE_ORG_ID");
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
    // The full manifest includes conditional controls and lane-specific
    // credentials, so an absent global entry is merely unset. The dry-run
    // plan and live per-cell resolver name actual required gaps as missing.
    const status = entry.present ? "present" : "unset";
    const shown = entry.present && !entry.spec.secret ? ` = ${entry.value}` : "";
    console.log(`  [${status}] ${entry.spec.name}${shown}`);
  }
}

function printLocalEnvironmentSources(
  environment: ReleaseEnvironmentLoadResult,
  profile: LocalProfileLoadResult | undefined,
): void {
  if (environment.status === "loaded") {
    console.log(
      `release-e2e: loaded ${environment.loadedNames.length} variable(s) from ${environment.filePath} ` +
        `(values redacted; ${environment.preservedNames.length} ambient override(s) preserved; ` +
        `${environment.ignoredNames.length} unselected key(s) not materialized)`,
    );
  } else if (environment.status === "missing") {
    console.log(`release-e2e: no local credential file at ${environment.filePath}; using ambient environment only`);
  }
  if (profile) {
    const callback = profile.publicCloudWorkerBaseUrl ? "public" : "none";
    console.log(
      `release-e2e: profile=${profile.profile} worktree=${profile.worktreePath} db=${profile.databaseMode} ` +
        `singleOrg=${profile.singleOrgMode} callback=${callback} candidate=${profile.candidateGitHead.slice(0, 12)} ` +
        `build=${profile.candidateBuildIdentity.slice(0, 19)}… ` +
        `(${profile.appliedNames.length} profile default(s) derived; ${profile.preservedNames.length} ambient override(s))`,
    );
  }
}

function printDryRunPlan(
  args: import("./args.js").CliArgs,
  scenarios: ReturnType<typeof selectScenarios>,
  neededEnv: ReturnType<typeof resolveEnv>,
  localServiceChecks: readonly LocalServiceCheck[],
  profileSelected: boolean,
  sandboxCallbackIssue: string | undefined,
): void {
  const agents = args.agents === "all" ? ["all"] : args.agents;
  let cellCount = 0;
  console.log("\nDry-run plan (diagnostic only):");
  for (const scenario of scenarios) {
    for (const runtimeLane of scenario.lanes) {
      cellCount += 1;
      const runtimeRequired = scenarioRequiredEnvForRuntimeLane(scenario, runtimeLane);
      const required = requiredEnvForTargetLane(runtimeRequired, args.lane);
      const preflightRequired = new Set(required);
      if (args.lane === "local" && scenarioUsesDurableIdentity(runtimeRequired)) {
        preflightRequired.add("RELEASE_E2E_SERVER_URL");
      }
      if (
        args.lane === "local" &&
        (runtimeRequired.includes("RELEASE_E2E_GATEWAY_TEST_KEY") ||
          runtimeRequired.includes("RELEASE_E2E_GATEWAY_BASE_URL"))
      ) {
        preflightRequired.add("RELEASE_E2E_LOCAL_RUNTIME_URL");
      }
      const missing = missingRequiredForLane(required, runtimeLane, neededEnv, new Set());
      if (
        args.lane === "staging" &&
        scenarioUsesDurableIdentity(runtimeRequired) &&
        !stagingSessionAvailable()
      ) {
        missing.push("RELEASE_E2E_STAGING_SESSION_REFRESH_TOKEN");
      }
      // The built-in first-run identity is deliberately local-runtime-only.
      // A fresh profile user cannot stand in for the persistent, publicly
      // reachable identity a sandbox cell needs. Mirror the live resolver
      // here so --dry-run never advertises a sandbox cell as satisfiable by a
      // seed that the real run will reject.
      const autoSeed = args.lane === "local" && runtimeLane === "local"
        ? missing.filter((name) => LOCAL_AUTO_SEED_NAMES.has(name))
        : [];
      const unresolved = missing.filter((name) => !autoSeed.includes(name));
      const unreachable = localServiceChecks
        .filter((check) => !check.ready && preflightRequired.has(check.name))
        .map((check) => check.name);
      const structuralBlock = dryRunStructuralBlock(args, scenario.id, runtimeLane);
      const callbackBlock = runtimeLane === "sandbox" && scenarioNeedsPublicCallback(scenario)
        ? sandboxCallbackIssue
        : undefined;
      const relevantChecks = localServiceChecks.filter((check) => preflightRequired.has(check.name));
      const reachability = args.lane === "staging"
        ? "remote reachability not checked by dry-run"
        : relevantChecks.length > 0
          ? "required local endpoints passed preflight"
          : profileSelected
            ? "no network service required by this cell"
            : "reachability not checked (no profile endpoint required/provided)";
      const readinessParts = [
        unresolved.length > 0 ? `unsatisfied ${unresolved.join(", ")}` : undefined,
        autoSeed.length > 0 ? `would attempt unverified local auto-seed: ${autoSeed.join(", ")}` : undefined,
        unreachable.length > 0 ? `unreachable ${unreachable.join(", ")}` : undefined,
        structuralBlock,
        callbackBlock,
        reachability,
      ].filter((part): part is string => part !== undefined);
      const readiness = readinessParts.join("; ");
      console.log(`  [PLAN] ${scenario.id}/${runtimeLane} target=${args.lane} — ${readiness}`);
      for (const [index, step] of scenario
        .plan({ runtimeLane, desktop: args.desktop, agents })
        .entries()) {
        console.log(`    ${index + 1}. ${step.description}`);
      }
    }
  }
  console.log(
    `\nDRY RUN ONLY: planned ${cellCount} scenario cell(s); validated 0. ` +
      "No provider, model, billing, provisioning, browser, updater, or product flow was executed.",
  );
}

const LOCAL_AUTO_SEED_NAMES = new Set([
  "RELEASE_E2E_DURABLE_USER_EMAIL",
  "RELEASE_E2E_DURABLE_USER_PASSWORD",
  "RELEASE_E2E_DURABLE_ORG_ID",
]);

function dryRunStructuralBlock(
  args: import("./args.js").CliArgs,
  scenarioId: string,
  runtimeLane: RuntimeLane,
): string | undefined {
  if (args.lane === "staging" && runtimeLane === "local") {
    return "structurally blocked: staging has no paired local runtime";
  }
  if (scenarioId === "T4-CLOUD-1" && args.lane !== "staging") {
    return "structurally blocked: cloud update requires the staging target";
  }
  if (scenarioId === "T4-DESKTOP-1" && (process.platform !== "darwin" || process.arch !== "arm64")) {
    return `structurally blocked: desktop update requires darwin/arm64 (host ${process.platform}/${process.arch})`;
  }
  return undefined;
}

function printLocalServiceChecks(checks: readonly LocalServiceCheck[]): void {
  if (checks.length === 0) {
    return;
  }
  console.log("\nProfile service preflight:");
  for (const check of checks) {
    const detail = check.detail ? ` — ${check.detail}` : "";
    console.log(`  [${check.ready ? "ready" : "UNREACHABLE"}] ${check.name} -> ${check.target}${detail}`);
  }
}

type SelectedScenario = ReturnType<typeof selectScenarios>[number];

function scenarioRequiredEnvForRuntimeLane(
  scenario: SelectedScenario,
  runtimeLane: RuntimeLane,
): string[] {
  return [...new Set([...scenario.requiredEnv, ...(scenario.requiredEnvByLane?.[runtimeLane] ?? [])])];
}

function allScenarioRequiredEnv(scenario: SelectedScenario): string[] {
  return [
    ...scenario.requiredEnv,
    ...Object.values(scenario.requiredEnvByLane ?? {}).flat(),
  ];
}

/**
 * Credential-file least privilege: materialize every selected scenario's
 * declared dependencies, all non-secret runner controls, and the small set of
 * secret alternatives whose availability is represented by a state file or a
 * bootstrap token rather than a hard requiredEnv entry.
 */
function environmentFileNamesForSelection(
  scenarios: ReturnType<typeof selectScenarios>,
  targetLane: import("../config/types.js").TargetLane,
): ReadonlySet<string> {
  const names = new Set<string>([RELEASE_POLICY_ENV]);
  for (const spec of ENV_MANIFEST) {
    if (!spec.secret) {
      names.add(spec.name);
    }
  }
  for (const scenario of scenarios) {
    for (const name of allScenarioRequiredEnv(scenario)) {
      names.add(name);
    }
  }
  const selectedIds = new Set(scenarios.map((scenario) => scenario.id));
  if (scenarios.some((scenario) => scenarioUsesDurableIdentity(allScenarioRequiredEnv(scenario)))) {
    if (targetLane === "local") {
      // The local runner authenticates (or first-run claims) this identity
      // even when a scenario body only consumes its email for a DB
      // reconciliation seam, so the password is an orchestration dependency.
      names.add("RELEASE_E2E_DURABLE_USER_PASSWORD");
    } else {
      names.add("RELEASE_E2E_STAGING_SESSION_REFRESH_TOKEN");
    }
  }
  if (["T3-PROV-1", "T3-REPO-1", "T3-SEC-MAT-1"].some((id) => selectedIds.has(id))) {
    names.add("RELEASE_E2E_GITHUB_APP_SEED_REFRESH_TOKEN");
  }
  if (["T3-WT-1", "T3-PROV-1", "T3-REPO-1", "T3-SEC-MAT-1"].some((id) => selectedIds.has(id))) {
    names.add("RELEASE_E2E_GITHUB_TEST_TOKEN");
  }
  return names;
}

function configureLocalSandboxCallback(
  args: import("./args.js").CliArgs,
  scenarios: ReturnType<typeof selectScenarios>,
  profile: LocalProfileLoadResult | undefined,
  ambientEnvironmentNames: ReadonlySet<string>,
): string | undefined {
  if (
    args.lane !== "local" ||
    !scenarios.some((scenario) => scenario.lanes.includes("sandbox") && scenarioNeedsPublicCallback(scenario))
  ) {
    return undefined;
  }

  if (!ambientEnvironmentNames.has("RELEASE_E2E_SERVER_URL") && profile?.publicCloudWorkerBaseUrl) {
    process.env.RELEASE_E2E_SERVER_URL = profile.publicCloudWorkerBaseUrl;
    console.log(
      `release-e2e: sandbox cells use profile ${profile.profile}'s public Cloud worker callback URL`,
    );
  }
  const serverUrl = nonEmpty(process.env.RELEASE_E2E_SERVER_URL);
  if (serverUrl && isPublicHttpUrl(serverUrl)) {
    return undefined;
  }
  const profileHint = profile
    ? `Restart with make run PROFILE=${profile.profile} RELEASE_E2E=1 CLOUD_WORKER_TUNNEL=ngrok.`
    : "Provide a publicly reachable RELEASE_E2E_SERVER_URL.";
  return (
    "Local sandbox cells require a non-loopback public API callback so E2B can deliver provider events; " +
    `${serverUrl ? `got ${serverUrl}. ` : "none was configured. "}${profileHint}`
  );
}

function scenarioNeedsPublicCallback(scenario: SelectedScenario): boolean {
  const required = scenarioRequiredEnvForRuntimeLane(scenario, "sandbox");
  return (
    required.includes("RELEASE_E2E_SERVER_URL") ||
    required.includes("RELEASE_E2E_E2B_API_KEY")
  );
}

function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
    const loopback =
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "::1" ||
      hostname === "::" ||
      hostname === "0.0.0.0" ||
      hostname.startsWith("127.");
    return (url.protocol === "https:" || url.protocol === "http:") && !loopback;
  } catch {
    return false;
  }
}

function countRuns(scenarios: ReturnType<typeof selectScenarios>): number {
  return scenarios.reduce((total, scenario) => total + scenario.lanes.length, 0);
}

function formatSelector(selector: string[] | "all"): string {
  return selector === "all" ? "all" : selector.join(",");
}

try {
  await main();
} catch (error) {
  if (error instanceof ReleaseEnvironmentFileError || error instanceof LocalProfileConfigurationError) {
    console.error(`release-e2e configuration error: ${error.message}`);
    process.exitCode = 2;
  } else {
    throw error;
  }
}
