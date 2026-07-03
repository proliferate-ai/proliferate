import { type ReactNode } from "react";
import { Cloud } from "lucide-react";
import { GitHub } from "@proliferate/ui/icons";
import { ProviderBrandIcon } from "@proliferate/product-ui/auth/ProviderBrandIcon";
import { SettingsEmptyState } from "@proliferate/product-ui/settings/SettingsEmptyState";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { Button } from "@proliferate/ui/primitives/Button";
import { useGitHubAppUserAuthorization } from "@/hooks/settings/workflows/use-github-app-user-authorization";
import { type CloudRepoEnvironmentEditor } from "@/hooks/settings/workflows/use-cloud-repo-environment-editor";

// Land the GitHub authorization callback on the cloud environments settings
// surface (the same return target the add-repo flow uses).
const USER_AUTHORIZATION_RETURN_TO =
  "proliferate://settings/environments?source=github_app_callback";

interface RepoCloudGateProps {
  editor: CloudRepoEnvironmentEditor;
  cloudEnabled: boolean;
  cloudActive: boolean;
  cloudSignInChecking: boolean;
  cloudSignInAvailable: boolean;
  children: ReactNode;
}

function CloudEnvironmentNotice({
  label,
  description,
}: {
  label: string;
  description: string;
}) {
  return (
    <SettingsSection title="Cloud environment">
      <SettingsRow label={label} description={description} />
    </SettingsSection>
  );
}

/**
 * Shared gate around the Cloud context of every repo-scope page: GitHub
 * backing → cloud availability/sign-in → config + authority loading →
 * authorization → the "set up Cloud" materialization state, then the page.
 */
export function RepoCloudGate({
  editor,
  cloudEnabled,
  cloudActive,
  cloudSignInChecking,
  cloudSignInAvailable,
  children,
}: RepoCloudGateProps) {
  if (!editor.cloudRepository) {
    return (
      <CloudEnvironmentNotice
        label="Not available"
        description="Cloud environments are available for GitHub-backed repositories."
      />
    );
  }

  if (!cloudEnabled || !cloudActive) {
    const description = !cloudEnabled
      ? "Cloud environments are unavailable in this build or deployment."
      : cloudSignInChecking
        ? "Checking cloud sign-in before loading this environment."
        : cloudSignInAvailable
          ? "Sign in to configure this cloud environment."
          : "GitHub sign-in is unavailable, so cloud environment settings cannot load.";

    return (
      <CloudEnvironmentNotice label="Unavailable" description={description} />
    );
  }

  if (editor.repoConfigsLoading) {
    return (
      <CloudEnvironmentNotice
        label="Loading"
        description="Loading saved cloud environment…"
      />
    );
  }

  if (editor.authority.isLoading) {
    return (
      <CloudEnvironmentNotice
        label="Checking access"
        description="Checking GitHub App access for this repository…"
      />
    );
  }

  if (editor.authority.isError) {
    return (
      <CloudEnvironmentNotice
        label="Access check failed"
        description="GitHub App access for this repository could not be checked."
      />
    );
  }

  // Not authorized: block the cloud context entirely and show a single
  // actionable connect prompt (or a clear admin/access message) instead of
  // half-loading the page behind a passive notice.
  if (editor.authority.data && !editor.authority.data.authorized) {
    return (
      <RepoCloudAuthorizationRequired
        status={editor.authority.data.status}
        message={editor.authority.data.message ?? null}
        onAuthorizationReturn={() => {
          void editor.authority.refetch();
        }}
      />
    );
  }

  if (editor.cloudEnvironment === null) {
    return (
      <SettingsEmptyState
        icon={<Cloud aria-hidden="true" />}
        title="Not set up in Proliferate Cloud"
        description="This repo isn't materialized in Proliferate Cloud yet. Set it up so agents can run it in cloud workspaces without this machine."
        action={
          <div className="flex flex-col items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              loading={editor.saving}
              disabled={editor.saving}
              onClick={() => {
                void editor.setUp();
              }}
            >
              Set up Cloud environment
            </Button>
            {editor.saveError ? (
              <p className="text-ui-sm text-destructive">{editor.saveError}</p>
            ) : null}
          </div>
        }
      />
    );
  }

  return <>{children}</>;
}

/**
 * The not-authorized branch of the gate. User-authorization gaps get an inline
 * "Connect GitHub App" action (the shared authorize flow); installation and
 * repo-access gaps a non-admin can't self-serve stay explanatory messages.
 */
function RepoCloudAuthorizationRequired({
  status,
  message,
  onAuthorizationReturn,
}: {
  status: string;
  message: string | null;
  onAuthorizationReturn: () => void;
}) {
  const needsUserAuthorization =
    status === "missing_user_authorization" || status === "expired_user_authorization";
  const { authorize, authorizing, error } = useGitHubAppUserAuthorization({
    returnTo: USER_AUTHORIZATION_RETURN_TO,
    onAuthorizationReturn,
  });

  if (needsUserAuthorization) {
    const reconnect = status === "expired_user_authorization";
    const actionLabel = authorizing
      ? "Opening GitHub…"
      : reconnect
        ? "Reconnect GitHub App"
        : "Connect GitHub App";
    return (
      <SettingsEmptyState
        icon={<GitHub aria-hidden="true" />}
        title={reconnect ? "Reconnect GitHub App" : "Connect GitHub App"}
        description={
          message
          ?? (reconnect
            ? "Your GitHub App authorization expired. Reconnect it to configure cloud environments for this repository."
            : "Authorize the Proliferate GitHub App to configure cloud environments for this repository.")
        }
        action={
          <div className="flex flex-col items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              loading={authorizing}
              disabled={authorizing}
              onClick={authorize}
            >
              {!authorizing ? (
                <ProviderBrandIcon provider="github" className="size-[13px]" />
              ) : null}
              {actionLabel}
            </Button>
            {error ? <p className="text-ui-sm text-destructive">{error}</p> : null}
          </div>
        }
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

function authorizationRequiredTitle(status: string): string {
  switch (status) {
    case "missing_installation":
      return "GitHub App not installed";
    case "repo_not_covered":
      return "Repository not covered";
    case "missing_user_repo_access":
      return "No access to this repository";
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
      return "Your GitHub user does not have access to this repository.";
    default:
      return "GitHub App repository access is not ready for this cloud environment.";
  }
}
