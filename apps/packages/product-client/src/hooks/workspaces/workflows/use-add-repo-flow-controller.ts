import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGitHubAppUserAuthorizationStatus } from "@proliferate/cloud-sdk-react";
import { parseGitRepoId } from "#product/domain/repos/repo-id";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import type {
  AddRepoFlowOption,
  AddRepoFlowStep,
} from "#product/lib/domain/workspaces/creation/add-repo-flow-steps";
import { useAddCloudEnvironment } from "#product/hooks/workspaces/workflows/use-add-cloud-environment";
import { useAddRepo } from "#product/hooks/workspaces/workflows/use-add-repo";
import { useActiveOrganization } from "#product/hooks/organizations/facade/use-active-organization";
import { isSettingsAdminRole } from "#product/lib/domain/settings/admin-roles";
import { useAppCapabilities } from "#product/hooks/capabilities/derived/use-app-capabilities";
import { useProductAuthStatus } from "#product/hooks/auth/facade/use-product-auth";
import { buildAddRepoPreflightBlockers } from "#product/lib/domain/workspaces/cloud/add-repo-preflight-blockers";
import { useGitHubSetupWaiting } from "#product/hooks/workspaces/workflows/use-github-setup-waiting";
import type { CloudRepoPickerProps } from "#product/lib/domain/workspaces/cloud/cloud-repo-picker-view";
import { useAddRepoFlowStore } from "#product/stores/ui/add-repo-flow-store";
import { useCloudRepositoryIntentStore } from "#product/stores/cloud/cloud-repository-intent-store";
import { directoryPickerUnavailableCopy } from "#product/copy/workspaces/directory-picker-copy";
import { DESKTOP_POINTER_COPY } from "#product/copy/workspaces/desktop-pointer-copy";
import {
  buildCloudRepoAddedReceipt,
  useRepoAddedToast,
} from "#product/hooks/workspaces/ui/use-repo-added-toast";

/** Confirmation on arrival, once the checklist has actually been walked. */
const GITHUB_CONNECTED_BANNER = "GitHub connected. Choose a repository.";

export interface AddRepoFlowControllerInput {
  /** Whether the hosting surface is showing the flow at all. */
  open: boolean;
  step: AddRepoFlowStep;
  setStep: (step: AddRepoFlowStep) => void;
  /** Close the hosting surface (a completed add, or a step that must dismiss). */
  onClose: () => void;
  /**
   * Hide the hosting surface because the flow has been handed to ANOTHER owner
   * (the cloud/clone intent host) that finishes it — and, critically, that reads
   * the completion callback the store still holds. Distinct from `onClose`
   * because the app-level host's close() clears `onCompleted`: closing on a
   * handoff destroys the callback the later completion needs (the surface is
   * already hidden by `handoffToCloud`). Surfaces that do not own the store's
   * callback (anchored popovers) pass their own close for both.
   */
  onHandoff: () => void;
}

export interface AddRepoFlowControllerResult {
  options: AddRepoFlowOption[];
  adding: boolean;
  githubConnected: boolean;
  entryNote: string | null;
  error: string | null;
  cloudPicker: CloudRepoPickerProps | null;
  clonePicker: CloudRepoPickerProps | null;
  onPickOption: (option: AddRepoFlowOption) => void;
  onBack: () => void;
}

/**
 * Everything the add-repository flow needs, wired once.
 *
 * The flow now has three hosts — the app-level command surface, the sidebar
 * Repositories "+", and the home project menu's sweep — and all three want the
 * identical behaviour: host-truthful options, resolver gates 1/2 taking
 * precedence over the picker's own prerequisites, the folder add committing on
 * the native picker's selection, and the GitHub checklist parking on a waiting
 * panel while the user is away. Only the surface (and therefore who owns
 * open/step) differs, so that is the only thing passed in.
 */
