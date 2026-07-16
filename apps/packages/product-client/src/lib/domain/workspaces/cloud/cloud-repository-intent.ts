import type { RepositoryCapabilityRequirement } from "@proliferate/product-domain/repos/repo-readiness";

/**
 * A minimal, serializable GitHub repository identity. Only owner/name/provider
 * — no display strings, no closures — so an intent survives a browser callback
 * round-trip held in memory.
 */
export interface CloudRepoIdentity {
  gitProvider: "github";
  gitOwner: string;
  gitRepoName: string;
}

/**
 * Everything the create-cloud-workspace continuation needs, kept as a minimal
 * serializable object rather than a captured closure so it can be held across a
 * browser authorization callback while the app stays open.
 */
export interface CreateCloudWorkspaceContinuation {
  repoGroupKeyToExpand: string | null;
  baseBranch: string | null;
}

/**
 * Everything the clone-from-github continuation needs, kept as a minimal
 * serializable object rather than a captured closure so it survives a browser
 * authorization callback while the app stays open. `destinationParentPath` is
 * the user-chosen parent directory the clone lands under; null means the host
 * still needs to prompt for it.
 */
export interface CloneFromGitHubContinuation {
  repoGroupKeyToExpand: string | null;
  cloneUrl: string;
  defaultBranch: string | null;
  destinationParentPath: string | null;
}

/**
 * The one intent the connected Cloud action host owns. Serializable by
 * construction: on cold restart the store is empty and nothing resumes; the
 * settings surfaces are the recovery path.
 */
export type CloudRepositoryIntent =
  | { kind: "set_up_cloud"; repo: CloudRepoIdentity }
  | {
    kind: "create_cloud_workspace";
    repo: CloudRepoIdentity;
    continuation: CreateCloudWorkspaceContinuation;
  }
  | {
    kind: "clone_from_github";
    repo: CloudRepoIdentity;
    continuation: CloneFromGitHubContinuation;
  }
  | { kind: "add_cloud_repository" };

/**
 * The capability an intent depends on. Every managed-Cloud intent
 * (set_up_cloud / create_cloud_workspace / add_cloud_repository) requires
 * managed-Cloud execution readiness, but `clone_from_github` only needs GitHub
 * repository access: a GitHub-App-ready deployment with managed Cloud disabled
 * can still clone locally, so it must not be gated behind managed Cloud.
 */
export function requirementForCloudRepositoryIntent(
  intent: CloudRepositoryIntent,
): RepositoryCapabilityRequirement {
  return intent.kind === "clone_from_github" ? "github_repository_access" : "managed_cloud";
}

/** The repository an intent targets, or null for the repo-agnostic add flow. */
export function repoForCloudRepositoryIntent(
  intent: CloudRepositoryIntent,
): CloudRepoIdentity | null {
  return intent.kind === "add_cloud_repository" ? null : intent.repo;
}

/**
 * Run the held intent once all readiness gates are green. Pure orchestration
 * (no React, no SDK) so the ordering is unit-testable: a setup-and-continue
 * intent MUST save the Cloud repo environment before creating the workspace,
 * and a workspace-create retry must not recreate an environment that already
 * exists.
 */
export async function continueCloudRepositoryIntent(args: {
  intent: CloudRepositoryIntent;
  /** True when a Cloud repo environment already exists for the target repo. */
  cloudEnvironmentConfigured: boolean;
  /** Save a Cloud repo environment for the target repo. */
  saveCloudEnvironment: (repo: CloudRepoIdentity) => Promise<void>;
  /** Create (and enter) a Cloud workspace for the target repo. */
  createCloudWorkspace: (
    repo: CloudRepoIdentity,
    continuation: CreateCloudWorkspaceContinuation,
  ) => Promise<void>;
  /** Clone the target GitHub repository to this machine. */
  cloneFromGitHub?: (
    repo: CloudRepoIdentity,
    continuation: CloneFromGitHubContinuation,
  ) => Promise<void>;
}): Promise<void> {
  const { intent } = args;

  if (intent.kind === "add_cloud_repository") {
    // The repo picker owns its own save; nothing to continue here.
    return;
  }

  // Clone never touches the Cloud repo environment: it uses only GitHub
  // repository access + the local Git credential chain, so it must not create a
  // managed-Cloud environment as a side effect.
  if (intent.kind === "clone_from_github") {
    await args.cloneFromGitHub?.(intent.repo, intent.continuation);
    return;
  }

  // Ensure the Cloud repo environment exists first. A retry that already has an
  // environment skips the save so it is not recreated.
  if (!args.cloudEnvironmentConfigured) {
    await args.saveCloudEnvironment(intent.repo);
  }

  if (intent.kind === "create_cloud_workspace") {
    await args.createCloudWorkspace(intent.repo, intent.continuation);
  }
}
