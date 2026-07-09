/**
 * Deliverable-A seam wrapper (tier-3 runner build task, 2026-07-09):
 * plant the OUTCOME of the GitHub App browser authorization dance for a test
 * user — a real user-to-server authorization + the real installation cache —
 * via the server's own service/store functions in-process, then optionally run
 * the real post-callback completion flow (sandbox trigger). NO product change:
 * see tests/release/scripts/github_app_seed.py for the full rationale and the
 * exact callback body it reproduces.
 *
 * `run(...)` is a thin spawn wrapper (mirrors t3-prov-1's runFallbackScript);
 * the pure helpers below (`githubAppSeedAvailable`, `parseSeedOutput`, the
 * error classifiers) carry the logic and are unit-tested in
 * github-app-seed.test.ts.
 */

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";

import { ApiRequestError } from "./http.js";

export type GithubAppSeedCommand = "seed" | "trigger" | "status" | "teardown";

export interface SeedVerifyResult {
  user_token_repo_listing_ok?: boolean;
  accessible_repo_count?: number;
  accessible_repo_sample?: string[];
  user_token_repo_listing_error?: string;
  installations?: Array<{ id: string; login: string; selection: string }>;
  installation_token_minted?: boolean;
  installation_token_mint_status?: number;
  installation_token_error?: string;
}

export interface SeedResult {
  seeded?: {
    github_login: string | null;
    github_user_id: string | null;
    status: string | null;
    token_expires_at: string | null;
  };
  verify?: SeedVerifyResult;
  error: string | null;
}

export interface StatusResult {
  authorized: boolean;
  gate_error: string | null;
  has_personal_sandbox: boolean;
  sandbox_status: string | null;
  error: string | null;
}

export interface TriggerResult extends SeedResult {
  preExistingSandbox?: boolean;
  sandboxKickedOffByTrigger?: boolean;
  sandboxId: string | null;
  status: string | null;
  anyharnessBaseUrl: string | null;
  readyWithinSeconds: number | null;
  agentsProbe: unknown;
}

export interface TeardownResult {
  destroyed?: boolean;
  sandboxId?: string | null;
  error?: string | null;
}

const DEFAULT_SEED_STATE_RELATIVE = ".proliferate-local/dev/release-e2e-github-seed.json";

/** Absolute path of the rotating seed-token state file (env override or default). */
export function seedStatePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.RELEASE_E2E_GITHUB_APP_SEED_STATE?.trim();
  return override && override.length > 0
    ? override
    : path.join(os.homedir(), DEFAULT_SEED_STATE_RELATIVE);
}

/**
 * Real-trigger mode is available only when we can reach the local profile DB
 * in-process (RELEASE_E2E_LOCAL_DATABASE_URL) AND a seed credential exists —
 * either the rotating state file or the bootstrap env var. Otherwise the caller
 * falls back to the older ensure+materialize seam.
 *
 * `fileExists` is injected so this stays a pure function for unit tests.
 */
export function githubAppSeedAvailable(
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (p: string) => boolean = existsSync,
): boolean {
  if (!env.RELEASE_E2E_LOCAL_DATABASE_URL?.trim()) {
    return false;
  }
  const hasBootstrapToken = Boolean(env.RELEASE_E2E_GITHUB_APP_SEED_REFRESH_TOKEN?.trim());
  return hasBootstrapToken || fileExists(seedStatePath(env));
}

/** Parse the script's single-line JSON result from captured stdout. */
export function parseSeedOutput<T>(stdout: string): T {
  const lastLine = stdout.trim().split("\n").pop() ?? "{}";
  return JSON.parse(lastLine) as T;
}

/**
 * FastAPI wraps raised CloudApiError detail as
 * `{"detail": {"code": "...", "message": "..."}}`. These two gate codes are the
 * ones the GitHub App authority chain (repo_authority.py) raises before any
 * repo mutation.
 */
function isCloudErrorCode(error: unknown, code: string): boolean {
  if (!(error instanceof ApiRequestError) || error.status !== 409) {
    return false;
  }
  if (typeof error.body !== "object" || error.body === null) {
    return false;
  }
  const body = error.body as { code?: unknown; detail?: { code?: unknown } };
  return body.code === code || body.detail?.code === code;
}

export function isGithubAppAuthorizationRequiredError(error: unknown): boolean {
  return isCloudErrorCode(error, "github_app_authorization_required");
}

export function isGithubAppInstallationRequiredError(error: unknown): boolean {
  return isCloudErrorCode(error, "github_app_installation_required");
}

export function isGithubAppRepoNotCoveredError(error: unknown): boolean {
  return isCloudErrorCode(error, "github_app_repo_not_covered");
}

interface RunOptions {
  command: GithubAppSeedCommand;
  pollTimeoutSeconds?: number;
}

/**
 * Spawns `uv run python github_app_seed.py <command> <email>` in the server dir
 * with DATABASE_URL pointed at the local profile DB, and returns the parsed
 * JSON result. Requires RELEASE_E2E_LOCAL_DATABASE_URL.
 */
export function runGithubAppSeed<T>(email: string, options: RunOptions): Promise<T> {
  const databaseUrl = process.env.RELEASE_E2E_LOCAL_DATABASE_URL;
  if (!databaseUrl) {
    return Promise.reject(
      new Error(
        "github_app_seed: RELEASE_E2E_LOCAL_DATABASE_URL is required (see src/config/env-manifest.ts).",
      ),
    );
  }
  const scriptPath = path.resolve(import.meta.dirname, "../../scripts/github_app_seed.py");
  const serverDir = path.resolve(import.meta.dirname, "../../../../server");
  const args = [scriptPath, options.command, email];
  if (options.command === "trigger") {
    args.push("--poll-timeout-seconds", String(options.pollTimeoutSeconds ?? 300));
  }

  return new Promise((resolve, reject) => {
    const child = spawn("uv", ["run", "python", ...args], {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`github_app_seed.py (${options.command}) exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        resolve(parseSeedOutput<T>(stdout));
      } catch (error) {
        reject(new Error(`github_app_seed.py (${options.command}) did not print valid JSON: ${stdout}\n${error}`));
      }
    });
  });
}
