import { type ReactNode } from "react";
import { Cloud } from "lucide-react";
import { SettingsEmptyState } from "@proliferate/product-ui/settings/SettingsEmptyState";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { Button } from "@proliferate/ui/primitives/Button";
import { type CloudRepoEnvironmentEditor } from "@/hooks/settings/workflows/use-cloud-repo-environment-editor";

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

  if (editor.authority.data && !editor.authority.data.authorized) {
    return (
      <CloudEnvironmentNotice
        label="GitHub App access needed"
        description={editor.authority.data.message ?? repoAuthorityNotice(editor.authority.data.status)}
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

function repoAuthorityNotice(status: string): string {
  switch (status) {
    case "missing_user_authorization":
      return "Authorize the Proliferate GitHub App in Account settings before configuring this cloud environment.";
    case "expired_user_authorization":
      return "Reauthorize the Proliferate GitHub App in Account settings before configuring this cloud environment.";
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
