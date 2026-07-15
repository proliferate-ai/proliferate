import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { BoxExec } from "./box-exec.js";

/**
 * The two server-side seeds CLOUD-PROVISION-1 runs on the candidate box through
 * the box-exec seam, each executing the product's OWN store/service functions
 * against the candidate box's Postgres — never a synthetic row, never a faked
 * provider.
 *
 *  - Gap 3 (Core funding): a real `BillingEntitlement(kind="unlimited_cloud")`
 *    for the actor — the spec-sanctioned server-side entitlement seed
 *    ("acceptable FOR THIS PROVISIONING PROOF ONLY, disclosed"). It flips the
 *    actor to unlimited cloud hours (plan=PRO, `has_unlimited_cloud_hours`) so
 *    the compute gate ADMITS provisioning. Real Core-via-Stripe funding is
 *    PR 4 / PR 6 property (PR 2 non-goals exclude billing).
 *  - Gap 4 (GitHub authorization): the 2026-07-09-ruled refresh-seed — refresh a
 *    real GitHub App user refresh token (bot `proliferate-e2e-bot`) and upsert
 *    the exact `github_app_authorizations` row
 *    `complete_github_app_user_authorization_callback` would write, then refresh
 *    the installation cache. The browser code-exchange is deferred to PR 6's
 *    serial lane; the load-bearing installation-token / sandbox-trigger path
 *    stays real. The refresh ROTATES the token, so the caller persists the new
 *    one back to the seed source.
 *
 * Every effect is behind the injected `BoxExec` (and, for gap 4, an injected
 * token refresher), so unit tests exercise the plumbing offline with no real
 * box, GitHub, or DB.
 */

/** A UUID guard so an actor id can be interpolated into a `docker exec -e` value safely. */
const UUID_RE = /^[0-9a-fA-F-]{36}$/;

function assertUuid(value: string, what: string): string {
  if (!UUID_RE.test(value)) {
    throw new Error(`box-seeds: refusing to use a non-UUID ${what} ("${value}").`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Gap 3 — unlimited-cloud entitlement seed
// ---------------------------------------------------------------------------

const ENTITLEMENT_SEED_PY = `import asyncio, json, os
from uuid import UUID
from sqlalchemy import select
from proliferate.db.engine import async_session_factory
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.db.models.billing import BillingEntitlement
from proliferate.constants.billing import UNLIMITED_CLOUD_ENTITLEMENT
from proliferate.utils.time import utcnow

USER_ID = UUID(os.environ["SEED_USER_ID"])

async def main():
    async with async_session_factory() as db:
        subject = await ensure_personal_billing_subject(db, USER_ID)
        existing = (
            await db.execute(
                select(BillingEntitlement).where(
                    BillingEntitlement.billing_subject_id == subject.id,
                    BillingEntitlement.kind == UNLIMITED_CLOUD_ENTITLEMENT,
                    BillingEntitlement.expires_at.is_(None),
                )
            )
        ).scalars().first()
        if existing is None:
            db.add(
                BillingEntitlement(
                    user_id=USER_ID,
                    billing_subject_id=subject.id,
                    kind=UNLIMITED_CLOUD_ENTITLEMENT,
                    effective_at=utcnow(),
                    expires_at=None,
                    note="CLOUD-PROVISION-1 qualification unlimited-cloud entitlement seed",
                )
            )
        await db.commit()
        print(json.dumps({"billing_subject_id": str(subject.id)}))

asyncio.run(main())
`;

export interface EntitlementSeedResult {
  billingSubjectId: string;
}

/**
 * Seeds a real unlimited-cloud `BillingEntitlement` for the actor on the
 * candidate box (idempotent). Returns the billing subject id.
 */
export async function seedUnlimitedCloudEntitlementOnBox(
  box: BoxExec,
  userId: string,
): Promise<EntitlementSeedResult> {
  assertUuid(userId, "actor user id");
  const result = await box.serverPython(ENTITLEMENT_SEED_PY, {
    env: { SEED_USER_ID: userId },
    scriptName: "seed-core-entitlement.py",
  });
  const parsed = parseLastJsonLine(result.stdout);
  const billingSubjectId = typeof parsed.billing_subject_id === "string" ? parsed.billing_subject_id : "";
  if (!billingSubjectId) {
    throw new Error(
      `seedUnlimitedCloudEntitlementOnBox: entitlement seed did not report a billing subject id (stdout: ${result.stdout.trim()}).`,
    );
  }
  return { billingSubjectId };
}

// ---------------------------------------------------------------------------
// Gap 4 — GitHub App user-authorization refresh-seed
// ---------------------------------------------------------------------------

/** The rotated authorization obtained from a real GitHub token refresh (never logged). */
export interface RefreshedGithubAuthorization {
  accessToken: string;
  /** The NEW refresh token GitHub rotated in (null if none returned). */
  refreshToken: string | null;
  /** Absolute seconds-since-epoch the access token expires (or null). */
  expiresAtUnix: number | null;
  refreshTokenExpiresAtUnix: number | null;
  githubLogin: string;
  githubUserId: string;
}

/** Refreshes a GitHub App user refresh token → a fresh user-to-server authorization. */
export interface GithubTokenRefresher {
  refresh(params: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }): Promise<RefreshedGithubAuthorization>;
}

/**
 * Default refresher: the exact GitHub App refresh grant the product uses
 * (`refresh_github_app_user_authorization`), performed directly against GitHub
 * from the runner so the ROTATED refresh token can be persisted cleanly on the
 * host before it is handed to the box. Never logs a token.
 */
export const defaultGithubTokenRefresher: GithubTokenRefresher = {
  async refresh({ clientId, clientSecret, refreshToken }) {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await tokenResponse.json().catch(() => ({}))) as Record<string, unknown>;
    if (!tokenResponse.ok || payload.error || typeof payload.access_token !== "string") {
      throw new Error(
        `githubAuthorization: refresh of the bot refresh token failed (${payload.error ?? tokenResponse.status}). ` +
          "The device-flow bootstrap may need re-running for proliferate-e2e-bot.",
      );
    }
    const accessToken = payload.access_token;
    const profileResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(15_000),
    });
    const profile = (await profileResponse.json().catch(() => ({}))) as Record<string, unknown>;
    if (!profileResponse.ok || (typeof profile.id !== "number" && typeof profile.id !== "string") || typeof profile.login !== "string") {
      throw new Error("githubAuthorization: could not resolve the refreshed bot's GitHub profile.");
    }
    const nowUnix = Math.floor(Date.now() / 1000);
    const seconds = (key: string): number | null =>
      typeof payload[key] === "number" ? nowUnix + (payload[key] as number) : null;
    return {
      accessToken,
      refreshToken: typeof payload.refresh_token === "string" && payload.refresh_token.trim() ? payload.refresh_token : null,
      expiresAtUnix: seconds("expires_in"),
      refreshTokenExpiresAtUnix: seconds("refresh_token_expires_in"),
      githubLogin: profile.login,
      githubUserId: String(profile.id),
    };
  },
};

