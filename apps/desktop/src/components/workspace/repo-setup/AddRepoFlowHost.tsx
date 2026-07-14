import { useCallback, useState } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  AddRepoFlow,
  type AddRepoFlowOption,
} from "@proliferate/product-ui/repos/AddRepoFlow";
import {
  useAddCloudEnvironment,
} from "@proliferate/product-surfaces/settings/cloud-environments/use-add-cloud-environment";
import { useAddRepo } from "@/hooks/workspaces/workflows/use-add-repo";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import { isSettingsAdminRole } from "@/lib/domain/settings/admin-roles";
import { useAddRepoFlowStore } from "@/stores/ui/add-repo-flow-store";
import { useToastStore } from "@/stores/toast/toast-store";

/**
 * App-level host for the unified add-repository flow (UX_SPEC §4).
 * Entry offers three options; local paths immediately add after the
 * native folder picker returns, the cloud path runs the authorize →
 * pick → create sequence as an in-dialog step backed by
 * useAddCloudEnvironment.
 */
export function AddRepoFlowHost() {
  const open = useAddRepoFlowStore((state) => state.open);
  const step = useAddRepoFlowStore((state) => state.step);
  const setStep = useAddRepoFlowStore((state) => state.setStep);
  const closeFlow = useAddRepoFlowStore((state) => state.close);

  const { addRepoFromPath, isAddingRepo } = useAddRepo();
  const { activeOrganization, activeOrganizationId } = useActiveOrganization();
  const host = useProductHost();
  const files = host.desktop?.files ?? null;
  const showToast = useToastStore((state) => state.show);
  const [flowError, setFlowError] = useState<string | null>(null);

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
    installationReturnTo: host.links.buildReturnUrl({
      kind: "settings",
      section: "environments",
      query: [["source", "github_app_installation_callback"]],
    }),
    onOpenExternalUrl: host.links.openExternal,
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
    // The folder picker IS the intent signal; no confirmation step needed.
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
      step={step}
      adding={isAddingRepo}
      error={step.kind === "cloud" ? null : flowError}
      cloudPicker={step.kind === "cloud" ? cloudPicker : null}
      onPickOption={handlePickOption}
      onBack={handleBack}
      onClose={handleClose}
    />
  );
}
