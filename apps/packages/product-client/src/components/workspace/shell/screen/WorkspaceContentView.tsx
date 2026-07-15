import { memo } from "react";
import { ChatView } from "#product/components/workspace/chat/ChatView";
import { useActiveSessionActivityAcknowledgement } from "#product/hooks/workspaces/lifecycle/use-active-session-activity-acknowledgement";
import { useWorkspaceContentTabsViewModelContext } from "#product/components/workspace/shell/providers/WorkspaceHeaderTabsViewModelContext";
import { useDebugRenderCount } from "#product/hooks/ui/debug/use-debug-render-count";
import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";

export const WorkspaceContentView = memo(function WorkspaceContentView({
  visible = true,
}: {
  visible?: boolean;
}) {
  useDebugRenderCount("workspace-content-view");
  const contentTabs = useWorkspaceContentTabsViewModelContext();
  useActiveSessionActivityAcknowledgement(
    contentTabs.activation.renderSurface,
    { enabled: visible },
  );

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