const GITHUB_UPSERT_PY = `import asyncio, json, os
from datetime import datetime, timezone
from uuid import UUID
from proliferate.db.engine import async_session_factory
from proliferate.db.store import github_app as github_app_store
from proliferate.integrations.github.app_user_tokens import GitHubAppUserAuthorization
from proliferate.server.cloud.github_app.service import refresh_github_app_installation_cache
from proliferate.server.cloud.cloud_sandboxes.service import ensure_personal_cloud_sandbox_exists
from proliferate.server.cloud.materialization.service import materialize_sandbox

payload = json.load(open(os.environ["AUTH_FILE"]))

def _dt(ts):
    return datetime.fromtimestamp(ts, tz=timezone.utc) if ts else None

authorization = GitHubAppUserAuthorization(
    access_token=payload["access_token"],
    refresh_token=payload.get("refresh_token"),
    expires_at=_dt(payload.get("expires_at_unix")),
    refresh_token_expires_at=_dt(payload.get("refresh_token_expires_at_unix")),
    github_user_id=str(payload["github_user_id"]),
    github_login=payload["github_login"],
    permissions={},
)

async def main():
    user_id = UUID(payload["user_id"])
    async with async_session_factory() as db:
        await github_app_store.upsert_github_app_authorization(
            db, user_id=user_id, authorization=authorization
        )
        await db.commit()
        await refresh_github_app_installation_cache(db)
        await db.commit()
        # Mirror the FULL production callback tail
        # (complete_github_app_user_authorization_callback): it also ensures the
        # personal cloud-sandbox row and schedules sandbox materialization. The
        # scheduler variant spawns a background task that would die with this
        # one-shot script process, so run the real materializer to completion —
        # this is the call that actually creates the E2B provider sandbox.
        await ensure_personal_cloud_sandbox_exists(db, user_id=user_id)
        await db.commit()
        await materialize_sandbox(db, user_id=user_id)
        await db.commit()
    print(json.dumps({"github_login": authorization.github_login, "github_user_id": authorization.github_user_id}))

asyncio.run(main())
`;

