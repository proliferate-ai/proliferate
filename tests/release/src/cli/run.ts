import { runReleaseCommand } from "./command.js";
import { resolveEnv } from "../config/env-resolution.js";
import { envVarNames, DEFAULT_LOCAL_RUNTIME_URL } from "../config/env-manifest.js";
import { pushGatewayAuthState } from "../fixtures/agent-auth.js";
import { selectScenarios } from "../scenarios/registry.js";
import {
  DEFAULT_LOCAL_DURABLE_USER_EMAIL,
  DEFAULT_LOCAL_DURABLE_USER_PASSWORD,
  ensureLocalDurableUser,
} from "../fixtures/identity.js";
import { fileIssuesForFailures } from "../report/issue-filer.js";
import { resolveRunIdentity } from "../runner/identity.js";
import { executeSelectedCells } from "../runner/execute.js";
import { loadCandidateBuildMap } from "../artifacts/build-map.js";
import { writeReport } from "../evidence/write.js";

/**
 * Thin process adapter: supplies the real side-effect dependencies to
 * `cli/command.ts` (which owns the orchestration and ordering) and converts
 * the returned intended exit into process.exitCode. No runner policy lives
 * here.
 */

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

process.exitCode = await runReleaseCommand(process.argv.slice(2), {
  resolveIdentity: (overrides) => resolveRunIdentity({ overrides }),
  selectScenarios,
  loadBuildMap: loadCandidateBuildMap,
  seedLocalDurableUser,
  pushLocalGatewayAuth,
  printEnvManifestReport,
  execute: executeSelectedCells,
  write: writeReport,
  fileIssues: fileIssuesForFailures,
  log: (message) => console.log(message),
  error: (message) => console.error(message),
});
