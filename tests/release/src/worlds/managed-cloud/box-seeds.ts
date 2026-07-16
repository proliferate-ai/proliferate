import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { BoxExec } from "./box-exec.js";
import type { AwsCliExec } from "./ec2.js";

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
 *
 * MCW-004: neither the local seed file nor a static Actions secret is a
 * durable home for the gap-4 refresh token — GitHub ROTATES it on every use,
 * the local file does not survive an ephemeral Actions runner, and a static
 * Actions secret goes stale after the first run. This module also owns the
 * durable AWS SSM Parameter Store seam (`getBotRefreshTokenFromSsm`,
 * `putBotRefreshTokenToSsm`, `persistRotatedBotSeedDurable`) that resolution
 * and rotation-persistence fall back to when the env token / local file are
 * unavailable. AWS credentials stay ambient (the `aws` CLI), matching the
 * `ec2.ts` precedent; the rotated token is passed to `aws ssm put-parameter`
 * via a mode-0600 `file://` temp file, never argv, so it never appears in a
 * shell-failure error message or a process listing.
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
from proliferate.db.store import repositories as repositories_store
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
        # Configure the covered repo as a CLOUD repo_environment via the
        # product's OWN store function (the same one save_cloud_environment
        # calls), so the sandbox bootstrap preclones it into the sandbox (spec
        # step 7: "materialized BY THE PRODUCT inside the sandbox"). Without a
        # configured cloud repo_environment the materializer preclones nothing,
        # so this is a real prerequisite, not a shortcut around product code.
        repo_owner = payload["repo_owner"]
        repo_name = payload["repo_name"]
        await repositories_store.upsert_cloud_repo_environment(
            db,
            user_id=user_id,
            git_provider="github",
            git_owner=repo_owner,
            git_repo_name=repo_name,
            default_branch=None,
            setup_script="",
            run_command="",
        )
        await db.commit()
        # Mirror the FULL production callback tail
        # (complete_github_app_user_authorization_callback): it also ensures the
        # personal cloud-sandbox row and schedules sandbox materialization. The
        # scheduler variant spawns a background task that would die with this
        # one-shot script process, so run the real materializer to completion —
        # this is the call that actually creates the E2B provider sandbox AND
        # preclones the configured cloud repo_environment above.
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
  /** The covered repo to configure as a cloud repo_environment so the sandbox preclones it (spec step 7). */
  coveredRepoOwner: string;
  coveredRepoName: string;
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
    repo_owner: options.coveredRepoOwner,
    repo_name: options.coveredRepoName,
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

// ---------------------------------------------------------------------------
// MCW-004 — durable AWS SSM Parameter Store seam
// ---------------------------------------------------------------------------

/**
 * Default AWS SSM Parameter Store name for the durable D2 GitHub bot
 * refresh-token seed (SecureString), overridable via
 * `RELEASE_E2E_CLOUD_GITHUB_BOT_SEED_SSM_PARAMETER` (see env-manifest.ts).
 */
export const DEFAULT_BOT_SEED_SSM_PARAMETER = "/proliferate/qualification/github-bot-refresh-token";

/**
 * Where the CURRENT (pre-rotation) refresh token was resolved from — needed
 * by `persistRotatedBotSeedDurable` to decide which durable store(s) the
 * rotated replacement must land in.
 */
export type BotSeedSource = "env" | "file" | "ssm";

