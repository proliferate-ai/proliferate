import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defaultStripeHttp, type StripeHttp } from "../fixtures/stripe-test-clock.js";
import { webhookEndpointUrl } from "../fixtures/stripe-smoke-resources.js";
import {
  killProviderSandbox,
  listProviderSandboxesByTemplate,
  listProviderTemplates,
  type E2BTemplateInventoryRow,
  type E2BTemplateSweepResult,
} from "../fixtures/e2b-verify.js";
import {
  reconcileWebhookIntentFile,
  WEBHOOK_CUSTODY_DIRNAME,
  WEBHOOK_INTENT_FILENAME,
} from "../scenarios/managed-cloud-fixture-smoke-1.js";
import {
  loadSharedTemplateCustody,
  markSharedTemplateIntentReleasedWithoutAcquire,
  markSharedTemplateReleased,
  sharedTemplateCustodyPath,
  type SharedTemplateCustodyIdentityV1,
} from "../worlds/managed-cloud/shared-template-custody.js";
import {
  cleanupSharedTemplateProviderResources,
  resolveSharedTemplateIntentName,
  type SharedTemplateProviderCleanupDeps,
} from "../worlds/managed-cloud/shared-template-provider-cleanup.js";
import { E2bTemplateBuilder } from "../worlds/managed-cloud/template.js";

export interface ReplayManagedCloudCustodyArgs {
  runDir: string;
  runId: string;
  shardId: string;
}

export interface ReplayManagedCloudCustodyDeps {
  listTemplates(env: NodeJS.ProcessEnv): Promise<E2BTemplateInventoryRow[]>;
  listSandboxes(templateId: string, env: NodeJS.ProcessEnv): Promise<E2BTemplateSweepResult>;
  killSandbox(
    providerSandboxId: string,
    env: NodeJS.ProcessEnv,
  ): Promise<{ killed: boolean; alreadyGone?: boolean }>;
  deleteTemplate(
    templateId: string,
    templateName: string,
    teamId: string,
    apiKey: string,
  ): Promise<void>;
}

const DEFAULT_DEPS: ReplayManagedCloudCustodyDeps = {
  listTemplates: listProviderTemplates,
  listSandboxes: listProviderSandboxesByTemplate,
  killSandbox: killProviderSandbox,
  deleteTemplate: deleteE2bTemplate,
};

const PROVIDER_CLEANUP_POLICY = {
  sandboxAbsence: { timeoutMs: 120_000, intervalMs: 2_000 },
  templateAbsence: { timeoutMs: 120_000, intervalMs: 2_000 },
} as const;
const INTENT_RESOLUTION_WINDOW = { timeoutMs: 60_000, intervalMs: 2_000 } as const;

