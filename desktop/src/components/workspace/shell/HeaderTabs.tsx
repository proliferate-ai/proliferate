import {
  useCallback,
  useState,
} from "react";
import { Button } from "@/components/ui/Button";
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
import { useSessionTitleActions } from "@/hooks/sessions/use-session-title-actions";
import { useResizeObserverWidth } from "@/hooks/ui/use-resize-observer-width";
import { useHeaderTabsCloseActions } from "@/hooks/workspaces/tabs/use-header-tabs-close-actions";
import { useHeaderTabsGroupEditor } from "@/hooks/workspaces/tabs/use-header-tabs-group-editor";
import {
  getChatDragRowId,
  getFileDragRowId,
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
import {
  useChatTabDrag,
  useFileTabDrag,
} from "@/hooks/workspaces/tabs/use-tab-drag";
import { useWorkspaceHeaderTabsViewModel } from "@/hooks/workspaces/tabs/use-workspace-header-tabs-view-model";
import { useWorkspaceTabActions } from "@/hooks/workspaces/use-workspace-tab-actions";
import {
  TAB_GROUP_PILL_WIDTH,
} from "@/lib/domain/workspaces/tabs/chrome-layout";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useToastStore } from "@/stores/toast/toast-store";

export function HeaderTabs() {
  const viewModel = useWorkspaceHeaderTabsViewModel();
  const chatVisibilityActions = useChatTabVisibilityActions({
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

  const setVisibleChatSessionIdsForWorkspace = useWorkspaceUiStore(
    (state) => state.setVisibleChatSessionIdsForWorkspace,
  );
  const closeTab = useWorkspaceFilesStore((state) => state.closeTab);
  const setActiveTab = useWorkspaceFilesStore((state) => state.setActiveTab);
  const reorderOpenTabs = useWorkspaceFilesStore((state) => state.reorderOpenTabs);

  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const chatStrip = useResizeObserverWidth<HTMLDivElement>();
  const fileStrip = useResizeObserverWidth<HTMLDivElement>();

  useShortcutHandler("session.rename", () => {
    if (viewModel.activeSessionId) {
      setRenamingSessionId(viewModel.activeSessionId);
    }
  });

  const multiSelect = useHeaderTabsMultiSelect({
    workspaceId: viewModel.selectedWorkspaceId,
    chatTabs: viewModel.chatTabs,
    stripChatSessionIds: viewModel.stripChatSessionIds,
  });
  const groupEditorWorkflow = useHeaderTabsGroupEditor({
    workspaceId: viewModel.selectedWorkspaceId,
    displayManualGroups: viewModel.displayManualGroups,
    onCreateComplete: multiSelect.clearSelection,
  });

  const {
    chatLayout,
    chatGroupUnderlines,
    chatDragRows,
    fileLayout,
    fileDragRows,
  } = useHeaderTabsLayout({
    chatWidth: chatStrip.width,
    fileWidth: fileStrip.width,
    stripRows: viewModel.stripRows,
    openTabs: viewModel.openTabs,
  });

  const dismissChatSession = useCallback((sessionId: string) => {
    void dismissSession(sessionId).then(() => {
      if (viewModel.selectedWorkspaceId) {
        removeSessionsFromManualChatGroups(viewModel.selectedWorkspaceId, [sessionId]);
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
  ]);

  const {
    closeFilePaths,
    closeOtherRenderedChatTabs,
    closeRenderedChatTabsToRight,
  } = useHeaderTabsCloseActions({
    activeMainTab: viewModel.activeMainTab,
    activeSessionId: viewModel.activeSessionId,
    openTabs: viewModel.openTabs,
    stripChatSessionIds: viewModel.stripChatSessionIds,
    buffersByPath: viewModel.buffersByPath,
    closeTab,
    hideChatSessionTabs: chatVisibilityActions.hideChatSessionTabs,
    clearSelection: multiSelect.clearSelection,
  });

  const chatDrag = useChatTabDrag({
    stripRef: chatStrip.ref,
    rows: chatDragRows,
    orderedIds: viewModel.visibleChatSessionIds,
    childToParent: viewModel.childToParent,
    onDragStart: multiSelect.clearSelection,
    onReorder: (nextIds) => {
      if (!viewModel.selectedWorkspaceId) {
        return;
      }
      setVisibleChatSessionIdsForWorkspace(viewModel.selectedWorkspaceId, nextIds);
    },
  });
  const fileDrag = useFileTabDrag({
    stripRef: fileStrip.ref,
    rows: fileDragRows,
    orderedIds: viewModel.openTabs,
    onReorder: reorderOpenTabs,
  });

  return (
    <div className="flex h-full min-w-0 flex-1 items-end gap-1 overflow-hidden px-1">
      <WorkspaceTabStrip
        label="Chat tabs"
        stripRef={chatStrip.ref}
        className="h-9 flex-[2_1_0%]"
        {...chatDrag.stripDragProps}
      >
        {chatGroupUnderlines.map((range) => (
          <span
            key={`group-line-${range.groupId}`}
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 z-[6] h-0.5 rounded-full"
            style={{
              left: range.left + chatDrag.getRowDragOffset(`pill:${range.groupId}`),
              width: range.width,
              backgroundColor: range.color,
            }}
          />
        ))}
        {viewModel.stripRows.map((row, index) => {
          const width = chatLayout.widths[index] ?? (row.kind === "pill" ? TAB_GROUP_PILL_WIDTH : 160);
          const position = chatLayout.positions[index] ?? 0;
          const rowId = getChatDragRowId(row);
          const isDragging = chatDrag.isDraggingRow(rowId);
          const dragOffset = chatDrag.getRowDragOffset(rowId);
          if (row.kind === "pill") {
            return (
              <div
                key={`pill-${row.groupId}`}
                {...(row.groupKind === "subagent" ? chatDrag.getRowDragProps(rowId) : {})}
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
                    if (chatDrag.shouldSuppressClick(rowId)) {
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
                      if (!viewModel.selectedWorkspaceId) {
                        return;
                      }
                      deleteManualChatGroup(viewModel.selectedWorkspaceId, row.manualGroupId);
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
          return (
            <div
              key={tab.id}
              {...(canDragTab ? chatDrag.getRowDragProps(rowId) : {})}
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
                hideLeftDivider={viewModel.stripRows[index - 1]?.kind !== "tab"}
                hideRightDivider={viewModel.stripRows[index + 1]?.kind !== "tab"}
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
                  if (chatDrag.shouldSuppressClick(rowId)) {
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
                onCloseOthers={() => closeOtherRenderedChatTabs(tab.id)}
                onCloseRight={() => closeRenderedChatTabsToRight(tab.id)}
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

      {viewModel.openTabs.length > 0 && (
        <WorkspaceTabStrip
          label="File tabs"
          stripRef={fileStrip.ref}
          className="h-9 max-w-[45%] flex-1"
          {...fileDrag.stripDragProps}
        >
          {viewModel.openTabs.map((path, index) => {
            const isActive = viewModel.activeMainTab.kind === "file"
              && viewModel.activeMainTab.path === path;
            const buf = viewModel.buffersByPath[path];
            const isDirty = buf?.isDirty ?? false;
            const isDiff = viewModel.tabModes[path] === "diff";
            const width = fileLayout.widths[index] ?? 150;
            const rowId = getFileDragRowId(path);
            const isDragging = fileDrag.isDraggingRow(rowId);
            const dragOffset = fileDrag.getRowDragOffset(rowId);
            return (
              <div
                key={path}
                {...fileDrag.getRowDragProps(rowId)}
                className={`absolute bottom-0 h-9 app-region-no-drag ${
                  isDragging
                    ? "z-[20] cursor-grabbing opacity-80"
                    : `${isActive ? "z-[5]" : "z-[1] hover:z-[2]"} cursor-grab transition-transform duration-150`
                }`}
                style={{
                  width,
                  transform: `translate3d(${(fileLayout.positions[index] ?? 0) + dragOffset}px, 0, 0)`,
                }}
              >
                <FileTabWithMenu
                  path={path}
                  openTabs={viewModel.openTabs}
                  isActive={isActive}
                  isDirty={isDirty}
                  isDiff={isDiff}
                  width={width}
                  hideLeftDivider={index === 0}
                  hideRightDivider={index === viewModel.openTabs.length - 1}
                  onSelect={() => {
                    if (fileDrag.shouldSuppressClick(rowId)) {
                      return;
                    }
                    setActiveTab(path);
                  }}
                  onClosePaths={closeFilePaths}
                />
              </div>
            );
          })}
        </WorkspaceTabStrip>
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
