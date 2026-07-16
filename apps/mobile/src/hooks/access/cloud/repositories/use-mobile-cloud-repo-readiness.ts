import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  githubAppRootKey,
  repositoriesKey,
  useCloudClient,
  useGitHubAppInstallationStatus,
  useGitHubAppUserAuthorizationStatus,
  useGitHubRepoAuthority,
  useOrganizations,
} from "@proliferate/cloud-sdk-react";
import {
  resolveRepositoryReadiness,
  type RepositoryReadiness,
} from "@proliferate/product-domain/repos/repo-readiness";
import * as Clipboard from "expo-clipboard";

import {
  openMobileGitHubAppInstallation,
  openMobileGitHubAppUserAuthorization,
  openMobileGitHubInstallationSettings,
} from "../../../../lib/access/cloud/auth/mobile-auth-flow";
import {
  resolveMobileInstallationTarget,
  synthesizeListAuthority,
  type MobileInstallationState,
  type MobileUserAuthorizationState,
} from "../../../../lib/domain/repos/mobile-repo-access-inputs";
import {
  buildMobileCloudAdminRequestMessage,
  resolveMobileRepoReadinessBlocker,
  type MobileRepoReadinessActionKind,
  type MobileRepoReadinessBlocker,
} from "../../../../lib/domain/repos/mobile-repo-readiness-blocker";
import { useMobileServerCapabilities } from "../capabilities/use-mobile-server-capabilities";

export interface MobileCloudRepoReadiness {
  /** The resolver result; `gate === 10` means every prerequisite is met. */
  readiness: RepositoryReadiness;
  /** The single blocker to render, or null when ready to list / save. */
  blocker: MobileRepoReadinessBlocker | null;
  /** True while any prerequisite query is still loading. */
  checking: boolean;
  /** Perform the blocker's CTA (opens browser / copies request / refetches). */
  runAction: (kind: MobileRepoReadinessActionKind) => Promise<void>;
  /** Invalidate all access queries and re-run the resolver (callback return). */
  refetchOnReturn: () => void;
}

/**
 * Shared readiness gate for the mobile Cloud repository surfaces — the Add
 * Repository modal (list level) and workspace creation. Assembles the
 * already-fetched GitHub App / capability / organization state into the shared
 * `resolveRepositoryReadiness` resolver, so mobile uses the exact Desktop/Web
 * gate ordering and vocabulary, and exposes the native browser actions plus the
 * callback-return invalidation the spec requires.
 *
 * Pass a concrete `repo` to gate per-repository (authority query runs);
 * omit it (or pass null) for the list-level gate before a repo is chosen —
 * authority is then synthesized from account-level authorization/installation.
 */
