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
 *   logged in via `POST /auth/web/password/login`.
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

import { ApiClient } from "./http.js";

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

  const email = `release-e2e+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@proliferate.test`;
  const password = `release-e2e-${Math.random().toString(36).slice(2, 12)}!Aa1`;

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
