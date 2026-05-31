import { createContext, useContext, type ReactNode } from "react";

export interface WorkspaceWebActions {
  disabled: boolean;
  disabledReason: string | null;
  openCurrentWorkspaceInWeb: () => void;
  title: string;
  url: string | null;
}

export interface WorkspaceRemoteAccessActions {
  disabled: boolean;
  handleClick: () => void;
  isEnabled: boolean;
  isPending: boolean;
  label: string;
  syncToWeb: () => void;
  syncToWebDisabledReason: string | null;
  title: string;
}

interface WorkspaceShellActions {
  openTerminalPanel: (terminalId?: string) => boolean;
  workspaceWebActions: WorkspaceWebActions;
  workspaceRemoteAccessActions: WorkspaceRemoteAccessActions;
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
