import { useWorkspaceContentTabsViewModelContext } from "@/components/workspace/shell/providers/WorkspaceHeaderTabsViewModelContext";
import { useWorkspaceContentShortcuts } from "@/hooks/workspaces/ui/use-workspace-content-shortcuts";
import { useWorkspaceTabActions } from "@/hooks/workspaces/workflows/tabs/use-workspace-tab-actions";

export function WorkspaceShellShortcuts({ enabled }: { enabled: boolean }) {
  const contentTabs = useWorkspaceContentTabsViewModelContext();
  const tabActions = useWorkspaceTabActions(contentTabs);
  useWorkspaceContentShortcuts(tabActions, { enabled });

  return null;
}
