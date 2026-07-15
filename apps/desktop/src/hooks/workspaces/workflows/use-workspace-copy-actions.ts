import { useCallback } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import type { WorkspaceCopyLocationTarget } from "@/lib/domain/workspaces/workspace-copy-metadata";
import { useToastStore } from "@/stores/toast/toast-store";

export function useWorkspaceCopyActions() {
  const { writeText } = useProductHost().clipboard;
  const showToast = useToastStore((state) => state.show);

  const copyWorkspaceLocation = useCallback(async (
    target: WorkspaceCopyLocationTarget | null | undefined,
  ) => {
    const value = target?.value.trim();
    if (!target || !value) {
      showToast(target?.missingLabel ?? "No workspace location to copy.");
      return;
    }

    try {
      await writeText(value);
      showToast(`${target.toastLabel} copied`, "info");
    } catch {
      showToast(`Failed to copy ${target.toastLabel.toLowerCase()}.`);
    }
  }, [showToast, writeText]);

  const copyBranchName = useCallback(async (branchName: string | null | undefined) => {
    if (!branchName?.trim()) {
      showToast("No branch name to copy.");
      return;
    }

    try {
      await writeText(branchName.trim());
      showToast("Branch name copied", "info");
    } catch {
      showToast("Failed to copy branch name.");
    }
  }, [showToast, writeText]);

  return {
    copyWorkspaceLocation,
    copyBranchName,
  };
}
