import { useId, type ReactNode } from "react";
import type { CurrentPullRequestResponse } from "@anyharness/sdk";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { ModalShell } from "@/components/ui/ModalShell";
import { Switch } from "@/components/ui/Switch";
import { Textarea } from "@/components/ui/Textarea";
import { GitHub } from "@/components/ui/icons";
import { useWorkspacePublishWorkflow } from "@/hooks/workspaces/use-workspace-publish-workflow";

interface PublishDialogProps {
  open: boolean;
  workspaceId: string | null;
  initialIntent: "commit" | "publish" | "pull_request";
  runtimeBlockedReason: string | null;
  repoDefaultBranch: string | null;
  onClose: () => void;
  onViewPr: (pullRequest: NonNullable<CurrentPullRequestResponse["pullRequest"]>) => void;
}

export function PublishDialog({
  open,
  workspaceId,
  initialIntent,
  runtimeBlockedReason,
  repoDefaultBranch,
  onClose,
  onViewPr,
}: PublishDialogProps) {
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
    submit,
  } = workflow;

  const commitSummaryId = useId();
  const includeUnstagedId = useId();
  const prTitleId = useId();
  const prBodyId = useId();
  const prBaseBranchId = useId();
  const prDraftId = useId();

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
      description="Commit, publish, and create pull requests for this workspace."
      sizeClassName="max-h-[88vh] max-w-xl"
      bodyClassName="min-h-0 px-0 pb-0 pt-0"
      footer={(
        <div className="flex w-full items-center justify-end gap-2">
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
        <AutoHideScrollArea className="min-h-0 flex-1" viewportClassName="max-h-[56vh] px-5 pb-4">
          <div className="space-y-4">
            {initialIntent === "publish" && !hasDirtyChanges && viewState.publishStatus && (
              <PublishSection flush>
                <p className="text-sm font-medium text-foreground">Publish branch</p>
                <p className="mt-1 text-xs text-muted-foreground">{viewState.publishStatus}</p>
              </PublishSection>
            )}

            {hasDirtyChanges && (
              <PublishSection flush>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Changed files</p>
                    <p className="text-xs text-muted-foreground">
                      Staged, partial, and unstaged files in this workspace.
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
              </PublishSection>
            )}

            {hasDirtyChanges && (
              <PublishSection>
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
                  <p className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
                    {viewState.partialWarning}
                  </p>
                )}
              </PublishSection>
            )}

            {initialIntent === "pull_request" && !viewState.existingPr && (
              <PublishSection>
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
              </PublishSection>
            )}

            {(error || viewState.disabledReason) && (
              <p className="border-t border-border/60 pt-4 text-xs text-destructive">
                {error ?? viewState.disabledReason}
              </p>
            )}
          </div>
        </AutoHideScrollArea>
      </div>
    </ModalShell>
  );
}

function PublishSection({
  children,
  flush = false,
}: {
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className={flush ? "space-y-3" : "space-y-3 border-t border-border/60 pt-4"}>
      {children}
    </section>
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
