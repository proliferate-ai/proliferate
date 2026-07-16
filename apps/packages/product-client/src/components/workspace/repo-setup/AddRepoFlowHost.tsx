import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CloudRepoPickerProps } from "@proliferate/product-ui/repos/CloudRepoPicker";
import { parseGitRepoId } from "@proliferate/product-domain/repos/repo-id";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  resolveRepositoryReadiness,
  type RepositoryCapabilityRequirement,
} from "@proliferate/product-domain/repos/repo-readiness";
import type { CloudRepoPickerBlockerView } from "@proliferate/product-ui/repos/CloudRepoPicker";
import {
  AddRepoFlow,
  type AddRepoFlowOption,
} from "@proliferate/product-ui/repos/AddRepoFlow";
import {
  useAddCloudEnvironment,
} from "@proliferate/product-surfaces/settings/cloud-environments/use-add-cloud-environment";
import { useAddRepo } from "#product/hooks/workspaces/workflows/use-add-repo";
import { useActiveOrganization } from "#product/hooks/organizations/facade/use-active-organization";
import { isSettingsAdminRole } from "#product/lib/domain/settings/admin-roles";
import { useAppCapabilities } from "#product/hooks/capabilities/derived/use-app-capabilities";
import { useProductAuthStatus } from "#product/hooks/auth/facade/use-product-auth";
import { describeReadinessBlocker } from "#product/lib/domain/workspaces/cloud/describe-readiness-blocker";
import { useAddRepoFlowStore } from "#product/stores/ui/add-repo-flow-store";
import { useToastStore } from "#product/stores/toast/toast-store";
import { useCloudRepositoryIntentStore } from "#product/stores/cloud/cloud-repository-intent-store";

/**
 * App-level host for the unified add-repository flow. Entry offers only the
 * host-truthful choices: Desktop adds "Add an existing folder" + "Set up in
 * Cloud"; Web offers "Set up in Cloud" only (no local operation that would
 * error at click time). The cloud path runs the readiness → pick → authority
 * → save sequence as an in-dialog step backed by useAddCloudEnvironment.
 */
