import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { useSessionTitleActions } from "@/hooks/sessions/use-session-title-actions";
import { useWorkspaceTabActions } from "@/hooks/workspaces/use-workspace-tab-actions";
import {
  useWorkspaceChatTabs,
  type ChatTabEntry,
} from "@/hooks/sessions/use-workspace-chat-tabs";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { SessionTitleRenamePopover } from "@/components/workspace/shell/SessionTitleRenamePopover";
import { HeaderTab } from "@/components/workspace/shell/HeaderTab";
import { HeaderChatMenuPopover } from "@/components/workspace/shell/HeaderChatMenuPopover";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import { Button } from "@/components/ui/Button";
import {
  Plus,
  MessageSquare,
  ProviderIcon,
  CircleAlert,
  BrailleSweepBadge,
} from "@/components/ui/icons";
import { useHeaderSubagentTabs } from "@/hooks/chat/subagents/use-header-subagent-tabs";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";
import { useToastStore } from "@/stores/toast/toast-store";
import { useShortcutHandler } from "@/hooks/shortcuts/use-shortcut-handler";
import { useTransparentChromeEnabled } from "@/hooks/theme/use-transparent-chrome";

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
  const activeSessionWorkspaceId = useHarnessStore((s) =>
    s.activeSessionId ? s.sessionSlots[s.activeSessionId]?.workspaceId ?? null : null,
  );
  const showToast = useToastStore((state) => state.show);
  const { dismissSession, selectSession } = useSessionActions();
  const { updateSessionTitle } = useSessionTitleActions();
  const tabActions = useWorkspaceTabActions();
  const transparentChromeEnabled = useTransparentChromeEnabled();

  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const chatTabElementsRef = useRef(new Map<string, HTMLSpanElement>());

  useShortcutHandler("session.rename", () => {
    if (activeSessionId) {
      setRenamingSessionId(activeSessionId);
    }
  });

  const isChatActive = activeMainTab.kind === "chat";
  const chatTabs = useWorkspaceChatTabs(selectedWorkspaceId, activeSessionId, isChatActive);
  const subagentTabs = useHeaderSubagentTabs(
    isChatActive ? activeSessionId : null,
    activeSessionWorkspaceId,
  );

  const setChatTabElement = useCallback((sessionId: string, element: HTMLSpanElement | null) => {
    if (element) {
      chatTabElementsRef.current.set(sessionId, element);
      return;
    }
    chatTabElementsRef.current.delete(sessionId);
  }, []);

  useEffect(() => {
    if (!activeSessionId || !isChatActive) {
      return;
    }

    chatTabElementsRef.current.get(activeSessionId)?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [activeSessionId, chatTabs.length, isChatActive]);

  const activateSessionId = useCallback((sessionId: string) => {
    activateChatTab();
    const latencyFlowId = startLatencyFlow({
      flowKind: "session_switch",
      source: "header_tab",
      targetWorkspaceId: selectedWorkspaceId,
      targetSessionId: sessionId,
    });
    void selectSession(sessionId, { latencyFlowId }).catch((error) => {
      failLatencyFlow(latencyFlowId, "session_switch_failed");
      const message = error instanceof Error ? error.message : String(error);
      showToast(message);
    });
  }, [activateChatTab, selectSession, selectedWorkspaceId, showToast]);

  const activateSession = useCallback((tab: ChatTabEntry) => {
    activateSessionId(tab.id);
  }, [activateSessionId]);

  return (
    <div
      role="tablist"
      aria-label="Workspace tabs"
      className="flex h-full min-w-0 items-center gap-1 overflow-hidden px-1"
    >
      <div className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden">
        {chatTabs.map((tab) => (
          <span
            key={tab.id}
            ref={(element) => setChatTabElement(tab.id, element)}
            role="presentation"
            className="inline-flex shrink-0 app-region-no-drag"
          >
            <SessionTitleRenamePopover
              currentTitle={tab.title}
              onRename={(title) => updateSessionTitle(tab.id, title)}
              externalOpen={renamingSessionId === tab.id}
              onOpenChange={(isOpen) => {
                if (!isOpen) setRenamingSessionId(null);
              }}
              trigger={(
                <span role="presentation" className="inline-flex">
                  <HeaderTab
                    isActive={tab.isActive}
                    transparentChromeEnabled={transparentChromeEnabled}
                    icon={renderSessionIcon(tab)}
                    label={tab.title}
                    onClick={() => activateSession(tab)}
                    onClose={() => void dismissSession(tab.id)}
                    badge={renderSessionStatusBadge(tab)}
                  />
                </span>
              )}
            />
          </span>
        ))}
      </div>

      <HeaderChatMenuPopover
        chatTabs={chatTabs}
        subagentTabs={subagentTabs}
        renderSessionIcon={renderSessionIcon}
        renderSessionStatusBadge={renderSessionStatusBadge}
        onOpenChatTab={activateSession}
        onOpenSession={activateSessionId}
      />

      {openTabs.length > 0 && (
        <div className="flex min-w-0 max-w-[45%] flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden">
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
      )}

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
