import { ChatView } from "@/components/workspace/chat/ChatView";
import { useWorkspaceContentShortcuts } from "@/hooks/workspaces/use-workspace-content-shortcuts";
import { useWorkspaceTabActions } from "@/hooks/workspaces/use-workspace-tab-actions";
import { useWorkspaceHeaderTabsViewModel } from "@/hooks/workspaces/tabs/use-workspace-header-tabs-view-model";
import { FileEditorView } from "@/components/workspace/files/FileEditorView";
import { AllChangesFrame } from "@/components/workspace/changes/AllChangesFrame";
import { viewerTargetKey } from "@/lib/domain/workspaces/viewer-target";

export function WorkspaceContentView() {
  const tabActions = useWorkspaceTabActions();
  const headerTabs = useWorkspaceHeaderTabsViewModel();
  useWorkspaceContentShortcuts(tabActions);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 flex flex-col">
        {headerTabs.activeShellTab?.kind !== "viewer" ? (
          <ChatView shellRenderSurface={headerTabs.activation.renderSurface} />
        ) : headerTabs.activeShellTab.target.kind === "fileDiff" ? (
          <FileEditorView
            filePath={headerTabs.activeShellTab.target.path}
            targetKey={viewerTargetKey(headerTabs.activeShellTab.target)}
            diffTarget={headerTabs.activeShellTab.target}
          />
        ) : headerTabs.activeShellTab.target.kind === "allChanges" ? (
          <AllChangesFrame target={headerTabs.activeShellTab.target} />
        ) : (
          <FileEditorView
            filePath={headerTabs.activeShellTab.target.path}
            targetKey={viewerTargetKey(headerTabs.activeShellTab.target)}
          />
        )}
      </div>
    </div>
  );
}
