/**
 * Pure helpers that shape already-fetched mobile access state into inputs for
 * the shared `resolveRepositoryReadiness` resolver — so mobile reuses the exact
 * Desktop/Web gate ordering and vocabulary rather than re-implementing policy.
 *
 * No React, no SDK, no platform APIs. Unit-tested directly.
 */

import type {
  RepoAuthoritySnapshot,
  RepoAuthorityStatus,
} from "@proliferate/product-domain/repos/repo-readiness";

/** GitHub App user-authorization status wire values the resolver cares about. */
export type MobileUserAuthorizationState =
  | "unknown"
  | "connected"
  | "needs_authorize"
  | "needs_reauthorize";

/** GitHub App installation status wire values the resolver cares about. */
export type MobileInstallationState =
  | "unknown"
  | "installed"
  | "missing";

/**
 * Synthesize a list-level authority snapshot (before any specific repo is
 * chosen) from the account-level GitHub App user-authorization and
 * organization installation states.
 *
 * The list picker cannot know per-repo coverage or human access, so it gates
 * only through installation; repo coverage (`repo_not_covered`) and human
 * access (`missing_user_repo_access`) are resolved per-repo when a repository
 * is picked, via the authority endpoint. Returns `null` when either input is
 * still unknown/loading so the resolver reports gate 4 (checking).
 */
export function synthesizeListAuthority(input: {
  userAuthorization: MobileUserAuthorizationState;
  installation: MobileInstallationState;
  /** Whether an organization is required for installation (i.e. one exists). */
  requiresInstallation: boolean;
}): RepoAuthoritySnapshot | null {
  const { userAuthorization, installation, requiresInstallation } = input;

  if (userAuthorization === "unknown") {
    return null;
  }
  if (userAuthorization === "needs_authorize") {
    return notReady("missing_user_authorization");
  }
  if (userAuthorization === "needs_reauthorize") {
    return notReady("expired_user_authorization");
  }

  // User is connected; check organization installation.
  if (requiresInstallation) {
    if (installation === "unknown") {
      return null;
    }
    if (installation === "missing") {
      return notReady("missing_installation");
    }
  }

  return { authorized: true, status: "ready" };
}

function notReady(status: RepoAuthorityStatus): RepoAuthoritySnapshot {
  return { authorized: false, status };
}

export interface MobileInstallationOrg {
  id: string;
  role: "owner" | "admin" | "member" | null;
}

export interface MobileInstallationTarget {
  organizationId: string | null;
  canManageInstallation: boolean;
}

/**
 * Choose the organization mobile installs / grants against. Mobile has no
 * active-org switcher, so pick the first organization the member can manage
 * (owner/admin); otherwise the first organization (member, request-only).
 * Returns a null org when the user belongs to no organizations — a
 * personal-only user needs no installation gate.
 */
export function resolveMobileInstallationTarget(
  organizations: readonly MobileInstallationOrg[],
): MobileInstallationTarget {
  if (organizations.length === 0) {
    return { organizationId: null, canManageInstallation: false };
  }
  const manageable = organizations.find(
    (org) => org.role === "owner" || org.role === "admin",
  );
  const chosen = manageable ?? organizations[0];
  return {
    organizationId: chosen.id,
    canManageInstallation: chosen.role === "owner" || chosen.role === "admin",
  };
}
