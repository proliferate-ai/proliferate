import { useCallback, useMemo } from "react";
import type { SidebarGroupState } from "#product/lib/domain/workspaces/sidebar/sidebar-model";

interface RepositoryHeaderNewChatActions {
  handleGoHome: () => void;
  handleGoHomeForRepository: (sourceRoot: string) => void;
}

export function useRepositoryHeaderNewChat(
  groups: readonly SidebarGroupState[],
  actions: RepositoryHeaderNewChatActions,
): () => void {
  const activeRepositorySourceRoot = useMemo(
    () => groups.find((group) => group.items.some((item) => item.active))?.sourceRoot ?? null,
    [groups],
  );

  return useCallback(() => {
    if (activeRepositorySourceRoot) {
      actions.handleGoHomeForRepository(activeRepositorySourceRoot);
      return;
    }
    actions.handleGoHome();
  }, [actions, activeRepositorySourceRoot]);
}
