/**
 * T3-FIXTURE (specs/developing/testing/scenarios.md): shared identity fixture
 * so no scenario reimplements auth.
 *
 * Two identities:
 * - fresh user: minted per run, torn down after. Registration in this codebase
 *   only has one self-serve password path today — invitation-gated
 *   registration (single_org_mode; see
 *   server/proliferate/server/organizations/registration_api.py and
 *   server/proliferate/server/organizations/self_registration.py). There is no
 *   plain "create an account from nothing" endpoint, so minting a fresh user
 *   means: the durable (admin) user invites a throwaway email into its own
 *   org, then the fresh user redeems that invitation via
 *   `POST /auth/password/register`.
 * - durable user: one seeded `e2e-tests` account/org on the target server,
 *   logged in via `POST /auth/web/password/login`. Exception: staging's
 *   durable user (proliferate-e2e-bot, confirmed present 2026-07-09) was
 *   created by a real GitHub OAuth sign-in and has no password, so
 *   --lane staging existing-user scenarios authenticate via
 *   `loginDurableUserOnStaging` in `./staging-session.ts` instead of
 *   `loginDurableUser` below.
 *
 * Request/response shapes below mirror the real Pydantic models as of this
 * writing:
 * - PasswordLoginRequest / AuthSessionResponse — server/proliferate/auth/identity/models.py
 * - OrganizationInviteRequest / OrganizationInvitationResponse — server/proliferate/server/organizations/models.py
 * - PasswordRegisterRequest / PasswordRegisterResponse — server/proliferate/server/organizations/registration_api.py
 *
 * Not yet exercised outside --dry-run: no credentials exist for any target
 * deployment yet (see src/config/env-manifest.ts), and this module makes real
 * network calls once invoked for real.
 */

import { randomBytes } from "node:crypto";

import { ApiClient, ApiRequestError } from "./http.js";

/**
 * NOT `proliferate.test` — see the note at `mintFreshUser` below. `.dev` is a
 * real, unreserved gTLD, so the server's email-validator syntax/policy checks
 * pass even though the domain never resolves (deliverability checking is
 * disabled server-side for these flows).
 */
const FIXTURE_EMAIL_DOMAIN = "proliferate-releasee2e.dev";

export interface AuthSessionResponse {
  accessToken: string;
  refreshToken?: string;
  tokenType: "bearer";
  expiresIn: number;
  user: {
    id: string;
    email: string;
    displayName: string | null;
  };
  readiness: unknown;
}

export interface OrganizationInvitationResponse {
  id: string;
  organizationId: string;
  organizationName: string | null;
  email: string;
  role: "owner" | "admin" | "member";
  status: "pending" | "accepted" | "revoked" | "expired";
  deliveryStatus: "sent" | "skipped" | "failed";
  deliveryError: string | null;
  expiresAt: string;
  deliveredAt: string | null;
  acceptedByUserId: string | null;
  acceptedAt: string | null;
}

export interface PasswordRegisterResponse {
  email: string;
  organizationName: string;
}

export interface OrganizationMember {
  membershipId: string;
  email: string;
  role: "owner" | "admin" | "member";
}

export interface DurableUserCredentials {
  serverUrl: string;
  email: string;
  password: string;
  organizationId: string;
}

export interface FreshUserFixture {
  email: string;
  password: string;
  session: AuthSessionResponse;
  organizationId: string;
  /** Removes the fresh user's membership from the inviting org. Best-effort teardown. */
  teardown(): Promise<void>;
}

/**
 * Logs the durable e2e-tests account in via the real password-login route.
 * Used as-is by existing-user scenarios (T3-PROV-2) and as the inviting admin
 * for `mintFreshUser`.
 */
export async function loginDurableUser(creds: DurableUserCredentials): Promise<AuthSessionResponse> {
  const client = new ApiClient({ baseUrl: creds.serverUrl });
  return client.post<AuthSessionResponse>("/auth/web/password/login", {
    email: creds.email,
    password: creds.password,
  });
}

