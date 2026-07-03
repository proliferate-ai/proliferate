import { useCallback, useId } from "react";
import type { RepoRoot, WorkspaceKind } from "@anyharness/sdk";
import { PublishChangedFiles } from "@/components/workspace/git/PublishChangedFiles";
import { PublishSection } from "@/components/workspace/git/PublishSection";
import { MoveProgress } from "@/components/workspace/move/MoveProgress";
import { Button } from "@proliferate/ui/primitives/Button";
import { Label } from "@proliferate/ui/primitives/Label";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { Spinner } from "@proliferate/ui/icons";
import { useWorkspaceMoveWorkflow } from "@/hooks/workspaces/workflows/use-workspace-move-workflow";
import { useWorkspaceNavigationWorkflow } from "@/hooks/workspaces/workflows/use-workspace-navigation-workflow";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";

interface MoveWorkspaceDialogProps {
  open: boolean;
  workspaceId: string | null;
  workspaceKind: WorkspaceKind | null;
  repoRoot: Pick<RepoRoot, "remoteOwner" | "remoteRepoName" | "defaultBranch"> | null | undefined;
  onClose: () => void;
}

export function MoveWorkspaceDialog({
  open,
  workspaceId,
  workspaceKind,
  repoRoot,
  onClose,
}: MoveWorkspaceDialogProps) {
  const workflow = useWorkspaceMoveWorkflow({
    workspaceId,
    workspaceKind,
    repoRoot,
    enabled: open && Boolean(workspaceId),
  });
  const { direction, stage, readiness, publish, error, isSubmitting } = workflow;
  const { selectWorkspaceFromSurface } = useWorkspaceNavigationWorkflow();

  const commitSummaryId = useId();
  const includeUnstagedId = useId();

  const handleClose = useCallback(() => {
    workflow.reset();
    onClose();
  }, [onClose, workflow]);

  const handleOpenCollidingWorkspace = useCallback((collidingWorkspaceId: string) => {
    selectWorkspaceFromSurface(cloudWorkspaceSyntheticId(collidingWorkspaceId), "workspace-move-dialog");
    handleClose();
  }, [handleClose, selectWorkspaceFromSurface]);

  const disableClose = isSubmitting || stage.kind === "progress";

  // Same dialog, direction-aware copy (spec section 2.6). `direction` is `null` until
  // the workflow resolves it from `workspaceId` -- defaults to the local->cloud
  // wording, matching this dialog's original (pre-mirror) behavior.
  const isMirror = direction === "cloud_to_local";
  let title = isMirror ? "Move to this Mac" : "Move to cloud";
  let primaryLabel: string | null = null;
  let onPrimary: (() => void) | null = null;
  let primaryDisabled = false;
  let secondaryAction: { label: string; onClick: () => void } | null = null;

  if (stage.kind === "readiness") {
    title = readiness.copy.headline;
    if (readiness.kind !== "blocked") {
      primaryLabel = readiness.copy.primaryActionLabel;
      onPrimary = () => void workflow.startMove();
      primaryDisabled = readiness.kind === "prepare_required" && publish.viewState.disabledReason !== null;
    }
  } else if (stage.kind === "resume" && !stage.postCutover) {
    title = "A move is already in progress";
    primaryLabel = "Resume move";
    onPrimary = () => void workflow.resumeMove();
    secondaryAction = { label: "Abandon move", onClick: () => void workflow.abandonMove() };
  } else if (stage.kind === "resume" && stage.postCutover) {
    // Cutover already committed the move -- only cleanup remains, so retry is the sole
    // option (abandon is refused post-cutover). Freshly-rediscovered stuck moves land
    // here with no `error`, so this branch (not MoveProgress's error-gated banner) must
    // carry the retry affordance.
    title = "Finishing the move to cloud";
    primaryLabel = "Retry cleanup";
    onPrimary = () => void workflow.resumeMove();
  } else if (stage.kind === "collision") {
    title = "A cloud workspace already exists";
  } else if (stage.kind === "not_configured") {
    title = "Connect this repository to Proliferate Cloud";
  } else if (stage.kind === "done") {
    title = isMirror ? "Moved to this Mac" : "Moved to cloud";
    primaryLabel = "Done";
    onPrimary = handleClose;
  }

  return (
    <ModalShell
      open={open}
      onClose={handleClose}
      disableClose={disableClose}
      title={title}
      sizeClassName="max-w-md"
      footer={(
        <div className="flex w-full items-center justify-end gap-2">
          {secondaryAction && (
            <Button type="button" variant="outline" size="sm" disabled={isSubmitting} onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={handleClose} disabled={disableClose}>
            {stage.kind === "done" ? "Close" : "Cancel"}
          </Button>
          {primaryLabel && onPrimary && (
            <Button
              type="button"
              variant="inverted"
              size="sm"
              loading={isSubmitting}
              disabled={primaryDisabled}
              onClick={onPrimary}
            >
              {primaryLabel}
            </Button>
          )}
        </div>
      )}
    >
      <div className="space-y-4">
        {stage.kind === "loading" && (
          <div className="flex items-center gap-2 text-ui-sm text-muted-foreground">
            <Spinner className="size-4" />
            Checking workspace status…
          </div>
        )}

        {stage.kind === "not_configured" && (
          <p className="text-ui-sm text-muted-foreground">
            This repository isn't connected to Proliferate Cloud yet. Configure it from
            repository settings, then try moving this workspace again.
          </p>
        )}

        {stage.kind === "resume" && !stage.postCutover && (
          <p className="text-ui-sm text-muted-foreground">
            A previous move for this workspace hasn't finished. Resume it, or abandon it
            to unfreeze this workspace and start over.
          </p>
        )}

        {stage.kind === "resume" && stage.postCutover && (
          <MoveProgress
            phase={stage.move.phase}
            error={error}
            isRetrying={isSubmitting}
            onRetry={() => void workflow.resumeMove()}
          />
        )}

        {stage.kind === "collision" && (
          <MoveCollisionPanel
            branch={stage.branch}
            collidingWorkspaceId={stage.collidingWorkspaceId}
            isSubmitting={isSubmitting}
            onOpen={handleOpenCollidingWorkspace}
            onReplace={(id) => void workflow.replaceCollidingWorkspace(id)}
          />
        )}

        {stage.kind === "readiness" && (
          <div className="space-y-4">
            <p className="text-ui-sm text-muted-foreground">{readiness.copy.body}</p>

            {readiness.kind === "prepare_required" && (
              <>
                {(publish.viewState.hasStagedChanges || publish.viewState.hasUnstagedChanges) && (
                  <PublishSection flush>
                    <p className="text-ui font-medium text-foreground">Changed files</p>
                    <PublishChangedFiles groups={publish.viewState.fileGroups} scroll={false} />
                  </PublishSection>
                )}
                <PublishSection flush>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-ui font-medium text-foreground">Commit message</p>
                    {publish.viewState.hasUnstagedChanges && (
                      <div className="flex items-center gap-2">
                        <Switch
                          id={includeUnstagedId}
                          checked={publish.commitDraft.includeUnstaged}
                          onChange={(includeUnstaged) =>
                            publish.setCommitDraft({ ...publish.commitDraft, includeUnstaged })}
                          disabled={isSubmitting}
                        />
                        <Label htmlFor={includeUnstagedId} className="mb-0">Include unstaged</Label>
                      </div>
                    )}
                  </div>
                  <Textarea
                    id={commitSummaryId}
                    aria-label="Commit message"
                    rows={3}
                    value={publish.commitDraft.summary}
                    onChange={(event) =>
                      publish.setCommitDraft({ ...publish.commitDraft, summary: event.target.value })}
                    placeholder="Describe your changes"
                    disabled={isSubmitting}
                  />
                </PublishSection>
              </>
            )}
          </div>
        )}

        {stage.kind === "progress" && <MoveProgress phase={stage.phase} />}

        {error && stage.kind !== "resume" && (
          <p className="text-ui-sm text-destructive">{error}</p>
        )}
      </div>
    </ModalShell>
  );
}

function MoveCollisionPanel({
  branch,
  collidingWorkspaceId,
  isSubmitting,
  onOpen,
  onReplace,
}: {
  branch: string;
  collidingWorkspaceId: string | null;
  isSubmitting: boolean;
  onOpen: (collidingWorkspaceId: string) => void;
  onReplace: (collidingWorkspaceId: string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-ui-sm text-muted-foreground">
        A cloud workspace for <span className="font-mono text-foreground">{branch}</span> already
        exists with its own sessions. Open it instead, or replace it with this local copy.
      </p>
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!collidingWorkspaceId || isSubmitting}
          onClick={() => collidingWorkspaceId && onOpen(collidingWorkspaceId)}
        >
          Open the cloud workspace
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!collidingWorkspaceId || isSubmitting}
          loading={isSubmitting}
          onClick={() => collidingWorkspaceId && onReplace(collidingWorkspaceId)}
        >
          Replace it with this local copy
        </Button>
      </div>
    </div>
  );
}
