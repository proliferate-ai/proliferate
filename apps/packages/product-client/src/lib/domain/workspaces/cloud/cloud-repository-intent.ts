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
 * The one intent the connected Cloud action host owns. Serializable by
 * construction: on cold restart the store is empty and nothing resumes; the
 * settings surfaces are the recovery path.
 *
 * NOTE (PR5-DEAD-04): local clone-from-GitHub is NOT an intent here. It runs
 * entirely inside AddRepoFlowHost's clone picker (`useAddRepoFlowStore` "clone"
 * step → `useCloneRepo`), which owns its own repo picker + GitHub-App gating and
 * does not need this readiness-gate/continuation host. A `clone_from_github`
 * intent kind was previously declared here but never begun by any surface, so it
 * was removed rather than left as dead code. If clone ever needs the browser
 * authorization round-trip this host provides, reintroduce it with a real
 * `begin({ kind: "clone_from_github" })` call site.
 */
export type CloudRepositoryIntent =
  | { kind: "set_up_cloud"; repo: CloudRepoIdentity }
  | {
    kind: "create_cloud_workspace";
    repo: CloudRepoIdentity;
    continuation: CreateCloudWorkspaceContinuation;
  }
  | { kind: "add_cloud_repository"; repo: CloudRepoIdentity };

/**
 * The capability an intent depends on. Every intent this host owns requires
 * managed-Cloud execution readiness (the local clone path is not an intent; see
 * the type note above).
 */
export function requirementForCloudRepositoryIntent(
  _intent: CloudRepositoryIntent,
): RepositoryCapabilityRequirement {
  return "managed_cloud";
}

/** The repository an intent targets. */
export function repoForCloudRepositoryIntent(
  intent: CloudRepositoryIntent,
): CloudRepoIdentity {
  return intent.repo;
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
  /** Complete the original Add Repository flow after registration succeeds. */
  onRepositoryRegistered?: (repo: CloudRepoIdentity) => void;
}): Promise<void> {
  const { intent } = args;

  // Ensure the Cloud repo environment exists first. A retry that already has an
  // environment skips the save so it is not recreated.
  if (!args.cloudEnvironmentConfigured) {
    await args.saveCloudEnvironment(intent.repo);
  }

  if (intent.kind === "create_cloud_workspace") {
    await args.createCloudWorkspace(intent.repo, intent.continuation);
    return;
  }

  if (intent.kind === "add_cloud_repository") {
    args.onRepositoryRegistered?.(intent.repo);
  }
}
