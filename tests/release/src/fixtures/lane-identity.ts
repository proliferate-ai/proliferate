/**
 * Target-lane-aware durable-user login. `identity.ts`'s `loginDurableUser`
 * only knows password login (the local-lane durable identity); staging's
 * durable user (`proliferate-e2e-bot`) is a real GitHub-OAuth-only account
 * with no password (see `staging-session.ts`'s module docstring), so
 * `--lane staging` scenarios must authenticate through
 * `loginDurableUserOnStaging` instead. This module is the single seam that
 * branches on `ctx.targetLane` so scenarios don't each reimplement the
 * branch -- kept separate from `identity.ts`/`staging-session.ts` to avoid a
 * circular import between the two (staging-session.ts already imports the
 * `AuthSessionResponse` type from identity.ts).
 */

import type { AuthSessionResponse } from "./identity.js";
import { loginDurableUser } from "./identity.js";
import { loginDurableUserOnStaging, stagingSessionAvailable } from "./staging-session.js";
import { ScenarioBlockedError } from "../scenarios/types.js";
import type { TargetLane } from "../config/types.js";

export interface LaneIdentityContext {
  targetLane: TargetLane;
}

/**
 * Reports a clean `ScenarioBlockedError` (not a raw thrown error, not a red
 * failure) when the current `ctx.targetLane`'s durable-identity credential is
 * absent. `requiredEnv` on `ScenarioDefinition` cannot express this itself --
 * it is keyed by `RuntimeLane` (local/sandbox), not `TargetLane`
 * (local/staging), so a var like `RELEASE_E2E_DURABLE_USER_PASSWORD` (only
 * needed by `--lane local`) would otherwise either wrongly block `--lane
 * staging` runs that never use it, or (if simply omitted from `requiredEnv`)
 * surface as an unreported raw throw instead of a blocked run. Call this
 * before `loginDurableUserForLane`.
 */
export function assertDurableIdentityAvailableForLane(scenarioId: string, ctx: LaneIdentityContext): void {
  if (ctx.targetLane === "staging") {
    if (!stagingSessionAvailable()) {
      throw new ScenarioBlockedError(
        `${scenarioId}: no staging durable-user session available -- neither ` +
          "RELEASE_E2E_STAGING_SESSION_REFRESH_TOKEN nor the rotating state file " +
          "(~/.proliferate-local/dev/release-e2e-staging-session.json) is present. Bootstrap one per " +
          "src/fixtures/staging-session.ts's module docstring.",
      );
    }
    return;
  }
  const missing = ["RELEASE_E2E_DURABLE_USER_EMAIL", "RELEASE_E2E_DURABLE_USER_PASSWORD"].filter(
    (name) => !nonEmpty(process.env[name]),
  );
  if (missing.length > 0) {
    throw new ScenarioBlockedError(
      `${scenarioId}: --lane local durable-user credential(s) absent: ${missing.join(", ")}. Either set them ` +
        "directly or run via `make release-e2e` / the CLI's own local-lane self-seed (cli/run.ts).",
    );
  }
}

/**
 * Logs the durable user in against whichever lane `ctx.targetLane` names.
 * Staging: rotates the seeded refresh token (no password, no env creds
 * needed beyond RELEASE_E2E_STAGING_SESSION_REFRESH_TOKEN / the state file).
 * Local: password login via RELEASE_E2E_DURABLE_USER_EMAIL/_PASSWORD.
 * Call `assertDurableIdentityAvailableForLane` first so a missing credential
 * reports blocked instead of throwing a raw error.
 */
export async function loginDurableUserForLane(
  ctx: LaneIdentityContext,
  serverUrl: string,
): Promise<AuthSessionResponse> {
  if (ctx.targetLane === "staging") {
    return loginDurableUserOnStaging(serverUrl);
  }
  return loginDurableUser({
    serverUrl,
    email: process.env.RELEASE_E2E_DURABLE_USER_EMAIL as string,
    password: process.env.RELEASE_E2E_DURABLE_USER_PASSWORD as string,
    organizationId: process.env.RELEASE_E2E_DURABLE_ORG_ID ?? "",
  });
}

function nonEmpty(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}
