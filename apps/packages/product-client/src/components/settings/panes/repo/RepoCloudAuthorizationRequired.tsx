import { Cloud } from "lucide-react";
import { GitHub } from "@proliferate/ui/icons";
import { ProviderBrandIcon } from "@proliferate/product-ui/auth/ProviderBrandIcon";
import { SettingsEmptyState } from "@proliferate/product-ui/settings/SettingsEmptyState";
import { Button } from "@proliferate/ui/primitives/Button";
import type { GitHubRepoAuthorityAction } from "@proliferate/cloud-sdk";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useActiveOrganization } from "#product/hooks/organizations/facade/use-active-organization";
import { isSettingsAdminRole } from "#product/lib/domain/settings/admin-roles";
import { buildCloudAdminRequestMessage } from "#product/lib/domain/settings/github-app-copy";
import { useGitHubAppInstallation } from "#product/hooks/settings/workflows/use-github-app-installation";
import { useGitHubAppUserAuthorization } from "#product/hooks/settings/workflows/use-github-app-user-authorization";

const INSTALLATION_SETTINGS_URL = "https://github.com/settings/installations";

/** Render the one repair action for a repository-authority gate. */
export function RepoCloudAuthorizationRequired({
  status,
  action,
  message,
  onAuthorizationReturn,
}: {
  status: string;
  action: GitHubRepoAuthorityAction | null;
  message: string | null;
  onAuthorizationReturn: () => void;
}) {
  const { activeOrganization, activeOrganizationId } = useActiveOrganization();
  const { links, clipboard } = useProductHost();
  const canManageInstallation = isSettingsAdminRole(activeOrganization?.membership?.role);
  const userAuthorization = useGitHubAppUserAuthorization({
    returnTo: links.buildReturnUrl({
      kind: "settings",
      section: "environments",
      source: "github_app_callback",
    }),
    onAuthorizationReturn,
  });
  const installation = useGitHubAppInstallation({
    organizationId: activeOrganizationId,
    returnTo: links.buildReturnUrl({
      kind: "settings",
      section: "environments",
      query: [["source", "github_app_installation_callback"]],
    }),
    onInstallationReturn: onAuthorizationReturn,
  });

  if (status === "operator_configuration_required") {
    return (
      <SettingsEmptyState
        icon={<Cloud aria-hidden="true" />}
        title="Cloud is not configured on this deployment"
        description={
          message
          ?? "Managed Cloud isn't fully configured on this deployment. An operator must finish configuring the Proliferate GitHub App before repositories can be set up in Cloud."
        }
      />
    );
  }

  if ((action === "install_app" || action === "grant_repo_access") && !canManageInstallation) {
    return (
      <RepoAuthorityActionState
        title="Ask an admin"
        description={
          message
          ?? "You don't have permission to install or grant access to the Proliferate GitHub App. Copy a request to send to an organization admin."
        }
        actionLabel="Copy request"
        error={null}
        onAction={() => {
          void clipboard.writeText(
            buildCloudAdminRequestMessage({
              orgName: activeOrganization?.name ?? null,
              repo: null,
              installUrl: INSTALLATION_SETTINGS_URL,
            }),
          );
        }}
      />
    );
  }

  if (action === "authorize_user" || action === "reauthorize_user") {
    const reconnect = action === "reauthorize_user";
    const actionLabel = userAuthorization.authorizing
      ? "Opening GitHub…"
      : reconnect
        ? "Reconnect GitHub App"
        : "Connect GitHub App";
    return (
      <RepoAuthorityActionState
        title={reconnect ? "Reconnect GitHub App" : "Connect GitHub App"}
        description={
          message
          ?? (reconnect
            ? "Your GitHub App authorization expired. Reconnect it to configure cloud environments for this repository."
            : "Authorize the Proliferate GitHub App to configure cloud environments for this repository.")
        }
        actionLabel={actionLabel}
        withGitHubIcon={!userAuthorization.authorizing}
        loading={userAuthorization.authorizing}
        error={userAuthorization.error}
        onAction={userAuthorization.authorize}
      />
    );
  }

  if (action === "install_app" && activeOrganizationId) {
    return (
      <RepoAuthorityActionState
        title="Install Proliferate GitHub App"
        description={
          message
          ?? "Install the Proliferate GitHub App for your organization to configure cloud environments for this repository."
        }
        actionLabel={installation.installing ? "Opening GitHub…" : "Install Proliferate GitHub App"}
        loading={installation.installing}
        error={installation.error}
        onAction={installation.install}
      />
    );
  }

  if (action === "grant_repo_access") {
    return (
      <RepoAuthorityActionState
        title="Grant repository access"
        description={
          message
          ?? "Update the Proliferate GitHub App installation so it has access to this repository."
        }
        actionLabel="Grant repository access"
        error={installation.error}
        onAction={installation.openInstallationSettings}
      />
    );
  }

  return (
    <SettingsEmptyState
      icon={<GitHub aria-hidden="true" />}
      title={authorizationRequiredTitle(status)}
      description={message ?? repoAuthorityNotice(status)}
    />
  );
}

function RepoAuthorityActionState({
  title,
  description,
  actionLabel,
  withGitHubIcon = false,
  loading = false,
  error,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  withGitHubIcon?: boolean;
  loading?: boolean;
  error: string | null;
  onAction: () => void;
}) {
  return (
    <SettingsEmptyState
      icon={<GitHub aria-hidden="true" />}
      title={title}
      description={description}
      action={
        <div className="flex flex-col items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            loading={loading}
            disabled={loading}
            onClick={onAction}
          >
            {withGitHubIcon ? (
              <ProviderBrandIcon provider="github" className="icon-control" />
            ) : null}
            {actionLabel}
          </Button>
          {error ? <p className="text-ui-sm text-destructive">{error}</p> : null}
        </div>
      }
    />
  );
}

function authorizationRequiredTitle(status: string): string {
  switch (status) {
    case "missing_installation":
      return "GitHub App not installed";
    case "repo_not_covered":
      return "Repository not covered";
    case "missing_user_repo_access":
      return "No access to this repository";
    case "operator_configuration_required":
      return "Cloud is not configured on this deployment";
    default:
      return "GitHub App access needed";
  }
}

function repoAuthorityNotice(status: string): string {
  switch (status) {
    case "missing_installation":
      return "An organization admin needs to install the Proliferate GitHub App for this repository.";
    case "repo_not_covered":
      return "Update the Proliferate GitHub App installation so it has access to this repository.";
    case "missing_user_repo_access":
      return "Your GitHub user does not have access to this repository. Ask a repository admin on GitHub to grant you access.";
    case "operator_configuration_required":
      return "An operator must finish configuring the Proliferate GitHub App on this deployment.";
    default:
      return "GitHub App repository access is not ready for this cloud environment.";
  }
}
