/**
 * Live-run harness for the managed-cloud world foundation + CLOUD-PROVISION-1.
 *
 * Loads local secrets by PARSING the data files (ambient wins), prepares the
 * managed-cloud world, and — if the world reaches readiness — runs the vertical
 * slice against the real product path. Emits a redacted, non-qualifying
 * diagnostic report. This is the "run it locally" path: laptop and CI call the
 * same provisioner/driver; only the secret source differs.
 *
 * Invoke: `pnpm -C tests/release exec tsx src/foundation/worlds/managed-cloud/live-run.ts`
 */

import { randomUUID } from "node:crypto";

import type { CandidateManifest, Slot, TemplateSlot } from "../../contracts/artifacts.js";
import type { CleanupEntry, CleanupLedger, CleanupState } from "../../contracts/cleanup.js";
import type { EvidenceSink } from "../../contracts/evidence.js";
import type { RunIdentity, ShardIdentity } from "../../contracts/identity.js";
import { WorldReadinessError, type WorldContext } from "../../contracts/world.js";
import { loadMergedEnv, applyMergedEnv } from "./env-file.js";
import { envVarNames } from "../../../config/env-manifest.js";
import { resolveManagedCloudConfig, MissingManagedCloudApiUrlError } from "./config.js";
import { ManagedCloudWorldProvisioner } from "./provisioner.js";
import { createLiveDriver, liveGithubAppAuthorityAvailable } from "./live-driver.js";
import { runCloudProvision1, CloudProvisionBlockedError, CloudProvision1FailedError } from "./cloud-provision-1.js";
import { redactSecrets } from "./redaction.js";

/** The product creates cloud sandboxes from this rolling alias today (E2B_TEMPLATE_NAME default). */
const OBSERVED_ROLLING_TEMPLATE_REF = "base";

function inMemoryLedger(): CleanupLedger {
  const rows: CleanupEntry[] = [];
  let seq = 0;
  return {
    register: async (entry) => {
      seq += 1;
      const now = new Date().toISOString();
      rows.push({ ...entry, sequence: seq, state: "registered", attempts: 0, registeredAt: now, updatedAt: now, lastError: null });
      return seq;
    },
    transition: async (sequence: number, state: CleanupState, error?: string) => {
      const idx = rows.findIndex((r) => r.sequence === sequence);
      if (idx >= 0) rows[idx] = { ...rows[idx], state, updatedAt: new Date().toISOString(), lastError: error ?? rows[idx].lastError };
    },
    entries: async () => rows,
  };
}

function consoleEvidenceSink(secrets: readonly (string | undefined)[]): EvidenceSink {
  return {
    append: async (event) => {
      console.log(`[evidence] ${redactSecrets(JSON.stringify(event), { secrets })}`);
    },
    finalize: async (evidence) => {
      console.log(`[evidence:final] ${redactSecrets(JSON.stringify(evidence), { secrets })}`);
    },
  };
}

