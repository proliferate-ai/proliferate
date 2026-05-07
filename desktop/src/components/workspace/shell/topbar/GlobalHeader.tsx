import {
  useState,
  useCallback,
  useEffect,
} from "react";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { resolvePreferredOpenTarget } from "@/lib/domain/chat/composer/preference-resolvers";
import { HeaderTabs } from "@/components/workspace/shell/topbar/HeaderTabs";
import { Button } from "@/components/ui/Button";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { GitActionsButton } from "@/components/workspace/git/GitActionsButton";
import { SplitButton } from "@/components/workspace/open-target/SplitButton";
import {
  type OpenTarget,
  useTauriShellActions,
} from "@/hooks/access/tauri/use-shell-actions";
import {
  Play,
  SplitPanel,
} from "@/components/ui/icons";
import type { GitStatusSnapshot, Workspace } from "@anyharness/sdk";
import type { CurrentPullRequestResponse } from "@anyharness/sdk";
import { useDebugRenderCount } from "@/hooks/ui/use-debug-render-count";

interface GlobalHeaderProps {
  gitStatus: GitStatusSnapshot | null;
  existingPr: NonNullable<CurrentPullRequestResponse["pullRequest"]> | null;
  selectedWorkspace: Workspace | undefined;
  rightPanelOpen: boolean;
  disableGitActions?: boolean;
  runDisabled?: boolean;
  runLoading?: boolean;
  runLabel?: string;
  runTitle?: string;
  onRun: () => void;
  onTogglePanel: () => void;
  onCommit: () => void;
  onPush: () => void;
  onCreatePr: () => void;
  onViewPr: () => void;
  onRenameBranch?: (newName: string) => Promise<void>;
}

export function GlobalHeader({
  gitStatus,
  existingPr,
  selectedWorkspace,
  rightPanelOpen,
  disableGitActions = false,
  runDisabled = false,
  runLoading = false,
  runLabel = "Run",
  runTitle = "Run workspace command",
  onRun,
  onTogglePanel,
  onCommit,
  onPush,
  onCreatePr,
  onViewPr,
  onRenameBranch: _onRenameBranch,
}: GlobalHeaderProps) {
  useDebugRenderCount("global-header");

  const [targets, setTargets] = useState<OpenTarget[]>([]);
  const {
    listOpenTargets,
    openTarget: execOpenTarget,
  } = useTauriShellActions();
  const defaultOpenInTargetId = useUserPreferencesStore((s) => s.defaultOpenInTargetId);
  const preferredTarget = resolvePreferredOpenTarget(targets, { defaultOpenInTargetId });
  const workspacePath = selectedWorkspace?.path;

  useEffect(() => {
    void listOpenTargets("directory").then(setTargets);
  }, [listOpenTargets]);

  const handleDefaultOpen = useCallback(() => {
    if (!workspacePath) return;
    const targetId = preferredTarget?.id ?? "finder";
    void execOpenTarget(targetId, workspacePath);
  }, [execOpenTarget, workspacePath, preferredTarget]);

  const handleTargetClick = useCallback(
    (targetId: string) => {
      if (!workspacePath) return;
      void execOpenTarget(targetId, workspacePath);
    },
    [execOpenTarget, workspacePath],
  );

  return (
    <DebugProfiler id="global-header">
      <div className="flex h-full min-w-0 flex-1 items-stretch gap-2 px-2">
      {/* Tabs */}
      <div className="flex min-w-0 flex-1 items-center overflow-hidden">
        <HeaderTabs />
      </div>

      {/* Right side - branch + open-in + git + panel toggle */}
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          loading={runLoading}
          disabled={runDisabled}
          onClick={onRun}
          aria-label={runTitle}
          title={runTitle}
          className="h-6 gap-1.5 rounded-lg bg-background px-2 text-xs font-medium"
        >
          <Play className="size-3.5" />
          <span>{runLabel}</span>
        </Button>
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
          <SplitPanel className="size-3.5 text-muted-foreground" />
        </Button>
      </div>
      </div>
    </DebugProfiler>
  );
}
