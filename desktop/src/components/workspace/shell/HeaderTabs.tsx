import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { useSessionTitleActions } from "@/hooks/sessions/use-session-title-actions";
import { useWorkspaceTabActions } from "@/hooks/workspaces/use-workspace-tab-actions";
import {
  useWorkspaceChatTabs,
  type ChatTabEntry,
} from "@/hooks/sessions/use-workspace-chat-tabs";
import { useSessionTabOverflow } from "@/hooks/sessions/use-session-tab-overflow";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { SessionTitleRenamePopover } from "@/components/workspace/shell/SessionTitleRenamePopover";
import { HeaderTab } from "@/components/workspace/shell/HeaderTab";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import { Button } from "@/components/ui/Button";
import { PopoverButton } from "@/components/ui/PopoverButton";
import {
  Plus,
  MessageSquare,
  ProviderIcon,
  CircleAlert,
  BrailleSweepBadge,
  MoreHorizontal,
  X,
} from "@/components/ui/icons";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";
import { useToastStore } from "@/stores/toast/toast-store";
import { useShortcutHandler } from "@/hooks/shortcuts/use-shortcut-handler";
import { useTransparentChromeEnabled } from "@/hooks/theme/use-transparent-chrome";

type SessionActivationSource = "header_tab" | "header_overflow";

