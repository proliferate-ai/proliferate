import { memo } from "react";
import { ChatView } from "@/components/workspace/chat/ChatView";
import { useWorkspaceContentShortcuts } from "@/hooks/workspaces/ui/use-workspace-content-shortcuts";
import { useWorkspaceTabActions } from "@/hooks/workspaces/tabs/use-workspace-tab-actions";
import { useWorkspaceContentTabsViewModelContext } from "@/components/workspace/shell/providers/WorkspaceHeaderTabsViewModelContext";
import { useDebugValueChange } from "@/hooks/ui/use-debug-value-change";
import { useDebugRenderCount } from "@/hooks/ui/use-debug-render-count";
import { useDebugRenderReason } from "@/hooks/ui/use-debug-render-reason";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { FileEditorView } from "@/components/workspace/files/FileEditorView";
import { AllChangesFrame } from "@/components/workspace/changes/AllChangesFrame";
import { viewerTargetKey } from "@/lib/domain/workspaces/viewer/viewer-target";

export const WorkspaceContentView = memo(function WorkspaceContentView() {
  useDebugRenderCount("workspace-content-view");
  const contentTabs = useWorkspaceContentTabsViewModelContext();
  const tabActions = useWorkspaceTabActions(contentTabs);
  useWorkspaceContentShortcuts(tabActions);
  const renderSurface = contentTabs.activation.renderSurface;
  useDebugValueChange("workspace_content.inputs", "active_surface_refs", {
    activeShellTab: contentTabs.activeShellTab,
    activeShellTabKey: contentTabs.activeShellTabKey,
    activation: contentTabs.activation,
    renderSurfaceKind: renderSurface.kind,
    renderSurfaceSessionId: "sessionId" in renderSurface ? renderSurface.sessionId : null,
    renderSurfaceTargetKey: "targetKey" in renderSurface ? renderSurface.targetKey : null,
  });
  useDebugRenderReason("WorkspaceContentView", {
    activeShellTab: contentTabs.activeShellTab,
    activeShellTabKey: contentTabs.activeShellTabKey,
    activation: contentTabs.activation,
    renderSurface,
  });

  return (
    <DebugProfiler id="workspace-content-view">
      <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 flex flex-col">
        {contentTabs.activeShellTab?.kind !== "viewer" ? (
          <ChatView shellRenderSurface={contentTabs.activation.renderSurface} />
        ) : contentTabs.activeShellTab.target.kind === "fileDiff" ? (
          <FileEditorView
            filePath={contentTabs.activeShellTab.target.path}
            targetKey={viewerTargetKey(contentTabs.activeShellTab.target)}
            diffTarget={contentTabs.activeShellTab.target}
          />
        ) : contentTabs.activeShellTab.target.kind === "allChanges" ? (
          <AllChangesFrame target={contentTabs.activeShellTab.target} />
        ) : (
          <FileEditorView
            filePath={contentTabs.activeShellTab.target.path}
            targetKey={viewerTargetKey(contentTabs.activeShellTab.target)}
          />
        )}
      </div>
      </div>
    </DebugProfiler>
  );
});
