import {
  useCallback,
  useState,
} from "react";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import {
  ManualChatGroupEditorPopover,
  type ManualChatGroupEditorAnchorRect,
} from "@/components/workspace/shell/tabs/ManualChatGroupEditorPopover";
import { WorkspaceTabStrip } from "@/components/workspace/shell/tabs/WorkspaceTabStrip";
import { HeaderTabsActions } from "@/components/workspace/shell/topbar/HeaderTabsActions";
import { HeaderTabsStripRows } from "@/components/workspace/shell/topbar/HeaderTabsStripRows";
import { useShortcutHandler } from "@/hooks/shortcuts/lifecycle/use-shortcut-handler";
import { useSessionDismissActions } from "@/hooks/sessions/workflows/use-session-dismiss-actions";
import { useSessionForkActions } from "@/hooks/sessions/workflows/use-session-fork-actions";
import { useSessionTitleActions } from "@/hooks/sessions/workflows/use-session-title-actions";
import { useDebugRenderCount } from "@/hooks/ui/use-debug-render-count";
import { useResizeObserverWidth } from "@/hooks/ui/use-resize-observer-width";
import { useHeaderTabsCloseActions } from "@/hooks/workspaces/tabs/use-header-tabs-close-actions";
import { useHeaderTabsGroupEditor } from "@/hooks/workspaces/tabs/use-header-tabs-group-editor";
import {
  useHeaderTabsLayout,
} from "@/hooks/workspaces/tabs/use-header-tabs-layout";
import { useHeaderTabsMultiSelect } from "@/hooks/workspaces/tabs/use-header-tabs-multi-select";
import { useManualChatGroupActions } from "@/hooks/workspaces/tabs/use-manual-chat-group-actions";
import { useChatTabVisibilityActions } from "@/hooks/workspaces/tabs/use-chat-tab-visibility-actions";
import { useTabGroupActions } from "@/hooks/workspaces/tabs/use-tab-group-actions";
import { useShellTabOrderActions } from "@/hooks/workspaces/tabs/use-shell-tab-order-actions";
import { useShellTabDrag } from "@/hooks/workspaces/tabs/use-tab-drag";
import { useWorkspaceHeaderTabsViewModelContext } from "@/components/workspace/shell/providers/WorkspaceHeaderTabsViewModelContext";
import { useWorkspaceShellActivation } from "@/hooks/workspaces/tabs/use-workspace-shell-activation";
import { useWorkspaceTabActions } from "@/hooks/workspaces/use-workspace-tab-actions";
import { useHeaderTabsUrgentHighlight } from "@/hooks/workspaces/ui/use-header-tabs-urgent-highlight";
import type { ManualChatGroupId } from "@/lib/domain/workspaces/tabs/manual-groups";
import type { ViewerTarget } from "@/lib/domain/workspaces/viewer/viewer-target";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { startMeasurementOperation } from "@/lib/infra/measurement/debug-measurement";

