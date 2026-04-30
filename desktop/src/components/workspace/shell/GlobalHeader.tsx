import {
  useState,
  useCallback,
  useEffect,
} from "react";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { resolvePreferredOpenTarget } from "@/lib/domain/chat/preference-resolvers";
import { BranchBadge } from "@/components/workspace/shell/BranchBadge";
import { HeaderTabs } from "@/components/workspace/shell/HeaderTabs";
import { Button } from "@/components/ui/Button";
import { GitActionsButton } from "@/components/workspace/git/GitActionsButton";
import { SplitButton } from "@/components/workspace/open-target/SplitButton";
import {
  listOpenTargets,
  openTarget as execOpenTarget,
  type OpenTarget,
} from "@/platform/tauri/shell";
import {
  Play,
  SplitPanelRight,
} from "@/components/ui/icons";
import type { GitStatusSnapshot, Workspace } from "@anyharness/sdk";
import type { CurrentPullRequestResponse } from "@anyharness/sdk";

interface GlobalHeaderProps {
  branchName?: string;
  additions?: number;
  deletions?: number;
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
  branchName,
  additions,
  deletions,
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
      <div className="flex min-w-0 flex-1 items-center overflow-hidden">
        <HeaderTabs />
      </div>

      {/* Right side - branch + open-in + git + panel toggle */}
      <div className="flex shrink-0 items-center gap-2">
        {branchName && (
          <BranchBadge branchName={branchName} />
        )}
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