const defaultAwsCliExec: AwsCliExec = async (file, args, options) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const { stdout, stderr } = await run(file, [...args], {
    timeout: options?.timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { stdout: stdout.toString(), stderr: stderr.toString() };
};

/** `execFile` failure messages include the full argv; safe here since neither AWS call below puts the token in argv. */
function describeAwsCliError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads the durable bot refresh-token seed from AWS SSM Parameter Store
 * (`aws ssm get-parameter --with-decryption`). Never throws: any failure
 * (missing creds, missing parameter, network) comes back as a bounded,
 * honest `reason` so both the resolution fallback and preflight can report
 * WHY the SSM lane was unavailable instead of treating "not there" as a bug.
 * Never logs the resolved value.
 */
export async function getBotRefreshTokenFromSsm(
  parameterName: string,
  exec: AwsCliExec = defaultAwsCliExec,
  // Explicit region (from RELEASE_E2E_CLOUD_AWS_REGION) — the CI job maps that
  // var, NOT the aws-CLI-native AWS_REGION, so the SSM call must pass --region
  // itself exactly like ec2.ts's resolveImageId does. Omitted → ambient region.
  region?: string,
): Promise<{ refreshToken: string } | { refreshToken: null; reason: string }> {
  try {
    const { stdout } = await exec("aws", [
      "ssm",
      "get-parameter",
      "--name",
      parameterName,
      "--with-decryption",
      ...(region ? ["--region", region] : []),
      "--query",
      "Parameter.Value",
      "--output",
      "text",
    ]);
    const value = stdout.trim();
    if (!value || value === "None") {
      return { refreshToken: null, reason: `SSM parameter "${parameterName}" resolved to an empty value.` };
    }
    return { refreshToken: value };
  } catch (error) {
    return {
      refreshToken: null,
      reason: `SSM get-parameter for "${parameterName}" failed (${describeAwsCliError(error)}).`,
    };
  }
}

/**
 * Writes the ROTATED bot refresh token to AWS SSM Parameter Store
 * (`aws ssm put-parameter --overwrite`, SecureString). The token is written
 * to a mode-0600 temp file first and passed as `--value file://…` — never
 * argv — so it can never appear in a process listing or a shell-failure
 * error message, matching `box-exec.ts`'s "secret VALUES travel as a copied
 * file, never argv" rule. Throws (does not swallow) on failure: per the
 * MCW-004 ruling, "a silently-lost rotated token bricks the seed", so a
 * failed durable write must fail the run loudly.
 */
export async function putBotRefreshTokenToSsm(
  parameterName: string,
  refreshToken: string,
  exec: AwsCliExec = defaultAwsCliExec,
  region?: string,
): Promise<void> {
  const tmp = path.join(tmpdir(), `bot-seed-ssm-${process.pid}-${Date.now()}.tmp`);
  await writeFile(tmp, refreshToken, { mode: 0o600 });
  try {
    await exec("aws", [
      "ssm",
      "put-parameter",
      "--name",
      parameterName,
      "--type",
      "SecureString",
      ...(region ? ["--region", region] : []),
      "--value",
      `file://${tmp}`,
      "--overwrite",
    ]);
  } catch (error) {
    throw new Error(
      `putBotRefreshTokenToSsm: failed to durably persist the rotated GitHub bot refresh token to SSM ` +
        `parameter "${parameterName}" (${describeAwsCliError(error)}). GitHub has already rotated the ` +
        "token server-side — the previous token is now invalid. Treat this run as failed; re-bootstrap " +
        "the seed before retrying.",
    );
  } finally {
    await rm(tmp, { force: true });
  }
}

export interface PersistRotatedBotSeedDurableOptions {
  /** Local seed-file path, written only when NOT running in Actions (an ephemeral runner makes it non-durable there). */
  localSeedFilePath: string;
  /** Where the pre-rotation refresh token was resolved from. */
  source: BotSeedSource;
  /** SSM parameter name, written when the seed came from SSM, or unconditionally in Actions. */
  ssmParameterName: string;
  /** Explicit AWS region for the SSM write (RELEASE_E2E_CLOUD_AWS_REGION); omitted → ambient. */
  region?: string;
  exec?: AwsCliExec;
  /** Defaults to `process.env`; only read for `GITHUB_ACTIONS`. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Durable rotation-write per the MCW-004 ruling: writes the rotated token to
 * whichever of {local seed file, SSM} are actually durable for the current
 * lane —
 *
 *   - local seed file: only when NOT `GITHUB_ACTIONS=true` (the runner
 *     filesystem does not survive past this run, so writing it there would
 *     silently look successful while losing the token);
 *   - SSM: when the pre-rotation token came FROM SSM (so the durable source
 *     must be kept current), OR unconditionally when `GITHUB_ACTIONS=true`
 *     (SSM is the only durable store available to the Actions lane).
 *
 * Collects failures from every attempted write and throws a single loud
 * error naming all of them if any fail — never swallows a failed durable
 * write, because GitHub has already rotated the token server-side by the
 * time this runs, so losing the replacement bricks the seed.
 */
export async function persistRotatedBotSeedDurable(
  options: PersistRotatedBotSeedDurableOptions,
  next: { refreshToken: string; githubLogin: string; githubUserId: string },
): Promise<void> {
  const env = options.env ?? process.env;
  const isActions = env.GITHUB_ACTIONS === "true";
  const exec = options.exec ?? defaultAwsCliExec;
  const failures: string[] = [];

  if (!isActions) {
    try {
      await persistRotatedBotSeed(options.localSeedFilePath, next);
    } catch (error) {
      failures.push(`local seed file (${options.localSeedFilePath}): ${describeAwsCliError(error)}`);
    }
  }

  if (isActions || options.source === "ssm") {
    try {
      await putBotRefreshTokenToSsm(options.ssmParameterName, next.refreshToken, exec, options.region);
    } catch (error) {
      failures.push(describeAwsCliError(error));
    }
  }

  if (failures.length > 0) {
    throw new Error(
      "persistRotatedBotSeedDurable: failed to durably persist the ROTATED GitHub bot refresh token " +
        `(${failures.join("; ")}). GitHub has already rotated the token server-side, invalidating the ` +
        "previous one — this run must be treated as failed and the seed re-bootstrapped before retrying.",
    );
  }
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