/**
 * Mints a fresh user for new-user scenarios (T3-PROV-1):
 * 1. durable admin invites a throwaway email into its org
 *    (`POST /v1/organizations/{orgId}/invitations`);
 * 2. the fresh user redeems the invitation
 *    (`POST /auth/password/register`, single_org_mode only);
 * 3. the fresh user logs in to get a session
 *    (`POST /auth/web/password/login`).
 */
export async function mintFreshUser(creds: DurableUserCredentials): Promise<FreshUserFixture> {
  const anonymousClient = new ApiClient({ baseUrl: creds.serverUrl });
  const adminSession = await loginDurableUser(creds);
  const adminClient = anonymousClient.withBearerToken(adminSession.accessToken);

  // Math.random() is not appropriate here: the suffix disambiguates concurrent
  // runs and the password is a real (if throwaway) credential sent to the
  // server, so both need a cryptographically secure source.
  //
  // Domain note (found running this fixture for real against a local target,
  // 2026-07-08): the server's email validation (pydantic-core / email-validator)
  // rejects IANA special-use domains (`.test`, `.example`, `.invalid`,
  // `.localhost`) outright, even with deliverability checks disabled — a user
  // created with a `.test` address 500s on every future login because
  // `UserRead` serialization re-validates the stored email. Use a domain that
  // is fake but not in the special-use registry.
  const email = `release-e2e+${Date.now()}-${randomToken(6)}@${FIXTURE_EMAIL_DOMAIN}`;
  const password = `release-e2e-${randomToken(10)}!Aa1`;

  const invitation = await adminClient.post<OrganizationInvitationResponse>(
    `/v1/organizations/${creds.organizationId}/invitations`,
    { email, role: "member" },
  );

  await anonymousClient.post<PasswordRegisterResponse>("/auth/password/register", {
    email,
    password,
    invitationToken: invitation.id,
  });

  const session = await loginDurableUser({ ...creds, email, password });

  return {
    email,
    password,
    session,
    organizationId: creds.organizationId,
    teardown: async () => {
      const member = await findMemberByEmail(adminClient, creds.organizationId, email);
      if (member) {
        await adminClient.delete(`/v1/organizations/${creds.organizationId}/members/${member.membershipId}`);
      }
    },
  };
}

/** Lowercase alphanumeric token of `length` chars, drawn from a CSPRNG. */
function randomToken(length: number): string {
  return randomBytes(length)
    .toString("base64url")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
    .slice(0, length)
    .padEnd(length, "0");
}

interface OrganizationMembersResponseShape {
  members: Array<{ membershipId: string; email: string; role: "owner" | "admin" | "member" }>;
}

async function findMemberByEmail(
  adminClient: ApiClient,
  organizationId: string,
  email: string,
): Promise<OrganizationMember | undefined> {
  const response = await adminClient.get<OrganizationMembersResponseShape>(
    `/v1/organizations/${organizationId}/members`,
  );
  return response.members.find((member) => member.email.toLowerCase() === email.toLowerCase());
}

/**
 * Fixed local-lane durable identity, used when RELEASE_E2E_DURABLE_USER_EMAIL /
 * _PASSWORD are absent (the CI local lane, which boots a fresh, ephemeral
 * server per run). "Durable" here means seeded-per-run via the real first-run
 * `/setup` claim — the ephemeral stack has no pre-existing account, so the
 * runner mints one deterministically instead of depending on a repo secret.
 * Only ever used against a `--lane local` target (never staging). The domain is
 * fake-but-not-special-use for the same reason `FIXTURE_EMAIL_DOMAIN` is (see
 * `mintFreshUser`).
 */
export const DEFAULT_LOCAL_DURABLE_USER_EMAIL = `durable@${FIXTURE_EMAIL_DOMAIN}`;
export const DEFAULT_LOCAL_DURABLE_USER_PASSWORD = "release-e2e-DurableUser!Aa1";

/**
 * One-time durable-user seeding for the **local** target, only. The local
 * profile boots with an empty Postgres DB, so unlike staging (where the
 * `e2e-tests` org/user is provisioned once, out of band, by ops), a fresh
 * `--lane local` run needs to create it itself via the real first-run `/setup`
 * claim transport (`server/proliferate/server/setup/api.py`) — the same
 * unauthenticated, single-use, form-encoded flow a human running
 * `pdevui <profile>` would use per
 * `specs/developing/local/feature-worktree-auth.md` Layer B.
 *
 * Idempotent across runs against the same profile: `/setup` permanently 404s
 * ("not found — nothing to set up here") once any user exists, which this
 * treats as "already seeded" and falls through to a normal login rather than
 * failing. Not applicable to `--lane staging`, which never mounts `/setup`.
 */
