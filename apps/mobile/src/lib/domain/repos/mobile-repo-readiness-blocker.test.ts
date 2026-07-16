import { describe, expect, it } from "vitest";
import { resolveRepositoryReadiness } from "@proliferate/product-domain/repos/repo-readiness";

import {
  buildMobileCloudAdminRequestMessage,
  resolveMobileRepoReadinessBlocker,
} from "./mobile-repo-readiness-blocker";

const READY_MANAGED = {
  requirement: "managed_cloud" as const,
  githubRepositoryAccess: "ready" as const,
  managedCloud: "ready" as const,
  signedIn: true,
  hasSupportedRepoIdentity: true,
  authorityLoading: false,
  authorityError: false,
  canManageInstallation: true,
  cloudEnvironmentConfigured: false,
};

function readiness(overrides: Partial<Parameters<typeof resolveRepositoryReadiness>[0]>) {
  return resolveRepositoryReadiness({ ...READY_MANAGED, authority: null, ...overrides });
}

describe("resolveMobileRepoReadinessBlocker", () => {
  it("shows an operator blocker with no CTA when managed Cloud is disabled", () => {
    const blocker = resolveMobileRepoReadinessBlocker({
      readiness: readiness({ managedCloud: "disabled" }),
      githubAccessDisplayName: null,
    });
    expect(blocker?.actionKind).toBe("none");
    expect(blocker?.actionLabel).toBeNull();
    expect(blocker?.title).toMatch(/not configured/i);
  });

  it("names the instance in operator copy when available", () => {
    const blocker = resolveMobileRepoReadinessBlocker({
      readiness: readiness({ managedCloud: "operator_configuration_required" }),
      githubAccessDisplayName: "Acme Cloud",
    });
    expect(blocker?.description).toContain("Acme Cloud");
    expect(blocker?.actionKind).toBe("none");
  });

  it("offers authorize_user for missing user authorization", () => {
    const blocker = resolveMobileRepoReadinessBlocker({
      readiness: readiness({
        authority: { authorized: false, status: "missing_user_authorization" },
      }),
      githubAccessDisplayName: null,
    });
    expect(blocker?.actionKind).toBe("authorize_user");
    expect(blocker?.actionLabel).toBe("Connect GitHub App");
  });

  it("offers reauthorize_user for expired authorization", () => {
    const blocker = resolveMobileRepoReadinessBlocker({
      readiness: readiness({
        authority: { authorized: false, status: "expired_user_authorization" },
      }),
      githubAccessDisplayName: null,
    });
    expect(blocker?.actionKind).toBe("reauthorize_user");
  });

  it("offers install_app for an admin missing installation", () => {
    const blocker = resolveMobileRepoReadinessBlocker({
      readiness: readiness({
        canManageInstallation: true,
        authority: { authorized: false, status: "missing_installation" },
      }),
      githubAccessDisplayName: null,
    });
    expect(blocker?.actionKind).toBe("install_app");
  });

  it("offers copy_admin_request for a non-admin missing installation", () => {
    const blocker = resolveMobileRepoReadinessBlocker({
      readiness: readiness({
        canManageInstallation: false,
        authority: { authorized: false, status: "missing_installation" },
      }),
      githubAccessDisplayName: null,
    });
    expect(blocker?.actionKind).toBe("copy_admin_request");
  });

  it("offers grant_repo_access for an admin with repo not covered", () => {
    const blocker = resolveMobileRepoReadinessBlocker({
      readiness: readiness({
        canManageInstallation: true,
        authority: { authorized: false, status: "repo_not_covered" },
      }),
      githubAccessDisplayName: null,
    });
    expect(blocker?.actionKind).toBe("grant_repo_access");
  });

  it("explains missing human access with no CTA", () => {
    const blocker = resolveMobileRepoReadinessBlocker({
      readiness: readiness({
        authority: { authorized: false, status: "missing_user_repo_access" },
      }),
      githubAccessDisplayName: null,
    });
    expect(blocker?.actionKind).toBe("none");
    expect(blocker?.actionLabel).toBeNull();
    expect(blocker?.title).toMatch(/no access/i);
  });

  it("offers retry on an authority error", () => {
    const blocker = resolveMobileRepoReadinessBlocker({
      readiness: readiness({ authorityError: true }),
      githubAccessDisplayName: null,
    });
    expect(blocker?.actionKind).toBe("retry");
  });

  it("returns a pending, no-CTA blocker while authority loads", () => {
    const blocker = resolveMobileRepoReadinessBlocker({
      readiness: readiness({ authorityLoading: true }),
      githubAccessDisplayName: null,
    });
    expect(blocker?.pending).toBe(true);
    expect(blocker?.actionKind).toBe("none");
  });

  it("surfaces a checking state instead of the resolved gate while a prerequisite query loads", () => {
    // Simulates the cold-open race: capabilities have not resolved yet, so
    // managedCloud fail-closed to "disabled" and the resolver reports gate 1
    // (operator-not-configured) on placeholder input. `checking: true` must
    // take priority so a fully-configured deployment does not flash "Cloud is
    // not configured on this deployment".
    const blocker = resolveMobileRepoReadinessBlocker({
      readiness: readiness({ managedCloud: "disabled" }),
      githubAccessDisplayName: null,
      checking: true,
    });
    expect(blocker?.pending).toBe(true);
    expect(blocker?.actionKind).toBe("none");
    expect(blocker?.title).toMatch(/checking/i);
    expect(blocker?.title).not.toMatch(/not configured/i);
  });

  it("returns null when every gate is met (ready to save)", () => {
    // Ready authority + not-yet-configured env => gate 9 (set_up_cloud), which
    // is the mobile continue point, not a blocker.
    const blocker = resolveMobileRepoReadinessBlocker({
      readiness: readiness({ authority: { authorized: true, status: "ready" } }),
      githubAccessDisplayName: null,
    });
    expect(blocker).toBeNull();
  });
});

describe("buildMobileCloudAdminRequestMessage", () => {
  it("names the repo when provided", () => {
    expect(buildMobileCloudAdminRequestMessage("acme/app")).toContain("acme/app");
  });

  it("uses a generic message with no repo", () => {
    expect(buildMobileCloudAdminRequestMessage(null)).toMatch(/Cloud repositories/);
  });
});
