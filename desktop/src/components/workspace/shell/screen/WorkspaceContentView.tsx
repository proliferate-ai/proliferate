import { memo } from "react";
import { ChatView } from "@/components/workspace/chat/ChatView";
import { useWorkspaceContentShortcuts } from "@/hooks/workspaces/ui/use-workspace-content-shortcuts";
import { useWorkspaceTabActions } from "@/hooks/workspaces/tabs/use-workspace-tab-actions";
import { useActiveSessionActivityAcknowledgement } from "@/hooks/workspaces/lifecycle/use-active-session-activity-acknowledgement";
import { useWorkspaceContentTabsViewModelContext } from "@/components/workspace/shell/providers/WorkspaceHeaderTabsViewModelContext";
import { useDebugRenderCount } from "@/hooks/ui/use-debug-render-count";
import { DebugProfiler } from "@/components/ui/DebugProfiler";

export const WorkspaceContentView = memo(function WorkspaceContentView() {
  useDebugRenderCount("workspace-content-view");
  const contentTabs = useWorkspaceContentTabsViewModelContext();
  const tabActions = useWorkspaceTabActions(contentTabs);
  useWorkspaceContentShortcuts(tabActions);
  useActiveSessionActivityAcknowledgement(contentTabs.activation.renderSurface);

  return (
    <DebugProfiler id="workspace-content-view">
      <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 flex flex-col">
        <ChatView shellRenderSurface={contentTabs.activation.renderSurface} />
      </div>
      </div>
    </DebugProfiler>
  );
});
