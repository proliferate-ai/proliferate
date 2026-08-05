import { type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Cloud } from "lucide-react";
import { SettingsEmptyState } from "#product/components/patterns/SettingsEmptyState";
import { Button } from "#product/primitives/Button";
import { resolveRepositoryReadiness } from "#product/domain/repos/repo-readiness";
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

function CloudGateState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <SettingsEmptyState
      icon={<Cloud aria-hidden="true" />}
      title={title}
      description={description}
    />
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
      <CloudGateState
        title="GitHub repository required"
        description="Cloud environments require a GitHub-backed repository."
      />
    );
  }

  if (!cloudEnabled) {
    return (
      <CloudGateState
        title="Cloud unavailable"
        description="This build does not support cloud environments."
      />
    );
  }

  if (readiness.gate === 1) {
    const appName = capabilities.githubRepositoryAccessDisplayName;
    return (
      <CloudGateState
        title="Cloud needs deployment setup"
        description={
          appName
            ? `An operator must finish configuring ${appName} access.`
            : "An operator must finish configuring Managed Cloud."
        }
      />
    );
  }

  if (readiness.gate === 2) {
    if (cloudSignInChecking) {
      return (
        <CloudGateState
          title="Checking sign-in"
          description="Loading Cloud access."
        />
      );
    }
    if (!cloudSignInAvailable) {
      return (
        <CloudGateState
          title="Sign-in unavailable"
          description="This build cannot open cloud environment settings."
        />
      );
    }
    return (
      <SettingsEmptyState
        icon={<Cloud aria-hidden="true" />}
        title="Sign in to use Cloud"
        description="Sign in to configure this repository's cloud environment."
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
      <CloudGateState
        title="Loading cloud environment"
        description="Loading saved settings."
      />
    );
  }

  if (readiness.gate === 4) {
    return (
      <SettingsEmptyState
        icon={<Cloud aria-hidden="true" />}
        title="Could not check access"
        description="GitHub App access is unavailable for this repository."
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
        title="Set up a Cloud environment"
        description="Create a remote environment for agents to run this repository."
        action={
          <div className="flex flex-col items-center gap-2">
            <Button
              type="button"
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
