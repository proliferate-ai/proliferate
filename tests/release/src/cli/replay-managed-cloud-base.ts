import path from "node:path";
import { fileURLToPath } from "node:url";

import { isSafeId } from "../runner/identity.js";
import {
  defaultBaseWorldReplayDeps,
  replayManagedCloudBaseWorld,
  type BaseWorldReplayInputs,
} from "../worlds/managed-cloud/base-world-replay.js";

function flag(argv: string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`Missing required ${name} value.`);
  return value;
}

export function parseReplayManagedCloudBaseArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): BaseWorldReplayInputs {
  const allowed = new Set(["--run-dir", "--run-id", "--shard-id"]);
  if (argv.length !== 6) {
    throw new Error("Usage: replay-managed-cloud-base --run-dir <path> --run-id <id> --shard-id <id>");
  }
  for (let index = 0; index < argv.length; index += 2) {
    if (!allowed.has(argv[index] ?? "") || argv[index + 1] === undefined) {
      throw new Error("Usage: replay-managed-cloud-base --run-dir <path> --run-id <id> --shard-id <id>");
    }
  }
  const runId = flag(argv, "--run-id");
  const shardId = flag(argv, "--shard-id");
  if (!isSafeId(runId) || !isSafeId(shardId)) {
    throw new Error("run id and shard id must be safe qualification identities.");
  }
  return {
    runDir: path.resolve(flag(argv, "--run-dir")),
    runId,
    shardId,
    // Provider access is intentionally lazy per ledger domain. Missing AWS
    // access must not prevent LiteLLM/process/path cleanup (and vice versa);
    // the selected domain records a failure after all others are attempted.
    region: env.RELEASE_E2E_CLOUD_AWS_REGION?.trim() ?? "",
    hostedZoneId: env.RELEASE_E2E_CLOUD_ROUTE53_ZONE_ID?.trim() ?? "",
    litellmBaseUrl: env.AGENT_GATEWAY_LITELLM_BASE_URL?.trim() ?? "",
    litellmMasterKey: env.AGENT_GATEWAY_LITELLM_MASTER_KEY?.trim() ?? "",
  };
}

function boundedReason(error: unknown, env: NodeJS.ProcessEnv): string {
  let raw = error instanceof Error ? error.message : String(error);
  for (const name of [
    "AGENT_GATEWAY_LITELLM_MASTER_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
  ]) {
    const value = env[name];
    if (value && value.length >= 4) raw = raw.split(value).join(`[REDACTED_${name}]`);
  }
  return raw
    .replace(/\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9_-]+\b/g, "[REDACTED_PROVIDER_KEY]")
    .replace(/\b[A-Za-z0-9+/]{80,}={0,2}\b/g, "[REDACTED_SECRET]")
    .slice(0, 700);
}

async function main(): Promise<void> {
  try {
    const report = await replayManagedCloudBaseWorld(
      parseReplayManagedCloudBaseArgs(process.argv.slice(2)),
      defaultBaseWorldReplayDeps,
    );
    console.log(JSON.stringify(report));
  } catch (error) {
    console.log(JSON.stringify({
      kind: "managed_cloud_base_world_cleanup_replay",
      schema_version: 1,
      status: "failed",
      reason: boundedReason(error, process.env),
    }));
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