export function HeaderTabs() {
  const activeMainTab = useWorkspaceFilesStore((s) => s.activeMainTab);
  const openTabs = useWorkspaceFilesStore((s) => s.openTabs);
  const buffersByPath = useWorkspaceFilesStore((s) => s.buffersByPath);
  const tabModes = useWorkspaceFilesStore((s) => s.tabModes);
  const activateChatTab = useWorkspaceFilesStore((s) => s.activateChatTab);
  const setActiveTab = useWorkspaceFilesStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceFilesStore((s) => s.closeTab);

  const activeSessionId = useHarnessStore((s) => s.activeSessionId);
  const selectedWorkspaceId = useHarnessStore((s) => s.selectedWorkspaceId);
  const showToast = useToastStore((state) => state.show);
  const { dismissSession, selectSession } = useSessionActions();
  const { updateSessionTitle } = useSessionTitleActions();
  const tabActions = useWorkspaceTabActions();
  const transparentChromeEnabled = useTransparentChromeEnabled();

  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [promotedSessionIds, setPromotedSessionIds] = useState<string[]>([]);

  useShortcutHandler("session.rename", () => {
    if (activeSessionId) {
      setRenamingSessionId(activeSessionId);
    }
  });

  const isChatActive = activeMainTab.kind === "chat";
  const chatTabs = useWorkspaceChatTabs(selectedWorkspaceId, activeSessionId, isChatActive);
  useEffect(() => {
    const validIds = new Set(chatTabs.map((tab) => tab.id));
    setPromotedSessionIds((current) => {
      const next = current.filter((id) => validIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [chatTabs]);

  const fileTabLabels = useMemo(
    () => openTabs.map((path) => path.split("/").pop() ?? path),
    [openTabs],
  );
  const {
    containerRef,
    visibleTabs,
    overflowTabs,
    hasOverflow,
  } = useSessionTabOverflow({
    chatTabs,
    activeSessionId,
    promotedSessionIds,
    fileTabLabels,
  });

  const activateSession = useCallback((tab: ChatTabEntry, source: SessionActivationSource) => {
    activateChatTab();
    const latencyFlowId = startLatencyFlow({
      flowKind: "session_switch",
      source,
      targetWorkspaceId: selectedWorkspaceId,
      targetSessionId: tab.id,
    });
    void selectSession(tab.id, { latencyFlowId }).catch((error) => {
      failLatencyFlow(latencyFlowId, "session_switch_failed");
      const message = error instanceof Error ? error.message : String(error);
      showToast(message);
    });
  }, [activateChatTab, selectSession, selectedWorkspaceId, showToast]);

  const activateOverflowSession = useCallback((tab: ChatTabEntry) => {
    setPromotedSessionIds((current) => {
      const next = [
        activeSessionId,
        tab.id,
        ...current,
      ].filter((id): id is string => typeof id === "string" && id.length > 0);
      return uniqueIds(next).slice(0, 6);
    });
    activateSession(tab, "header_overflow");
  }, [activateSession, activeSessionId]);

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label="Workspace tabs"
      className="flex h-full min-w-0 items-end gap-1 overflow-hidden px-1 pt-1"
    >
      {visibleTabs.map((tab) => (
        <SessionTitleRenamePopover
          key={tab.id}
          currentTitle={tab.title}
          onRename={(title) => updateSessionTitle(tab.id, title)}
          externalOpen={renamingSessionId === tab.id}
          onOpenChange={(isOpen) => { if (!isOpen) setRenamingSessionId(null); }}
          trigger={(
            <span role="presentation" className="inline-flex app-region-no-drag">
              <HeaderTab
                isActive={tab.isActive}
                transparentChromeEnabled={transparentChromeEnabled}
                icon={renderSessionIcon(tab)}
                label={tab.title}
                onClick={() => activateSession(tab, "header_tab")}
                onClose={() => void dismissSession(tab.id)}
                badge={renderSessionStatusBadge(tab)}
              />
            </span>
          )}
        />
      ))}

      {hasOverflow && (
        <SessionTabOverflowMenu
          tabs={overflowTabs}
          onActivate={activateOverflowSession}
          onDismiss={(sessionId) => void dismissSession(sessionId)}
        />
      )}

      <div className="flex min-w-0 max-w-[45%] flex-1 items-end gap-1 overflow-hidden">
        {openTabs.map((path) => {
          const isActive = activeMainTab.kind === "file" && activeMainTab.path === path;
          const buf = buffersByPath[path];
          const isDirty = buf?.isDirty ?? false;
          const isDiff = tabModes[path] === "diff";
          const basename = path.split("/").pop() ?? path;

          return (
            <HeaderTab
              key={path}
              isActive={isActive}
              transparentChromeEnabled={transparentChromeEnabled}
              icon={
                <FileTreeEntryIcon
                  name={basename}
                  path={path}
                  kind="file"
                  className="size-3 shrink-0"
                />
              }
              label={basename}
              onClick={() => setActiveTab(path)}
              onClose={() => {
                if (isDirty && !confirm("Discard unsaved changes?")) return;
                closeTab(path);
              }}
              badge={
                <>
                  {isDiff && (
                    <span className="shrink-0 text-xs font-medium text-git-green">DIFF</span>
                  )}
                  {isDirty && (
                    <span className="size-1.5 shrink-0 rounded-full bg-foreground/50" />
                  )}
                </>
              }
            />
          );
        })}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={!tabActions.canOpenNewSessionTab}
        onClick={() => tabActions.openNewSessionTab()}
        title={tabActions.newSessionDisabledReason ?? "New chat"}
        className="mb-0.5 ml-0.5 size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        <Plus className="size-3" />
      </Button>
    </div>
  );
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];

  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    next.push(id);
  }

  return next;
}

interface SessionTabOverflowMenuProps {
  tabs: ChatTabEntry[];
  onActivate: (tab: ChatTabEntry) => void;
  onDismiss: (sessionId: string) => void;
}

function SessionTabOverflowMenu({
  tabs,
  onActivate,
  onDismiss,
}: SessionTabOverflowMenuProps) {
  return (
    <PopoverButton
      align="start"
      className="w-64 rounded-lg border border-border bg-popover p-1 shadow-floating"
      trigger={(
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={`${tabs.length} more chat ${tabs.length === 1 ? "session" : "sessions"}`}
          aria-label={`${tabs.length} more chat ${tabs.length === 1 ? "session" : "sessions"}`}
          className="mb-0.5 size-8 shrink-0 rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      )}
    >
      {(close) => (
        <div className="flex max-h-80 flex-col gap-px overflow-y-auto">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className="group/overflow-session flex items-center gap-1 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onActivate(tab);
                  close();
                }}
                title={tab.title}
                className="h-8 min-w-0 flex-1 justify-start gap-2 bg-transparent px-2 py-0 text-xs font-normal hover:bg-transparent"
              >
                {renderSessionIcon(tab)}
                <span className="min-w-0 flex-1 truncate text-left">{tab.title}</span>
                {renderSessionStatusBadge(tab)}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={(event) => {
                  event.stopPropagation();
                  onDismiss(tab.id);
                }}
                title={`Close ${tab.title}`}
                aria-label={`Close ${tab.title}`}
                className="mr-1 size-6 shrink-0 rounded-sm text-muted-foreground opacity-70 hover:bg-accent hover:text-foreground hover:opacity-100"
              >
                <X className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </PopoverButton>
  );
}

function renderSessionIcon(tab: ChatTabEntry): ReactNode {
  return tab.agentKind ? (
    <ProviderIcon kind={tab.agentKind} className="size-3.5 shrink-0" />
  ) : (
    <MessageSquare className="size-3 shrink-0" />
  );
}

function renderSessionStatusBadge(tab: ChatTabEntry): ReactNode {
  if (tab.viewState === "working") {
    return <BrailleSweepBadge className="text-[10px] text-muted-foreground" />;
  }

  if (tab.viewState === "needs_input") {
    return <BrailleSweepBadge className="text-[10px] text-special" />;
  }

  if (tab.viewState === "errored") {
    return <CircleAlert className="size-3 shrink-0 text-destructive" />;
  }

  return undefined;
}
