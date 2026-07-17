import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  clockNameForRun,
  defaultStripeHttp,
  defaultStripeTestClockTransport,
  type StripeHttp,
  type StripeTestClockTransport,
} from "../fixtures/stripe-test-clock.js";
import {
  countHardCancelTestClocks,
  deactivateHardCancelProductFamilies,
  deleteHardCancelCustomers,
  deleteHardCancelWebhookEndpoints,
} from "../worlds/managed-cloud/hard-cancel-stripe.js";
import {
  cleanupQualificationLiteLlmRun,
  type HardCancelLiteLlmResult,
} from "../worlds/managed-cloud/hard-cancel-litellm.js";
import {
  cleanupHardCancelE2bTemplate,
  killHardCancelE2bSandbox,
  listHardCancelE2bSandboxes,
  listHardCancelE2bTemplates,
  resolveHardCancelE2bTemplateName,
} from "../worlds/managed-cloud/hard-cancel-e2b.js";
import { E2bTemplateBuilder } from "../worlds/managed-cloud/template.js";

const SHARD_ID = "1";
const MAX_TEST_CLOCKS = 100;
const TEMPLATE_RESOLUTION = { timeoutMs: 60_000, intervalMs: 2_000 } as const;
const PROVIDER_ABSENCE = {
  sandboxAbsence: { timeoutMs: 120_000, intervalMs: 2_000 },
  templateAbsence: { timeoutMs: 120_000, intervalMs: 2_000 },
} as const;

export interface ProviderCleanupInputs {
  workflowRunId: string;
  workflowRunAttempt: string;
  cleanupSha: string;
  sourceSupportsLiteLlmAttribution: boolean;
  e2bApiKey: string;
  e2bTeamId: string;
  stripeSecretKey: string;
  litellmBaseUrl: string;
  litellmMasterKey: string;
}

export interface E2bCleanupResult {
  matchedTemplates: number;
  killedSandboxes: number;
}

export interface StripeCleanupResult {
  deletedWebhookEndpoints: number;
  deletedTestClocks: number;
  deletedCustomers: number;
  matchedProductFamilies: number;
  deactivationWrites: number;
}

export interface ProviderCleanupDeps {
  cleanupE2b(runId: string, inputs: ProviderCleanupInputs): Promise<E2bCleanupResult>;
  cleanupStripe(runTag: string, inputs: ProviderCleanupInputs): Promise<StripeCleanupResult>;
  cleanupLiteLlm(runId: string, shardId: string, inputs: ProviderCleanupInputs): Promise<HardCancelLiteLlmResult>;
}

interface DomainResult<Result> {
  status: "reconciled" | "not_needed" | "failed";
  result?: Result;
  reason?: string;
}

export interface ProviderCleanupReport {
  kind: "managed_cloud_provider_hard_cancel_cleanup";
  schema_version: 1;
  workflow_run_id: string;
  workflow_run_attempt: number;
  cleanup_sha: string;
  status: "reconciled" | "not_needed" | "failed";
  runs: Array<{
    run_id: string;
    e2b: DomainResult<E2bCleanupResult>;
    stripe: DomainResult<StripeCleanupResult>;
    litellm: DomainResult<HardCancelLiteLlmResult>;
  }>;
}

function positiveInteger(value: string, label: string): number {
  if (!/^[1-9][0-9]{0,19}$/.test(value)) throw new Error(`${label} is malformed.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} exceeds the safe integer range.`);
  return parsed;
}

function safeRunId(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(value)) {
    throw new Error("managed-cloud run identity is malformed.");
  }
  return value;
}

function safeSha(value: string): string {
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error("cleanup source SHA is malformed.");
  }
  return value;
}

/** The single run identity created by both CP1 and fixture-smoke invocations. */
export function managedCloudProviderRunIdentities(runId: string, attempt: string): string[] {
  const root = safeRunId(`qlc-ci-${positiveInteger(runId, "workflow run id")}-${positiveInteger(attempt, "workflow run attempt")}`);
  return [root];
}

function hasWork(result: E2bCleanupResult | StripeCleanupResult | HardCancelLiteLlmResult): boolean {
  return Object.values(result).some((value) => typeof value === "number" && value > 0);
}

