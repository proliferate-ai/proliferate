/**
 * Run and shard identity creation.
 *
 * Identity is created once, before any provider mutation. Execution host and
 * origin are detected from the environment (GitHub Actions vs local) for
 * traceability — they are never supplied as product configuration. A one-shard
 * local run still carries an explicit `shard-1-of-1` identity so its output
 * aggregates exactly like CI.
 *
 * Implements the frozen contracts/identity.ts types.
 */

import { hostname as osHostname } from "node:os";

import type { ExecutionHost, RunIdentity, ShardIdentity } from "../contracts/identity.js";

export interface OriginInfo {
  readonly executionHost: ExecutionHost;
  readonly origin: string;
}

/** Detects execution host + traceable origin from the environment. */
export function detectOrigin(
  env: NodeJS.ProcessEnv = process.env,
  hostname: string = osHostname(),
): OriginInfo {
  const isActions = env.GITHUB_ACTIONS === "true" || env.GITHUB_ACTIONS === "1";
  if (isActions) {
    const server = trimTrailingSlash(env.GITHUB_SERVER_URL ?? "https://github.com");
    const repo = env.GITHUB_REPOSITORY ?? "unknown/unknown";
    const runIdEnv = env.GITHUB_RUN_ID ?? "unknown";
    const attempt = env.GITHUB_RUN_ATTEMPT ?? "1";
    return {
      executionHost: "github-actions",
      origin: `${server}/${repo}/actions/runs/${runIdEnv}/attempts/${attempt}`,
    };
  }
  return { executionHost: "local", origin: `local:${hostname}` };
}

export interface CreateRunIdentityInput {
  readonly sourceSha: string;
  readonly candidateManifestHash: string;
  readonly retainedManifestHash: string | null;
  readonly env?: NodeJS.ProcessEnv;
  readonly hostname?: string;
  /** Injectable clock. */
  readonly now?: () => Date;
  /**
   * Injectable local-run nonce so a laptop invocation gets a unique runId while
   * remaining deterministic under test. Ignored on GitHub Actions, whose runId
   * derives deterministically from the workflow run + attempt.
   */
  readonly localNonce?: string;
}

export function createRunIdentity(input: CreateRunIdentityInput): RunIdentity {
  const env = input.env ?? process.env;
  const hostname = input.hostname ?? osHostname();
  const now = (input.now ?? (() => new Date()))();
  const { executionHost, origin } = detectOrigin(env, hostname);

  const runId =
    executionHost === "github-actions"
      ? `gh-${env.GITHUB_RUN_ID ?? "unknown"}-${env.GITHUB_RUN_ATTEMPT ?? "1"}`
      : `local-${input.sourceSha.slice(0, 12)}-${input.localNonce ?? defaultNonce(now)}`;

  return {
    runId,
    sourceSha: input.sourceSha,
    candidateManifestHash: input.candidateManifestHash,
    retainedManifestHash: input.retainedManifestHash,
    executionHost,
    origin,
    createdAt: now.toISOString(),
  };
}

export interface CreateShardIdentityInput {
  readonly runId: string;
  /** 1-based shard index. */
  readonly shardIndex: number;
  readonly shardCount: number;
}

export function createShardIdentity(input: CreateShardIdentityInput): ShardIdentity {
  const { runId, shardIndex, shardCount } = input;
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error(`shardCount must be a positive integer, got ${shardCount}`);
  }
  if (!Number.isInteger(shardIndex) || shardIndex < 1 || shardIndex > shardCount) {
    throw new Error(`shardIndex must be in 1..${shardCount}, got ${shardIndex}`);
  }
  return {
    runId,
    shardId: `shard-${shardIndex}-of-${shardCount}`,
    shardIndex,
    shardCount,
  };
}

/**
 * Parses a `--shard i/n` flag into a 1-based index and count.
 */
export function parseShardFlag(value: string): { shardIndex: number; shardCount: number } {
  const match = /^(\d+)\/(\d+)$/.exec(value.trim());
  if (!match) {
    throw new Error(`--shard must be "i/n" (1-based), got "${value}"`);
  }
  const shardIndex = Number(match[1]);
  const shardCount = Number(match[2]);
  if (shardIndex < 1 || shardCount < 1 || shardIndex > shardCount) {
    throw new Error(`--shard i/n requires 1 <= i <= n, got "${value}"`);
  }
  return { shardIndex, shardCount };
}

function defaultNonce(now: Date): string {
  return `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
