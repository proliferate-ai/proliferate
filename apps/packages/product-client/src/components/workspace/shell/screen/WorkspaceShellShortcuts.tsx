import { useWorkspaceContentTabsViewModelContext } from "#product/components/workspace/shell/providers/WorkspaceHeaderTabsViewModelContext";
import { useWorkspaceContentShortcuts } from "#product/hooks/workspaces/ui/use-workspace-content-shortcuts";
import { useWorkspaceTabActions } from "#product/hooks/workspaces/workflows/tabs/use-workspace-tab-actions";

export function WorkspaceShellShortcuts({ enabled }: { enabled: boolean }) {
  const contentTabs = useWorkspaceContentTabsViewModelContext();
  const tabActions = useWorkspaceTabActions(contentTabs);
  useWorkspaceContentShortcuts(tabActions, { enabled });

  return null;
}
