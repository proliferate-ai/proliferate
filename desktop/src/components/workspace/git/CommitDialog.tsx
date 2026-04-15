import { useEffect, useMemo, useState } from "react";
import {
  useCommitGitMutation,
  useGitStatusQuery,
  usePushGitMutation,
  useStageGitPathsMutation,
} from "@anyharness/sdk-react";
import type { GitChangedFile } from "@anyharness/sdk";
import { ModalShell } from "@/components/ui/ModalShell";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { Switch } from "@/components/ui/Switch";
import { GitCommit, CloudUpload, GitPullRequest, GitBranchIcon } from "@/components/ui/icons";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import { useHarnessStore } from "@/stores/sessions/harness-store";

type CommitMode = "commit" | "commit-push" | "commit-pr";

interface CommitDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenPrDialog?: () => void;
}

const MODE_OPTIONS: { id: CommitMode; label: string; icon: React.ReactNode }[] = [
  { id: "commit", label: "Commit", icon: <GitCommit className="size-3.5" /> },
  { id: "commit-push", label: "Commit + push", icon: <CloudUpload className="size-3.5" /> },
  { id: "commit-pr", label: "Commit + PR", icon: <GitPullRequest className="size-3.5" /> },
];

const EMPTY_GIT_FILES: GitChangedFile[] = [];

export function CommitDialog({ open, onClose, onOpenPrDialog }: CommitDialogProps) {
  const [summary, setSummary] = useState("");
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [mode, setMode] = useState<CommitMode>("commit");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setError(null);
  }, [open]);

  const selectedWorkspaceId = useHarnessStore((s) => s.selectedWorkspaceId);
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const runtimeBlockedReason = getWorkspaceRuntimeBlockReason(selectedWorkspaceId);

  const commitMutation = useCommitGitMutation();
  const pushMutation = usePushGitMutation();
  const stageMutation = useStageGitPathsMutation();
  const { data: gitStatus } = useGitStatusQuery({ enabled: runtimeBlockedReason === null });

  const branchName = gitStatus?.currentBranch ?? null;
  const allFiles = gitStatus?.files ?? EMPTY_GIT_FILES;
  const hasUnstagedFiles = allFiles.some((file: GitChangedFile) => file.includedState !== "included");
  const selectedFiles = useMemo(
    () => includeUnstaged
      ? allFiles
      : allFiles.filter((file: GitChangedFile) => file.includedState !== "excluded"),
    [allFiles, includeUnstaged],
  );
  const selectedStats = useMemo(() => summarizeChangedFiles(selectedFiles), [selectedFiles]);
  const fileCount = selectedStats.files;
  const requiresPush = mode === "commit-push" || mode === "commit-pr";
  const pushBlockedReason = requiresPush && (!branchName || gitStatus?.detached)
    ? "Switch to a branch before pushing."
    : null;
  const blockedReason = runtimeBlockedReason ?? gitStatus?.actions.reasonIfBlocked ?? pushBlockedReason;

  const canSubmit = !loading
    && !blockedReason
    && !!gitStatus
    && summary.trim().length > 0
    && fileCount > 0;

  async function handleSubmit() {
    if (blockedReason) {
      setError(blockedReason);
      return;
    }
    const msg = summary.trim();
    if (!msg || fileCount === 0) return;
    setLoading(true);
    setError(null);
    try {
      if (includeUnstaged && hasUnstagedFiles) {
        await stageMutation.mutateAsync(selectedFiles.map((file: GitChangedFile) => file.path));
      }
      await commitMutation.mutateAsync({ summary: msg });
      if (mode === "commit-push" || mode === "commit-pr") {
        await pushMutation.mutateAsync({});
      }
      setSummary("");
      setMode("commit");
      onClose();
      if (mode === "commit-pr" && onOpenPrDialog) {
        onOpenPrDialog();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  const submitLabel = mode === "commit"
    ? "Commit"
    : mode === "commit-push"
      ? "Commit & push"
      : "Commit, push, then PR";

  const modeDescription = mode === "commit"
    ? "Create a local commit from the selected changes."
    : mode === "commit-push"
      ? "Create the commit, then push the current branch."
      : "Create the commit, push the current branch, then open the pull request form.";

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      sizeClassName="max-w-[420px]"
      title={
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
            <GitCommit className="size-4 text-foreground" />
          </span>
          <span className="text-base font-semibold text-foreground">Commit changes</span>
        </div>
      }
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="inverted"
            size="sm"
            loading={loading}
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {submitLabel}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Branch & changes info */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <GitBranchIcon className="size-3.5 shrink-0" />
              <span className="truncate">{branchName ?? "\u2014"}</span>
            </span>
            <div className="flex items-center gap-2.5">
              <span className="text-xs text-muted-foreground">
                {fileCount} file{fileCount !== 1 ? "s" : ""}
              </span>
              <span className="inline-flex items-center gap-1 tabular-nums text-xs">
                <span className="text-git-green">+{selectedStats.additions}</span>
                <span className="text-git-red">-{selectedStats.deletions}</span>
              </span>
            </div>
          </div>

          {hasUnstagedFiles && (
            <div className="flex items-center gap-2">
              <Switch checked={includeUnstaged} onChange={setIncludeUnstaged} />
              <span
                className="text-xs text-muted-foreground cursor-pointer select-none"
                onClick={() => setIncludeUnstaged((v) => !v)}
              >
                Stage unstaged changes before committing
              </span>
            </div>
          )}
        </div>

        {/* Commit message */}
        <Textarea
          rows={3}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Commit message"
          autoFocus
        />

        {/* Mode selector — segmented control */}
        <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
          {MODE_OPTIONS.map((opt) => {
            const selected = mode === opt.id;
            return (
              <Button
                key={opt.id}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setMode(opt.id)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  selected
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.icon}
                {opt.label}
              </Button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">{modeDescription}</p>

        {error && <p className="text-xs text-destructive">{error}</p>}
        {!error && blockedReason && (
          <p className="text-xs text-muted-foreground">{blockedReason}</p>
        )}
      </div>
    </ModalShell>
  );
}

function summarizeChangedFiles(files: GitChangedFile[]) {
  return files.reduce(
    (summary, file) => ({
      files: summary.files + 1,
      additions: summary.additions + file.additions,
      deletions: summary.deletions + file.deletions,
    }),
    { files: 0, additions: 0, deletions: 0 },
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
