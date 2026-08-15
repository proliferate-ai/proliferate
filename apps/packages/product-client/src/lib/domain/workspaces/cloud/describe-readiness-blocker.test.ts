import { describe, expect, it, vi } from "vitest";
import type { RepositoryReadiness } from "#product/domain/repos/repo-readiness";
import { describeReadinessBlocker, type ReadinessBlockerInputs } from "./describe-readiness-blocker";

function inputs(readiness: RepositoryReadiness, overrides: Partial<ReadinessBlockerInputs> = {}): ReadinessBlockerInputs {
  return {
    readiness,
    requirement: "managed_cloud",
    repo: { gitProvider: "github", gitOwner: "acme", gitRepoName: "app" },
    githubAccessDisplayName: "proliferate-app",
    orgName: "Acme",
    installUrl: "https://github.com/settings/installations",
    userAuthorization: { authorize: vi.fn(), authorizing: false, error: null },
    installation: {
      install: vi.fn(),
      openInstallationSettings: vi.fn(),
      installing: false,
      error: null,
    },
    onCopyAdminRequest: vi.fn(),
    onRetryAuthority: vi.fn(),
    onSignIn: vi.fn(),
    ...overrides,
  };
}

describe("describeReadinessBlocker", () => {
  it("returns no blocker for the in-progress continuation states (gates 9 and 10) — never operator copy (S1)", () => {
    // Gate 9 is the normal `set_up_cloud` continue point.
    expect(describeReadinessBlocker(inputs({ gate: 9, action: "set_up_cloud" }))).toBeNull();
    // Gate 10 (ready, action "none") must show progress, NOT the operator copy.
    expect(describeReadinessBlocker(inputs({ gate: 10, action: "none" }))).toBeNull();
  });

  it("reserves the operator-not-configured copy for the true operator gate (gate 1)", () => {
    const blocker = describeReadinessBlocker(inputs({ gate: 1, action: "none" }));
    expect(blocker?.title).toBe("Cloud is not configured on this deployment");
  });

  it("names GitHub repository access—not Cloud—for a blocked Clone", () => {
    const blocker = describeReadinessBlocker(inputs(
      { gate: 1, action: "none" },
      { requirement: "github_repository_access" },
    ));
    expect(blocker?.title).toBe("GitHub repository access is not configured");
    expect(blocker?.actionLabel).toBeNull();
  });

  it("keeps human-access copy for gate 8", () => {
    const blocker = describeReadinessBlocker(inputs({ gate: 8, action: "none" }));
    expect(blocker?.title).toBe("No access to this repository");
  });

  it("wires the gate-2 Sign in CTA to the product sign-in flow, never leaving it unrecoverable (PR2-SIGNIN-04)", () => {
    const onSignIn = vi.fn();
    const blocker = describeReadinessBlocker(inputs({ gate: 2, action: "sign_in" }, { onSignIn }));
    expect(blocker?.title).toBe("Sign in to continue");
    expect(blocker?.actionLabel).toBe("Sign in");
    expect(blocker?.onAction).toBeTypeOf("function");
    blocker?.onAction?.();
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("carries the 3-step GitHub checklist on every gate a user can act out of", () => {
    const actionable: RepositoryReadiness[] = [
      { gate: 4, action: "retry" },
      { gate: 5, action: "authorize_user" },
      { gate: 5, action: "reauthorize_user" },
      { gate: 6, action: "install_app" },
      { gate: 6, action: "copy_admin_request" },
      { gate: 7, action: "grant_repo_access" },
      { gate: 8, action: "none" },
    ];

    for (const readiness of actionable) {
      const blocker = describeReadinessBlocker(inputs(readiness));
      expect(blocker?.steps?.map((step) => step.label), readiness.action).toEqual([
        "Authorize your GitHub identity",
        "Install for repository access",
        "Choose a repository",
      ]);
      // Exactly one current step, so the checklist always names one next move.
      expect(
        blocker?.steps?.filter((step) => step.status === "current").length,
        readiness.action,
      ).toBe(1);
    }
  });

  it("advances the checklist with the gate: authorize is current at gate 5 and complete at gate 6", () => {
    const atAuthorize = describeReadinessBlocker(inputs({ gate: 5, action: "authorize_user" }));
    expect(atAuthorize?.steps?.map((step) => step.status)).toEqual([
      "current",
      "upcoming",
      "upcoming",
    ]);

    const atInstall = describeReadinessBlocker(inputs({ gate: 6, action: "install_app" }));
    expect(atInstall?.steps?.map((step) => step.status)).toEqual([
      "complete",
      "current",
      "upcoming",
    ]);

    const atPicker = describeReadinessBlocker(inputs({ gate: 8, action: "none" }));
    expect(atPicker?.steps?.map((step) => step.status)).toEqual([
      "complete",
      "complete",
      "current",
    ]);
  });

  it("tells a non-admin that an admin owns step 2", () => {
    const blocker = describeReadinessBlocker(inputs({ gate: 6, action: "copy_admin_request" }));
    expect(blocker?.steps?.[1]?.description).toBe("An organization admin needs to grant access.");
  });

  it("leaves the out-of-scope operator and sign-in gates without a checklist", () => {
    expect(describeReadinessBlocker(inputs({ gate: 1, action: "none" }))?.steps).toBeUndefined();
    expect(describeReadinessBlocker(inputs({ gate: 2, action: "sign_in" }))?.steps).toBeUndefined();
  });

  it("wires the gate-4 Retry CTA to the authority refetch (S3)", () => {
    const onRetryAuthority = vi.fn();
    const blocker = describeReadinessBlocker(inputs({ gate: 4, action: "retry" }, { onRetryAuthority }));
    expect(blocker?.actionLabel).toBe("Retry");
    expect(blocker?.onAction).toBeTypeOf("function");
    blocker?.onAction?.();
    expect(onRetryAuthority).toHaveBeenCalledTimes(1);
  });
});
