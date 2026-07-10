// T2-WS-1 (specs/developing/testing/scenarios.md): cloud workspace create
// request path, to the seam.
//
// Formerly-documented GAP, now fixed: this spec used to pin a MAJOR SURVEY
// CORRECTION — `current_product_user` (auth/dependencies.py) unconditionally
// required a real GitHub OAuth identity + ready provider grant, with no
// single-org-mode carve-out, so POST /cloud/workspaces 403'd
// `github_link_required` for a password-only account before the endpoint
// body ever ran — a step earlier than the scenario's own negative case. PR
// #1023 extended the same single-org-mode bypass `current_organization_actor`
// already had to `current_product_user` too, so a password-only account on a
// single-org instance now clears the gate and reaches the scenario's
// original seam.
//
// Net effect, verified against the running stack: for a nonexistent repo,
// `create_cloud_workspace_for_user`
// (server/proliferate/server/cloud/workspaces/service.py:103-114) looks up
// the cloud repo environment first and 404s with
// `cloud_repo_environment_not_found` before any GitHub App call is made.
// This is exactly the assertion T2-WS-1 originally wanted (per
// scenarios.md) — this spec now asserts it directly instead of the
// account-level gate.

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
  test("POST /cloud/workspaces 404s cloud_repo_environment_not_found for a repo with no cloud repo environment configured", async () => {
    const result = await createCloudWorkspace(ownerToken, {
      gitOwner: "t2intent-nonexistent-owner",
      gitRepoName: `nonexistent-repo-${Date.now()}`,
      branchName: "feature/does-not-matter",
    });
    expect(result.status).toBe(404);
    const detail = (result.body as { detail?: { code?: string } }).detail;
    expect(detail?.code).toBe("cloud_repo_environment_not_found");
  });
});

// NOT COVERED by this wave, named so the gap is loud rather than silent:
// - the happy path (200, workspace id, status pending|materializing) —
//   NEEDS-GITHUB-FIXTURE regardless of the gate fix above, since it requires
//   both a configured cloud repo environment and
//   require_github_cloud_repo_authority to succeed against a real GitHub App
//   installation (secrets.spec.ts's header documents the same dependency for
//   workspace-scope secrets).
