import { useId } from "react";
import type { CurrentPullRequestResponse } from "@anyharness/sdk";
import { AutoHideScrollArea } from "@proliferate/ui/layout/AutoHideScrollArea";
import { Button } from "@proliferate/ui/primitives/Button";
import { Checkbox } from "@proliferate/ui/primitives/Checkbox";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import {
  SegmentedControl,
  type SegmentedControlItem,
} from "@proliferate/ui/primitives/SegmentedControl";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { ArrowUp, GitCommit, GitHub, GitPullRequest } from "@proliferate/ui/icons";
import { useWorkspacePublishWorkflow } from "@/hooks/workspaces/workflows/use-workspace-publish-workflow";
import type { PublishIntent } from "@/lib/domain/workspaces/creation/publish-workflow-model";

const PUBLISH_INTENT_ITEMS = [
  { id: "commit", label: "Commit", icon: <GitCommit /> },
  { id: "publish", label: "Publish", icon: <ArrowUp /> },
  { id: "pull_request", label: "Pull request", icon: <GitPullRequest /> },
] satisfies readonly SegmentedControlItem<PublishIntent>[];

interface PublishDialogProps {
  open: boolean;
  workspaceId: string | null;
  initialIntent: "commit" | "publish" | "pull_request";
  runtimeBlockedReason: string | null;
  repoDefaultBranch: string | null;
  onClose: () => void;
  onIntentChange: (intent: PublishIntent) => void;
  onViewPr: (pullRequest: NonNullable<CurrentPullRequestResponse["pullRequest"]>) => void;
}