export async function ensureLocalDurableUser(creds: DurableUserCredentials): Promise<DurableUserCredentials> {
  const client = new ApiClient({ baseUrl: creds.serverUrl });
  const setupOpen = await isLocalSetupOpen(client);
  if (setupOpen) {
    const setupTokenFile = process.env.SETUP_TOKEN_FILE;
    if (!setupTokenFile) {
      throw new Error(
        "ensureLocalDurableUser: /setup is open (fresh profile) but SETUP_TOKEN_FILE is not set. " +
          "Boot the profile with SETUP_TOKEN_FILE=/tmp/proliferate-<profile>-setup-token per " +
          "specs/developing/local/feature-worktree-auth.md Layer B, then re-run.",
      );
    }
    const { readFile } = await import("node:fs/promises");
    const setupToken = (await readFile(setupTokenFile, "utf8")).trim();
    await claimLocalSetup(client, {
      email: creds.email,
      password: creds.password,
      setupToken,
      organizationName: "e2e-tests",
    });
  }
  const session = await loginDurableUser(creds);
  const organizations = await client
    .withBearerToken(session.accessToken)
    .get<{ organizations: Array<{ id: string; name: string }> }>("/v1/organizations");
  const organizationId = organizations.organizations[0]?.id;
  if (!organizationId) {
    throw new Error("ensureLocalDurableUser: durable user has no organization after claim/login.");
  }
  return { ...creds, organizationId };
}

async function isLocalSetupOpen(client: ApiClient): Promise<boolean> {
  // GET /setup renders HTML (200 while open, 404 "There is nothing to set up
  // here" once claimed) — not JSON, so this reaches for fetch directly rather
  // than ApiClient.get's JSON-shaped contract.
  const response = await fetch(`${client.baseUrl}/setup`).catch(() => undefined);
  return response?.status === 200;
}

async function claimLocalSetup(
  client: ApiClient,
  params: { email: string; password: string; setupToken: string; organizationName: string },
): Promise<void> {
  const baseUrl = client.baseUrl;
  const body = new URLSearchParams({
    email: params.email,
    password: params.password,
    setup_token: params.setupToken,
    organization_name: params.organizationName,
  });
  const response = await fetch(`${baseUrl}/setup`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new ApiRequestError("POST", "/setup", response.status, text);
  }
}

/**
 * The known blocker (per the tier-3 runner build task, 2026-07-08):
 * `current_product_user` (`server/proliferate/auth/dependencies.py:54`) 403s
 * every password-only account with `code: "github_link_required"` — every
 * cloud/sandbox/secrets/repo route depends on it, and single-org local dev
 * has no way to link a real GitHub identity to a fresh or durable password
 * account without borrowing another profile's session (`pseedauth`, which
 * would replace this profile's DB wholesale). A fix
 * (`fix/product-user-single-org-bypass`) is in flight upstream.
 *
 * `GITHUB_LINK_GATE_WORKAROUND_ACTIVE` is the single flag: flip it to `false`
 * once that fix merges, and every scenario using `withProductGate` below
 * starts asserting for real again with no other code change.
 */
export const GITHUB_LINK_GATE_WORKAROUND_ACTIVE = false;

export function isGithubLinkRequiredError(error: unknown): boolean {
  if (!(error instanceof ApiRequestError) || error.status !== 403 || typeof error.body !== "object" || error.body === null) {
    return false;
  }
  // FastAPI's default HTTPException envelope wraps the raised detail:
  // `{"detail": {"code": "github_link_required", "message": "..."}}` — found
  // running this for real against `current_product_user`, 2026-07-08 (not a
  // bare top-level `code` field, which was this check's first, wrong guess).
  const body = error.body as { code?: unknown; detail?: { code?: unknown } };
  return body.code === "github_link_required" || body.detail?.code === "github_link_required";
}
