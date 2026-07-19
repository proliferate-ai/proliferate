import { useId, type KeyboardEvent, type ReactNode } from "react";
import type { CurrentPullRequestResponse } from "@anyharness/sdk";
import { AutoHideScrollArea } from "@proliferate/ui/layout/AutoHideScrollArea";
import { Button } from "@proliferate/ui/primitives/Button";
import { Checkbox } from "@proliferate/ui/primitives/Checkbox";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { ArrowUp, GitCommit, GitHub, GitPullRequest, Spinner } from "@proliferate/ui/icons";
import { useWorkspacePublishWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-publish-workflow";
import type { PublishIntent } from "#product/lib/domain/workspaces/creation/publish-workflow-model";

/* Codex git-modal anatomy (reference/codex/git_modal/git_modal.html): no
 * intent tabs and no Cancel/Submit footer — the bottom of the card is a
 * command list. The row for the current intent is the primary action and
 * carries the ⌘⏎ hint; clicking another row switches intent. */
const PUBLISH_INTENTS: ReadonlyArray<{
  id: PublishIntent;
  label: string;
  icon: ReactNode;
}> = [
  { id: "commit", label: "Commit", icon: <GitCommit className="icon-paired" /> },
  { id: "publish", label: "Publish", icon: <ArrowUp className="icon-paired" /> },
  { id: "pull_request", label: "Pull request", icon: <GitPullRequest className="icon-paired" /> },
];

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

  const primaryDisabled = isLoading
    || (!primaryActionViewsExistingPr && !!viewState.disabledReason);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (!isSubmitting && !primaryDisabled) {
        void handleSubmit();
      }
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
              <GitPullRequest className="icon-paired shrink-0 text-muted-foreground" />
            ) : intent === "publish" ? (
              <ArrowUp className="icon-paired shrink-0 text-muted-foreground" />
            ) : (
              <GitCommit className="icon-paired shrink-0 text-muted-foreground" />
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
      footerClassName="shrink-0 border-t border-border/60 p-1"
      panelClassName="border-border bg-background shadow-xl"
      showCloseButton={false}
      footer={(
        <div className="flex w-full flex-col gap-1" onKeyDown={handleKeyDown}>
          {visibleValidationMessage && (
            <p className={`px-2 pt-1 text-ui-sm ${error ? "text-destructive" : "text-muted-foreground"}`}>
              {visibleValidationMessage}
            </p>
          )}
          <div className="flex w-full flex-col gap-1" role="listbox" aria-label="Source control action">
            {PUBLISH_INTENTS.map((item) => {
              const active = item.id === intent;
              return (
                <PublishActionRow
                  key={item.id}
                  icon={item.icon}
                  label={active ? viewState.primaryLabel : item.label}
                  active={active}
                  loading={active && isSubmitting}
                  disabled={isSubmitting || (active && primaryDisabled)}
                  onClick={() => {
                    if (active) {
                      void handleSubmit();
                    } else {
                      handleIntentChange(item.id);
                    }
                  }}
                />
              );
            })}
            {viewState.existingPr && viewState.workflowSteps.length > 0 && (
              <PublishActionRow
                icon={<GitHub className="icon-paired" />}
                label="View pull request"
                active={false}
                loading={false}
                disabled={isSubmitting}
                onClick={() => onViewPr(viewState.existingPr!)}
              />
            )}
          </div>
        </div>
      )}
    >
      <AutoHideScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col" onKeyDown={handleKeyDown}>
          {hasDirtyChanges && (
            <div className="border-t border-border/60">
              <Textarea
                aria-label="Commit message"
                rows={3}
                value={commitDraft.summary}
                onChange={(event) => setCommitDraft({ ...commitDraft, summary: event.target.value })}
                placeholder="Commit message (leave blank to generate)…"
                disabled={isSubmitting}
                variant="flush"
                // Codex git-modal field: bare textarea, no focus ring — the
                // section hairlines already frame it.
                className="h-20 focus:ring-0"
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

        </div>
      </AutoHideScrollArea>
    </ModalShell>
  );
}

/* Codex cmdk-item recipe: rounded-lg row, icon slot + truncating label,
 * list-hover paint on the selected/primary row, disabled rows dimmed, and
 * the primary row carries the ⌘⏎ hint. */
function PublishActionRow({
  icon,
  label,
  active,
  loading,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      role="option"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-ui text-foreground disabled:opacity-25 ${
        active ? "bg-list-hover" : "hover:bg-list-hover"
      }`}
    >
      <span className="flex w-[18px] shrink-0 items-center justify-start text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active && (
        loading
          ? <Spinner className="icon-paired shrink-0 text-muted-foreground" />
          : (
            <kbd className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-md bg-current/10 px-1.5 font-sans text-xs leading-4 text-current opacity-80">
              ⌘⏎
            </kbd>
          )
      )}
    </Button>
  );
}
