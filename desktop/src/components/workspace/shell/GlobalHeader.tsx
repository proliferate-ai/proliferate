import {
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { useSessionTitleActions } from "@/hooks/sessions/use-session-title-actions";
import { useWorkspaceTabActions } from "@/hooks/workspaces/use-workspace-tab-actions";
import { useWorkspaceChatTabs } from "@/hooks/sessions/use-workspace-chat-tabs";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { resolvePreferredOpenTarget } from "@/lib/domain/chat/preference-resolvers";
import { SessionTitleRenamePopover } from "@/components/workspace/shell/SessionTitleRenamePopover";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import { Button } from "@/components/ui/Button";
import { GitActionsButton } from "@/components/workspace/git/GitActionsButton";
import { SplitButton } from "@/components/workspace/open-target/SplitButton";
import {
  listOpenTargets,
  openTarget as execOpenTarget,
  type OpenTarget,
} from "@/platform/tauri/shell";
import {
  X,
  Plus,
  MessageSquare,
  ProviderIcon,
  Copy,
  Check,
  CircleAlert,
  BrailleSweepBadge,
  SplitPanelRight,
} from "@/components/ui/icons";
import type { GitStatusSnapshot, Workspace } from "@anyharness/sdk";
import type { CurrentPullRequestResponse } from "@anyharness/sdk";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";
import { useToastStore } from "@/stores/toast/toast-store";
import { useShortcutHandler } from "@/hooks/shortcuts/use-shortcut-handler";
import { useTransparentChromeEnabled } from "@/hooks/theme/use-transparent-chrome";

interface GlobalHeaderProps {
  branchName?: string;
  additions?: number;
  deletions?: number;
  gitStatus: GitStatusSnapshot | null;
  existingPr: NonNullable<CurrentPullRequestResponse["pullRequest"]> | null;
  selectedWorkspace: Workspace | undefined;
  rightPanelOpen: boolean;
  disableGitActions?: boolean;
  onTogglePanel: () => void;
  onCommit: () => void;
  onPush: () => void;
  onCreatePr: () => void;
  onViewPr: () => void;
  onRenameBranch?: (newName: string) => Promise<void>;
}

export function GlobalHeader({
  branchName,
  additions,
  deletions,
  gitStatus,
  existingPr,
  selectedWorkspace,
  rightPanelOpen,
  disableGitActions = false,
  onTogglePanel,
  onCommit,
  onPush,
  onCreatePr,
  onViewPr,
  onRenameBranch: _onRenameBranch,
}: GlobalHeaderProps) {
  const hasStats =
    additions !== undefined &&
    deletions !== undefined &&
    (additions > 0 || deletions > 0);

  const [targets, setTargets] = useState<OpenTarget[]>([]);
  const defaultOpenInTargetId = useUserPreferencesStore((s) => s.defaultOpenInTargetId);
  const preferredTarget = resolvePreferredOpenTarget(targets, { defaultOpenInTargetId });
  const workspacePath = selectedWorkspace?.path;

  useEffect(() => {
    void listOpenTargets("directory").then(setTargets);
  }, []);

  const handleDefaultOpen = useCallback(() => {
    if (!workspacePath) return;
    const targetId = preferredTarget?.id ?? "finder";
    void execOpenTarget(targetId, workspacePath);
  }, [workspacePath, preferredTarget]);

  const handleTargetClick = useCallback(
    (targetId: string) => {
      if (!workspacePath) return;
      void execOpenTarget(targetId, workspacePath);
    },
    [workspacePath],
  );

  return (
    <div className="flex h-full min-w-0 flex-1 items-stretch gap-2 px-2">
      {/* Tabs */}
      <div className="flex min-w-0 flex-1 items-end overflow-hidden">
        <HeaderTabs />
      </div>

      {/* Right side — branch + open-in + git + panel toggle */}
      <div className="flex shrink-0 items-center gap-2 pb-px">
        {branchName && (
          <BranchBadge branchName={branchName} />
        )}
        {workspacePath && (
          <SplitButton
            label={preferredTarget?.label ?? "Open"}
            onClick={handleDefaultOpen}
            targets={targets}
            onTargetClick={handleTargetClick}
            preferredTarget={preferredTarget}
          />
        )}
        <GitActionsButton
          gitStatus={gitStatus}
          existingPr={existingPr}
          disabled={disableGitActions}
          onCommit={onCommit}
          onPush={onPush}
          onCreatePr={onCreatePr}
          onViewPr={onViewPr}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={onTogglePanel}
          aria-label={rightPanelOpen ? "Hide side panel" : "Show side panel"}
          title={rightPanelOpen ? "Hide side panel" : "Show side panel"}
          className="h-7 px-1.5 text-xs rounded-md"
        >
          {hasStats && (
            <span className="flex items-center gap-1 mr-1 text-xs tabular-nums">
              <span className="text-git-green">+{additions}</span>
              <span className="text-git-red">-{deletions}</span>
            </span>
          )}
          <SplitPanelRight className="size-3.5 text-muted-foreground" />
        </Button>
      </div>
    </div>
  );
}

function BranchBadge({ branchName }: { branchName: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(branchName);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [branchName]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      className="group h-7 min-w-0 max-w-[200px] justify-start gap-1 px-1.5 py-0 text-sm font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
      title="Click to copy branch"
    >
      <span className="truncate">{branchName}</span>
      <span className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
        {copied ? (
          <Check className="size-2.5 text-git-green" />
        ) : (
          <Copy className="size-2.5" />
        )}
      </span>
    </Button>
  );
}

function HeaderTabs() {
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

  useShortcutHandler("session.rename", () => {
    if (activeSessionId) {
      setRenamingSessionId(activeSessionId);
    }
  });

  const isChatActive = activeMainTab.kind === "chat";
  const chatTabs = useWorkspaceChatTabs(selectedWorkspaceId, activeSessionId, isChatActive);

  return (
    <div
      role="tablist"
      aria-label="Workspace tabs"
      className="flex h-full min-w-0 items-end gap-1 overflow-x-auto px-1 pt-1"
    >
      {chatTabs.map((tab) => (
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
                icon={
                  tab.agentKind ? (
                    <ProviderIcon kind={tab.agentKind} className="size-3.5 shrink-0" />
                  ) : (
                    <MessageSquare className="size-3 shrink-0" />
                  )
                }
                label={tab.title}
                onClick={() => {
                  activateChatTab();
                  const latencyFlowId = startLatencyFlow({
                    flowKind: "session_switch",
                    source: "header_tab",
                    targetWorkspaceId: selectedWorkspaceId,
                    targetSessionId: tab.id,
                  });
                  void selectSession(tab.id, { latencyFlowId }).catch((error) => {
                    failLatencyFlow(latencyFlowId, "session_switch_failed");
                    const message = error instanceof Error ? error.message : String(error);
                    showToast(message);
                  });
                }}
                onClose={() => void dismissSession(tab.id)}
                badge={
                  tab.viewState === "working"
                    ? <BrailleSweepBadge className="text-[10px] text-muted-foreground" />
                    : tab.viewState === "needs_input"
                      ? <BrailleSweepBadge className="text-[10px] text-special" />
                      : tab.viewState === "errored"
                        ? <CircleAlert className="size-3 shrink-0 text-destructive" />
                      : undefined
                }
              />
            </span>
          )}
        />
      ))}

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
                  <span className="text-xs text-git-green font-medium shrink-0">DIFF</span>
                )}
                {isDirty && (
                  <span className="size-1.5 rounded-full bg-foreground/50 shrink-0" />
                )}
              </>
            }
          />
        );
      })}

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

