import { useId } from "react";
import { PublishChangedFiles } from "@/components/workspace/git/PublishChangedFiles";
import { PublishSection } from "@/components/workspace/git/PublishSection";
import { AutoHideScrollArea } from "@proliferate/ui/layout/AutoHideScrollArea";
import { Button } from "@proliferate/ui/primitives/Button";
import { Label } from "@proliferate/ui/primitives/Label";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import type { useWorkspaceMobilityGitPrepWorkflow } from "@/hooks/workspaces/workflows/mobility/use-workspace-mobility-git-prep-workflow";

type MobilityGitPrepWorkflow = ReturnType<typeof useWorkspaceMobilityGitPrepWorkflow>;

export function WorkspaceMobilityGitPrepDialog({
  open,
  workflow,
  onCancel,
  onOpenGitPanel,
  onSubmit,
}: {
  open: boolean;
  workflow: MobilityGitPrepWorkflow;
  onCancel: () => void;
  onOpenGitPanel: () => void;
  onSubmit: () => void | Promise<void>;
}) {
  const commitSummaryId = useId();
  const includeUnstagedId = useId();
  const {
    commitDraft,
    setCommitDraft,
    error,
    isLoading,
    isSubmitting,
    viewState,
  } = workflow;
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
  const shouldScrollChangedFiles = stats.files > 6;
  const hasDirtyChanges = viewState.hasStagedChanges || viewState.hasUnstagedChanges;
  const title = hasDirtyChanges ? "Prepare branch for move" : "Push branch for move";
  const description = hasDirtyChanges
    ? "Commit and push these changes so the destination can check out the exact code."
    : "Push this branch so the destination can check out the exact code.";

  return (
    <ModalShell
      open={open}
      onClose={onCancel}
      disableClose={isSubmitting}
      title={title}
      description={description}
      sizeClassName="max-h-[88vh] max-w-xl"
      bodyClassName="min-h-0 px-0 pb-0 pt-0"
      footer={(
        <div className="flex w-full items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isSubmitting}
            onClick={onOpenGitPanel}
          >
            Open Git panel
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="inverted"
            size="sm"
            loading={isSubmitting}
            disabled={isLoading || !!viewState.disabledReason}
            onClick={() => {
              void onSubmit();
            }}
          >
            {viewState.primaryLabel}
          </Button>
        </div>
      )}
    >
      <div className="flex min-h-0 flex-col">
        <AutoHideScrollArea className="min-h-0 flex-1" viewportClassName="max-h-[56vh] px-5 pb-4">
          <div className="space-y-4">
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
