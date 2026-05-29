import { createContext, useContext, type ReactNode } from "react";

interface WorkspaceShellActions {
  openTerminalPanel: (terminalId?: string) => boolean;
}

const WorkspaceShellActionsContext = createContext<WorkspaceShellActions | null>(null);

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

export function useWorkspaceShellActions(): WorkspaceShellActions | null {
  return useContext(WorkspaceShellActionsContext);
}
