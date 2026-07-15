/**
 * Browser-free session fixture for the staging lane's durable user.
 *
 * The staging durable user (`proliferate-e2e-bot`, email
 * `support@proliferate.com`) exists because of a real one-time GitHub OAuth
 * sign-in against the "Proliferate Staging" OAuth app — confirmed via a
 * read-only staging-DB query (`user` + `auth_identity` + a `provider_grant`
 * row with status=ready) run from an in-VPC one-off ECS task. Because that
 * account is GitHub-OAuth-only it has no password, so `loginDurableUser` in
 * `./identity.ts` (which POSTs `/auth/web/password/login`) cannot
 * authenticate it, and there is no self-serve way to re-run the GitHub OAuth
 * browser dance headlessly.
 *
 * Sessions in this codebase are stateless JWTs, not DB rows
 * (`mint_auth_session`, server/proliferate/auth/identity/sessions.py). The
 * one-time bootstrap (`tests/release/scripts/staging_session_seed.py mint`,
 * run in-process inside a one-off in-VPC ECS task because the staging DB is
 * VPC-only) mints a real session for the already-existing user by calling
 * that exact function — the same one every real login funnels through — and
 * hands back a refresh token. From then on this module rotates that refresh
 * token itself via `POST /auth/mobile/session/refresh`
 * (server/proliferate/auth/identity/api.py): a public, JSON-body,
 * browser-free route that mints a fresh access + refresh token pair from a
 * valid refresh token, with no DB/VPC access needed. Same
 * bootstrap-once-then-self-rotate shape as the GitHub App seed fixture's
 * refresh-token state file (./github-app-seed.ts /
 * ../../scripts/github_app_seed.py) — this module only needs re-bootstrapping
 * if the state file is lost or the user's `token_generation` is bumped
 * (logout-everywhere / password change), which would revoke the refresh
 * token.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AuthSessionResponse } from "./identity.js";
import { ApiClient } from "./http.js";

const DEFAULT_STATE_RELATIVE = ".proliferate-local/dev/release-e2e-staging-session.json";

export interface StagingSessionState {
  refreshToken: string;
  accessToken?: string;
  rotatedAt?: string;
}

/** Absolute path of the rotating staging-session state file (env override or default). */
export function stagingSessionStatePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.RELEASE_E2E_STAGING_SESSION_STATE?.trim();
  return override && override.length > 0 ? override : path.join(os.homedir(), DEFAULT_STATE_RELATIVE);
}

/**
 * Staging-session rotation is available once either the rotating state file
 * exists or a bootstrap refresh token was supplied directly. `fileExists` is
 * injected so this stays a pure function for unit tests.
 */
export function stagingSessionAvailable(
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (p: string) => boolean = existsSync,
): boolean {
  const hasBootstrapToken = Boolean(env.RELEASE_E2E_STAGING_SESSION_REFRESH_TOKEN?.trim());
  return hasBootstrapToken || fileExists(stagingSessionStatePath(env));
}

/** Parses the state file's JSON, tolerating a missing/blank `refreshToken`. */
export function parseStagingSessionState(raw: string): StagingSessionState | undefined {
  const parsed = JSON.parse(raw) as Partial<StagingSessionState>;
  if (typeof parsed.refreshToken !== "string" || parsed.refreshToken.trim().length === 0) {
    return undefined;
  }
  return { ...parsed, refreshToken: parsed.refreshToken.trim() };
}

async function loadRefreshToken(env: NodeJS.ProcessEnv, fileExists: (p: string) => boolean): Promise<string> {
  const statePath = stagingSessionStatePath(env);
  if (fileExists(statePath)) {
    const state = parseStagingSessionState(await readFile(statePath, "utf8"));
    if (state) {
      return state.refreshToken;
    }
  }
  const bootstrap = env.RELEASE_E2E_STAGING_SESSION_REFRESH_TOKEN?.trim();
  if (bootstrap) {
    return bootstrap;
  }
  throw new Error(
    "loginDurableUserOnStaging: no staging session refresh token available: neither " +
      `the state file (${statePath}) nor RELEASE_E2E_STAGING_SESSION_REFRESH_TOKEN is set. ` +
      "Bootstrap one with `uv run python tests/release/scripts/staging_session_seed.py mint " +
      "proliferate-e2e-bot`, run inside a one-off in-VPC ECS task against the proliferate-staging " +
      "cluster (the staging DB is VPC-only) — see the script's module docstring for the exact " +
      "`aws ecs run-task` invocation. This fixture self-rotates the token after that.",
  );
}

/** Atomically rewrites the state file (mode 0600) so a crash mid-write never corrupts it. */
async function persistStagingSessionState(statePath: string, state: StagingSessionState): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true });
  const tmpPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, JSON.stringify(state), { mode: 0o600 });
  await rename(tmpPath, statePath);
}

/**
 * Rotates the durable staging user's session and returns the fresh
 * `AuthSessionResponse` (same shape `loginDurableUser` returns), so scenario
 * code does not need to branch on which durable-login path was used.
 */
export async function loginDurableUserOnStaging(
  serverUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AuthSessionResponse> {
  const refreshToken = await loadRefreshToken(env, existsSync);
  const client = new ApiClient({ baseUrl: serverUrl });
  const response = await client.post<AuthSessionResponse>("/auth/mobile/session/refresh", {
    refreshToken,
  });

  if (!response.refreshToken) {
    throw new Error("loginDurableUserOnStaging: refresh response did not include a new refresh token.");
  }

  await persistStagingSessionState(stagingSessionStatePath(env), {
    refreshToken: response.refreshToken,
    accessToken: response.accessToken,
    rotatedAt: new Date().toISOString(),
  });

  return response;
}
