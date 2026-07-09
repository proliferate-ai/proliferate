import { useCallback, useMemo } from "react";
import { useAddRepo } from "@/hooks/workspaces/workflows/use-add-repo";
import { useAddRepoFlowStore } from "@/stores/ui/add-repo-flow-store";
import type { AppCommandAction } from "./app-command-action-types";

export function useAppAddRepositoryCommandAction(): AppCommandAction {
  const {
    canAddRepo,
    addRepoDisabledReason,
    isAddingRepo,
  } = useAddRepo();
  const openAddRepoFlow = useAddRepoFlowStore((state) => state.openFlow);

  const disabledReason = isAddingRepo
    ? "Action already in progress."
    : canAddRepo
      ? null
      : addRepoDisabledReason;
  const execute = useCallback(() => {
    if (disabledReason) {
      return;
    }
    openAddRepoFlow();
  }, [disabledReason, openAddRepoFlow]);

  return useMemo<AppCommandAction>(() => ({
    execute,
    disabledReason,
  }), [disabledReason, execute]);
}
