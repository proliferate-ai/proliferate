import { useCallback } from "react";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import type { WorkspaceCopyLocationTarget } from "@/lib/domain/workspaces/workspace-copy-metadata";
import { useToastStore } from "@/stores/toast/toast-store";

export function useWorkspaceCopyActions() {
  const { copyPath, copyText } = useTauriShellActions();
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
      await copyPath(value);
      showToast(`${target.toastLabel} copied`, "info");
    } catch {
      showToast(`Failed to copy ${target.toastLabel.toLowerCase()}.`);
    }
  }, [copyPath, showToast]);

  const copyBranchName = useCallback(async (branchName: string | null | undefined) => {
    if (!branchName?.trim()) {
      showToast("No branch name to copy.");
      return;
    }

    try {
      await copyText(branchName.trim());
      showToast("Branch name copied", "info");
    } catch {
      showToast("Failed to copy branch name.");
    }
  }, [copyText, showToast]);

  return {
    copyWorkspaceLocation,
    copyBranchName,
  };
}
