import type { ReactNode } from "react";
import {
  WorkspaceShellActionsContext,
  type WorkspaceShellActions,
} from "#product/hooks/workspaces/workflows/use-workspace-shell-actions";

export function WorkspaceShellActionsProvider({
  value,
  children,
}: {
  value: WorkspaceShellActions;
  children: ReactNode;
}) {
  return (
    <WorkspaceShellActionsContext.Provider value={value}>
      {children}
    </WorkspaceShellActionsContext.Provider>
  );
}
