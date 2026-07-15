import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import {
  ManualChatGroupEditorPopover,
  type ManualChatGroupEditorAnchorRect,
} from "#product/components/workspace/shell/tabs/ManualChatGroupEditorPopover";
import { WorkspaceTabStrip } from "#product/components/workspace/shell/tabs/WorkspaceTabStrip";
import { NewChatButton, ClosedSessionsTrigger } from "#product/components/workspace/shell/topbar/HeaderTabsActions";
import { HeaderTabsStripRows } from "#product/components/workspace/shell/topbar/HeaderTabsStripRows";
import { useShortcutHandler } from "#product/hooks/shortcuts/lifecycle/use-shortcut-handler";
import { useSessionDismissActions } from "#product/hooks/sessions/workflows/use-session-dismiss-actions";
import { useSessionForkActions } from "#product/hooks/sessions/workflows/use-session-fork-actions";
import { useSessionTitleActions } from "#product/hooks/sessions/workflows/use-session-title-actions";
import { useDebugRenderCount } from "#product/hooks/ui/debug/use-debug-render-count";
import { useResizeObserverWidth } from "#product/hooks/ui/layout/use-resize-observer-width";
import { useHeaderTabsCloseActions } from "#product/hooks/workspaces/workflows/tabs/use-header-tabs-close-actions";
import { useHeaderTabsGroupEditor } from "#product/hooks/workspaces/ui/tabs/use-header-tabs-group-editor";
import {
  useHeaderTabsLayout,
} from "#product/hooks/workspaces/ui/tabs/use-header-tabs-layout";
import { useHeaderTabsMultiSelect } from "#product/hooks/workspaces/ui/tabs/use-header-tabs-multi-select";
import { useManualChatGroupActions } from "#product/hooks/workspaces/workflows/tabs/use-manual-chat-group-actions";
import { useChatTabVisibilityActions } from "#product/hooks/workspaces/workflows/tabs/use-chat-tab-visibility-actions";
import { useTabGroupActions } from "#product/hooks/workspaces/workflows/tabs/use-tab-group-actions";
import { useShellTabOrderActions } from "#product/hooks/workspaces/workflows/tabs/use-shell-tab-order-actions";
import { useShellTabDrag } from "#product/hooks/workspaces/ui/tabs/use-tab-drag";
import {
  useOptionalWorkspaceHeaderTabsViewModelContext,
} from "#product/components/workspace/shell/providers/WorkspaceHeaderTabsViewModelContext";
import { useWorkspaceTabActions } from "#product/hooks/workspaces/workflows/tabs/use-workspace-tab-actions";
import { useHeaderTabsUrgentHighlight } from "#product/hooks/workspaces/ui/use-header-tabs-urgent-highlight";
import type { ManualChatGroupId } from "#product/lib/domain/workspaces/tabs/manual-groups";
import { useWorkspaceViewerTabsStore } from "#product/stores/editor/workspace-viewer-tabs-store";
import { useToastStore } from "#product/stores/toast/toast-store";
import { startMeasurementOperation } from "#product/lib/infra/measurement/measurement-port";
import { useShortcutRevealVisible } from "#product/providers/ShortcutRevealProvider";

type HeaderTabsViewModel = NonNullable<
  ReturnType<typeof useOptionalWorkspaceHeaderTabsViewModelContext>
>;

// reservedWidth calculation: "+" button + its gap + flex-1 spacer gap + history button when visible + its gap.
// The 28px button size mirrors --workspace-shell-action-size (1.75rem) in apps/packages/design/src/css/product.css — if that token changes, these must change.
const PLUS_BUTTON_RESERVED = 28 + 6 + 6;
const HISTORY_BUTTON_RESERVED = 28 + 6;

export const HeaderTabs = memo(function HeaderTabs() {
  const viewModel = useOptionalWorkspaceHeaderTabsViewModelContext();
  if (!viewModel) {
    return null;
  }
  return <HeaderTabsInner viewModel={viewModel} />;
});