export interface GithubAuthorizationSeedResult {
  githubLogin: string;
  githubUserId: string;
  /** True when GitHub rotated a new refresh token that the caller persisted. */
  refreshTokenRotated: boolean;
}

export interface SeedGithubAuthorizationOptions {
  box: BoxExec;
  /** The actor whose product user the authorization row is planted for. */
  userId: string;
  clientId: string;
  clientSecret: string;
  /** The current bot refresh token (from the seed file / env). */
  refreshToken: string;
  /**
   * Persists the ROTATED refresh token (+ resolved identity) back to the seed
   * source. Called with the new token BEFORE the box upsert, so a crash after
   * rotation never strands the only valid token.
   */
  persistRotatedRefreshToken(next: {
    refreshToken: string;
    githubLogin: string;
    githubUserId: string;
  }): Promise<void>;
  refresher?: GithubTokenRefresher;
}

/**
 * Clears the GitHub authorization boundary for the automated lane by seeding the
 * real authorization on the box (refresh → upsert). Persists the rotated refresh
 * token back to the seed source. Returns the resolved bot identity so the
 * caller can assert it is `proliferate-e2e-bot`.
 */
export async function seedGithubAuthorizationOnBox(
  options: SeedGithubAuthorizationOptions,
): Promise<GithubAuthorizationSeedResult> {
  assertUuid(options.userId, "actor user id");
  const refresher = options.refresher ?? defaultGithubTokenRefresher;
  const authorization = await refresher.refresh({
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    refreshToken: options.refreshToken,
  });

  // Persist the rotated refresh token FIRST (it is now the only valid one).
  if (authorization.refreshToken) {
    await options.persistRotatedRefreshToken({
      refreshToken: authorization.refreshToken,
      githubLogin: authorization.githubLogin,
      githubUserId: authorization.githubUserId,
    });
  }

  const authFileContents = JSON.stringify({
    user_id: options.userId,
    access_token: authorization.accessToken,
    refresh_token: authorization.refreshToken,
    expires_at_unix: authorization.expiresAtUnix,
    refresh_token_expires_at_unix: authorization.refreshTokenExpiresAtUnix,
    github_login: authorization.githubLogin,
    github_user_id: authorization.githubUserId,
  });
  const authFilePath = await options.box.putSecretFile("github-user-auth.json", authFileContents);
  try {
    const result = await options.box.serverPython(GITHUB_UPSERT_PY, {
      env: { AUTH_FILE: authFilePath },
      scriptName: "seed-github-authorization.py",
    });
    const parsed = parseLastJsonLine(result.stdout);
    if (parsed.github_login !== authorization.githubLogin) {
      throw new Error(
        `seedGithubAuthorizationOnBox: on-box upsert did not confirm the seeded login (stdout: ${result.stdout.trim()}).`,
      );
    }
  } finally {
    await options.box.removeRemoteFile(authFilePath);
  }

  return {
    githubLogin: authorization.githubLogin,
    githubUserId: authorization.githubUserId,
    refreshTokenRotated: authorization.refreshToken !== null,
  };
}

// ---------------------------------------------------------------------------
// Seed-source persistence (host seed file)
// ---------------------------------------------------------------------------

/**
 * Atomically rewrites the local bot seed JSON with the rotated refresh token,
 * preserving the source/bootstrap metadata shape `github_app_seed.py` uses.
 * Mode 0600. Never logs the token.
 */
export async function persistRotatedBotSeed(
  seedFilePath: string,
  next: { refreshToken: string; githubLogin: string; githubUserId: string },
): Promise<void> {
  await mkdir(path.dirname(seedFilePath), { recursive: true });
  const body = {
    refresh_token: next.refreshToken,
    github_login: next.githubLogin,
    github_user_id: next.githubUserId,
    source: "cloud-provision-1 refresh-seed (rotated)",
    rotated_at: new Date().toISOString(),
  };
  const tmp = `${seedFilePath}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(body), { mode: 0o600 });
  await rename(tmp, seedFilePath);
}

/** Parses the last `{...}` line of a script's stdout (reused by other box-exec callers, e.g. cloud-provision-1.ts). */
export function parseLastJsonLine(stdout: string): Record<string, unknown> {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"));
  const last = lines[lines.length - 1];
  if (!last) {
    return {};
  }
  try {
    return JSON.parse(last) as Record<string, unknown>;
  } catch {
    return {};
  }
}
