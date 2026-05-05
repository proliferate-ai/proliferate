import {
  useCallback,
  useState,
} from "react";
import { Button } from "@/components/ui/Button";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { ListFilter, Plus } from "@/components/ui/icons";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { ChatTabWithMenu } from "@/components/workspace/shell/tabs/ChatTabWithMenu";
import { ChatTabsMenu } from "@/components/workspace/shell/tabs/ChatTabsMenu";
import { FileTabWithMenu } from "@/components/workspace/shell/tabs/FileTabWithMenu";
import {
  ManualChatGroupEditorPopover,
} from "@/components/workspace/shell/tabs/ManualChatGroupEditorPopover";
import { TabGroupPillWithMenu } from "@/components/workspace/shell/tabs/TabGroupPillWithMenu";
import { WorkspaceTabStrip } from "@/components/workspace/shell/tabs/WorkspaceTabStrip";
import {
  renderChatMenuStatus,
  renderChatTabIcon,
} from "@/components/workspace/shell/tabs/tab-rendering";
import { useShortcutHandler } from "@/hooks/shortcuts/use-shortcut-handler";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { useSessionForkActions } from "@/hooks/sessions/use-session-fork-actions";
import { useSessionTitleActions } from "@/hooks/sessions/use-session-title-actions";
import { useDebugRenderCount } from "@/hooks/ui/use-debug-render-count";
import { useResizeObserverWidth } from "@/hooks/ui/use-resize-observer-width";
import { useHeaderTabsCloseActions } from "@/hooks/workspaces/tabs/use-header-tabs-close-actions";
import { useHeaderTabsGroupEditor } from "@/hooks/workspaces/tabs/use-header-tabs-group-editor";
import {
  getShellDragRowId,
  useHeaderTabsLayout,
} from "@/hooks/workspaces/tabs/use-header-tabs-layout";
import {
  isPrimaryMultiSelectClick,
  isPrimaryMultiSelectPointer,
  useHeaderTabsMultiSelect,
} from "@/hooks/workspaces/tabs/use-header-tabs-multi-select";
import { useManualChatGroupActions } from "@/hooks/workspaces/tabs/use-manual-chat-group-actions";
import { useChatTabVisibilityActions } from "@/hooks/workspaces/tabs/use-chat-tab-visibility-actions";
import { useTabGroupActions } from "@/hooks/workspaces/tabs/use-tab-group-actions";
import { useShellTabOrderActions } from "@/hooks/workspaces/tabs/use-shell-tab-order-actions";
import { useShellTabDrag } from "@/hooks/workspaces/tabs/use-tab-drag";
import { useWorkspaceHeaderTabsViewModelContext } from "@/components/workspace/shell/WorkspaceHeaderTabsViewModelContext";
import { useWorkspaceShellActivation } from "@/hooks/workspaces/tabs/use-workspace-shell-activation";
import { useWorkspaceTabActions } from "@/hooks/workspaces/use-workspace-tab-actions";
import {
  TAB_GROUP_PILL_WIDTH,
} from "@/lib/domain/workspaces/tabs/chrome-layout";
import {
  viewerTargetKey,
  viewerTargetLabel,
  viewerTargetDisplayPath,
  viewerTargetEditablePath,
} from "@/lib/domain/workspaces/viewer-target";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { startMeasurementOperation } from "@/lib/infra/debug-measurement";

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
  const tabActions = useWorkspaceTabActions();
  const { dismissSession } = useSessionActions();
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
        {viewModel.shellRows.map((shellRow, index) => {
          const rowKind = shellRow.kind === "chat" && shellRow.row.kind === "pill" ? "pill" : "tab";
          const width = layout.widths[index] ?? (rowKind === "pill" ? TAB_GROUP_PILL_WIDTH : 160);
          const position = layout.positions[index] ?? 0;
          const rowId = getShellDragRowId(shellRow);
          const isDragging = shellDrag.isDraggingRow(rowId);
          const dragOffset = shellDrag.getRowDragOffset(rowId);
          if (shellRow.kind === "viewer") {
            const target = shellRow.target;
            const targetKey = viewerTargetKey(target);
            const displayPath = viewerTargetDisplayPath(target);
            const isActive = viewModel.activeShellTab?.kind === "viewer"
              && viewerTargetKey(viewModel.activeShellTab.target) === targetKey;
            const bufferPath = viewerTargetEditablePath(target);
            const buf = bufferPath ? viewModel.buffersByPath[bufferPath] : null;
            const isDirty = buf?.isDirty ?? false;
            const isAllChanges = target.kind === "allChanges";
            const isDiff = !isAllChanges && viewModel.tabModes[targetKey] === "diff";
            return (
              <div
                key={targetKey}
                {...shellDrag.getRowDragProps(rowId)}
                onPointerEnter={handleHeaderTabHover}
                className={`absolute bottom-0 h-9 app-region-no-drag ${
                  isDragging
                    ? "z-[20] cursor-grabbing opacity-80"
                    : `${isActive ? "z-[5]" : "z-[1] hover:z-[2]"} cursor-grab transition-transform duration-150`
                }`}
                style={{
                  width,
                  transform: `translate3d(${position + dragOffset}px, 0, 0)`,
                }}
              >
                <FileTabWithMenu
                  path={displayPath ?? viewerTargetLabel(target)}
                  label={viewerTargetLabel(target)}
                  isActive={isActive}
                  isDirty={isDirty}
                  isDiff={isDiff}
                  isAllChanges={isAllChanges}
                  width={width}
                  hideLeftDivider={index === 0}
                  hideRightDivider={index === viewModel.shellRows.length - 1}
                  onSelect={() => {
                    if (shellDrag.shouldSuppressClick(rowId)) {
                      return;
                    }
                    if (viewModel.selectedWorkspaceId) {
                      activateViewerTarget({
                        workspaceId: viewModel.selectedWorkspaceId,
                        shellWorkspaceId: viewModel.workspaceUiKey,
                        target,
                        mode: "focus-existing",
                      });
                    }
                  }}
                  onClose={() => closeWorkspaceTabs([{ kind: "viewer", target }])}
                  onCloseOthers={() => closeOtherWorkspaceTabs({ kind: "viewer", target })}
                  onCloseRight={() => closeWorkspaceTabsToRight({ kind: "viewer", target })}
                />
              </div>
            );
          }

          const row = shellRow.row;
          if (row.kind === "pill") {
            return (
              <div
                key={`pill-${row.groupId}`}
                {...(row.groupKind === "subagent" ? shellDrag.getRowDragProps(rowId) : {})}
                className={`absolute bottom-0 flex h-9 items-end pb-2 app-region-no-drag ${
                  isDragging
                    ? "z-[20] cursor-grabbing opacity-80"
                    : `z-[3] transition-transform duration-150 hover:z-[4] ${
                      row.groupKind === "subagent" ? "cursor-grab" : ""
                    }`
                }`}
                style={{
                  width,
                  transform: `translate3d(${position + dragOffset}px, 0, 0)`,
                }}
              >
                <TabGroupPillWithMenu
                  groupKind={row.groupKind}
                  label={row.label}
                  color={row.color}
                  width={width}
                  isCollapsed={row.isCollapsed}
                  onToggle={() => {
                    if (shellDrag.shouldSuppressClick(rowId)) {
                      return;
                    }
                    tabGroupActions.toggleGroupCollapsed(row.groupId);
                  }}
                  onRename={row.groupKind === "manual"
                    ? (anchorRect) =>
                      groupEditorWorkflow.openEditGroupEditor(
                        row.manualGroupId,
                        "rename",
                        anchorRect,
                      )
                    : undefined}
                  onChangeColor={row.groupKind === "manual"
                    ? (anchorRect) =>
                      groupEditorWorkflow.openEditGroupEditor(
                        row.manualGroupId,
                        "color",
                        anchorRect,
                      )
                    : undefined}
                  onUngroup={row.groupKind === "manual"
                    ? () => {
                      if (!viewModel.workspaceUiKey) {
                        return;
                      }
                      deleteManualChatGroup(viewModel.workspaceUiKey, row.manualGroupId);
                      multiSelect.clearSelection();
                    }
                    : undefined}
                />
              </div>
            );
          }

          const tab = row.tab;
          const canMultiSelect = !tab.isChild;
          const canCreateGroup = canMultiSelect
            && multiSelect.multiSelectedSessionIds.has(tab.id)
            && multiSelect.selectedTopLevelSessionIds.length >= 2;
          const canDragTab = !tab.isReviewAgentChild;
          const previousShellRow = viewModel.shellRows[index - 1];
          const nextShellRow = viewModel.shellRows[index + 1];
          const previousIsChatTab =
            previousShellRow?.kind === "chat" && previousShellRow.row.kind === "tab";
          const nextIsChatTab =
            nextShellRow?.kind === "chat" && nextShellRow.row.kind === "tab";
          return (
            <div
              key={tab.id}
              {...(canDragTab ? shellDrag.getRowDragProps(rowId) : {})}
              onPointerEnter={handleHeaderTabHover}
              className={`absolute bottom-0 h-9 app-region-no-drag ${
                isDragging
                  ? "z-[20] cursor-grabbing opacity-80"
                  : `${tab.isActive ? "z-[5]" : "z-[1] hover:z-[2]"} ${
                    canDragTab ? "cursor-grab" : "cursor-default"
                  } transition-transform duration-150`
              }`}
              style={{
                width,
                transform: `translate3d(${position + dragOffset}px, 0, 0)`,
              }}
            >
              <ChatTabWithMenu
                tab={tab}
                width={width}
                hideLeftDivider={!previousIsChatTab}
                hideRightDivider={!nextIsChatTab}
                renaming={renamingSessionId === tab.id}
                onRenameOpenChange={(isOpen) => {
                  if (!isOpen) setRenamingSessionId(null);
                }}
                onStartRename={() => setRenamingSessionId(tab.id)}
                onRename={(title) => updateSessionTitle(tab.id, title)}
                isMultiSelected={!tab.isActive && multiSelect.multiSelectedSessionIds.has(tab.id)}
                canCreateGroup={canCreateGroup}
                onCreateGroup={() =>
                  groupEditorWorkflow.openCreateGroupEditor(multiSelect.selectedTopLevelSessionIds)
                }
                onFork={() => {
                  multiSelect.clearSelection();
                  forkSession(tab.id);
                }}
                onSelectPointerDownCapture={(event) => {
                  if (!canMultiSelect || !isPrimaryMultiSelectPointer(event)) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  multiSelect.suppressNextSelectClick(tab.id);
                  multiSelect.toggleSelection(tab.id);
                }}
                onContextMenuTarget={(anchorRect) => {
                  groupEditorWorkflow.rememberAnchorRect(anchorRect);
                  if (!multiSelect.multiSelectedSessionIds.has(tab.id)) {
                    multiSelect.clearSelection();
                  }
                }}
                onSelect={(event) => {
                  if (shellDrag.shouldSuppressClick(rowId)) {
                    return;
                  }
                  if (multiSelect.consumeSuppressedSelectClick(tab.id)) {
                    event.preventDefault();
                    return;
                  }
                  if (canMultiSelect && isPrimaryMultiSelectClick(event)) {
                    event.preventDefault();
                    multiSelect.toggleSelection(tab.id);
                    return;
                  }
                  multiSelect.clearSelection();
                  chatVisibilityActions.showChatSessionTab(tab.id, { select: true });
                }}
                onClose={() => {
                  multiSelect.clearSelection();
                  chatVisibilityActions.hideChatSessionTabs([tab.id], { selectFallback: true });
                }}
                onCloseOthers={() => closeOtherWorkspaceTabs({ kind: "chat", sessionId: tab.id })}
                onCloseRight={() => closeWorkspaceTabsToRight({ kind: "chat", sessionId: tab.id })}
                onDismiss={() => dismissChatSession(tab.id)}
              />
            </div>
          );
        })}
      </WorkspaceTabStrip>

      {(viewModel.menuChatTabs.length > 1 || hasAnySubagents(viewModel.childrenByParentSessionId)) && (
        <PopoverButton
          align="end"
          trigger={(
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title="Open chat tabs"
              className="mb-1.5 size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            >
              <ListFilter className="size-3.5" />
            </Button>
          )}
          className="w-72 rounded-lg border border-border bg-popover p-1 shadow-floating"
        >
          {(close) => (
            <ChatTabsMenu
              workspaceId={viewModel.selectedWorkspaceId}
              rows={viewModel.menuChatTabs}
              childrenByParentSessionId={viewModel.childrenByParentSessionId}
              renderIcon={renderChatTabIcon}
              renderStatus={renderChatMenuStatus}
              onOpenSession={(sessionId) => {
                chatVisibilityActions.showChatSessionTab(sessionId, { select: true });
                close();
              }}
            />
          )}
        </PopoverButton>
      )}

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={!tabActions.canOpenNewSessionTab}
        onClick={() => tabActions.openNewSessionTab()}
        title={tabActions.newSessionDisabledReason ?? "New chat"}
        className="mb-1.5 ml-0.5 size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        <Plus className="size-3" />
      </Button>

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

function hasAnySubagents(childrenByParentSessionId: Map<string, unknown[]>): boolean {
  for (const children of childrenByParentSessionId.values()) {
    if (children.length > 0) {
      return true;
    }
  }
  return false;
}
