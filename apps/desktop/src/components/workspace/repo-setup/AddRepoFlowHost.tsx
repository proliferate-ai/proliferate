import { useCallback, useState } from "react";
import {
  AddRepoFlow,
  type AddRepoFlowOption,
} from "@proliferate/product-ui/repos/AddRepoFlow";
import {
  useAddCloudEnvironment,
} from "@proliferate/product-surfaces/settings/cloud-environments/use-add-cloud-environment";
import { useAddRepo } from "@/hooks/workspaces/workflows/use-add-repo";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { isSettingsAdminRole } from "@/lib/domain/settings/admin-roles";
import { useAddRepoFlowStore } from "@/stores/ui/add-repo-flow-store";
import { useToastStore } from "@/stores/toast/toast-store";

/**
 * App-level host for the unified add-repository flow (UX_SPEC §4).
 * Entry offers three options; local paths run the existing add-repo
 * workflow, the cloud path runs the authorize → pick → create sequence
 * as an in-dialog step backed by useAddCloudEnvironment.
 */
export function AddRepoFlowHost() {
  const open = useAddRepoFlowStore((state) => state.open);
  const step = useAddRepoFlowStore((state) => state.step);
  const setStep = useAddRepoFlowStore((state) => state.setStep);
  const closeFlow = useAddRepoFlowStore((state) => state.close);

  const { addRepoFromPath, isAddingRepo } = useAddRepo();
  const { activeOrganization, activeOrganizationId } = useActiveOrganization();
  const { openExternal, pickFolder } = useTauriShellActions();
  const showToast = useToastStore((state) => state.show);
  const [flowError, setFlowError] = useState<string | null>(null);

  const canCreateCloudEnvironment = activeOrganizationId !== null;

  const cloudPicker = useAddCloudEnvironment({
    enabled: open && step.kind === "cloud",
    organizationId: activeOrganizationId,
    canManageGitHubAppInstallation: isSettingsAdminRole(
      activeOrganization?.membership?.role,
    ),
    userAuthorizationReturnTo: "proliferate://settings/environments?source=github_app_callback",
    installationReturnTo: "proliferate://settings/environments?source=github_app_installation_callback",
    onOpenExternalUrl: openExternal,
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

  const handlePickOption = useCallback((option: AddRepoFlowOption) => {
    setFlowError(null);
    if (option === "cloud") {
      setStep({ kind: "cloud" });
      return;
    }
    // "link-local" and "add-local" both start from the native folder picker;
    // they differ in intent copy only — the same registration flow backs both.
    void (async () => {
      const path = await pickFolder();
      if (!path) {
        return;
      }
      setStep({ kind: "confirm-local", path });
    })();
  }, [pickFolder, setStep]);

  const handleConfirmLocal = useCallback((options: { createCloudEnvironment: boolean }) => {
    if (step.kind !== "confirm-local") {
      return;
    }
    setFlowError(null);
    void addRepoFromPath(step.path, {
      createCloudEnvironment: canCreateCloudEnvironment && options.createCloudEnvironment,
    }).then((result) => {
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
    });
  }, [addRepoFromPath, canCreateCloudEnvironment, closeFlow, step]);

  const handleBack = useCallback(() => {
    setFlowError(null);
    setStep({ kind: "entry" });
  }, [setStep]);

  const handleClose = useCallback(() => {
    // Ignore Escape/overlay-click while a local add is committing so the
    // dialog cannot vanish mid-add.
    if (isAddingRepo) {
      return;
    }
    setFlowError(null);
    closeFlow();
  }, [closeFlow, isAddingRepo]);

  return (
    <AddRepoFlow
      open={open}
      step={step.kind === "confirm-local"
        ? {
          kind: "confirm-local",
          path: step.path,
          canCreateCloudEnvironment,
        }
        : step}
      confirming={isAddingRepo}
      error={step.kind === "cloud" ? null : flowError}
      cloudPicker={step.kind === "cloud" ? cloudPicker : null}
      onPickOption={handlePickOption}
      onConfirmLocal={handleConfirmLocal}
      onBack={handleBack}
      onClose={handleClose}
    />
  );
}
