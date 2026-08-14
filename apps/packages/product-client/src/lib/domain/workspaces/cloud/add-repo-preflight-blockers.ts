import {
  resolveRepositoryReadiness,
  type RepositoryCapabilityRequirement,
} from "#product/domain/repos/repo-readiness";
import { describeReadinessBlocker } from "#product/lib/domain/workspaces/cloud/describe-readiness-blocker";
import type { CloudRepoPickerBlockerView } from "#product/lib/domain/workspaces/cloud/cloud-repo-picker-view";

/** GitHub's per-user installation settings page (grant repository access). */
const INSTALLATION_SETTINGS_URL = "https://github.com/settings/installations";

export interface AddRepoPreflightInput {
  githubRepositoryAccessStatus: Parameters<
    typeof resolveRepositoryReadiness
  >[0]["githubRepositoryAccess"];
  managedCloudStatus: Parameters<typeof resolveRepositoryReadiness>[0]["managedCloud"];
  githubAccessDisplayName: string | null;
  signedIn: boolean;
  orgName: string | null;
  /** Leave for the product sign-in flow (gate 2's only move). */
  onSignIn: () => void;
}

/**
 * PR2-GATING-01: the add-repository flow routes through the SAME ordered
 * readiness resolver every other cloud-repo surface uses, so a deployment with
 * operator configuration incomplete shows the "operator must configure"
 * explanation instead of the older prerequisite model's "Authorize GitHub App"
 * CTA.
 *
 * Only the two repo-independent gates (1 operator config, 2 product sign-in)
 * precede repo selection; once past them the per-repo picker (its authority
 * query) owns gates 3+. So resolve with the later gates satisfied and return a
 * blocker only when the resolver stops at gate 1 or 2 — otherwise null, meaning
 * "the picker owns what happens next".
 */
export function buildAddRepoPreflightBlockers(
  input: AddRepoPreflightInput,
): Record<"cloud" | "clone", CloudRepoPickerBlockerView | null> {
  const resolve = (
    requirement: RepositoryCapabilityRequirement,
  ): CloudRepoPickerBlockerView | null => {
    const readiness = resolveRepositoryReadiness({
      requirement,
      githubRepositoryAccess: input.githubRepositoryAccessStatus,
      managedCloud: input.managedCloudStatus,
      signedIn: input.signedIn,
      hasSupportedRepoIdentity: true,
      authorityLoading: false,
      authorityError: false,
      authority: { authorized: true, status: "ready" },
      canManageInstallation: false,
      cloudEnvironmentConfigured: true,
    });
    if (readiness.gate !== 1 && readiness.gate !== 2) {
      return null;
    }
    return describeReadinessBlocker({
      readiness,
      requirement,
      repo: null,
      githubAccessDisplayName: input.githubAccessDisplayName,
      orgName: input.orgName,
      installUrl: INSTALLATION_SETTINGS_URL,
      // Gates 1 and 2 are the only ones this preflight can report, and neither
      // one's copy reaches for an authorize/install/copy/retry action.
      userAuthorization: { authorize: () => {}, authorizing: false, error: null },
      installation: {
        install: () => {},
        openInstallationSettings: () => {},
        installing: false,
        error: null,
      },
      onCopyAdminRequest: () => {},
      onRetryAuthority: () => {},
      onSignIn: input.onSignIn,
    });
  };

  return {
    cloud: resolve("managed_cloud"),
    clone: resolve("github_repository_access"),
  };
}
