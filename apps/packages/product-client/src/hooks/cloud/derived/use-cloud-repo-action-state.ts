import { useGitHubRepoAuthority } from "@proliferate/cloud-sdk-react";
import {
  cloudRepoActionStateFromReadiness,
  type CloudWorkspaceRepoTarget,
} from "#product/lib/domain/workspaces/cloud/cloud-workspace-creation";
import { resolveRepositoryReadiness } from "@proliferate/product-domain/repos/repo-readiness";
import { cloudRepositoryKey } from "#product/lib/domain/settings/repositories";
import { useAppCapabilities } from "#product/hooks/capabilities/derived/use-app-capabilities";
import { useProductAuthStatus } from "#product/hooks/auth/facade/use-product-auth";
import { useActiveOrganization } from "#product/hooks/organizations/facade/use-active-organization";
import { isSettingsAdminRole } from "#product/lib/domain/settings/admin-roles";

export function useCloudRepoActionState(args: {
  repoTarget: CloudWorkspaceRepoTarget | null;
  configuredRepoKeys: ReadonlySet<string>;
  isInitialConfigLoad: boolean;
  cloudConnected: boolean;
}) {
  const capabilities = useAppCapabilities();
  const signedIn = useProductAuthStatus() === "authenticated";
  const { activeOrganization } = useActiveOrganization();
  const canManageInstallation = isSettingsAdminRole(activeOrganization?.membership?.role);
  const operatorReady =
    capabilities.githubRepositoryAccessStatus === "ready"
    && capabilities.managedCloudStatus === "ready";
  // The authority endpoint is meaningful only after the deployment and actor
  // gates, but it must run whether or not a Cloud environment already exists.
  // Keep this hook unconditional: the command target changes from null to a
  // repository when a repo's create menu opens.
  const shouldCheckAuthority = args.repoTarget !== null && signedIn && operatorReady;
  const authority = useGitHubRepoAuthority({
    gitOwner: args.repoTarget?.gitOwner,
    gitRepoName: args.repoTarget?.gitRepoName,
  }, shouldCheckAuthority);
  if (!args.repoTarget) {
    return { kind: "hidden", label: null, accessState: "hidden" } as const;
  }
  const configured = args.configuredRepoKeys.has(cloudRepositoryKey(
    args.repoTarget.gitOwner,
    args.repoTarget.gitRepoName,
  ));

  const readiness = resolveRepositoryReadiness({
    requirement: "managed_cloud",
    githubRepositoryAccess: capabilities.githubRepositoryAccessStatus,
    managedCloud: capabilities.managedCloudStatus,
    signedIn,
    hasSupportedRepoIdentity: true,
    authorityLoading: shouldCheckAuthority && authority.isPending && !authority.data,
    authorityError: shouldCheckAuthority && authority.isError,
    authority: authority.data
      ? { authorized: authority.data.authorized, status: authority.data.status }
      : null,
    canManageInstallation,
    cloudEnvironmentConfigured: configured,
  });

  // Repository configuration and authority load concurrently. Once authority
  // is ready, keep the action in a loading state until we know whether gate 9
  // is already satisfied.
  if (args.isInitialConfigLoad && readiness.gate >= 9) {
    return { kind: "loading", label: "Loading cloud...", accessState: "loading" } as const;
  }
  return cloudRepoActionStateFromReadiness(readiness);
}
