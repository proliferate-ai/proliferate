// T2-SEC-1 (specs/developing/testing/scenarios.md): secrets CRUD across all
// three scopes (personal, organization, workspace), stopped at the
// materialization seam.
//
// MAJOR SURVEY CORRECTION, flagged prominently in the PR body: every
// /v1/cloud/* route — secrets included — is gated by
// `current_product_user` (auth/dependencies.py), which unconditionally calls
// `_require_product_ready`. That check requires a real GitHub OAuth identity
// + ready provider grant (auth/identity/store.py get_account_readiness) with
// NO single-org-mode carve-out. Contrast with `current_organization_actor`
// (used by the org/invitation endpoints T2-ORG-1 and T2-INV-1 exercise),
// whose docstring says single-org "instances admit password-only accounts:
// listing the org, inviting teammates, and accepting invitations must all
// work with no GitHub OAuth app configured" — and which explicitly bypasses
// the same gate when `settings.single_org_mode` is true.
//
// Net effect, verified against the running stack: a password-only account —
// owner, admin, or member, it doesn't matter, this gate is account-level, not
// org-role-level — gets 403 `github_link_required` on every single cloud
// secrets endpoint (personal, organization, and workspace scope alike),
// before any of the business logic this scenario wants to exercise (version
// bumps, non-echo, materialization-pending, member-403-on-org-secret,
// cloud_repo_environment_not_configured) is ever reached. This is NOT the
// GitHub-auth wall the scenario anticipated only for the workspace scope —
// it blocks personal and organization scope too, which have no intrinsic
// reason to need a GitHub connection at all (they're arbitrary env vars/files
// for a user's own cloud sandbox).
//
// Per this wave's explicit instruction not to fake GitHub auth, this spec
// pins the AS-BUILT gate (a real, deterministic, security-relevant boundary)
// instead of the deeper CRUD assertions, which stay unverified pending
// either a product decision (should single-org mode bypass this gate the
// way current_organization_actor already does?) or a real GitHub App test
// fixture.

import { expect, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  ensureInstanceClaimed,
  getOrganizationSecrets,
  getOwnOrganization,
  getPersonalSecrets,
  getWorkspaceSecrets,
  passwordLogin,
  putOrganizationSecretEnvVar,
  putPersonalSecretEnvVar,
  putWorkspaceSecretEnvVar,
} from "../stack/seed.ts";

test.describe.configure({ mode: "serial" });

let ownerToken: string;
let organizationId: string;

test.beforeAll(async () => {
  await ensureInstanceClaimed();
  ownerToken = (await passwordLogin(ADMIN_EMAIL, ADMIN_PASSWORD)).access_token;
  organizationId = (await getOwnOrganization(ownerToken)).id;
});

function expectGitHubLinkRequired(result: { status: number; body: unknown }): void {
  expect(result.status).toBe(403);
  const detail = (result.body as { detail?: { code?: string } }).detail;
  expect(detail?.code).toBe("github_link_required");
}

test.describe("T2-SEC-1: secrets CRUD, all three scopes — blocked at the product-readiness gate before reaching secrets logic", () => {
  test("documents GAP: personal secrets (GET and PUT) are unreachable for a password-only account, no single-org carve-out", async () => {
    expectGitHubLinkRequired(await getPersonalSecrets(ownerToken));
    expectGitHubLinkRequired(await putPersonalSecretEnvVar(ownerToken, "MY_API_KEY", "value"));
  });

  test("documents GAP: organization secrets (GET and PUT, as owner) are unreachable for the same reason", async () => {
    expectGitHubLinkRequired(await getOrganizationSecrets(ownerToken, organizationId));
    expectGitHubLinkRequired(await putOrganizationSecretEnvVar(ownerToken, organizationId, "ORG_KEY", "value"));
  });

  test("documents GAP: workspace secrets (GET and PUT) hit the same product-readiness 403 before the cloud_repo_environment_not_configured check the scenario names ever runs", async () => {
    const gitOwner = "t2intent-nonexistent-owner";
    const gitRepoName = `nonexistent-repo-${Date.now()}`;
    expectGitHubLinkRequired(await getWorkspaceSecrets(ownerToken, gitOwner, gitRepoName));
    expectGitHubLinkRequired(await putWorkspaceSecretEnvVar(ownerToken, gitOwner, gitRepoName, "WS_KEY", "value"));
  });
});

// NOT COVERED by this wave, named so the gap is loud rather than silent:
// - version bumps / never-echoed values / materialization.status='pending'
//   for personal, organization, and workspace secrets;
// - binary file upload rejected with invalid_secret_file_upload;
// - member setting an organization-scope secret -> 403
//   organization_secrets_permission_denied;
// - the workspace-scope cloud_repo_environment_not_configured negative
//   itself (it exists in code — cloud/secrets/service.py
//   _load_workspace_repo_scope — but is unreachable via this gate).
// All of the above require getting a test account past
// current_product_user's GitHub-readiness gate, which this wave does not
// fake. Re-scope once Pablo rules on the GAP above.
