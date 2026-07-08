// T2-WS-1 (specs/developing/testing/scenarios.md): cloud workspace create
// request path, to the seam.
//
// MAJOR SURVEY CORRECTION, flagged prominently in the PR body (see
// secrets.spec.ts's header for the full writeup): POST/GET /cloud/workspaces
// depends on `current_product_user` (auth/dependencies.py), which
// unconditionally requires a real GitHub OAuth identity + ready provider
// grant — no single-org-mode bypass exists, unlike
// `current_organization_actor` (used by T2-ORG-1/T2-INV-1's org endpoints),
// whose docstring explicitly carves single-org mode out of this exact gate.
//
// Concretely: even the scenario's own negative case
// (`cloud_repo_environment_not_found`, raised in
// cloud/workspaces/service.py create_cloud_workspace_for_user AFTER the repo
// environment lookup) is unreachable for a password-only account — the
// request 403s with `github_link_required` before the endpoint body ever
// runs, verified against the running stack. This is a step earlier than the
// GitHub-auth wall this wave's brief anticipated (which was scoped to the
// happy path needing a real GitHub App installation); the wall is now in
// front of the negative case too.
//
// Per this wave's explicit instruction not to fake GitHub auth, this spec
// pins the AS-BUILT gate rather than the service-layer negative, which stays
// unverified pending either a product decision or a real GitHub App test
// fixture.

import { expect, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  createCloudWorkspace,
  ensureInstanceClaimed,
  passwordLogin,
} from "../stack/seed.ts";

test.describe.configure({ mode: "serial" });

let ownerToken: string;

test.beforeAll(async () => {
  await ensureInstanceClaimed();
  ownerToken = (await passwordLogin(ADMIN_EMAIL, ADMIN_PASSWORD)).access_token;
});

test.describe("T2-WS-1: cloud workspace create request path (to the seam)", () => {
  test("documents GAP: POST /cloud/workspaces is unreachable for a password-only account — 403 github_link_required fires before the cloud_repo_environment_not_found check this scenario names", async () => {
    const result = await createCloudWorkspace(ownerToken, {
      gitOwner: "t2intent-nonexistent-owner",
      gitRepoName: `nonexistent-repo-${Date.now()}`,
      branchName: "feature/does-not-matter",
    });
    expect(result.status).toBe(403);
    const detail = (result.body as { detail?: { code?: string } }).detail;
    expect(detail?.code).toBe("github_link_required");
  });
});

// NOT COVERED by this wave, named so the gap is loud rather than silent:
// - cloud_repo_environment_not_found itself (exists in code, unreachable via
//   this gate for a password-only test account);
// - the happy path (200, workspace id, status pending|materializing) —
//   NEEDS-GITHUB-FIXTURE regardless of the gate above, since it also
//   requires require_github_cloud_repo_authority to succeed against a real
//   GitHub App installation.
// Re-scope once Pablo rules on the current_product_user GAP (see
// secrets.spec.ts), or a GitHub App test fixture exists.