export function useMobileCloudRepoReadiness(input: {
  enabled: boolean;
  repo?: { gitOwner: string; gitRepoName: string } | null;
}): MobileCloudRepoReadiness {
  const { enabled } = input;
  const repo = input.repo ?? null;
  const client = useCloudClient();
  const queryClient = useQueryClient();
  const [actionBusy, setActionBusy] = useState(false);

  const capabilities = useMobileServerCapabilities(enabled);
  const managedCloudStatus = capabilities.data?.managedCloud ?? "disabled";
  const githubAccessStatus = capabilities.data?.githubRepositoryAccess ?? "disabled";
  const githubAccessDisplayName =
    capabilities.data?.githubRepositoryAccessDisplayName ?? null;

  // Managed Cloud disabled/operator-incomplete short-circuits: never call the
  // repository authority endpoint (spec failure behavior).
  const capabilityReady = enabled && managedCloudStatus === "ready";

  const organizations = useOrganizations(enabled);
  const installationTarget = useMemo(
    () =>
      resolveMobileInstallationTarget(
        (organizations.data?.organizations ?? []).map((org) => ({
          id: org.id,
          role: org.membership?.role ?? null,
        })),
      ),
    [organizations.data?.organizations],
  );

  const userAuthorization = useGitHubAppUserAuthorizationStatus(capabilityReady);
  const installation = useGitHubAppInstallationStatus(
    installationTarget.organizationId,
    capabilityReady && installationTarget.organizationId !== null,
  );

  // Per-repo authority: only when a concrete repo is targeted and capability is
  // ready and the user is authorized (avoids a doomed call before auth).
  const authorityEnabled =
    capabilityReady
    && repo !== null
    && userAuthorization.data?.connected === true;
  const authority = useGitHubRepoAuthority(
    { gitOwner: repo?.gitOwner, gitRepoName: repo?.gitRepoName },
    authorityEnabled,
  );

  const readiness = useMemo<RepositoryReadiness>(() => {
    const userAuthState: MobileUserAuthorizationState = userAuthorization.isLoading
      ? "unknown"
      : userAuthorization.data?.connected === true
        ? "connected"
        : userAuthorization.data?.action === "reauthorize"
          ? "needs_reauthorize"
          : "needs_authorize";
    const installationState: MobileInstallationState = installation.isLoading
      ? "unknown"
      : installation.data?.installed === true
        ? "installed"
        : "missing";

    // For the per-repo gate use the authority endpoint result; for the
    // list-level gate synthesize authority from account-level state.
    const authoritySnapshot = repo
      ? authority.data
        ? { authorized: authority.data.authorized, status: authority.data.status }
        : null
      : synthesizeListAuthority({
          userAuthorization: userAuthState,
          installation: installationState,
          requiresInstallation: installationTarget.organizationId !== null,
        });

    return resolveRepositoryReadiness({
      requirement: "managed_cloud",
      githubRepositoryAccess: githubAccessStatus,
      managedCloud: managedCloudStatus,
      // Mobile is only reachable when signed in.
      signedIn: true,
      // List level has no specific repo identity yet — treat as supported so
      // the gate advances to authority; the per-repo gate always has identity.
      hasSupportedRepoIdentity: true,
      authorityLoading: repo
        ? authorityEnabled && authority.isPending && !authority.data
        : userAuthorization.isLoading || installation.isLoading,
      authorityError: repo ? authority.isError : false,
      authority: authoritySnapshot,
      canManageInstallation: installationTarget.canManageInstallation,
      // The list surface saves the environment on pick; treat as not-yet so the
      // resolver reports gate 9 (ready-to-save) rather than gate 10.
      cloudEnvironmentConfigured: false,
    });
  }, [
    authority.data,
    authority.isError,
    authority.isPending,
    authorityEnabled,
    githubAccessStatus,
    installation.data?.installed,
    installation.isLoading,
    installationTarget.canManageInstallation,
    installationTarget.organizationId,
    managedCloudStatus,
    repo,
    userAuthorization.data?.action,
    userAuthorization.data?.connected,
    userAuthorization.isLoading,
  ]);

  // While capabilities are still loading, `managedCloudStatus` above has
  // fail-closed to "disabled" and the resolver reports gate 1 on placeholder
  // input. Route that through the blocker's checking presentation instead of
  // "Cloud is not configured on this deployment" so a fully-configured
  // deployment does not flash the operator-blocker copy on cold open.
  const checking =
    capabilities.isLoading
    || (capabilityReady
      && (userAuthorization.isLoading || (installationTarget.organizationId !== null && installation.isLoading)));

  const blocker = useMemo(
    () =>
      resolveMobileRepoReadinessBlocker({
        readiness,
        githubAccessDisplayName,
        actionBusy,
        checking: capabilities.isLoading,
      }),
    [actionBusy, capabilities.isLoading, githubAccessDisplayName, readiness],
  );

  const refetchOnReturn = useCallback(() => {
    // Callback return: invalidate user authorization, installation, accessible
    // repos, and per-repo authority (all under the GitHub App root), plus
    // repositories, so the resolver re-runs with fresh state.
    void queryClient.invalidateQueries({ queryKey: githubAppRootKey(client.baseUrl) });
    void queryClient.invalidateQueries({ queryKey: repositoriesKey() });
  }, [client.baseUrl, queryClient]);

  const runAction = useCallback(
    async (kind: MobileRepoReadinessActionKind) => {
      if (actionBusy) {
        return;
      }
      setActionBusy(true);
      try {
        switch (kind) {
          case "retry":
            refetchOnReturn();
            break;
          case "authorize_user":
          case "reauthorize_user":
            await openMobileGitHubAppUserAuthorization(client);
            break;
          case "install_app":
            if (installationTarget.organizationId) {
              await openMobileGitHubAppInstallation(
                client,
                installationTarget.organizationId,
              );
            }
            break;
          case "grant_repo_access":
            await openMobileGitHubInstallationSettings();
            break;
          case "copy_admin_request":
            await Clipboard.setStringAsync(
              buildMobileCloudAdminRequestMessage(
                repo ? `${repo.gitOwner}/${repo.gitRepoName}` : null,
              ),
            );
            break;
          case "none":
            break;
        }
      } finally {
        setActionBusy(false);
      }
    },
    [actionBusy, client, installationTarget.organizationId, refetchOnReturn, repo],
  );

  return { readiness, blocker, checking, runAction, refetchOnReturn };
}
