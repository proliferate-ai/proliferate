import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";

/**
 * Run identity per specs/developing/testing/qualification-runner-core.md
 * ("Run identity"). Resolved exactly once, before selection executes; every
 * invocation — local or GitHub Actions — carries the same shape so local and
 * parallel CI reports look alike.
 */
export interface RunIdentityV1 {
  run_id: string;
  shard_id: string;
  attempt: number;
  source_sha: string;
  origin: {
    kind: "local" | "github_actions";
    github_run_id: string | null;
    github_job: string | null;
  };
}

/** Explicit CLI overrides. They win over derived values without changing the recorded origin. */
export interface IdentityOverrides {
  runId?: string;
  shardId?: string;
  attempt?: number;
}

/** Invalid or incomplete identity: the runner exits 2 before selection executes. */
export class IdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityError";
  }
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;

export function isSafeId(value: string): boolean {
  return SAFE_ID_PATTERN.test(value);
}

export interface ResolveIdentityOptions {
  overrides?: IdentityOverrides;
  env?: NodeJS.ProcessEnv;
  /** Injectable for tests; defaults to `git rev-parse HEAD`. */
  resolveGitHead?: () => Promise<string>;
  /** Injectable for tests; defaults to wall-clock now. */
  now?: () => Date;
}

/**
 * Derives the run identity. GitHub Actions identity applies only when
 * `GITHUB_ACTIONS === "true"`; an unrelated `GITHUB_*` variable does not flip
 * the origin. In GitHub Actions each of run/shard/attempt falls back to
 * `GITHUB_RUN_ID` / `GITHUB_JOB` / `GITHUB_RUN_ATTEMPT` when not explicitly
 * overridden (the run id deliberately excludes the run attempt so retries
 * preserve the logical run), and `GITHUB_SHA` must be a full commit SHA.
 * Locally the defaults are a generated `local-<timestamp>-<suffix>` run id,
 * shard `local-0`, attempt `1`, and `git rev-parse HEAD`.
 */
export async function resolveRunIdentity(options: ResolveIdentityOptions = {}): Promise<RunIdentityV1> {
  const env = options.env ?? process.env;
  const overrides = options.overrides ?? {};
  const isGitHub = env.GITHUB_ACTIONS === "true";

  validateOverrides(overrides);

  if (isGitHub) {
    // Provenance is required regardless of overrides: an explicit --run-id /
    // --shard-id / --attempt changes the logical identity but may not erase
    // or bypass the real GitHub context recorded in `origin`.
    const githubRunId = requireGitHubEnv(env, "GITHUB_RUN_ID", "run id");
    const githubJob = requireGitHubEnv(env, "GITHUB_JOB", "shard id");
    const githubAttempt = parseGitHubAttempt(env);
    const runId = overrides.runId ?? githubRunId;
    const shardId = overrides.shardId ?? githubJob;
    const attempt = overrides.attempt ?? githubAttempt;
    const sourceSha = requireGitHubEnv(env, "GITHUB_SHA", "source SHA");
    if (!FULL_SHA_PATTERN.test(sourceSha)) {
      throw new IdentityError(
        `GITHUB_SHA must be a full 40-hex commit SHA in GitHub Actions, got "${sourceSha}".`,
      );
    }
    return validated({
      run_id: runId,
      shard_id: shardId,
      attempt,
      source_sha: sourceSha,
      origin: {
        kind: "github_actions",
        github_run_id: githubRunId,
        github_job: githubJob,
      },
    });
  }

  const resolveGitHead = options.resolveGitHead ?? defaultResolveGitHead;
  let sourceSha: string;
  try {
    sourceSha = (await resolveGitHead()).trim();
  } catch (error) {
    throw new IdentityError(
      `Could not resolve the local source SHA via git rev-parse HEAD: ${describe(error)}`,
    );
  }
  if (!FULL_SHA_PATTERN.test(sourceSha)) {
    throw new IdentityError(`Local source SHA must be a full 40-hex commit SHA, got "${sourceSha}".`);
  }
  const now = options.now ?? (() => new Date());
  return validated({
    run_id: overrides.runId ?? generateLocalRunId(now()),
    shard_id: overrides.shardId ?? "local-0",
    attempt: overrides.attempt ?? 1,
    source_sha: sourceSha,
    origin: { kind: "local", github_run_id: null, github_job: null },
  });
}

function validateOverrides(overrides: IdentityOverrides): void {
  if (overrides.runId !== undefined && !isSafeId(overrides.runId)) {
    throw new IdentityError(`--run-id must match ${SAFE_ID_PATTERN}, got "${overrides.runId}".`);
  }
  if (overrides.shardId !== undefined && !isSafeId(overrides.shardId)) {
    throw new IdentityError(`--shard-id must match ${SAFE_ID_PATTERN}, got "${overrides.shardId}".`);
  }
  if (overrides.attempt !== undefined && (!Number.isInteger(overrides.attempt) || overrides.attempt < 1)) {
    throw new IdentityError(`--attempt must be a positive integer, got "${overrides.attempt}".`);
  }
}

function validated(identity: RunIdentityV1): RunIdentityV1 {
  if (!isSafeId(identity.run_id)) {
    throw new IdentityError(`Run id must match ${SAFE_ID_PATTERN}, got "${identity.run_id}".`);
  }
  if (!isSafeId(identity.shard_id)) {
    throw new IdentityError(`Shard id must match ${SAFE_ID_PATTERN}, got "${identity.shard_id}".`);
  }
  if (!Number.isInteger(identity.attempt) || identity.attempt < 1) {
    throw new IdentityError(`Attempt must be a positive integer, got "${identity.attempt}".`);
  }
  return identity;
}

function requireGitHubEnv(env: NodeJS.ProcessEnv, name: string, what: string): string {
  const value = nonEmpty(env[name]);
  if (value === undefined) {
    throw new IdentityError(
      `GITHUB_ACTIONS is "true" but ${name} is missing or empty; cannot derive the ${what}.`,
    );
  }
  return value;
}

function parseGitHubAttempt(env: NodeJS.ProcessEnv): number {
  const raw = requireGitHubEnv(env, "GITHUB_RUN_ATTEMPT", "attempt");
  const attempt = Number(raw);
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new IdentityError(`GITHUB_RUN_ATTEMPT must be a positive integer, got "${raw}".`);
  }
  return attempt;
}

function generateLocalRunId(now: Date): string {
  const timestamp = now
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
  const suffix = randomBytes(3).toString("hex");
  return `local-${timestamp}-${suffix}`;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const execFileAsync = promisify(execFile);

async function defaultResolveGitHead(): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"]);
  return stdout;
}