const HeaderTabsInner = memo(function HeaderTabsInner({
  viewModel,
}: {
  viewModel: HeaderTabsViewModel;
}) {
  useDebugRenderCount("header-tabs");
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
  const shortcutRevealVisible = useShortcutRevealVisible();
  const {
    deleteGroup: deleteManualChatGroup,
    removeSessions: removeSessionsFromManualChatGroups,
  } = useManualChatGroupActions();

  const closeTarget = useWorkspaceViewerTabsStore((state) => state.closeTarget);

  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const outerMeasure = useResizeObserverWidth<HTMLDivElement>();
  const stripScrollRef = useRef<HTMLDivElement | null>(null);
  const closedCount = viewModel.closedChatTabs.length;
  const reservedWidth = PLUS_BUTTON_RESERVED + (closedCount > 0 ? HISTORY_BUTTON_RESERVED : 0);
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
    width: outerMeasure.width,
    shellRows: viewModel.shellRows,
    reservedWidth,
  });
  const contentWidth = layout.widths.length > 0
    ? (layout.positions[layout.positions.length - 1] ?? 0)
      + (layout.widths[layout.widths.length - 1] ?? 0)
    : 0;

  const activeTabIndex = viewModel.shellRows.findIndex((shellRow) =>
    shellRow.kind === "chat"
    && shellRow.row.kind === "tab"
    && shellRow.row.tab.isActive
  );

  useEffect(() => {
    const strip = stripScrollRef.current;
    if (!strip || activeTabIndex < 0) {
      return;
    }
    const tabLeft = layout.positions[activeTabIndex] ?? 0;
    const tabWidth = layout.widths[activeTabIndex] ?? 0;
    const tabRight = tabLeft + tabWidth;
    const viewLeft = strip.scrollLeft;
    const viewRight = viewLeft + strip.clientWidth;
    if (tabLeft < viewLeft) {
      strip.scrollTo({ left: tabLeft, behavior: "smooth" });
    } else if (tabRight > viewRight) {
      strip.scrollTo({ left: tabRight - strip.clientWidth, behavior: "smooth" });
    }
  }, [activeTabIndex, layout.positions, layout.widths]);

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
    stripRef: stripScrollRef,
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
      <div
        ref={outerMeasure.ref}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-hidden pl-1"
      >
        <DebugProfiler id="header-tabs-strip">
          <WorkspaceTabStrip
            label="Workspace tabs"
            stripRef={stripScrollRef}
            contentWidth={contentWidth}
            className="h-7 min-w-0 shrink"
            style={{ maxWidth: contentWidth }}
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
              urgentHighlightedChatSessionId={urgentHighlightedChatSessionId}
              multiSelectedSessionIds={multiSelect.multiSelectedSessionIds}
              selectedTopLevelSessionIds={multiSelect.selectedTopLevelSessionIds}
              onHeaderTabHover={handleHeaderTabHover}
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
              shortcutRevealVisible={shortcutRevealVisible}
              clearSelection={multiSelect.clearSelection}
              toggleSelection={multiSelect.toggleSelection}
              suppressNextSelectClick={multiSelect.suppressNextSelectClick}
              consumeSuppressedSelectClick={multiSelect.consumeSuppressedSelectClick}
            />
          </WorkspaceTabStrip>
        </DebugProfiler>

        <NewChatButton
          canOpenNewSessionTab={tabActions.canOpenNewSessionTab}
          newSessionDisabledReason={tabActions.newSessionDisabledReason}
          onOpenNewSessionTab={() => tabActions.openNewSessionTab()}
        />

        <div className="min-w-0 flex-1" />

        <ClosedSessionsTrigger
          closedChatTabs={viewModel.closedChatTabs}
          onRestoreSession={(sessionId) => {
            chatVisibilityActions.showChatSessionTab(sessionId, { select: true });
          }}
          onDeleteSession={dismissChatSession}
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
});
