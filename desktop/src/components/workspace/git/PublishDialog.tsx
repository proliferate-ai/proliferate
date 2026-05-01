import { useEffect, useId, useMemo, useRef } from "react";
import type { CurrentPullRequestResponse, Workspace } from "@anyharness/sdk";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { ModalShell } from "@/components/ui/ModalShell";
import { Switch } from "@/components/ui/Switch";
import { Textarea } from "@/components/ui/Textarea";
import {
  CloudUpload,
  GitBranchIcon,
  GitCommit,
  GitHub,
  SplitPanelRight,
} from "@/components/ui/icons";
import { useWorkspacePublishWorkflow } from "@/hooks/workspaces/use-workspace-publish-workflow";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";

interface PublishDialogProps {
  open: boolean;
  workspaceId: string | null;
  initialIntent: "commit" | "publish" | "pull_request";
  selectedWorkspace: Workspace | undefined;
  runtimeBlockedReason: string | null;
  onClose: () => void;
  onReviewDiffs: () => void;
  onViewPr: (pullRequest: NonNullable<CurrentPullRequestResponse["pullRequest"]>) => void;
}

export function PublishDialog({
  open,
  workspaceId,
  initialIntent,
  selectedWorkspace,
  runtimeBlockedReason,
  onClose,
  onReviewDiffs,
  onViewPr,
}: PublishDialogProps) {
  const repoConfigs = useRepoPreferencesStore((state) => state.repoConfigs);
  const repoDefaultBranch = useMemo(() => {
    const sourceRoot = selectedWorkspace?.sourceRepoRootPath?.trim();
    if (!sourceRoot) return null;
    return repoConfigs[sourceRoot]?.defaultBranch ?? null;
  }, [repoConfigs, selectedWorkspace?.sourceRepoRootPath]);
  const workflow = useWorkspacePublishWorkflow({
    workspaceId,
    initialIntent,
    runtimeBlockedReason,
    repoDefaultBranch,
    enabled: open && Boolean(workspaceId),
  });
  const {
    commitDraft,
    setCommitDraft,
    pullRequestDraft,
    setPullRequestDraft,
    viewState,
    isLoading,
    isSubmitting,
    error,
    resetDrafts,
    submit,
  } = workflow;

  const commitSummaryId = useId();
  const includeUnstagedId = useId();
  const prTitleId = useId();
  const prBodyId = useId();
  const prBaseBranchId = useId();
  const prDraftId = useId();
  const draftWorkspaceIdRef = useRef<string | null>(workspaceId);
  const runtimeReadyRef = useRef(runtimeBlockedReason === null);

  useEffect(() => {
    if (workspaceId && draftWorkspaceIdRef.current !== workspaceId) {
      draftWorkspaceIdRef.current = workspaceId;
      resetDrafts();
    }
  }, [resetDrafts, workspaceId]);

  useEffect(() => {
    const runtimeReady = runtimeBlockedReason === null;
    if (runtimeReadyRef.current && !runtimeReady) {
      resetDrafts();
    }
    runtimeReadyRef.current = runtimeReady;
  }, [resetDrafts, runtimeBlockedReason]);

  const title = initialIntent === "pull_request"
    ? "Publish pull request"
    : initialIntent === "publish"
      ? "Publish branch"
      : "Commit changes";
  const stats = [
    ...viewState.fileGroups.staged,
    ...viewState.fileGroups.partial,
    ...viewState.fileGroups.unstaged,
  ].reduce(
    (total, file) => ({
      files: total.files + 1,
      additions: total.additions + file.additions,
      deletions: total.deletions + file.deletions,
    }),
    { files: 0, additions: 0, deletions: 0 },
  );
  const hasDirtyChanges = viewState.hasStagedChanges || viewState.hasUnstagedChanges;
  const shouldScrollChangedFiles = stats.files > 6;

  async function handleSubmit() {
    if (viewState.existingPr && viewState.workflowSteps.length === 0) {
      onViewPr(viewState.existingPr);
      onClose();
      return;
    }
    const didComplete = await submit();
    if (didComplete) {
      onClose();
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      disableClose={isSubmitting}
      title={title}
      description="Review, commit, and publish this workspace without opening the changes panel."
      sizeClassName="max-h-[88vh] max-w-2xl"
      bodyClassName="min-h-0 px-0 pb-0 pt-0"
      footer={(
        <div className="flex w-full items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onReviewDiffs}
            disabled={isSubmitting}
            className="mr-auto"
          >
            <SplitPanelRight className="size-3.5" />
            Review diffs
          </Button>
          {viewState.existingPr && viewState.workflowSteps.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSubmitting}
              onClick={() => onViewPr(viewState.existingPr!)}
            >
              <GitHub className="size-3.5" />
              View PR
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="inverted"
            size="sm"
            loading={isSubmitting}
            disabled={isLoading || !!viewState.disabledReason}
            onClick={handleSubmit}
          >
            {viewState.primaryLabel}
          </Button>
        </div>
      )}
    >
      <div className="flex min-h-0 flex-col">
        <div className="border-y border-border/60 bg-foreground/5 px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background">
              {initialIntent === "pull_request" ? (
                <GitHub className="size-4 text-foreground" />
              ) : initialIntent === "publish" ? (
                <CloudUpload className="size-4 text-foreground" />
              ) : (
                <GitCommit className="size-4 text-foreground" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{viewState.branchName ?? "Unknown branch"}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {stats.files === 0
                  ? "Working tree clean"
                  : `${stats.files} changed file${stats.files === 1 ? "" : "s"}`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-xs tabular-nums">
              <span className="text-git-green">+{stats.additions}</span>
              <span className="text-git-red">-{stats.deletions}</span>
            </div>
          </div>
        </div>

        <AutoHideScrollArea className="min-h-0 flex-1" viewportClassName="max-h-[52vh] px-5 py-4">
          <div className="space-y-4">
            {initialIntent === "publish" && !hasDirtyChanges && viewState.publishStatus && (
              <div className="rounded-lg border border-border bg-foreground/5 p-3">
                <p className="text-sm font-medium text-foreground">Publish branch</p>
                <p className="mt-1 text-xs text-muted-foreground">{viewState.publishStatus}</p>
              </div>
            )}

            {hasDirtyChanges && (
              <div className="space-y-3 rounded-lg border border-border bg-foreground/5 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Changed files</p>
                    <p className="text-xs text-muted-foreground">
                      Review staged, partial, and unstaged files in this workspace.
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs tabular-nums">
                    <span className="text-git-green">+{stats.additions}</span>
                    <span className="text-git-red">-{stats.deletions}</span>
                  </div>
                </div>
                <PublishChangedFiles
                  groups={viewState.fileGroups}
                  scroll={shouldScrollChangedFiles}
                />
              </div>
            )}

            {hasDirtyChanges && (
              <div className="space-y-3 rounded-lg border border-border bg-foreground/5 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Commit message</p>
                    <p className="text-xs text-muted-foreground">
                      {commitDraft.includeUnstaged
                        ? "Stages unstaged files before committing."
                        : "Commits the currently staged index."}
                    </p>
                  </div>
                  {viewState.hasUnstagedChanges && (
                    <div className="flex items-center gap-2">
                      <Switch
                        id={includeUnstagedId}
                        checked={commitDraft.includeUnstaged}
                        onChange={(includeUnstaged) => setCommitDraft({ ...commitDraft, includeUnstaged })}
                        disabled={isSubmitting}
                      />
                      <Label htmlFor={includeUnstagedId} className="mb-0">Include unstaged</Label>
                    </div>
                  )}
                </div>
                <Label htmlFor={commitSummaryId}>Commit message</Label>
                <Textarea
                  id={commitSummaryId}
                  rows={3}
                  value={commitDraft.summary}
                  onChange={(event) => setCommitDraft({ ...commitDraft, summary: event.target.value })}
                  placeholder="Commit message"
                  disabled={isSubmitting}
                />
                {viewState.partialWarning && (
                  <p className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                    {viewState.partialWarning}
                  </p>
                )}
              </div>
            )}

            {initialIntent === "pull_request" && !viewState.existingPr && (
              <div className="space-y-3 rounded-lg border border-border bg-foreground/5 p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Pull request</p>
                  <p className="text-xs text-muted-foreground">Create a pull request after publishing the branch.</p>
                </div>
                <div>
                  <Label htmlFor={prTitleId}>Title</Label>
                  <Input
                    id={prTitleId}
                    value={pullRequestDraft.title}
                    onChange={(event) => setPullRequestDraft({ ...pullRequestDraft, title: event.target.value })}
                    placeholder="PR title"
                    disabled={isSubmitting}
                  />
                </div>
                <div>
                  <Label htmlFor={prBodyId}>Description</Label>
                  <Textarea
                    id={prBodyId}
                    rows={3}
                    value={pullRequestDraft.body}
                    onChange={(event) => setPullRequestDraft({ ...pullRequestDraft, body: event.target.value })}
                    placeholder="Optional description"
                    disabled={isSubmitting}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <div>
                    <Label htmlFor={prBaseBranchId}>Base branch</Label>
                    <Input
                      id={prBaseBranchId}
                      value={pullRequestDraft.baseBranch}
                      onChange={(event) => setPullRequestDraft({ ...pullRequestDraft, baseBranch: event.target.value })}
                      placeholder={viewState.defaultBaseBranch}
                      disabled={isSubmitting}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id={prDraftId}
                      checked={pullRequestDraft.draft}
                      onChange={(draft) => setPullRequestDraft({ ...pullRequestDraft, draft })}
                      disabled={isSubmitting}
                    />
                    <Label htmlFor={prDraftId} className="mb-0">Draft</Label>
                  </div>
                </div>
              </div>
            )}

            {(error || viewState.disabledReason) && (
              <p className="rounded-md border border-border bg-foreground/5 px-3 py-2 text-xs text-muted-foreground">
                {error ?? viewState.disabledReason}
              </p>
            )}
          </div>
        </AutoHideScrollArea>
      </div>
    </ModalShell>
  );
}

function PublishChangedFiles({
  groups,
  scroll,
}: {
  groups: {
    staged: PublishFileRow[];
    partial: PublishFileRow[];
    unstaged: PublishFileRow[];
  };
  scroll: boolean;
}) {
  const content = (
    <div className="space-y-3">
      <PublishFileSection title="Staged" files={groups.staged} />
      <PublishFileSection title="Partially staged" files={groups.partial} />
      <PublishFileSection title="Unstaged" files={groups.unstaged} />
    </div>
  );

  if (!scroll) return content;

  return (
    <AutoHideScrollArea
      className="max-h-56 min-h-0"
      viewportClassName="max-h-56 pr-2"
    >
      {content}
    </AutoHideScrollArea>
  );
}

interface PublishFileRow {
  path: string;
  additions: number;
  deletions: number;
}

function PublishFileSection({
  title,
  files,
}: {
  title: string;
  files: PublishFileRow[];
}) {
  if (files.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">{title}</p>
        <span className="text-xs text-muted-foreground">{files.length}</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-border/60">
        {files.map((file) => (
          <div
            key={`${title}:${file.path}`}
            className="flex items-center gap-3 border-b border-border/60 bg-background px-3 py-2 last:border-b-0"
          >
            <span className="min-w-0 flex-1 truncate text-start text-xs text-foreground [direction:rtl]" title={file.path}>
              <span className="[direction:ltr] [unicode-bidi:plaintext]">{file.path}</span>
            </span>
            <span className="shrink-0 text-xs tabular-nums text-git-green">+{file.additions}</span>
            <span className="shrink-0 text-xs tabular-nums text-git-red">-{file.deletions}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