async function main(): Promise<number> {
  const env = loadMergedEnv();
  // Bridge file-sourced declared credentials into process.env for the existing
  // fixtures + spawned Python subprocesses (ambient still wins; nothing is
  // overwritten). Names only — never log the applied values.
  const applied = applyMergedEnv(env, envVarNames());
  if (applied.length > 0) {
    console.log(`[env] applied ${applied.length} file-sourced declared var(s) to the process environment (names): ${applied.join(", ")}`);
  }

  let config;
  try {
    config = resolveManagedCloudConfig({
      env,
      githubAppAuthorityAvailable: liveGithubAppAuthorityAvailable(process.env),
    });
  } catch (error) {
    if (error instanceof MissingManagedCloudApiUrlError) {
      console.error(`[blocked] ${error.message}`);
      return 2;
    }
    throw error;
  }

  const secretValues = Object.values(config.secrets.byName);
  const evidence = consoleEvidenceSink(secretValues);
  const ledger = inMemoryLedger();

  const run: RunIdentity = {
    runId: `local-${randomUUID()}`,
    sourceSha: process.env.GITHUB_SHA ?? "local-working-tree",
    candidateManifestHash: "local-diagnostic",
    retainedManifestHash: null,
    executionHost: process.env.GITHUB_ACTIONS ? "github-actions" : "local",
    origin: `local:${process.env.USER ?? "unknown"}`,
    createdAt: new Date().toISOString(),
  };
  const shard: ShardIdentity = { runId: run.runId, shardId: "shard-1-of-1", shardIndex: 0, shardCount: 1 };

  // Local diagnostic: no prepare-candidate step, so the template slot is
  // unavailable. The provisioner will attempt to pin the observed rolling ref
  // via the E2B resolver (null locally), which fails readiness honestly.
  const e2bTemplate: Slot<TemplateSlot> = { available: false, reason: "no prepare-candidate step in a local diagnostic run" };
  const candidate = buildDiagnosticCandidate(run.sourceSha, e2bTemplate);
  const ctx: WorldContext = { run, shard, candidate, retained: null, ledger, evidence };

  const provisioner = new ManagedCloudWorldProvisioner(config, {
    observedRollingRef: OBSERVED_ROLLING_TEMPLATE_REF,
  });

  console.log(`[world] preparing managed-cloud against ${safeHost(config.apiUrl)} (github-app authority: ${config.githubAppAuthorityAvailable})`);

  let handle;
  try {
    handle = await provisioner.prepare(ctx);
  } catch (error) {
    if (error instanceof WorldReadinessError) {
      console.error(`[world:not-ready] ${error.message}`);
      for (const obs of error.observations) {
        console.error(`  - ${obs.check}: ${obs.ok ? "OK" : "FAIL"} — ${obs.detail}`);
      }
      console.error(
        "[diagnostic] managed-cloud world did not reach readiness. This is the honest local outcome: a candidate " +
          "E2B template must be built+pinned (prepare-candidate) or the rolling ref resolved via E2B API access, and " +
          "the candidate API must be publicly reachable.",
      );
      return 1;
    }
    throw error;
  }

  console.log(`[world:ready] template=${handle.template.templateId} capabilities=${handle.verifiedCapabilities.join(",")}`);

  const durableEmail = env.get("RELEASE_E2E_DURABLE_USER_EMAIL");
  const durablePassword = env.get("RELEASE_E2E_DURABLE_USER_PASSWORD");
  const durableOrg = env.get("RELEASE_E2E_DURABLE_ORG_ID");
  if (!durableEmail || !durablePassword || !durableOrg) {
    console.error("[blocked] durable-user credentials absent; cannot mint a fresh actor for CLOUD-PROVISION-1.");
    return 2;
  }

  const driver = createLiveDriver({
    apiUrl: config.apiUrl,
    durable: { serverUrl: config.apiUrl, email: durableEmail, password: durablePassword, organizationId: durableOrg },
    repository: config.preparedRepository,
  });

  try {
    const report = await runCloudProvision1({ handle, driver, ledger, evidence, repository: config.preparedRepository, secretValues });
    console.log(`[CLOUD-PROVISION-1] GREEN — every required step passed and cleanup reconciled.`);
    for (const step of report.steps) console.log(`  - ${step.step}: OK`);
    return 0;
  } catch (error) {
    if (error instanceof CloudProvisionBlockedError) {
      console.error(`[CLOUD-PROVISION-1:blocked] ${error.message}`);
      return 2;
    }
    if (error instanceof CloudProvision1FailedError) {
      console.error(`[CLOUD-PROVISION-1:red]`);
      for (const step of error.report.steps) console.error(`  - ${step.step}: ${step.ok ? "OK" : "RED"} — ${step.detail}`);
      return 1;
    }
    throw error;
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

function buildDiagnosticCandidate(sourceSha: string, e2bTemplate: Slot<TemplateSlot>): CandidateManifest {
  const unavailable = { available: false as const, reason: "local diagnostic: not built" };
  return {
    schemaVersion: 1,
    kind: "candidate",
    sourceSha,
    sourceContentHash: "local-diagnostic",
    serverImage: unavailable,
    webBuild: unavailable,
    desktopApp: unavailable,
    desktopUpdater: unavailable,
    anyharness: {},
    worker: {},
    supervisor: {},
    catalogHash: unavailable,
    registryHash: unavailable,
    e2bTemplate,
    selfHostBundle: unavailable,
    litellm: unavailable,
  };
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`[fatal] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exit(1);
  });