function boundedFailure(error: unknown, secrets: readonly string[]): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) {
    if (secret.length >= 4) message = message.split(secret).join("[REDACTED_PROVIDER_SECRET]");
  }
  return message
    .replace(/\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9_-]+\b/g, "[REDACTED_STRIPE_KEY]")
    .replace(/\b(?:e2b|sk)-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_PROVIDER_SECRET]")
    .slice(0, 400);
}

async function capture<Result>(
  task: () => Promise<Result>,
  didWork: (result: Result) => boolean,
  secrets: readonly string[],
): Promise<DomainResult<Result>> {
  try {
    const result = await task();
    return { status: didWork(result) ? "reconciled" : "not_needed", result };
  } catch (error) {
    return { status: "failed", reason: boundedFailure(error, secrets) };
  }
}

/**
 * Reconciles each provider domain independently so an ambiguous read in one
 * domain never strands positively attributed resources in another.
 */
export async function reapManagedCloudProvidersForWorkflowAttempt(
  inputs: ProviderCleanupInputs,
  deps: ProviderCleanupDeps = DEFAULT_DEPS,
): Promise<ProviderCleanupReport> {
  const workflowRunAttempt = positiveInteger(inputs.workflowRunAttempt, "workflow run attempt");
  const cleanupSha = safeSha(inputs.cleanupSha);
  const runIds = managedCloudProviderRunIdentities(inputs.workflowRunId, inputs.workflowRunAttempt);
  const secrets = [inputs.e2bApiKey, inputs.stripeSecretKey, inputs.litellmMasterKey];
  const runs: ProviderCleanupReport["runs"] = [];
  for (const runId of runIds) {
    const runTag = `${runId}:${SHARD_ID}`;
    const e2b = await capture(() => deps.cleanupE2b(runId, inputs), hasWork, secrets);
    const stripe = await capture(() => deps.cleanupStripe(runTag, inputs), hasWork, secrets);
    const litellm = await capture(async () => {
      if (!inputs.sourceSupportsLiteLlmAttribution) {
        throw new Error(
          "The source candidate did not prove exact LiteLLM run+shard attribution; absence cannot be classified as clean.",
        );
      }
      return deps.cleanupLiteLlm(runId, SHARD_ID, inputs);
    }, hasWork, secrets);
    runs.push({ run_id: runId, e2b, stripe, litellm });
  }
  const statuses = runs.flatMap((run) => [run.e2b.status, run.stripe.status, run.litellm.status]);
  const status = statuses.includes("failed")
    ? "failed"
    : statuses.includes("reconciled") ? "reconciled" : "not_needed";
  return {
    kind: "managed_cloud_provider_hard_cancel_cleanup",
    schema_version: 1,
    workflow_run_id: String(positiveInteger(inputs.workflowRunId, "workflow run id")),
    workflow_run_attempt: workflowRunAttempt,
    cleanup_sha: cleanupSha,
    status,
    runs,
  };
}

