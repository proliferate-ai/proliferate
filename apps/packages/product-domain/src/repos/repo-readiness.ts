/**
 * Pure, DOM-free repository readiness resolver.
 *
 * One ordered model shared by Desktop and Web: Add Repository, the repo `…`
 * menu, right-click, New Cloud Workspace, and Account/Org/Repo settings all
 * present the first unmet prerequisite and exactly one repair action. No React,
 * no SDK calls, no platform APIs — this receives already-fetched state and
 * returns a stable gate + action.
 */

/** Operator readiness of a deployment capability, mirroring the v2 wire enum. */
export type OperatorCapabilityStatus =
  | "disabled"
  | "operator_configuration_required"
  | "ready";

/**
 * What a caller's intent requires from the deployment. `Add an existing folder`
 * is `local_only`; `Clone from GitHub` (PR 5) is `github_repository_access`;
 * `Set up in Cloud` and Cloud workspace creation are `managed_cloud`. A disabled
 * managed-Cloud capability must not block a `github_repository_access` intent.
 */
export type RepositoryCapabilityRequirement =
  | "local_only"
  | "github_repository_access"
  | "managed_cloud";

/** Stable repair actions. Human access and operator configuration are `none`. */
export type CloudRepoReadinessAction =
  | "none"
  | "sign_in"
  | "retry"
  | "authorize_user"
  | "reauthorize_user"
  | "install_app"
  | "grant_repo_access"
  | "copy_admin_request"
  | "set_up_cloud";

/** Per-repository GitHub authority, as returned by the authority endpoint. */
export type RepoAuthorityStatus =
  | "ready"
  | "missing_user_authorization"
  | "expired_user_authorization"
  | "missing_installation"
  | "repo_not_covered"
  | "missing_user_repo_access"
  | "operator_configuration_required"
  | "error";

export interface RepoAuthoritySnapshot {
  authorized: boolean;
  status: RepoAuthorityStatus;
}

export interface RepositoryReadinessInput {
  requirement: RepositoryCapabilityRequirement;
  /** Operator readiness of GitHub repository discovery/authority. */
  githubRepositoryAccess: OperatorCapabilityStatus;
  /** Operator readiness of managed-Cloud workspace execution. */
  managedCloud: OperatorCapabilityStatus;
  /** Whether the user is signed into the product control plane. */
  signedIn: boolean;
  /** Whether the target repo has a supported GitHub owner/name identity. */
  hasSupportedRepoIdentity: boolean;
  /** Per-repo authority query is in flight (or not yet resolved). */
  authorityLoading: boolean;
  /** Per-repo authority query failed. */
  authorityError: boolean;
  /** Latest per-repo authority result, or null when not yet available. */
  authority: RepoAuthoritySnapshot | null;
  /** The member can install / grant repository access for the organization. */
  canManageInstallation: boolean;
  /** A Cloud repo environment already exists for this repository. */
  cloudEnvironmentConfigured: boolean;
}

export interface RepositoryReadiness {
  /** The first unmet ordered gate (1–10); 10 means ready. */
  gate: number;
  action: CloudRepoReadinessAction;
}

const READY: RepositoryReadiness = { gate: 10, action: "none" };

/** The operator capability an intent depends on, or null for local-only. */
function requiredOperatorCapability(
  input: RepositoryReadinessInput,
): OperatorCapabilityStatus | null {
  switch (input.requirement) {
    case "local_only":
      return null;
    case "github_repository_access":
      return input.githubRepositoryAccess;
    case "managed_cloud":
      return input.managedCloud;
  }
}

/**
 * Resolve the first unmet ordered gate and its single repair action.
 *
 * Only the first unmet gate surfaces. Human access (gate 8) and operator
 * configuration (gate 1) resolve to action `none` because neither the user nor
 * this client can repair them here.
 */
export function resolveRepositoryReadiness(
  input: RepositoryReadinessInput,
): RepositoryReadiness {
  // `local_only` never touches Cloud/authority gates — a local folder is always
  // ready to register.
  if (input.requirement === "local_only") {
    return READY;
  }

  // Gate 1: required operator capability disabled / operator incomplete.
  const operatorCapability = requiredOperatorCapability(input);
  if (operatorCapability !== null && operatorCapability !== "ready") {
    return { gate: 1, action: "none" };
  }

  // Gate 2: product sign-in.
  if (!input.signedIn) {
    return { gate: 2, action: "sign_in" };
  }

  // Gate 3: supported GitHub repository identity.
  if (!input.hasSupportedRepoIdentity) {
    return { gate: 3, action: "none" };
  }

  // Gate 4: capability / authority query loading or failure.
  if (input.authorityError) {
    return { gate: 4, action: "retry" };
  }
  if (input.authorityLoading || input.authority === null) {
    return { gate: 4, action: "none" };
  }

  const authority = input.authority;
  if (!(authority.authorized && authority.status === "ready")) {
    switch (authority.status) {
      // Server-side operator gate can also surface per-repo; only the operator
      // can repair it.
      case "operator_configuration_required":
        return { gate: 1, action: "none" };
      // Gate 5: user App authorization / re-authorization.
      case "missing_user_authorization":
        return { gate: 5, action: "authorize_user" };
      case "expired_user_authorization":
        return { gate: 5, action: "reauthorize_user" };
      // Gate 6: organization App installation and role.
      case "missing_installation":
        return {
          gate: 6,
          action: input.canManageInstallation ? "install_app" : "copy_admin_request",
        };
      // Gate 7: repository coverage and role.
      case "repo_not_covered":
        return {
          gate: 7,
          action: input.canManageInstallation ? "grant_repo_access" : "copy_admin_request",
        };
      // Gate 8: human GitHub repository access (repaired on GitHub, not here).
      case "missing_user_repo_access":
        return { gate: 8, action: "none" };
      // Any other non-ready status is treated as a query failure to retry.
      case "error":
      case "ready":
      default:
        return { gate: 4, action: "retry" };
    }
  }

  // Gate 9: Cloud repo environment setup (managed Cloud only — a Clone consumer
  // needs GitHub access ready, not a Cloud environment).
  if (input.requirement === "managed_cloud" && !input.cloudEnvironmentConfigured) {
    return { gate: 9, action: "set_up_cloud" };
  }

  // Gate 10: ready.
  return READY;
}

/**
 * True when a `managed_cloud` intent is blocked at gate 1 (operator capability
 * disabled / operator configuration incomplete) for a signed-in user with a
 * supported repo identity — i.e. the deployment itself is not configured, so no
 * user action (sign-in, authorize, install, grant) can repair it. Surfaces use
 * this to show the operator explanation instead of a user-auth CTA, routing the
 * decision through the same resolver every other cloud-repo surface uses.
 */
export function isManagedCloudOperatorGateUnmet(input: {
  githubRepositoryAccess: OperatorCapabilityStatus;
  managedCloud: OperatorCapabilityStatus;
}): boolean {
  return (
    resolveRepositoryReadiness({
      requirement: "managed_cloud",
      githubRepositoryAccess: input.githubRepositoryAccess,
      managedCloud: input.managedCloud,
      signedIn: true,
      hasSupportedRepoIdentity: true,
      authorityLoading: false,
      authorityError: false,
      authority: { authorized: true, status: "ready" },
      canManageInstallation: false,
      cloudEnvironmentConfigured: true,
    }).gate === 1
  );
}
