import { createContext, useContext } from "react";
import type { PublishIntent } from "#product/lib/domain/workspaces/creation/publish-workflow-model";
import type { RightPanelTool } from "#product/lib/domain/workspaces/shell/right-panel-model";

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

export interface WorkspaceShellActions {
  openTerminalPanel: (terminalId?: string) => boolean;
  openRightPanelTool: (tool: RightPanelTool) => void;
  openPublishDialog: (intent: PublishIntent) => void;
  openPullRequest: () => void;
  workspaceWebActions: WorkspaceWebActions;
  workspaceRemoteAccessActions: WorkspaceRemoteAccessActions;
  /**
   * Requests that the right-panel rail be at least `minRailWidth` wide,
   * without shrinking a wider existing/durable preference. Implemented only
   * as `layout.setRightPanelWidth(current => Math.max(current, minRailWidth))`.
   */
  ensureRightPanelWidth: (minRailWidth: number) => void;
}

export const WorkspaceShellActionsContext = createContext<WorkspaceShellActions | null>(null);

export function useWorkspaceShellActions(): WorkspaceShellActions | null {
  return useContext(WorkspaceShellActionsContext);
}