async function deleteE2bTemplate(
  templateId: string,
  templateName: string,
  inputs: ProviderCleanupInputs,
): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "hard-cancel-e2b-"));
  const keyPath = path.join(tempDir, "e2b.env");
  try {
    await writeFile(keyPath, `E2B_API_KEY=${inputs.e2bApiKey}\n`, { mode: 0o600 });
    await new E2bTemplateBuilder().deleteTemplate(templateId, {
      teamId: inputs.e2bTeamId,
      templateName,
      secretsEnvFilePath: keyPath,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function cleanupE2bRun(
  runId: string,
  inputs: ProviderCleanupInputs,
): Promise<E2bCleanupResult> {
  if (!inputs.e2bApiKey.trim() || !inputs.e2bTeamId.trim()) {
    throw new Error("Qualification E2B API key and team id are required.");
  }
  const templateName = `proliferate-runtime-qual-${safeRunId(runId)}`;
  const deps = {
    listTemplates: () => listHardCancelE2bTemplates(inputs.e2bApiKey, inputs.e2bTeamId),
    listSandboxes: (templateId: string) => listHardCancelE2bSandboxes(templateId, inputs.e2bApiKey),
    killSandbox: (sandboxId: string) => killHardCancelE2bSandbox(sandboxId, inputs.e2bApiKey),
    deleteTemplate: (templateId: string) => deleteE2bTemplate(templateId, templateName, inputs),
  };
  const match = await resolveHardCancelE2bTemplateName(templateName, deps, TEMPLATE_RESOLUTION);
  if (!match) return { matchedTemplates: 0, killedSandboxes: 0 };
  const cleanup = await cleanupHardCancelE2bTemplate(match.templateId, deps, PROVIDER_ABSENCE);
  return { matchedTemplates: 1, killedSandboxes: cleanup.killedSandboxIds.length };
}

export async function cleanupStripeRun(
  runTag: string,
  inputs: ProviderCleanupInputs,
  http: StripeHttp = defaultStripeHttp,
  transport: StripeTestClockTransport = defaultStripeTestClockTransport,
): Promise<StripeCleanupResult> {
  const secretKey = inputs.stripeSecretKey;
  if (!secretKey.trim()) throw new Error("Stripe test secret key is required.");
  const deletedWebhookEndpoints = await deleteHardCancelWebhookEndpoints({ secretKey, runTag }, http);
  const clockName = clockNameForRun(runTag);
  let deletedTestClocks = 0;
  while (deletedTestClocks < MAX_TEST_CLOCKS) {
    const clock = await transport.findTestClockByName({ secretKey, name: clockName });
    if (!clock) break;
    await transport.deleteClock({ secretKey, testClockId: clock.testClockId });
    deletedTestClocks += 1;
  }
  if (await countHardCancelTestClocks({ secretKey, name: clockName }, http) !== 0) {
    throw new Error("Stripe still reports exact run-owned test clocks after bounded cleanup.");
  }
  const deletedCustomers = await deleteHardCancelCustomers({ secretKey, runTag }, http);
  const products = await deactivateHardCancelProductFamilies({ secretKey, runTag }, http);
  return {
    deletedWebhookEndpoints,
    deletedTestClocks,
    deletedCustomers,
    matchedProductFamilies: products.matched,
    deactivationWrites: products.touched,
  };
}

const DEFAULT_DEPS: ProviderCleanupDeps = {
  cleanupE2b: cleanupE2bRun,
  cleanupStripe: cleanupStripeRun,
  cleanupLiteLlm: (runId, shardId, inputs) => cleanupQualificationLiteLlmRun({
    baseUrl: inputs.litellmBaseUrl,
    masterKey: inputs.litellmMasterKey,
    runId,
    shardId,
  }),
};

function requiredFlag(argv: string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`Missing required ${name} value.`);
  return value;
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv): ProviderCleanupInputs {
  const allowed = new Set([
    "--workflow-run-id",
    "--workflow-run-attempt",
    "--cleanup-sha",
    "--source-supports-litellm-attribution",
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    if (!allowed.has(argv[index] ?? "") || argv[index + 1] === undefined) {
      throw new Error("Managed-cloud provider cleanup received malformed arguments.");
    }
  }
  const contract = requiredFlag(argv, "--source-supports-litellm-attribution");
  if (contract !== "true" && contract !== "false") {
    throw new Error("LiteLLM attribution contract flag must be true or false.");
  }
  return {
    workflowRunId: requiredFlag(argv, "--workflow-run-id"),
    workflowRunAttempt: requiredFlag(argv, "--workflow-run-attempt"),
    cleanupSha: safeSha(requiredFlag(argv, "--cleanup-sha")),
    sourceSupportsLiteLlmAttribution: contract === "true",
    e2bApiKey: env.RELEASE_E2E_E2B_API_KEY ?? "",
    e2bTeamId: env.RELEASE_E2E_E2B_TEAM_ID ?? "",
    stripeSecretKey: env.STRIPE_TEST_SECRET_KEY ?? "",
    litellmBaseUrl: env.AGENT_GATEWAY_LITELLM_BASE_URL ?? "",
    litellmMasterKey: env.AGENT_GATEWAY_LITELLM_MASTER_KEY ?? "",
  };
}

async function main(): Promise<void> {
  const inputs = parseArgs(process.argv.slice(2), process.env);
  const report = await reapManagedCloudProvidersForWorkflowAttempt(inputs);
  console.log(JSON.stringify(report));
  if (report.status === "failed") process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.log(JSON.stringify({
      kind: "managed_cloud_provider_hard_cancel_cleanup",
      schema_version: 1,
      status: "failed",
      reason: boundedFailure(error, [
        process.env.RELEASE_E2E_E2B_API_KEY ?? "",
        process.env.STRIPE_TEST_SECRET_KEY ?? "",
        process.env.AGENT_GATEWAY_LITELLM_MASTER_KEY ?? "",
      ]),
    }));
    process.exitCode = 2;
  });
}
