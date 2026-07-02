import type { CloudGitRepositorySummary } from "@proliferate/cloud-sdk";
import { formatGitRepoId } from "@proliferate/product-domain/repos/repo-id";
import type {
  AddCloudEnvironmentBlockerView,
} from "@proliferate/product-ui/environments/AddCloudEnvironmentDialog";

export function buildGitHubAppPrerequisiteBlocker({
  organizationId,
  canManageGitHubAppInstallation,
  userAuthorizationLoading,
  userAuthorizationConnected,
  userAuthorizationNeedsReconnect,
  authorizingUser,
  installationLoading,
  installationInstalled,
  installingGitHubApp,
  onAuthorizeUser,
  onInstallGitHubApp,
  onCopyAdminRequest,
}: {
  organizationId: string | null;
  canManageGitHubAppInstallation: boolean;
  userAuthorizationLoading: boolean;
  userAuthorizationConnected: boolean;
  userAuthorizationNeedsReconnect: boolean;
  authorizingUser: boolean;
  installationLoading: boolean;
  installationInstalled: boolean;
  installingGitHubApp: boolean;
  onAuthorizeUser: () => void;
  onInstallGitHubApp: () => void;
  onCopyAdminRequest: () => void;
}): AddCloudEnvironmentBlockerView | null {
  if (!organizationId) {
    return {
      title: "Organization required",
      description: "Cloud environments require an active organization before repositories can be added.",
    };
  }

  if (userAuthorizationLoading || installationLoading) {
    return {
      title: "Checking GitHub App access",
      description: "Proliferate is checking your GitHub authorization and organization installation.",
    };
  }

  if (!userAuthorizationConnected) {
    return {
      title: userAuthorizationNeedsReconnect
        ? "Reauthorize GitHub App"
        : "Authorize GitHub App",
      description: "Authorize the Proliferate GitHub App so Cloud can use your GitHub identity for repository access.",
      actionLabel: userAuthorizationNeedsReconnect
        ? "Reauthorize GitHub App"
        : "Authorize GitHub App",
      actionLoading: authorizingUser,
      onAction: onAuthorizeUser,
    };
  }

  if (!installationInstalled) {
    if (canManageGitHubAppInstallation) {
      return {
        title: "Install GitHub App",
        description: "Install the Proliferate GitHub App for this organization before adding Cloud environments.",
        actionLabel: "Install GitHub App",
        actionLoading: installingGitHubApp,
        onAction: onInstallGitHubApp,
      };
    }
    return {
      title: "GitHub App installation required",
      description: "Ask an organization admin to install the Proliferate GitHub App before adding Cloud environments.",
      actionLabel: "Copy admin request",
      onAction: onCopyAdminRequest,
    };
  }

  return null;
}

export function mergeRepositories(
  current: CloudGitRepositorySummary[],
  incoming: CloudGitRepositorySummary[],
): CloudGitRepositorySummary[] {
  const byId = new Map<string, CloudGitRepositorySummary>();
  for (const repo of current) {
    byId.set(formatGitRepoId(repo), repo);
  }
  for (const repo of incoming) {
    byId.set(formatGitRepoId(repo), repo);
  }
  return Array.from(byId.values());
}

export function repoAuthorityMessage(status: string): string {
  switch (status) {
    case "missing_user_authorization":
      return "Authorize the Proliferate GitHub App in Account settings before adding this cloud environment.";
    case "expired_user_authorization":
      return "Reauthorize the Proliferate GitHub App in Account settings before adding this cloud environment.";
    case "missing_installation":
      return "An organization admin needs to install the Proliferate GitHub App for this repository.";
    case "repo_not_covered":
      return "Update the Proliferate GitHub App installation so it has access to this repository.";
    case "missing_user_repo_access":
      return "Your GitHub user does not have access to this repository.";
    default:
      return "GitHub App repository access is not ready for this repository.";
  }
}