export function HeaderTabs() {
  useDebugRenderCount("header-tabs");
  const viewModel = useWorkspaceHeaderTabsViewModelContext();
  const chatVisibilityActions = useChatTabVisibilityActions({
    workspaceUiKey: viewModel.workspaceUiKey,
    materializedWorkspaceId: viewModel.materializedWorkspaceId,
    visibleIds: viewModel.visibleChatSessionIds,
    liveIds: viewModel.liveChatSessionIds,
    childToParent: viewModel.childToParent,
  });
  const tabGroupActions = useTabGroupActions();
  const tabActions = useWorkspaceTabActions(viewModel);
  const { dismissSession } = useSessionDismissActions();
  const { updateSessionTitle } = useSessionTitleActions();
  const showToast = useToastStore((state) => state.show);
  const {
    deleteGroup: deleteManualChatGroup,
    removeSessions: removeSessionsFromManualChatGroups,
  } = useManualChatGroupActions();

  const closeTarget = useWorkspaceViewerTabsStore((state) => state.closeTarget);
  const { activateViewerTarget } = useWorkspaceShellActivation();

  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const shellStrip = useResizeObserverWidth<HTMLDivElement>();
  const shellTabOrderActions = useShellTabOrderActions({
    workspaceId: viewModel.workspaceUiKey,
  });
  const handleSessionForked = useCallback((response: { session: { id: string } }) => {
    chatVisibilityActions.showChatSessionTab(response.session.id, { select: true });
  }, [chatVisibilityActions.showChatSessionTab]);
  const { forkSession } = useSessionForkActions({
    workspaceId: viewModel.selectedWorkspaceId,
    onForked: handleSessionForked,
  });

  useShortcutHandler("session.rename", () => {
    if (viewModel.activeSessionId) {
      setRenamingSessionId(viewModel.activeSessionId);
    }
  });

  const multiSelect = useHeaderTabsMultiSelect({
    workspaceId: viewModel.workspaceUiKey,
    chatTabs: viewModel.chatTabs,
    stripChatSessionIds: viewModel.stripChatSessionIds,
  });
  const groupEditorWorkflow = useHeaderTabsGroupEditor({
    workspaceId: viewModel.workspaceUiKey,
    displayManualGroups: viewModel.displayManualGroups,
    onCreateComplete: multiSelect.clearSelection,
  });

  const {
    layout,
    chatGroupUnderlines,
    dragRows,
    dragUnitsBySourceId,
  } = useHeaderTabsLayout({
    width: shellStrip.width,
    shellRows: viewModel.shellRows,
  });

  const dismissChatSession = useCallback((sessionId: string) => {
    void dismissSession(sessionId).then(() => {
      if (viewModel.selectedWorkspaceId) {
        removeSessionsFromManualChatGroups(viewModel.workspaceUiKey ?? viewModel.selectedWorkspaceId, [sessionId]);
      }
      multiSelect.clearSelection();
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(message);
    });
  }, [
    dismissSession,
    multiSelect.clearSelection,
    removeSessionsFromManualChatGroups,
    showToast,
    viewModel.selectedWorkspaceId,
    viewModel.workspaceUiKey,
  ]);

  const {
    closeWorkspaceTabs,
    closeOtherWorkspaceTabs,
    closeWorkspaceTabsToRight,
  } = useHeaderTabsCloseActions({
    selectedWorkspaceId: viewModel.selectedWorkspaceId,
    shellWorkspaceId: viewModel.workspaceUiKey,
    activeShellTab: viewModel.activeShellTab,
    orderedTabs: viewModel.orderedTabs,
    buffersByPath: viewModel.buffersByPath,
    closeTarget,
    showChatSessionTab: chatVisibilityActions.showChatSessionTab,
    hideChatSessionTabs: chatVisibilityActions.hideChatSessionTabs,
  });

  const shellDrag = useShellTabDrag({
    stripRef: shellStrip.ref,
    rows: dragRows,
    orderedIds: viewModel.orderedShellTabKeys,
    unitsBySourceId: dragUnitsBySourceId,
    onDragStart: multiSelect.clearSelection,
    onReorder: shellTabOrderActions.reorderShellTabs,
  });
  const handleHeaderTabHover = useCallback(() => {
    startMeasurementOperation({
      kind: "hover_sample",
      sampleKey: "header_tab",
      surfaces: ["header-tab", "header-tabs"],
      maxDurationMs: 750,
      cooldownMs: 2000,
    });
  }, []);
  const activateChatSessionFromHeader = useCallback((sessionId: string) => {
    chatVisibilityActions.showChatSessionTab(sessionId, { select: true });
  }, [chatVisibilityActions.showChatSessionTab]);
  const {
    urgentHighlightedChatSessionId,
    clearUrgentChatHighlight,
    previewHeaderChatTab,
    activateHeaderChatTab,
  } = useHeaderTabsUrgentHighlight({
    workspaceUiKey: viewModel.workspaceUiKey,
    activeShellTab: viewModel.activeShellTab,
    onActivateChatSession: activateChatSessionFromHeader,
  });
  const handleSelectViewerTarget = useCallback((target: ViewerTarget) => {
    if (!viewModel.selectedWorkspaceId) {
      return;
    }
    clearUrgentChatHighlight();
    activateViewerTarget({
      workspaceId: viewModel.selectedWorkspaceId,
      shellWorkspaceId: viewModel.workspaceUiKey,
      target,
      mode: "focus-existing",
    });
  }, [
    activateViewerTarget,
    clearUrgentChatHighlight,
    viewModel.selectedWorkspaceId,
    viewModel.workspaceUiKey,
  ]);
  const handleCloseViewerTarget = useCallback((target: ViewerTarget) => {
    closeWorkspaceTabs([{ kind: "viewer", target }]);
  }, [closeWorkspaceTabs]);
  const handleCloseOtherViewerTargets = useCallback((target: ViewerTarget) => {
    closeOtherWorkspaceTabs({ kind: "viewer", target });
  }, [closeOtherWorkspaceTabs]);
  const handleCloseViewerTargetsToRight = useCallback((target: ViewerTarget) => {
    closeWorkspaceTabsToRight({ kind: "viewer", target });
  }, [closeWorkspaceTabsToRight]);
  const handleRenameManualGroup = useCallback((
    groupId: ManualChatGroupId,
    anchorRect: ManualChatGroupEditorAnchorRect,
  ) => {
    groupEditorWorkflow.openEditGroupEditor(groupId, "rename", anchorRect);
  }, [groupEditorWorkflow.openEditGroupEditor]);
  const handleChangeManualGroupColor = useCallback((
    groupId: ManualChatGroupId,
    anchorRect: ManualChatGroupEditorAnchorRect,
  ) => {
    groupEditorWorkflow.openEditGroupEditor(groupId, "color", anchorRect);
  }, [groupEditorWorkflow.openEditGroupEditor]);
  const handleUngroupManualGroup = useCallback((groupId: ManualChatGroupId) => {
    if (!viewModel.workspaceUiKey) {
      return;
    }
    deleteManualChatGroup(viewModel.workspaceUiKey, groupId);
    multiSelect.clearSelection();
  }, [
    deleteManualChatGroup,
    multiSelect.clearSelection,
    viewModel.workspaceUiKey,
  ]);
  const handleRenameOpenChange = useCallback((_sessionId: string, isOpen: boolean) => {
    if (!isOpen) {
      setRenamingSessionId(null);
    }
  }, []);
  const handleStartRename = useCallback((sessionId: string) => {
    setRenamingSessionId(sessionId);
  }, []);
  const handleRenameChatTab = useCallback((sessionId: string, title: string) =>
    updateSessionTitle(sessionId, title), [updateSessionTitle]);
  const handleCreateGroup = useCallback((sessionIds: readonly string[]) => {
    groupEditorWorkflow.openCreateGroupEditor([...sessionIds]);
  }, [groupEditorWorkflow.openCreateGroupEditor]);
  const handleChatContextMenuTarget = useCallback((
    sessionId: string,
    anchorRect: ManualChatGroupEditorAnchorRect,
  ) => {
    groupEditorWorkflow.rememberAnchorRect(anchorRect);
    if (!multiSelect.multiSelectedSessionIds.has(sessionId)) {
      multiSelect.clearSelection();
    }
  }, [
    groupEditorWorkflow.rememberAnchorRect,
    multiSelect.clearSelection,
    multiSelect.multiSelectedSessionIds,
  ]);
  const handleForkChatTab = useCallback((sessionId: string) => {
    multiSelect.clearSelection();
    forkSession(sessionId);
  }, [forkSession, multiSelect.clearSelection]);
  const handleCloseChatTab = useCallback((sessionId: string) => {
    multiSelect.clearSelection();
    chatVisibilityActions.hideChatSessionTabs([sessionId], { selectFallback: true });
  }, [
    chatVisibilityActions.hideChatSessionTabs,
    multiSelect.clearSelection,
  ]);
  const handleCloseOtherChatTabs = useCallback((sessionId: string) => {
    closeOtherWorkspaceTabs({ kind: "chat", sessionId });
  }, [closeOtherWorkspaceTabs]);
  const handleCloseChatTabsToRight = useCallback((sessionId: string) => {
    closeWorkspaceTabsToRight({ kind: "chat", sessionId });
  }, [closeWorkspaceTabsToRight]);

  return (
    <DebugProfiler id="header-tabs">
      <div className="flex h-full min-w-0 flex-1 items-end gap-1 overflow-hidden px-1">
      <WorkspaceTabStrip
        label="Workspace tabs"
        stripRef={shellStrip.ref}
        className="h-9 min-w-0 flex-1"
        {...shellDrag.stripDragProps}
      >
        {chatGroupUnderlines.map((range) => (
          <span
            key={`group-line-${range.groupId}`}
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 z-[6] h-0.5 rounded-full"
            style={{
              left: range.left + shellDrag.getRowDragOffset(`pill:${range.groupId}`),
              width: range.width,
            backgroundColor: range.color,
          }}
        />
      ))}
        <HeaderTabsStripRows
          shellRows={viewModel.shellRows}
          widths={layout.widths}
          positions={layout.positions}
          shellDrag={shellDrag}
          renamingSessionId={renamingSessionId}
          activeShellTab={viewModel.activeShellTab}
          urgentHighlightedChatSessionId={urgentHighlightedChatSessionId}
          buffersByPath={viewModel.buffersByPath}
          tabModes={viewModel.tabModes}
          multiSelectedSessionIds={multiSelect.multiSelectedSessionIds}
          selectedTopLevelSessionIds={multiSelect.selectedTopLevelSessionIds}
          onHeaderTabHover={handleHeaderTabHover}
          onSelectViewerTarget={handleSelectViewerTarget}
          onCloseViewerTarget={handleCloseViewerTarget}
          onCloseOtherViewerTargets={handleCloseOtherViewerTargets}
          onCloseViewerTargetsToRight={handleCloseViewerTargetsToRight}
          onToggleGroup={tabGroupActions.toggleGroupCollapsed}
          onRenameManualGroup={handleRenameManualGroup}
          onChangeManualGroupColor={handleChangeManualGroupColor}
          onUngroupManualGroup={handleUngroupManualGroup}
          onRenameOpenChange={handleRenameOpenChange}
          onStartRename={handleStartRename}
          onRenameChatTab={handleRenameChatTab}
          onCreateGroup={handleCreateGroup}
          onChatContextMenuTarget={handleChatContextMenuTarget}
          onForkChatTab={handleForkChatTab}
          onPreviewChatTab={previewHeaderChatTab}
          onActivateChatTab={activateHeaderChatTab}
          onSuppressChatTabSelect={clearUrgentChatHighlight}
          onCloseChatTab={handleCloseChatTab}
          onCloseOtherChatTabs={handleCloseOtherChatTabs}
          onCloseChatTabsToRight={handleCloseChatTabsToRight}
          onDismissChatSession={dismissChatSession}
          clearSelection={multiSelect.clearSelection}
          toggleSelection={multiSelect.toggleSelection}
          suppressNextSelectClick={multiSelect.suppressNextSelectClick}
          consumeSuppressedSelectClick={multiSelect.consumeSuppressedSelectClick}
        />
      </WorkspaceTabStrip>

      <HeaderTabsActions
        workspaceId={viewModel.selectedWorkspaceId}
        menuChatTabs={viewModel.menuChatTabs}
        childrenByParentSessionId={viewModel.childrenByParentSessionId}
        canOpenNewSessionTab={tabActions.canOpenNewSessionTab}
        newSessionDisabledReason={tabActions.newSessionDisabledReason}
        onOpenSession={(sessionId) => {
          chatVisibilityActions.showChatSessionTab(sessionId, { select: true });
        }}
        onOpenNewSessionTab={() => tabActions.openNewSessionTab()}
      />

      {groupEditorWorkflow.groupEditor && (
        <ManualChatGroupEditorPopover
          title={groupEditorWorkflow.groupEditor.mode === "create" ? "Create Group" : "Edit Group"}
          anchorRect={groupEditorWorkflow.groupEditor.anchorRect}
          initialLabel={groupEditorWorkflow.groupEditor.label}
          initialColorId={groupEditorWorkflow.groupEditor.colorId}
          onClose={groupEditorWorkflow.closeGroupEditor}
          onConfirm={groupEditorWorkflow.confirmGroupEditor}
        />
      )}
      </div>
    </DebugProfiler>
  );
}