export function PublishDialog({
  open,
  workspaceId,
  initialIntent,
  runtimeBlockedReason,
  repoDefaultBranch,
  onClose,
  onIntentChange,
  onViewPr,
}: PublishDialogProps) {
  const intent = initialIntent;
  const workflow = useWorkspacePublishWorkflow({
    workspaceId,
    initialIntent: intent,
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
    clearError,
    resetDrafts,
  } = workflow;

  const includeUnstagedId = useId();
  const prTitleId = useId();
  const prBodyId = useId();
  const prBaseBranchId = useId();
  const prDraftId = useId();

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
  const title = intent === "pull_request"
    ? viewState.existingPr
      ? hasDirtyChanges ? "Update pull request" : "Pull request"
      : "Create pull request"
    : intent === "publish"
      ? "Publish branch"
      : "Commit changes";
  const primaryActionViewsExistingPr = Boolean(
    intent === "pull_request"
    && viewState.existingPr
    && !hasDirtyChanges
    && viewState.workflowSteps.length === 0,
  );
  const visibleValidationMessage = error
    ?? (primaryActionViewsExistingPr ? null : viewState.disabledReason);
  const stagedCount = viewState.fileGroups.staged.length;
  const partialCount = viewState.fileGroups.partial.length;
  const unstagedCount = viewState.fileGroups.unstaged.length;
  const changeSummary = [
    `${stats.files} ${stats.files === 1 ? "change" : "changes"}`,
    stagedCount > 0 ? `${stagedCount} staged` : null,
    partialCount > 0 ? `${partialCount} partially staged` : null,
    unstagedCount > 0 ? `${unstagedCount} unstaged` : null,
  ].filter((part): part is string => Boolean(part)).join(" · ");

  function handleClose() {
    resetDrafts();
    onClose();
  }

  function handleIntentChange(nextIntent: PublishIntent) {
    clearError();
    onIntentChange(nextIntent);
  }

  async function handleSubmit() {
    if (primaryActionViewsExistingPr && viewState.existingPr) {
      onViewPr(viewState.existingPr);
      handleClose();
      return;
    }
    const didComplete = await submit();
    if (didComplete) {
      handleClose();
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={handleClose}
      disableClose={isSubmitting}
      title={title}
      headerContent={(
        <div className="flex h-9 w-full items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2 text-foreground">
            {intent === "pull_request" ? (
              <GitPullRequest className="size-3.5 shrink-0 text-muted-foreground" />
            ) : intent === "publish" ? (
              <ArrowUp className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <GitCommit className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="shrink-0 text-ui font-medium">{title}</span>
            {viewState.branchName ? (
              <span className="min-w-0 truncate text-ui-sm text-muted-foreground">
                {viewState.branchName}
              </span>
            ) : null}
          </span>
          {(stats.additions > 0 || stats.deletions > 0) && (
            <span className="flex shrink-0 items-center gap-1.5 text-ui-sm tabular-nums">
              {stats.additions > 0 && <span className="text-git-green">+{stats.additions}</span>}
              {stats.deletions > 0 && <span className="text-git-red">−{stats.deletions}</span>}
            </span>
          )}
        </div>
      )}
      sizeClassName="max-h-[88vh] w-[420px] max-w-[calc(100vw-2rem)]"
      headerClassName="shrink-0 px-3"
      bodyClassName="flex min-h-0 flex-col p-0"
      footerClassName="shrink-0 border-t border-border/60 px-3 py-2"
      panelClassName="border-border bg-background shadow-xl"
      showCloseButton={false}
      footer={(
        <div className="flex w-full flex-col gap-2">
          {visibleValidationMessage && (
            <p className={`text-ui-sm ${error ? "text-destructive" : "text-muted-foreground"}`}>
              {visibleValidationMessage}
            </p>
          )}
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
            <Button type="button" variant="ghost" size="sm" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="inverted"
              size="sm"
              loading={isSubmitting}
              disabled={isLoading || (!primaryActionViewsExistingPr && !!viewState.disabledReason)}
              onClick={handleSubmit}
            >
              {viewState.primaryLabel}
            </Button>
          </div>
        </div>
      )}
    >
      <AutoHideScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col">
          <div className="border-t border-border/60 px-3 py-2">
            <SegmentedControl
              items={PUBLISH_INTENT_ITEMS.map((item) => ({
                ...item,
                disabled: isSubmitting,
              }))}
              value={intent}
              onChange={handleIntentChange}
              ariaLabel="Source control action"
              className="grid w-full grid-cols-3"
            />
          </div>

          {hasDirtyChanges && (
            <div className="border-t border-border/60 px-3 py-2 text-ui-sm text-muted-foreground">
              {changeSummary}
            </div>
          )}

          {hasDirtyChanges && (
            <div className="border-t border-border/60">
              <Textarea
                aria-label="Commit message"
                rows={3}
                value={commitDraft.summary}
                onChange={(event) => setCommitDraft({ ...commitDraft, summary: event.target.value })}
                placeholder="Commit message"
                disabled={isSubmitting}
                variant="flush"
                className="h-20"
              />
              {viewState.hasUnstagedChanges && (
                <div className="flex items-center gap-2 px-3 pb-3 pt-2">
                  <Checkbox
                    id={includeUnstagedId}
                    checked={commitDraft.includeUnstaged}
                    onCheckedChange={(checked) => setCommitDraft({
                      ...commitDraft,
                      includeUnstaged: checked === true,
                    })}
                    disabled={isSubmitting}
                  />
                  <Label htmlFor={includeUnstagedId} className="mb-0 text-ui text-foreground">
                    Include unstaged changes
                  </Label>
                </div>
              )}
              {viewState.partialWarning && (
                <p className="px-3 pb-3 text-ui-sm text-muted-foreground">
                  {viewState.partialWarning}
                </p>
              )}
            </div>
          )}

          {intent === "publish" && !hasDirtyChanges && viewState.publishStatus && (
            <p className="border-t border-border/60 px-3 py-3 text-ui-sm text-muted-foreground">
              {viewState.publishStatus}
            </p>
          )}

          {intent === "pull_request" && !viewState.existingPr && (
            <div className="space-y-3 border-t border-border/60 px-3 py-3">
              <div>
                <Label htmlFor={prTitleId} className="sr-only">Title</Label>
                <Input
                  id={prTitleId}
                  value={pullRequestDraft.title}
                  onChange={(event) => setPullRequestDraft({ ...pullRequestDraft, title: event.target.value })}
                  placeholder="Pull request title"
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <Label htmlFor={prBodyId} className="sr-only">Description</Label>
                <Textarea
                  id={prBodyId}
                  rows={3}
                  value={pullRequestDraft.body}
                  onChange={(event) => setPullRequestDraft({ ...pullRequestDraft, body: event.target.value })}
                  placeholder="Description (optional)"
                  disabled={isSubmitting}
                />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
                <div>
                  <Label htmlFor={prBaseBranchId} className="mb-1 text-ui-sm text-muted-foreground">
                    Base branch
                  </Label>
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
                  <Label htmlFor={prDraftId} className="mb-0 text-ui">Draft</Label>
                </div>
              </div>
            </div>
          )}

          {!hasDirtyChanges && intent === "commit" && viewState.disabledReason && (
            <p className="border-t border-border/60 px-3 py-3 text-ui-sm text-muted-foreground">
              No local changes
            </p>
          )}
        </div>
      </AutoHideScrollArea>
    </ModalShell>
  );
}
