import { useCallback, useState } from "react";
import {
  AddRepoFlow,
  type AddRepoFlowOption,
} from "@proliferate/product-ui/repos/AddRepoFlow";
import {
  AddCloudEnvironmentDialogController,
} from "@proliferate/product-surfaces/settings/cloud-environments/AddCloudEnvironmentDialogController";
import { useAddRepo } from "@/hooks/workspaces/workflows/use-add-repo";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { isSettingsAdminRole } from "@/lib/domain/settings/admin-roles";
import { pickFolder } from "@/lib/access/tauri/shell";
import { useAddRepoFlowStore } from "@/stores/ui/add-repo-flow-store";
import { useToastStore } from "@/stores/toast/toast-store";

/**
 * App-level host for the unified add-repository flow (UX_SPEC §4).
 * Entry offers three options; local paths run the existing add-repo
 * workflow, the cloud path reuses the AddCloudEnvironmentDialog wiring.
 */
export function AddRepoFlowHost() {
  const open = useAddRepoFlowStore((state) => state.open);
  const step = useAddRepoFlowStore((state) => state.step);
  const cloudPickerOpen = useAddRepoFlowStore((state) => state.cloudPickerOpen);
  const setStep = useAddRepoFlowStore((state) => state.setStep);
  const openCloudPicker = useAddRepoFlowStore((state) => state.openCloudPicker);
  const closeCloudPicker = useAddRepoFlowStore((state) => state.closeCloudPicker);
  const closeFlow = useAddRepoFlowStore((state) => state.close);

  const { addRepoFromPath, isAddingRepo } = useAddRepo();
  const { activeOrganization, activeOrganizationId } = useActiveOrganization();
  const { openExternal } = useTauriShellActions();
  const showToast = useToastStore((state) => state.show);
  const [flowError, setFlowError] = useState<string | null>(null);

  const canCreateCloudEnvironment = activeOrganizationId !== null;

  const handlePickOption = useCallback((option: AddRepoFlowOption) => {
    setFlowError(null);
    if (option === "cloud") {
      openCloudPicker();
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
  }, [openCloudPicker, setStep]);

  const handleConfirmLocal = useCallback((options: { createCloudEnvironment: boolean }) => {
    if (step.kind !== "confirm-local") {
      return;
    }
    setFlowError(null);
    void addRepoFromPath(step.path, {
      createCloudEnvironment: canCreateCloudEnvironment && options.createCloudEnvironment,
    }).then((result) => {
      if (result.succeeded) {
        closeFlow();
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
    <>
      <AddRepoFlow
        open={open}
        step={step.kind === "confirm-local"
          ? {
            kind: "confirm-local",
            path: step.path,
            canCreateCloudEnvironment,
          }
          : { kind: "entry" }}
        confirming={isAddingRepo}
        error={flowError}
        onPickOption={handlePickOption}
        onConfirmLocal={handleConfirmLocal}
        onBack={handleBack}
        onClose={handleClose}
      />
      {cloudPickerOpen ? (
        <AddCloudEnvironmentDialogController
          open={cloudPickerOpen}
          organizationId={activeOrganizationId}
          canManageGitHubAppInstallation={isSettingsAdminRole(
            activeOrganization?.membership?.role,
          )}
          userAuthorizationReturnTo="proliferate://settings/environments?source=github_app_callback"
          installationReturnTo="proliferate://settings/environments?source=github_app_installation_callback"
          onOpenExternalUrl={openExternal}
          onClose={closeCloudPicker}
          onEnvironmentAdded={(repoId) => {
            // The controller closes itself (calls onClose) after this fires.
            showToast(repoId ? `Added ${repoId}` : "Cloud repo added.", "info");
          }}
        />
      ) : null}
    </>
  );
}
