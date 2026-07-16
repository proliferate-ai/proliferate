import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCloudClient,
  useGitHubRepoAuthority,
  useRepositories,
  useSaveRepoEnvironment,
  useValidateCloudRepoBranches,
} from "@proliferate/cloud-sdk-react";
import {
  githubAppRootKey,
  repositoriesKey,
} from "@proliferate/cloud-sdk-react";
import { buildMinimalCloudEnvironmentConfigRequest } from "@proliferate/product-domain/environments/cloud-environments";
import {
  resolveRepositoryReadiness,
  type RepositoryReadiness,
} from "@proliferate/product-domain/repos/repo-readiness";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@proliferate/ui/kit/Dialog";
import { CloudRepoPickerBlocker } from "@proliferate/product-ui/repos/CloudRepoPickerBlocker";
import type { CloudRepoPickerBlockerView } from "@proliferate/product-ui/repos/CloudRepoPicker";
import { describeReadinessBlocker } from "#product/lib/domain/workspaces/cloud/describe-readiness-blocker";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useCloudRepositoryIntentStore } from "#product/stores/cloud/cloud-repository-intent-store";
import {
  continueCloudRepositoryIntent,
  repoForCloudRepositoryIntent,
  type CloudRepoIdentity,
  type CloudRepositoryIntent,
  type CreateCloudWorkspaceContinuation,
} from "#product/lib/domain/workspaces/cloud/cloud-repository-intent";
import { buildConfiguredCloudRepoKeys } from "#product/lib/domain/workspaces/cloud/cloud-workspace-creation";
import { cloudRepositoryKey } from "#product/lib/domain/settings/repositories";
import { useActiveOrganization } from "#product/hooks/organizations/facade/use-active-organization";
import { isSettingsAdminRole } from "#product/lib/domain/settings/admin-roles";
import { useProductAuthStatus } from "#product/hooks/auth/facade/use-product-auth";
import { useAppCapabilities } from "#product/hooks/capabilities/derived/use-app-capabilities";
import { useGitHubAppUserAuthorization } from "#product/hooks/settings/workflows/use-github-app-user-authorization";
import { useGitHubAppInstallation } from "#product/hooks/settings/workflows/use-github-app-installation";
import { useCreateCloudWorkspace } from "#product/hooks/cloud/workflows/use-create-cloud-workspace";
import { buildCloudAdminRequestMessage } from "#product/lib/domain/settings/github-app-copy";

const USER_AUTHORIZATION_RETURN_TO_SOURCE = "github_app_callback";

/**
 * The one connected, app-level host that owns the active CloudRepositoryIntent.
 * It renders the readiness resolver's first unmet gate with a single CTA,
 * drives authorize/install/grant through the browser and resumes on the
 * existing staggered-polling callback (invalidating the GitHub App and
 * repositories queries so the resolver re-runs), and — once every gate is
 * green — continues the held intent in memory (save Cloud environment, then
 * create the workspace). Nothing is persisted: a cold restart leaves the store
 * empty and the settings surfaces are the recovery path.
 */
