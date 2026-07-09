// T2-SEC-1 (specs/developing/testing/scenarios.md): secrets CRUD across all
// three scopes (personal, organization, workspace), to the seam.
//
// Formerly-documented GAP, now fixed: this spec used to pin a MAJOR SURVEY
// CORRECTION — `current_product_user` (auth/dependencies.py) unconditionally
// required a real GitHub OAuth identity + ready provider grant, with no
// single-org-mode carve-out, so every /v1/cloud/secrets/* route 403'd
// `github_link_required` for a password-only account before any secrets
// logic ever ran. PR #1023 extended the same single-org-mode bypass
// `current_organization_actor` already had to `current_product_user` too, so
// a password-only account on a single-org instance now clears the gate the
// same way it already cleared the org endpoints.
//
// Net effect, verified against the running stack: personal and organization
// secrets are now fully reachable and usable end to end — GET/PUT roundtrip,
// version bumps, materialization defaults to "pending" — for owner/admin
// accounts. Workspace-scope secrets reach the real seam this scenario always
// named: `_load_workspace_repo_scope`
// (server/proliferate/server/cloud/secrets/service.py:140-159) 404s with
// `cloud_repo_environment_not_configured` for a repo that has no cloud repo
// environment configured, since that lookup runs before any secret-set
// logic. This spec now exercises the real secrets logic up to that seam
// instead of pinning the account-level gate.
//
// Response shape note (server/proliferate/server/cloud/secrets/models.py):
// `CloudSecretEnvVarMetadata` only ever carries id/name/byteSize/updatedAt —
// there is no `value` field on the type at all, so "never echoed" isn't a
// runtime check here, it's a property of the response schema itself.

import { expect, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  ensureInstanceClaimed,
  getOrganizationSecrets,
  getOwnOrganization,
  getPersonalSecrets,
  getWorkspaceSecrets,
  inviteAndRegisterMember,
  passwordLogin,
  putOrganizationSecretEnvVar,
  putPersonalSecretEnvVar,
  putWorkspaceSecretEnvVar,
} from "../stack/seed.ts";

test.describe.configure({ mode: "serial" });

// Date.now()-suffixed env var names: the owner/org secret sets persist in
// this profile's DB across local reruns (stack/boot.ts), and PUT is an
// upsert, so a fixed name would silently pass on a rerun against leftover
// state from a prior run instead of proving this run's PUT actually created
// the entry. A fresh member email is used for the same reason
// organization-roles.spec.ts uses one for its promote/remove cases: the
// permission-denied assertion only needs the account to exist and be an
// active "member", so an idempotent, reusable fixed email is fine here (no
// role/status mutation happens on it in this spec).
const RUN_ID = Date.now();
const PERSONAL_ENV_NAME = `MY_API_KEY_${RUN_ID}`;
const ORG_ENV_NAME = `ORG_KEY_${RUN_ID}`;
const MEMBER_EMAIL = "t2sec-member@t2intent.example.com";
const MEMBER_PASSWORD = "T2SecMember!Passw0rd";

let ownerToken: string;
let organizationId: string;
let memberToken: string;

test.beforeAll(async () => {
  await ensureInstanceClaimed();
  ownerToken = (await passwordLogin(ADMIN_EMAIL, ADMIN_PASSWORD)).access_token;
  organizationId = (await getOwnOrganization(ownerToken)).id;
  memberToken = await inviteAndRegisterMember(
    ownerToken,
    organizationId,
    MEMBER_EMAIL,
    MEMBER_PASSWORD,
    "member",
  );
});

function expectRepoEnvironmentNotConfigured(result: { status: number; body: unknown }): void {
  expect(result.status).toBe(404);
  const detail = (result.body as { detail?: { code?: string } }).detail;
  expect(detail?.code).toBe("cloud_repo_environment_not_configured");
}

