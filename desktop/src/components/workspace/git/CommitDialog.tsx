import { useEffect, useState } from "react";
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
  { id: "commit-push", label: "Push", icon: <CloudUpload className="size-3.5" /> },
  { id: "commit-pr", label: "PR", icon: <GitPullRequest className="size-3.5" /> },
];

export function CommitDialog({ open, onClose, onOpenPrDialog }: CommitDialogProps) {
  const [summary, setSummary] = useState("");
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [draft, setDraft] = useState(false);
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
  const allFiles = gitStatus?.files ?? [];
  const includedFiles = gitStatus?.summary.includedFiles ?? 0;
  const additions = gitStatus?.summary.additions ?? 0;
  const deletions = gitStatus?.summary.deletions ?? 0;
  const hasUnstagedFiles = allFiles.some((file: GitChangedFile) => file.includedState !== "included");
  const fileCount = includeUnstaged ? allFiles.length : includedFiles;

  const canSubmit = !loading && !runtimeBlockedReason && summary.trim().length > 0 && fileCount > 0;

  async function handleSubmit() {
    if (runtimeBlockedReason) {
      setError(runtimeBlockedReason);
      return;
    }
    const msg = summary.trim();
    if (!msg && fileCount === 0) return;
    setLoading(true);
    setError(null);
    try {
      if (includeUnstaged && hasUnstagedFiles) {
        await stageMutation.mutateAsync(allFiles.map((file: GitChangedFile) => file.path));
      }
      const finalMsg = draft ? `[draft] ${msg}` : msg;
      await commitMutation.mutateAsync({ summary: finalMsg });
      if (mode === "commit-push" || mode === "commit-pr") {
        await pushMutation.mutateAsync({});
      }
      setSummary("");
      setDraft(false);
      setMode("commit");
      onClose();
      if (mode === "commit-pr" && onOpenPrDialog) {
        onOpenPrDialog();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const submitLabel = mode === "commit"
    ? "Commit"
    : mode === "commit-push"
      ? "Commit & push"
      : "Commit & create PR";

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
        <div className="flex w-full items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch checked={draft} onChange={setDraft} />
            <span
              className="text-sm text-foreground cursor-pointer select-none"
              onClick={() => setDraft((d) => !d)}
            >
              Draft
            </span>
          </div>
          <span className="ml-auto">
            <Button
              variant="inverted"
              size="sm"
              loading={loading}
              disabled={!canSubmit}
              onClick={handleSubmit}
            >
              {submitLabel}
            </Button>
          </span>
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
                <span className="text-git-green">+{additions}</span>
                <span className="text-git-red">-{deletions}</span>
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
                Include unstaged files
              </span>
            </div>
          )}
        </div>

        {/* Commit message */}
        <Textarea
          rows={3}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Commit message (leave blank to autogenerate)"
          autoFocus
        />

        {/* Mode selector — segmented control */}
        <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
          {MODE_OPTIONS.map((opt) => {
            const selected = mode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMode(opt.id)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  selected
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.icon}
                {opt.label}
              </button>
            );
          })}
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
        {!error && runtimeBlockedReason && (
          <p className="text-xs text-muted-foreground">{runtimeBlockedReason}</p>
        )}
      </div>
    </ModalShell>
  );
}
