import { useCallback, useMemo } from "react";
import { useAddRepo } from "@/hooks/workspaces/workflows/use-add-repo";
import type { AppCommandAction } from "./app-command-action-types";

export function useAppAddRepositoryCommandAction(): AppCommandAction {
  const {
    addRepoFromPicker,
    canAddRepo,
    addRepoDisabledReason,
    isAddingRepo,
  } = useAddRepo();

  const disabledReason = isAddingRepo
    ? "Action already in progress."
    : canAddRepo
      ? null
      : addRepoDisabledReason;
  const execute = useCallback(() => {
    if (disabledReason) {
      return;
    }
    void addRepoFromPicker();
  }, [addRepoFromPicker, disabledReason]);

  return useMemo<AppCommandAction>(() => ({
    execute,
    disabledReason,
  }), [disabledReason, execute]);
}