interface HeaderTabProps {
  isActive: boolean;
  transparentChromeEnabled: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  onClose: () => void;
  badge?: ReactNode;
}

function HeaderTab({
  isActive,
  transparentChromeEnabled,
  icon,
  label,
  onClick,
  onClose,
  badge,
}: HeaderTabProps) {
  const shapeClassName = transparentChromeEnabled ? "-mb-px rounded-t-md" : "rounded-md";
  const activeClassName = transparentChromeEnabled
    ? "border-foreground/10 border-b-background bg-background/85 text-foreground shadow-subtle backdrop-blur-xl"
    : "border-border bg-background text-foreground shadow-subtle";

  return (
    <div
      role="presentation"
      className={`group/tab flex h-8 min-w-0 max-w-44 shrink-0 items-center border px-0.5 transition-colors ${shapeClassName} ${
        isActive
          ? activeClassName
          : "border-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
      }`}
    >
      <Button
        type="button"
        role="tab"
        aria-selected={isActive}
        variant="ghost"
        size="sm"
        onClick={onClick}
        title={label}
        className={`h-full min-w-0 flex-1 justify-start gap-1.5 bg-transparent px-2 py-0 text-xs font-normal hover:bg-transparent ${shapeClassName} ${
          isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {badge}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onClose}
        title={`Close ${label}`}
        aria-label={`Close ${label}`}
        className={`mr-1 size-5 shrink-0 rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground ${
          isActive
            ? "opacity-70 hover:opacity-100"
            : "opacity-0 transition-opacity group-hover/tab:opacity-70 hover:!opacity-100 focus-visible:opacity-100"
        }`}
      >
        <X className="size-2.5" />
      </Button>
    </div>
  );
}