test.describe("T2-SEC-1: secrets CRUD, all three scopes", () => {
  test("personal secrets: GET/PUT roundtrip, version bumps, value never echoed", async () => {
    const before = await getPersonalSecrets(ownerToken);
    expect(before.status).toBe(200);
    expect(before.body.scopeKind).toBe("personal");
    const versionBefore = before.body.version;
    expect(before.body.envVars.some((entry) => entry.name === PERSONAL_ENV_NAME)).toBe(false);

    const putResult = await putPersonalSecretEnvVar(ownerToken, PERSONAL_ENV_NAME, "shhh-personal");
    expect(putResult.status).toBe(200);
    expect(putResult.body.version).toBe(versionBefore + 1);
    const putEntry = putResult.body.envVars.find((entry) => entry.name === PERSONAL_ENV_NAME);
    expect(putEntry).toBeDefined();
    expect(putEntry).not.toHaveProperty("value");
    expect(putEntry?.byteSize).toBe("shhh-personal".length);

    const after = await getPersonalSecrets(ownerToken);
    expect(after.status).toBe(200);
    expect(after.body.version).toBe(versionBefore + 1);
    expect(after.body.envVars.some((entry) => entry.name === PERSONAL_ENV_NAME)).toBe(true);
    // materialization has no runtime to converge against under
    // TIER2_INTENT_SKIP_RUNTIME — "pending" (the default whenever the secret
    // set has desired state the recorded materialization hasn't caught up
    // to, per _materialization_payload) is the only status this spec can
    // assert without a real cloud sandbox.
    expect(after.body.materialization?.status).toBe("pending");
  });

  test("organization secrets: GET/PUT roundtrip as owner", async () => {
    const before = await getOrganizationSecrets(ownerToken, organizationId);
    expect(before.status).toBe(200);
    expect(before.body.scopeKind).toBe("organization");
    const versionBefore = before.body.version;

    const putResult = await putOrganizationSecretEnvVar(ownerToken, organizationId, ORG_ENV_NAME, "shhh-org");
    expect(putResult.status).toBe(200);
    expect(putResult.body.version).toBe(versionBefore + 1);
    expect(putResult.body.envVars.some((entry) => entry.name === ORG_ENV_NAME)).toBe(true);

    const after = await getOrganizationSecrets(ownerToken, organizationId);
    expect(after.status).toBe(200);
    expect(after.body.envVars.some((entry) => entry.name === ORG_ENV_NAME)).toBe(true);
  });

  test("organization secrets: a plain member gets 403 organization_secrets_permission_denied on write", async () => {
    // _require_organization_admin (service.py:121-137) gates every org
    // secrets write on owner/admin role; GET only needs active membership
    // (_require_organization_member), so a member can read but not write.
    const readResult = await getOrganizationSecrets(memberToken, organizationId);
    expect(readResult.status).toBe(200);

    const writeResult = await putOrganizationSecretEnvVar(memberToken, organizationId, ORG_ENV_NAME, "member-write");
    expect(writeResult.status).toBe(403);
    const detail = (writeResult.body as { detail?: { code?: string } }).detail;
    expect(detail?.code).toBe("organization_secrets_permission_denied");
  });

  test("workspace secrets: GET and PUT 404 cloud_repo_environment_not_configured for a repo with no cloud repo environment", async () => {
    const gitOwner = "t2intent-nonexistent-owner";
    const gitRepoName = `nonexistent-repo-${RUN_ID}`;
    expectRepoEnvironmentNotConfigured(await getWorkspaceSecrets(ownerToken, gitOwner, gitRepoName));
    expectRepoEnvironmentNotConfigured(
      await putWorkspaceSecretEnvVar(ownerToken, gitOwner, gitRepoName, "WS_KEY", "value"),
    );
  });
});

// NOT COVERED by this wave, named so the gap is loud rather than silent:
// - the workspace-scope happy path (a configured cloud repo environment) —
//   creating one goes through the same
//   require_github_cloud_repo_authority/GitHub App path cloud-workspace.spec.ts
//   documents as NEEDS-GITHUB-FIXTURE, so workspace secrets CRUD past this
//   seam stays unverified pending a real GitHub App test fixture;
// - binary file upload rejected with invalid_secret_file_upload (personal/org
//   file endpoints are otherwise untouched by this wave — only env vars are
//   exercised here, matching the GET/PUT roundtrip the scenario asked for).