export function CloudRepoActionDialogHost() {
  const intent = useCloudRepositoryIntentStore((state) => state.activeIntent);
  const clearIntent = useCloudRepositoryIntentStore((state) => state.clear);
  const repo = intent ? repoForCloudRepositoryIntent(intent) : null;

  const client = useCloudClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const capabilities = useAppCapabilities();
  const authStatus = useProductAuthStatus();
  const signedIn = authStatus === "authenticated";
  const { activeOrganization, activeOrganizationId } = useActiveOrganization();
  const canManageInstallation = isSettingsAdminRole(activeOrganization?.membership?.role);
  const host = useProductHost();

  const open = intent !== null;

  // Live readiness inputs.
  const repoConfigs = useRepositories(open && signedIn);
  const authority = useGitHubRepoAuthority(
    { gitOwner: repo?.gitOwner, gitRepoName: repo?.gitRepoName },
    open && signedIn && capabilities.managedCloudStatus !== "disabled" && repo !== null,
  );

  const configuredCloudKeys = useMemo(
    () => buildConfiguredCloudRepoKeys(repoConfigs.data?.repositories),
    [repoConfigs.data?.repositories],
  );
  const cloudEnvironmentConfigured = repo
    ? configuredCloudKeys.has(cloudRepositoryKey(repo.gitOwner, repo.gitRepoName))
    : false;

  const refetchOnReturn = useCallback(() => {
    // Auth/install/grant callback: invalidate user authorization, installation,
    // accessible repos, and per-repo authority (all under the GitHub App root),
    // plus repositories, so the resolver re-runs with fresh state.
    void queryClient.invalidateQueries({ queryKey: githubAppRootKey(client.baseUrl) });
    void queryClient.invalidateQueries({ queryKey: repositoriesKey() });
  }, [client.baseUrl, queryClient]);

  const userAuthorization = useGitHubAppUserAuthorization({
    returnTo: host.links.buildReturnUrl({
      kind: "settings",
      section: "environments",
      source: USER_AUTHORIZATION_RETURN_TO_SOURCE,
    }),
    onAuthorizationReturn: refetchOnReturn,
  });
  const installation = useGitHubAppInstallation({
    organizationId: activeOrganizationId,
    // Host-truthful: the installation return target is derived from the host
    // (Desktop → custom scheme, Web → the browser origin) exactly like the
    // user-authorization return above, rather than a hard-coded `proliferate://`
    // deep link that would strand a Web-initiated installation (PR2-WEB-03).
    returnTo: host.links.buildReturnUrl({
      kind: "settings",
      section: "environments",
      query: [["source", "github_app_installation_callback"]],
    }),
    onInstallationReturn: refetchOnReturn,
  });

  const saveEnvironment = useSaveRepoEnvironment();
  const validateBranches = useValidateCloudRepoBranches();
  const { createCloudWorkspaceAndEnter } = useCreateCloudWorkspace();

  const readiness: RepositoryReadiness | null = useMemo(() => {
    if (!intent) return null;
    return resolveRepositoryReadiness({
      requirement: "managed_cloud",
      githubRepositoryAccess: capabilities.githubRepositoryAccessStatus,
      managedCloud: capabilities.managedCloudStatus,
      signedIn,
      hasSupportedRepoIdentity: repo !== null,
      authorityLoading: authority.isPending && !authority.data,
      authorityError: authority.isError,
      authority: authority.data
        ? { authorized: authority.data.authorized, status: authority.data.status }
        : null,
      canManageInstallation,
      cloudEnvironmentConfigured,
    });
  }, [
    authority.data,
    authority.isError,
    authority.isPending,
    canManageInstallation,
    capabilities.githubRepositoryAccessStatus,
    capabilities.managedCloudStatus,
    cloudEnvironmentConfigured,
    intent,
    repo,
    signedIn,
  ]);

  const saveCloudEnvironment = useCallback(async (target: CloudRepoIdentity) => {
    const branches = await validateBranches.mutateAsync({
      gitOwner: target.gitOwner,
      gitRepoName: target.gitRepoName,
    });
    await saveEnvironment.mutateAsync({
      gitOwner: target.gitOwner,
      gitRepoName: target.gitRepoName,
      body: buildMinimalCloudEnvironmentConfigRequest(branches.defaultBranch),
    });
  }, [saveEnvironment, validateBranches]);

  const createCloudWorkspace = useCallback(async (
    target: CloudRepoIdentity,
    continuation: CreateCloudWorkspaceContinuation,
  ) => {
    await createCloudWorkspaceAndEnter(
      {
        gitOwner: target.gitOwner,
        gitRepoName: target.gitRepoName,
        baseBranch: continuation.baseBranch ?? undefined,
      },
      { repoGroupKeyToExpand: continuation.repoGroupKeyToExpand },
    );
  }, [createCloudWorkspaceAndEnter]);

  // Once every access gate is green, continue the held intent (save env →
  // create). Gate 9 (`set_up_cloud`) is the normal continue point: the resolver
  // has cleared authority and only the Cloud environment save remains, which is
  // exactly what the continuation performs. Gate 10 means the environment is
  // already configured (e.g. a create-workspace retry). Either way every
  // authority prerequisite is met, so continue.
  const readyToContinue =
    intent !== null && (readiness?.gate === 9 || readiness?.gate === 10);

  // Keep the continuation's live inputs in a ref so the drive-once effect reads
  // the latest values WITHOUT depending on them. `cloudEnvironmentConfigured`
  // in particular is flipped by the save's own query invalidation mid-flight;
  // if it were an effect dependency the re-run would cancel the in-flight
  // promise and strand the dialog open (B1).
  const continuationInputsRef = useRef({
    cloudEnvironmentConfigured,
    saveCloudEnvironment,
    createCloudWorkspace,
  });
  continuationInputsRef.current = {
    cloudEnvironmentConfigured,
    saveCloudEnvironment,
    createCloudWorkspace,
  };

  // The intent instance the continuation has already been started for. Because
  // store intents are stable object references, this guards both against
  // mid-flight readiness churn and against StrictMode's double-invoke.
  const startedForRef = useRef<CloudRepositoryIntent | null>(null);
  const [continuationError, setContinuationError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  // Reset per-intent continuation state when the dialog closes so the next
  // intent (the host stays mounted for the app's lifetime) can continue.
  useEffect(() => {
    if (!intent) {
      startedForRef.current = null;
      setContinuationError(null);
    }
  }, [intent]);

  useEffect(() => {
    if (!intent || !readyToContinue) {
      return;
    }
    // Drive the continuation imperatively exactly once per intent instance.
    if (startedForRef.current === intent) {
      return;
    }
    startedForRef.current = intent;
    setContinuationError(null);
    const { cloudEnvironmentConfigured, saveCloudEnvironment, createCloudWorkspace } =
      continuationInputsRef.current;
    void continueCloudRepositoryIntent({
      intent,
      cloudEnvironmentConfigured,
      saveCloudEnvironment,
      createCloudWorkspace,
    })
      .then(() => {
        // Terminal success: clear the intent unconditionally. Nothing should
        // suppress this — the store clear unmounts the dialog.
        clearIntent();
      })
      .catch((error) => {
        // Preserve already-completed earlier steps and surface a retry. Release
        // the per-intent guard so a retry (retryNonce bump) starts a fresh
        // attempt; a workspace-create retry will not recreate an already-saved
        // environment because `cloudEnvironmentConfigured` (read fresh from the
        // ref) guards the save.
        startedForRef.current = null;
        setContinuationError(
          error instanceof Error
            ? error.message
            : "Could not finish setting up this repository in Cloud.",
        );
      });
  }, [clearIntent, intent, readyToContinue, retryNonce]);

  if (!intent || !readiness) {
    return null;
  }

  const readinessBlocker = describeReadinessBlocker({
    readiness,
    repo,
    githubAccessDisplayName: capabilities.githubRepositoryAccessDisplayName,
    orgName: activeOrganization?.name ?? null,
    installUrl: INSTALLATION_SETTINGS_URL,
    userAuthorization,
    installation,
    onCopyAdminRequest: () => {
      void host.clipboard.writeText(
        buildCloudAdminRequestMessage({
          orgName: activeOrganization?.name ?? null,
          repo,
          installUrl: INSTALLATION_SETTINGS_URL,
        }),
      );
    },
    onRetryAuthority: () => {
      void authority.refetch();
    },
    onSignIn: () => {
      // A held intent cannot survive a route away, so clear it and send the
      // user to the product sign-in flow (PR2-SIGNIN-04). The settings surfaces
      // are the recovery path after sign-in.
      clearIntent();
      navigate("/login");
    },
  });

  // A continuation failure (env save / workspace create) surfaces its own
  // retryable blocker in the continue state, where the readiness blocker is
  // null. Earlier completed steps are preserved (spec §Failure).
  const continuationBlocker: CloudRepoPickerBlockerView | null = continuationError
    ? {
        title: "Couldn't finish Cloud setup",
        description: continuationError,
        actionLabel: "Retry",
        onAction: () => setRetryNonce((nonce) => nonce + 1),
      }
    : null;

  const blocker = readinessBlocker ?? continuationBlocker;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) clearIntent(); }}>
      <DialogContent
        overlayClassName="bg-black/70 backdrop-blur-sm"
        className="max-w-[440px] rounded-xl p-4"
        data-telemetry-block
      >
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold leading-5">
            Set up in Cloud
          </DialogTitle>
        </DialogHeader>
        <div className="mt-3">
          {blocker ? (
            <CloudRepoPickerBlocker blocker={blocker} />
          ) : (
            <p className="text-ui-sm leading-[1.45] text-muted-foreground" role="status">
              Preparing this repository for Proliferate Cloud…
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// GitHub's per-user installation settings page (grant repository access).
const INSTALLATION_SETTINGS_URL = "https://github.com/settings/installations";