function requiredFlag(argv: string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing required ${name} value.`);
  }
  return value;
}

function parseArgs(argv: string[]): ReplayManagedCloudCustodyArgs {
  const allowed = new Set(["--run-dir", "--run-id", "--shard-id"]);
  for (let index = 0; index < argv.length; index += 2) {
    if (!allowed.has(argv[index] ?? "") || argv[index + 1] === undefined) {
      throw new Error(
        "Usage: replay-managed-cloud-custody --run-dir <path> --run-id <id> --shard-id <id>",
      );
    }
  }
  return {
    runDir: requiredFlag(argv, "--run-dir"),
    runId: requiredFlag(argv, "--run-id"),
    shardId: requiredFlag(argv, "--shard-id"),
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function deleteE2bTemplate(
  templateId: string,
  templateName: string,
  teamId: string,
  apiKey: string,
): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "managed-template-cleanup-"));
  const keyPath = path.join(tempDir, "e2b.env");
  try {
    await writeFile(keyPath, `E2B_API_KEY=${apiKey}\n`, { mode: 0o600 });
    await new E2bTemplateBuilder().deleteTemplate(templateId, {
      teamId,
      templateName,
      secretsEnvFilePath: keyPath,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function providerCleanupDeps(
  custody: { template_name: string },
  teamId: string,
  apiKey: string,
  env: NodeJS.ProcessEnv,
  deps: ReplayManagedCloudCustodyDeps,
): SharedTemplateProviderCleanupDeps {
  return {
    listTemplates: () => deps.listTemplates(env),
    listSandboxes: (templateId) => deps.listSandboxes(templateId, env),
    killSandbox: (providerSandboxId) => deps.killSandbox(providerSandboxId, env),
    deleteTemplate: (templateId) =>
      deps.deleteTemplate(templateId, custody.template_name, teamId, apiKey),
  };
}

export async function replayManagedCloudCustody(
  args: ReplayManagedCloudCustodyArgs,
  env: NodeJS.ProcessEnv = process.env,
  http: StripeHttp = defaultStripeHttp,
  deps: ReplayManagedCloudCustodyDeps = DEFAULT_DEPS,
): Promise<"not_needed" | "reconciled"> {
  const intentPath = path.join(args.runDir, WEBHOOK_CUSTODY_DIRNAME, WEBHOOK_INTENT_FILENAME);
  let reconciled = false;
  const failures: Error[] = [];
  if (await exists(intentPath)) {
    try {
      // Resolve the expected callback independently from the cleanup journal,
      // so a malformed/tampered journal cannot redirect provider cleanup.
      const sidecarRaw = await readFile(path.join(args.runDir, "cloud-world-subdomain.json"), "utf8");
      const sidecar = JSON.parse(sidecarRaw) as { subdomain?: unknown };
      if (typeof sidecar.subdomain !== "string" || sidecar.subdomain.length === 0) {
        throw new Error("cloud-world-subdomain.json does not contain a non-empty subdomain.");
      }
      const stripeKey = env.STRIPE_TEST_SECRET_KEY;
      if (!stripeKey) {
        throw new Error("STRIPE_TEST_SECRET_KEY is required while webhook cleanup custody remains.");
      }

      await reconcileWebhookIntentFile(
        intentPath,
        `${args.runId}:${args.shardId}`,
        webhookEndpointUrl(sidecar.subdomain),
        stripeKey,
        http,
      );
      reconciled = true;
    } catch (error) {
      failures.push(new Error(`Stripe webhook custody cleanup failed: ${describe(error)}`));
    }
  }

  const templateJournalPath = sharedTemplateCustodyPath(args.runDir);
  if (await exists(templateJournalPath)) {
    try {
      const custody = await loadSharedTemplateCustody(templateJournalPath);
      if (custody.run_id !== args.runId || custody.shard_id !== args.shardId) {
        throw new Error("shared template custody belongs to a different run/shard.");
      }
      if (custody.state === "intent") {
        const apiKey = env.RELEASE_E2E_E2B_API_KEY?.trim();
        const teamId = env.RELEASE_E2E_E2B_TEAM_ID?.trim();
        if (!apiKey || !teamId) {
          throw new Error("E2B API key and team id are required while shared template custody is unreleased.");
        }
        const cleanupDeps = providerCleanupDeps(custody, teamId, apiKey, env, deps);
        const match = await resolveSharedTemplateIntentName(
          custody.template_name,
          cleanupDeps,
          INTENT_RESOLUTION_WINDOW,
        );
        if (match) {
          await cleanupSharedTemplateProviderResources(
            match.templateId,
            cleanupDeps,
            PROVIDER_CLEANUP_POLICY,
          );
        }
        await markSharedTemplateIntentReleasedWithoutAcquire(templateJournalPath, {
          runId: custody.run_id,
          shardId: custody.shard_id,
          sourceSha: custody.source_sha,
          templateName: custody.template_name,
          inputHash: custody.input_hash,
        });
        reconciled = true;
      } else if (custody.state === "acquired") {
        const apiKey = env.RELEASE_E2E_E2B_API_KEY?.trim();
        const teamId = env.RELEASE_E2E_E2B_TEAM_ID?.trim();
        if (!apiKey || !teamId) {
          throw new Error("E2B API key and team id are required while shared template custody is unreleased.");
        }
        await cleanupSharedTemplateProviderResources(
          custody.receipt.templateId,
          providerCleanupDeps(custody, teamId, apiKey, env, deps),
          PROVIDER_CLEANUP_POLICY,
        );
        const identity: SharedTemplateCustodyIdentityV1 = {
          runId: custody.run_id,
          shardId: custody.shard_id,
          sourceSha: custody.source_sha,
          templateName: custody.template_name,
          inputHash: custody.input_hash,
        };
        await markSharedTemplateReleased(templateJournalPath, identity, custody.receipt);
        reconciled = true;
      }
    } catch (error) {
      failures.push(new Error(`E2B template custody cleanup failed: ${describe(error)}`));
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, failures.map((failure) => failure.message).join("; "));
  }
  return reconciled ? "reconciled" : "not_needed";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function boundedCustodyFailure(error: unknown): string {
  return describe(error)
    .replace(/\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9_-]+\b/g, "[REDACTED_STRIPE_KEY]")
    .replace(/\b(?:e2b|ghp|github_pat)_[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_PROVIDER_KEY]")
    .replace(/\b[A-Za-z0-9+/]{80,}={0,2}\b/g, "[REDACTED_SECRET]")
    .slice(0, 500);
}

async function main(): Promise<void> {
  const status = await replayManagedCloudCustody(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify({ kind: "managed_cloud_custody_replay", status }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(`ERROR: ${boundedCustodyFailure(error)}`);
    process.exit(2);
  });
}