export function AddRepoFlowHost() {
  const open = useAddRepoFlowStore((state) => state.open);
  const step = useAddRepoFlowStore((state) => state.step);
  const setStep = useAddRepoFlowStore((state) => state.setStep);
  const closeFlow = useAddRepoFlowStore((state) => state.close);
  const handoffToCloud = useAddRepoFlowStore((state) => state.handoffToCloud);
  const beginCloudIntent = useCloudRepositoryIntentStore((state) => state.begin);

  const { addRepoFromPath, isAddingRepo } = useAddRepo();
  const { activeOrganization, activeOrganizationId } = useActiveOrganization();
  const host = useProductHost();
  const navigate = useNavigate();
  const capabilities = useAppCapabilities();
  const authStatus = useProductAuthStatus();
  const files = host.desktop?.files ?? null;
  const showToast = useToastStore((state) => state.show);
  const [flowError, setFlowError] = useState<string | null>(null);

  // PR2-GATING-01: the cloud path routes through the SAME ordered readiness
  // resolver every other cloud-repo surface uses, so a deployment with operator
  // configuration incomplete shows the "operator must configure" explanation
  // instead of the older prerequisite model's "Authorize GitHub App" CTA. Only
  // the two repo-independent gates (1 operator config, 2 product sign-in)
  // precede repo selection; once past them the per-repo picker (its authority
  // query) owns gates 3+, so we resolve with the later gates satisfied and
  // surface a blocker only when the resolver stops at gate 1 or 2.
  const preflightBlockers = useMemo<Record<"cloud" | "clone", CloudRepoPickerBlockerView | null>>(() => {
    const resolve = (
      requirement: RepositoryCapabilityRequirement,
    ): CloudRepoPickerBlockerView | null => {
      const readiness = resolveRepositoryReadiness({
        requirement,
        githubRepositoryAccess: capabilities.githubRepositoryAccessStatus,
        managedCloud: capabilities.managedCloudStatus,
        signedIn: authStatus === "authenticated",
        hasSupportedRepoIdentity: true,
        authorityLoading: false,
        authorityError: false,
        authority: { authorized: true, status: "ready" },
        canManageInstallation: false,
        cloudEnvironmentConfigured: true,
      });
      if (readiness.gate !== 1 && readiness.gate !== 2) {
        return null;
      }
      return describeReadinessBlocker({
        readiness,
        requirement,
        repo: null,
        githubAccessDisplayName: capabilities.githubRepositoryAccessDisplayName,
        orgName: activeOrganization?.name ?? null,
        installUrl: "https://github.com/settings/installations",
        userAuthorization: { authorize: () => {}, authorizing: false, error: null },
        installation: {
          install: () => {},
          openInstallationSettings: () => {},
          installing: false,
          error: null,
        },
        onCopyAdminRequest: () => {},
        onRetryAuthority: () => {},
        onSignIn: () => {
          closeFlow();
          navigate("/login");
        },
      });
    };
    return {
      cloud: resolve("managed_cloud"),
      clone: resolve("github_repository_access"),
    };
  }, [
    activeOrganization?.name,
    authStatus,
    capabilities.githubRepositoryAccessDisplayName,
    capabilities.githubRepositoryAccessStatus,
    capabilities.managedCloudStatus,
    closeFlow,
    navigate,
  ]);

  // Host-truthful options: only Desktop can register an existing local folder
  // or clone locally; Web offers only the managed-Cloud setup.
  const options = useMemo<AddRepoFlowOption[]>(
    () => (files ? ["add-existing-folder", "clone-from-github", "cloud"] : ["cloud"]),
    [files],
  );

  const cloudPicker = useAddCloudEnvironment({
    enabled: open && step.kind === "cloud",
    organizationId: activeOrganizationId,
    canManageGitHubAppInstallation: isSettingsAdminRole(
      activeOrganization?.membership?.role,
    ),
    userAuthorizationReturnTo: host.links.buildReturnUrl({
      kind: "settings",
      section: "environments",
      source: "github_app_callback",
    }),
    // Host-truthful installation return: Desktop → custom scheme, Web → the
    // browser origin, via the same buildReturnUrl strategy user-authorization
    // uses. A hard-coded `proliferate://` deep link stranded a Web-initiated
    // installation on the Desktop scheme (PR2-WEB-03).
    installationReturnTo: host.links.buildReturnUrl({
      kind: "settings",
      section: "environments",
      query: [["source", "github_app_installation_callback"]],
    }),
    onOpenExternalUrl: host.links.openExternal,
    onRepositorySelected: (repo) => {
      handoffToCloud();
      beginCloudIntent({
        kind: "add_cloud_repository",
        repo: { gitProvider: "github", ...repo },
      });
    },
    onEnvironmentAdded: (repoId) => {
      // Read before closeFlow — close() clears the completion callback.
      const onCompleted = useAddRepoFlowStore.getState().onCompleted;
      closeFlow();
      showToast(repoId ? `Added ${repoId}` : "Cloud repo added.", "info");
      if (repoId) {
        onCompleted?.({ kind: "cloud", repoId });
      }
    },
  });

  // Clone reuses the accessible-repos catalog + GitHub-App gating from the cloud
  // picker, but on select it clones locally (PR 3) instead of saving a
  // managed-Cloud environment. Clone needs only GitHub repository access, so it
  // is available whenever the picker's own GitHub-App prerequisites are met.
  const clonePickerBase = useAddCloudEnvironment({
    enabled: open && step.kind === "clone",
    organizationId: activeOrganizationId,
    canManageGitHubAppInstallation: isSettingsAdminRole(
      activeOrganization?.membership?.role,
    ),
    userAuthorizationReturnTo: host.links.buildReturnUrl({
      kind: "settings",
      section: "environments",
      source: "github_app_callback",
    }),
    // Host-truthful installation return (PR2-WEB-03): derive from the host via
    // buildReturnUrl instead of a hard-coded `proliferate://` deep link, matching
    // the cloud picker above.
    installationReturnTo: host.links.buildReturnUrl({
      kind: "settings",
      section: "environments",
      query: [["source", "github_app_installation_callback"]],
    }),
    onOpenExternalUrl: host.links.openExternal,
    // The clone path never adds a Cloud environment; select is overridden below.
    onEnvironmentAdded: () => {},
  });

  const clonePicker = useMemo<CloudRepoPickerProps>(() => ({
    ...clonePickerBase,
    onAddRepository: (repo) => {
      const identity = parseGitRepoId(repo.id);
      if (!identity) {
        setFlowError("That repository id is not a supported GitHub owner/name.");
        return;
      }
      setFlowError(null);
      handoffToCloud();
      beginCloudIntent({
        kind: "clone_from_github",
        repo: {
          gitProvider: "github",
          gitOwner: identity.gitOwner,
          gitRepoName: identity.gitRepoName,
        },
      });
    },
  }), [
    beginCloudIntent,
    clonePickerBase,
    handoffToCloud,
  ]);

  const handlePickOption = useCallback((option: AddRepoFlowOption) => {
    setFlowError(null);
    if (option === "cloud") {
      setStep({ kind: "cloud" });
      return;
    }
    if (option === "clone-from-github") {
      setStep({ kind: "clone" });
      return;
    }
    // "add-existing-folder": the native folder picker IS the intent signal, so
    // it adds immediately on selection with no confirmation step.
    void (async () => {
      if (!files) {
        setFlowError("Local repositories are only available in Desktop.");
        return;
      }
      const path = await files.pickDirectory();
      if (!path) {
        return;
      }
      const result = await addRepoFromPath(path, {
        createCloudEnvironment: false,
      });
      if (result.succeeded) {
        // Read before closeFlow — close() clears the completion callback.
        const onCompleted = useAddRepoFlowStore.getState().onCompleted;
        closeFlow();
        onCompleted?.({ kind: "local", sourceRoot: result.sourceRoot });
        return;
      }
      // Failures also toast from useAddRepo; surface the reason inline and
      // keep the dialog open so the user can retry or back out.
      setFlowError(result.error);
    })();
  }, [addRepoFromPath, closeFlow, files, setStep]);

  const handleBack = useCallback(() => {
    setFlowError(null);
    setStep({ kind: "entry" });
  }, [setStep]);

  const handleClose = useCallback(() => {
    // Ignore Escape/overlay-click while a local add is committing.
    if (isAddingRepo) {
      return;
    }
    setFlowError(null);
    closeFlow();
  }, [closeFlow, isAddingRepo]);

  // The resolver's repo-independent gates (operator config / product sign-in)
  // take precedence over the picker's own GitHub App prerequisite blocker, so a
  // user never sees a user-auth CTA when the operator must configure the
  // deployment (PR2-GATING-01).
  const resolvedCloudPicker = step.kind === "cloud"
    ? (preflightBlockers.cloud
      ? { ...cloudPicker, blocker: preflightBlockers.cloud }
      : cloudPicker)
    : null;
  const resolvedClonePicker = step.kind === "clone"
    ? (preflightBlockers.clone
      ? { ...clonePicker, blocker: preflightBlockers.clone }
      : clonePicker)
    : null;

  return (
    <AddRepoFlow
      open={open}
      step={step}
      options={options}
      adding={isAddingRepo}
      error={step.kind === "cloud" ? null : flowError}
      cloudPicker={resolvedCloudPicker}
      clonePicker={resolvedClonePicker}
      onPickOption={handlePickOption}
      onBack={handleBack}
      onClose={handleClose}
    />
  );
}
