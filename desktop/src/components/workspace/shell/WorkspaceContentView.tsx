import { useCallback } from "react";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { ChatView } from "@/components/workspace/chat/ChatView";
import { useWorkspaceContentShortcuts } from "@/hooks/workspaces/use-workspace-content-shortcuts";
import { useWorkspaceTabActions } from "@/hooks/workspaces/use-workspace-tab-actions";
import { useTerminalActions } from "@/hooks/terminals/use-terminal-actions";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { FileEditorView } from "@/components/workspace/files/FileEditorView";
import { FileDiffView } from "@/components/workspace/files/FileDiffView";

export function WorkspaceContentView() {
  const activeMainTab = useWorkspaceFilesStore((s) => s.activeMainTab);
  const tabModes = useWorkspaceFilesStore((s) => s.tabModes);
  const tabActions = useWorkspaceTabActions();
  const selectedWorkspaceId = useHarnessStore((s) => s.selectedWorkspaceId);
  const { createTab } = useTerminalActions();
  const showToast = useToastStore((s) => s.show);

  const createNewTerminalTab = useCallback(() => {
    if (!selectedWorkspaceId) return;
    createTab(selectedWorkspaceId, 120, 40).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Failed to create terminal tab: ${msg}`);
    });
  }, [selectedWorkspaceId, createTab, showToast]);

  useWorkspaceContentShortcuts({ ...tabActions, createNewTerminalTab });

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 flex flex-col">
        {activeMainTab.kind === "chat" ? (
          <ChatView />
        ) : tabModes[activeMainTab.path] === "diff" ? (
          <FileDiffView filePath={activeMainTab.path} />
        ) : (
          <FileEditorView filePath={activeMainTab.path} />
        )}
      </div>
    </div>
  );
}
