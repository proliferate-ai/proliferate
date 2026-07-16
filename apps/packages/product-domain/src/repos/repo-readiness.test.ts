import { describe, expect, it } from "vitest";

import {
  isManagedCloudOperatorGateUnmet,
  resolveRepositoryReadiness,
  type RepositoryReadinessInput,
} from "./repo-readiness";

/** A fully-ready managed-Cloud input; individual tests degrade one field. */
function ready(
  overrides: Partial<RepositoryReadinessInput> = {},
): RepositoryReadinessInput {
  return {
    requirement: "managed_cloud",
    githubRepositoryAccess: "ready",
    managedCloud: "ready",
    signedIn: true,
    hasSupportedRepoIdentity: true,
    authorityLoading: false,
    authorityError: false,
    authority: { authorized: true, status: "ready" },
    canManageInstallation: true,
    cloudEnvironmentConfigured: true,
    ...overrides,
  };
}

describe("resolveRepositoryReadiness", () => {
  it("returns ready when every gate is satisfied", () => {
    expect(resolveRepositoryReadiness(ready())).toEqual({ gate: 10, action: "none" });
  });

  it("treats local_only as always ready and never touches Cloud gates", () => {
    expect(
      resolveRepositoryReadiness(
        ready({
          requirement: "local_only",
          githubRepositoryAccess: "disabled",
          managedCloud: "disabled",
          signedIn: false,
          hasSupportedRepoIdentity: false,
        }),
      ),
    ).toEqual({ gate: 10, action: "none" });
  });

  describe("gate ordering (first unmet gate only)", () => {
    it("gate 1 when the required operator capability is disabled", () => {
      expect(
        resolveRepositoryReadiness(ready({ managedCloud: "disabled", signedIn: false })),
      ).toEqual({ gate: 1, action: "none" });
    });

    it("gate 1 when the operator configuration is incomplete", () => {
      expect(
        resolveRepositoryReadiness(ready({ managedCloud: "operator_configuration_required" })),
      ).toEqual({ gate: 1, action: "none" });
    });

    it("gate 2 sign-in when operator ready but signed out", () => {
      expect(
        resolveRepositoryReadiness(ready({ signedIn: false, hasSupportedRepoIdentity: false })),
      ).toEqual({ gate: 2, action: "sign_in" });
    });

    it("gate 3 for an unsupported repository identity", () => {
      expect(
        resolveRepositoryReadiness(ready({ hasSupportedRepoIdentity: false })),
      ).toEqual({ gate: 3, action: "none" });
    });

    it("gate 4 retry on authority error", () => {
      expect(
        resolveRepositoryReadiness(ready({ authorityError: true, authority: null })),
      ).toEqual({ gate: 4, action: "retry" });
    });

    it("gate 4 none while authority loads", () => {
      expect(
        resolveRepositoryReadiness(ready({ authorityLoading: true, authority: null })),
      ).toEqual({ gate: 4, action: "none" });
    });

    it("gate 4 none when authority has not resolved yet", () => {
      expect(resolveRepositoryReadiness(ready({ authority: null }))).toEqual({
        gate: 4,
        action: "none",
      });
    });

    it("gate 1 when per-repo authority reports operator configuration required", () => {
      expect(
        resolveRepositoryReadiness(
          ready({ authority: { authorized: false, status: "operator_configuration_required" } }),
        ),
      ).toEqual({ gate: 1, action: "none" });
    });

    it("gate 5 authorize_user for missing user authorization", () => {
      expect(
        resolveRepositoryReadiness(
          ready({ authority: { authorized: false, status: "missing_user_authorization" } }),
        ),
      ).toEqual({ gate: 5, action: "authorize_user" });
    });

    it("gate 5 reauthorize_user for an expired user authorization", () => {
      expect(
        resolveRepositoryReadiness(
          ready({ authority: { authorized: false, status: "expired_user_authorization" } }),
        ),
      ).toEqual({ gate: 5, action: "reauthorize_user" });
    });

    it("gate 6 install_app when the member can install", () => {
      expect(
        resolveRepositoryReadiness(
          ready({ authority: { authorized: false, status: "missing_installation" } }),
        ),
      ).toEqual({ gate: 6, action: "install_app" });
    });

    it("gate 6 copy_admin_request when the member cannot install", () => {
      expect(
        resolveRepositoryReadiness(
          ready({
            canManageInstallation: false,
            authority: { authorized: false, status: "missing_installation" },
          }),
        ),
      ).toEqual({ gate: 6, action: "copy_admin_request" });
    });

    it("gate 7 grant_repo_access when the member can grant", () => {
      expect(
        resolveRepositoryReadiness(
          ready({ authority: { authorized: false, status: "repo_not_covered" } }),
        ),
      ).toEqual({ gate: 7, action: "grant_repo_access" });
    });

    it("gate 7 copy_admin_request when the member cannot grant", () => {
      expect(
        resolveRepositoryReadiness(
          ready({
            canManageInstallation: false,
            authority: { authorized: false, status: "repo_not_covered" },
          }),
        ),
      ).toEqual({ gate: 7, action: "copy_admin_request" });
    });

    it("gate 8 none for missing human repository access", () => {
      expect(
        resolveRepositoryReadiness(
          ready({ authority: { authorized: false, status: "missing_user_repo_access" } }),
        ),
      ).toEqual({ gate: 8, action: "none" });
    });

    it("gate 4 retry for an authority error status", () => {
      expect(
        resolveRepositoryReadiness(
          ready({ authority: { authorized: false, status: "error" } }),
        ),
      ).toEqual({ gate: 4, action: "retry" });
    });

    it("gate 9 set_up_cloud when authority is ready but no Cloud environment", () => {
      expect(
        resolveRepositoryReadiness(ready({ cloudEnvironmentConfigured: false })),
      ).toEqual({ gate: 9, action: "set_up_cloud" });
    });
  });

  describe("capability independence", () => {
    it("does not block github_repository_access when managed Cloud is disabled", () => {
      expect(
        resolveRepositoryReadiness(
          ready({ requirement: "github_repository_access", managedCloud: "disabled" }),
        ),
      ).toEqual({ gate: 10, action: "none" });
    });

    it("does not require a Cloud environment for a github_repository_access intent", () => {
      expect(
        resolveRepositoryReadiness(
          ready({
            requirement: "github_repository_access",
            managedCloud: "disabled",
            cloudEnvironmentConfigured: false,
          }),
        ),
      ).toEqual({ gate: 10, action: "none" });
    });

    it("still gates github_repository_access on its own operator capability", () => {
      expect(
        resolveRepositoryReadiness(
          ready({ requirement: "github_repository_access", githubRepositoryAccess: "disabled" }),
        ),
      ).toEqual({ gate: 1, action: "none" });
    });
  });

  describe("isManagedCloudOperatorGateUnmet (PR2-GATING-01 shared operator check)", () => {
    it("is true when managed Cloud is operator-incomplete", () => {
      expect(isManagedCloudOperatorGateUnmet({
        githubRepositoryAccess: "ready",
        managedCloud: "operator_configuration_required",
      })).toBe(true);
    });

    it("is true when managed Cloud is disabled", () => {
      expect(isManagedCloudOperatorGateUnmet({
        githubRepositoryAccess: "ready",
        managedCloud: "disabled",
      })).toBe(true);
    });

    it("is false when managed Cloud is ready even if GitHub access is operator-incomplete (that surfaces via the per-repo authority query, not the operator gate)", () => {
      expect(isManagedCloudOperatorGateUnmet({
        githubRepositoryAccess: "operator_configuration_required",
        managedCloud: "ready",
      })).toBe(false);
    });

    it("is false when both capabilities are ready", () => {
      expect(isManagedCloudOperatorGateUnmet({
        githubRepositoryAccess: "ready",
        managedCloud: "ready",
      })).toBe(false);
    });
  });
});
