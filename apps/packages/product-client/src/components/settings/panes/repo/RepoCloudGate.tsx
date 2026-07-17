import { type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Cloud } from "lucide-react";
import { SettingsEmptyState } from "@proliferate/product-ui/settings/SettingsEmptyState";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { Button } from "@proliferate/ui/primitives/Button";
import { resolveRepositoryReadiness } from "@proliferate/product-domain/repos/repo-readiness";
import { useActiveOrganization } from "#product/hooks/organizations/facade/use-active-organization";
import { useAppCapabilities } from "#product/hooks/capabilities/derived/use-app-capabilities";
import { isSettingsAdminRole } from "#product/lib/domain/settings/admin-roles";
import { type CloudRepoEnvironmentEditor } from "#product/hooks/settings/workflows/use-cloud-repo-environment-editor";
import { useProductAuthStatus } from "#product/hooks/auth/facade/use-product-auth";
import { RepoCloudAuthorizationRequired } from "#product/components/settings/panes/repo/RepoCloudAuthorizationRequired";

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
  cloudSignInChecking,
  cloudSignInAvailable,
  children,
}: RepoCloudGateProps) {
  const capabilities = useAppCapabilities();
  const authStatus = useProductAuthStatus();
  const navigate = useNavigate();
  const { activeOrganization } = useActiveOrganization();
  const readiness = resolveRepositoryReadiness({
    requirement: "managed_cloud",
    githubRepositoryAccess: capabilities.githubRepositoryAccessStatus,
    managedCloud: capabilities.managedCloudStatus,
    signedIn: authStatus === "authenticated",
    hasSupportedRepoIdentity: editor.cloudRepository !== null,
    authorityLoading: editor.authority.isLoading,
    authorityError: editor.authority.isError,
    authority: editor.authority.data
      ? {
          authorized: editor.authority.data.authorized,
          status: editor.authority.data.status,
        }
      : null,
    canManageInstallation: isSettingsAdminRole(activeOrganization?.membership?.role),
    cloudEnvironmentConfigured: editor.cloudEnvironment !== null,
  });

  if (!editor.cloudRepository) {
    return (
      <CloudEnvironmentNotice
        label="Not available"
        description="Cloud environments are available for GitHub-backed repositories."
      />
    );
  }

  if (!cloudEnabled) {
    return (
      <CloudEnvironmentNotice
        label="Unavailable"
        description="Cloud environments are unavailable in this build or deployment."
      />
    );
  }

  if (readiness.gate === 1) {
    const appName = capabilities.githubRepositoryAccessDisplayName;
    return (
      <CloudEnvironmentNotice
        label="Not configured"
        description={
          appName
            ? `Cloud repository access for ${appName} isn't fully configured on this deployment. An operator must finish configuring it.`
            : "Managed Cloud isn't fully configured on this deployment. An operator must finish configuring it before repositories can be set up in Cloud."
        }
      />
    );
  }

  if (readiness.gate === 2) {
    if (cloudSignInChecking) {
      return (
        <CloudEnvironmentNotice
          label="Checking sign-in"
          description="Checking product sign-in before loading this environment."
        />
      );
    }
    if (!cloudSignInAvailable) {
      return (
        <CloudEnvironmentNotice
          label="Unavailable"
          description="Product sign-in is unavailable, so cloud environment settings cannot load."
        />
      );
    }
    return (
      <SettingsEmptyState
        icon={<Cloud aria-hidden="true" />}
        title="Sign in to configure Cloud"
        description="Sign in to continue setting up this repository in Proliferate Cloud."
        action={(
          <Button type="button" variant="secondary" onClick={() => navigate("/login")}>
            Sign in
          </Button>
        )}
      />
    );
  }

  if (editor.repoConfigsLoading || (readiness.gate === 4 && readiness.action === "none")) {
    return (
      <CloudEnvironmentNotice
        label="Loading"
        description="Loading saved cloud environment…"
      />
    );
  }

  if (readiness.gate === 4) {
    return (
      <SettingsEmptyState
        icon={<Cloud aria-hidden="true" />}
        title="Access check failed"
        description="GitHub App access for this repository could not be checked."
        action={(
          <Button
            type="button"
            variant="secondary"
            onClick={() => { void editor.authority.refetch(); }}
          >
            Retry
          </Button>
        )}
      />
    );
  }

  // Not authorized: block the cloud context entirely and show a single
  // actionable connect prompt (or a clear admin/access message) instead of
  // half-loading the page behind a passive notice.
  if (readiness.gate >= 5 && readiness.gate <= 8 && editor.authority.data) {
    return (
      <RepoCloudAuthorizationRequired
        status={editor.authority.data.status}
        action={editor.authority.data.action ?? null}
        message={editor.authority.data.message ?? null}
        onAuthorizationReturn={() => {
          void editor.authority.refetch();
        }}
      />
    );
  }

  if (readiness.gate === 9) {
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