export function useAddRepoFlowController({
  open,
  step,
  setStep,
  onClose,
  onHandoff,
}: AddRepoFlowControllerInput): AddRepoFlowControllerResult {
  const handoffToCloud = useAddRepoFlowStore((state) => state.handoffToCloud);
  const beginCloudIntent = useCloudRepositoryIntentStore((state) => state.begin);

  const { addRepoFromPath, isAddingRepo } = useAddRepo();
  const { activeOrganization, activeOrganizationId } = useActiveOrganization();
  const host = useProductHost();
  const navigate = useNavigate();
  const capabilities = useAppCapabilities();
  const authStatus = useProductAuthStatus();
  const files = host.desktop?.files ?? null;
  const showRepoAddedToast = useRepoAddedToast();
  const [flowError, setFlowError] = useState<string | null>(null);

  const canManageInstallation = isSettingsAdminRole(
    activeOrganization?.membership?.role,
  );

  // Known at the ENTRY step, before any picker query runs, because that is
  // where the one-time-connection footnote has to appear. Same query key as the
  // picker's own status read, so this costs nothing extra.
  const userAuthorization = useGitHubAppUserAuthorizationStatus(open);
  // Unknown reads as connected. The footnote is a warning, and a warning that
  // appears for the length of one query and then vanishes is noise: an already
  // connected user would see "you need to connect GitHub" flash every single
  // time they open the menu.
  const githubConnected = userAuthorization.data
    ? userAuthorization.data.connected === true
    : true;

  // The resolver's repo-independent gates, which take precedence over the
  // picker's own prerequisites (see buildAddRepoPreflightBlockers).
  const preflightBlockers = useMemo(() => buildAddRepoPreflightBlockers({
    githubRepositoryAccessStatus: capabilities.githubRepositoryAccessStatus,
    managedCloudStatus: capabilities.managedCloudStatus,
    githubAccessDisplayName: capabilities.githubRepositoryAccessDisplayName,
    signedIn: authStatus === "authenticated",
    orgName: activeOrganization?.name ?? null,
    onSignIn: () => {
      onClose();
      navigate("/login");
    },
  }), [
    activeOrganization?.name,
    authStatus,
    capabilities.githubRepositoryAccessDisplayName,
    capabilities.githubRepositoryAccessStatus,
    capabilities.managedCloudStatus,
    navigate,
    onClose,
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
    canManageGitHubAppInstallation: canManageInstallation,
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
    onCopyText: host.clipboard.writeText,
    onRepositorySelected: (repo) => {
      // Handoff, not close: CloudRepoActionDialogHost finishes this add later
      // and reads the store's `onCompleted`, which close() would have nulled.
      handoffToCloud();
      onHandoff();
      beginCloudIntent({
        kind: "add_cloud_repository",
        repo: { gitProvider: "github", ...repo },
      });
    },
    // Not the live completion path: `onRepositorySelected` above short-circuits
    // every selection into the cloud intent, and CloudRepoActionDialogHost
    // fires the receipt when the registration actually lands. Kept correct (via
    // the shared receipt builder, never a second copy of its copy) so removing
    // that short-circuit does not silently drop the confirmation.
    onEnvironmentAdded: (repoId) => {
      // Read before closing — close() clears the completion callback.
      const onCompleted = useAddRepoFlowStore.getState().onCompleted;
      onClose();
      if (repoId) {
        showRepoAddedToast(buildCloudRepoAddedReceipt(repoId));
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
    canManageGitHubAppInstallation: canManageInstallation,
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
    onCopyText: host.clipboard.writeText,
    // The clone path never adds a Cloud environment; select is overridden below.
    onEnvironmentAdded: () => {},
  });

  // What the step the user is ON still has to get past, before the waiting
  // decoration is applied. The preflight gates come first, exactly as
  // `resolvePicker` orders them below.
  const activeBlocker = step.kind === "cloud"
    ? preflightBlockers.cloud ?? cloudPicker.blocker ?? null
    : step.kind === "clone"
      ? preflightBlockers.clone ?? clonePickerBase.blocker ?? null
      : null;

  // Parked on GitHub: the departure, the waiting panel and the manual re-check.
  const {
    decorateBlocker,
    returnedFromGitHub,
    cancelWaiting,
  } = useGitHubSetupWaiting({
    open,
    canManageInstallation,
    blocked: activeBlocker !== null,
  });

  const beginCloneForRepoId = useCallback((repoId: string) => {
    const identity = parseGitRepoId(repoId);
    if (!identity) {
      setFlowError("That repository id is not a supported GitHub owner/name.");
      return;
    }
    setFlowError(null);
    // Handoff, not close: the clone completes in CloudRepoActionDialogHost,
    // which still needs the store's `onCompleted`.
    handoffToCloud();
    onHandoff();
    beginCloudIntent({
      kind: "clone_from_github",
      repo: {
        gitProvider: "github",
        gitOwner: identity.gitOwner,
        gitRepoName: identity.gitRepoName,
      },
    });
  }, [beginCloudIntent, handoffToCloud, onHandoff]);

  const clonePicker = useMemo<CloudRepoPickerProps>(() => ({
    ...clonePickerBase,
    onAddRepository: (repo) => beginCloneForRepoId(repo.id),
    // Manual owner/repo entry is the same clone intent as catalog selection;
    // never inherit useAddCloudEnvironment's managed-Cloud save callback.
    onAddManual: () => beginCloneForRepoId(clonePickerBase.manualValue),
  }), [
    beginCloneForRepoId,
    clonePickerBase,
  ]);

  const onPickOption = useCallback((option: AddRepoFlowOption) => {
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
      const picked = await files.pickDirectory();
      if (picked.kind === "cancelled") {
        return;
      }
      if (picked.kind === "unavailable") {
        setFlowError(directoryPickerUnavailableCopy(picked.reason));
        return;
      }
      const result = await addRepoFromPath(picked.path, {
        createCloudEnvironment: false,
      });
      if (result.succeeded) {
        // Read before closing — close() clears the completion callback.
        const onCompleted = useAddRepoFlowStore.getState().onCompleted;
        onClose();
        onCompleted?.({ kind: "local", sourceRoot: result.sourceRoot });
        return;
      }
      // Failures also toast from useAddRepo; surface the reason inline and
      // keep the surface open so the user can retry or back out.
      setFlowError(result.error);
    })();
  }, [addRepoFromPath, files, onClose, setStep]);

  const onBack = useCallback(() => {
    setFlowError(null);
    cancelWaiting();
    setStep({ kind: "entry" });
  }, [cancelWaiting, setStep]);

  // The resolver's repo-independent gates (operator config / product sign-in)
  // take precedence over the picker's own GitHub App prerequisite blocker, so a
  // user never sees a user-auth CTA when the operator must configure the
  // deployment (PR2-GATING-01).
  const resolvePicker = (
    kind: "cloud" | "clone",
    picker: CloudRepoPickerProps,
  ): CloudRepoPickerProps | null => {
    if (step.kind !== kind) {
      return null;
    }
    const blocker = decorateBlocker(preflightBlockers[kind] ?? picker.blocker);
    return {
      ...picker,
      blocker,
      connectedBanner: !blocker && returnedFromGitHub ? GITHUB_CONNECTED_BANNER : null,
    };
  };

  return {
    options,
    adding: isAddingRepo,
    githubConnected,
    entryNote: files ? null : DESKTOP_POINTER_COPY.addRepository,
    error: step.kind === "cloud" ? null : flowError,
    cloudPicker: resolvePicker("cloud", cloudPicker),
    clonePicker: resolvePicker("clone", clonePicker),
    onPickOption,
    onBack,
  };
}
