import { useState } from "react";
import type { WorktreeInventoryRow } from "@anyharness/sdk";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { RefreshCw, Trash, Tree } from "@proliferate/ui/icons";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import {
  EnvironmentField,
  EnvironmentPanel,
  EnvironmentPanelRow,
  EnvironmentSection,
} from "@proliferate/ui/layout/EnvironmentLayout";
import { useWorktreeCleanupPolicy } from "@/hooks/workspaces/facade/use-worktree-cleanup-policy";
import {
  useWorktreeSettingsTargets,
  type WorktreeSettingsTargetState,
} from "@/hooks/workspaces/facade/use-worktree-settings-targets";
import {
  worktreeRetentionRunMessage,
  worktreeSettingsActionFailureMessage,
} from "@/lib/domain/workspaces/sidebar/worktree-settings-actions";
import {
  formatWorktreeStorage,
  formatWorktreeStorageDetail,
  worktreeGitStatusView,
  worktreeRowLabel,
} from "@/lib/domain/workspaces/worktrees/worktree-inventory-presentation";
import { useToastStore } from "@/stores/toast/toast-store";

const EMPTY_ROWS: WorktreeInventoryRow[] = [];

export function WorktreeStorageSection() {
  const settings = useWorktreeSettingsTargets();
  const cleanupPolicy = useWorktreeCleanupPolicy(
    settings.targets,
    settings.syncPolicyToTarget,
  );
  const showToast = useToastStore((state) => state.show);
  const [confirmDelete, setConfirmDelete] = useState<{
    target: WorktreeSettingsTargetState["target"];
    workspaceId: string;
    label: string;
  } | null>(null);

  const runAction = <TResult,>(
    operation: () => Promise<TResult>,
    success: string | ((result: TResult) => string),
  ) => {
    void operation().then((result) => {
      const failureMessage = worktreeSettingsActionFailureMessage(result);
      if (failureMessage) {
        showToast(failureMessage);
        return;
      }
      const successMessage = typeof success === "function" ? success(result) : success;
      showToast(successMessage);
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(message);
    });
  };

  return (
    <>
      <AutomaticCleanupSection
        draftValue={cleanupPolicy.draftValue}
        onDraftValueChange={cleanupPolicy.setDraftValue}
        canApply={cleanupPolicy.canApply && !cleanupPolicy.isApplying}
        applyDisabledReason={cleanupPolicy.applyDisabledReason}
        statusMessage={cleanupPolicy.statusMessage}
        onApply={() => runAction(
          cleanupPolicy.apply,
          "Pruning preference updated.",
        )}
      />

      {settings.targets.length === 0 ? (
        <EnvironmentSection title="Current worktrees">
          <EnvironmentPanel>
            <EnvironmentPanelRow>
              <p className="text-sm text-muted-foreground">No runtime roots found.</p>
            </EnvironmentPanelRow>
          </EnvironmentPanel>
        </EnvironmentSection>
      ) : settings.targets.map((targetState) => (
        <RuntimeWorktreesSection
          key={targetState.target.key}
          targetState={targetState}
          onRunCleanup={() => runAction(
            () => settings.runRetention(targetState.target, cleanupPolicy.value),
            worktreeRetentionRunMessage,
          )}
          onPruneOrphan={(path) => runAction(
            () => settings.pruneOrphan(targetState.target, { path }),
            "Worktree checkout removed.",
          )}
          onPruneWorkspace={(workspaceId) => runAction(
            () => settings.pruneWorkspaceCheckout(targetState.target, workspaceId),
            "Workspace checkout removed.",
          )}
          onPurgeWorkspace={(workspaceId) => {
            const row = (targetState.inventory?.rows ?? EMPTY_ROWS).find((candidate) => (
              candidate.associatedWorkspaces.some((workspace) => workspace.id === workspaceId)
            ));
            setConfirmDelete({
              target: targetState.target,
              workspaceId,
              label: row ? worktreeRowLabel(row) : "this workspace",
            });
          }}
          onRetryPurge={(workspaceId) => runAction(
            () => settings.retryPurge(targetState.target, workspaceId),
            "Purge retry finished.",
          )}
        />
      ))}

      <ConfirmationDialog
        open={confirmDelete !== null}
        title={`Delete runtime history for ${confirmDelete?.label ?? "this workspace"}?`}
        description="This removes the AnyHarness runtime workspace record, chats, raw events, normalized events, checkout, and local agent artifacts from the owning runtime. Uncommitted changes in the checkout will be lost. Git commits, branches, pull requests, and Cloud product records are preserved."
        confirmLabel="Delete"
        confirmVariant="destructive"
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          const pending = confirmDelete;
          if (!pending) {
            return;
          }
          setConfirmDelete(null);
          runAction(
            () => settings.purgeWorkspace(pending.target, pending.workspaceId),
            "Runtime workspace history deleted.",
          );
        }}
      />
    </>
  );
}

function AutomaticCleanupSection({
  draftValue,
  onDraftValueChange,
  canApply,
  applyDisabledReason,
  statusMessage,
  onApply,
}: {
  draftValue: string;
  onDraftValueChange: (value: string) => void;
  canApply: boolean;
  applyDisabledReason: string | null;
  statusMessage: string | null;
  onApply: () => void;
}) {
  return (
    <EnvironmentSection
      title="Pruning"
      description="Set the ideal worktree count used by the composer pressure indicator. Cleanup only runs when you explicitly ask for it."
    >
      <EnvironmentPanel>
        <EnvironmentPanelRow>
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <EnvironmentField
              label="Ideal materialized managed worktrees per repo"
              description="When a repo exceeds this count, the composer pressure circle moves toward warning or red. Manual cleanup retires the oldest clean managed checkouts first; workspace history stays available unless you explicitly delete the workspace."
            >
              <div className="w-full max-w-64 space-y-1.5">
                <Label htmlFor="worktree-policy-global">Ideal worktrees</Label>
                <Input
                  id="worktree-policy-global"
                  type="number"
                  min={10}
                  max={100}
                  value={draftValue}
                  onChange={(event) => onDraftValueChange(event.target.value)}
                />
                <p className="text-xs leading-4 text-muted-foreground">
                  Default is 20; minimum is 10. This does not prune automatically.
                  Commits, branches, and pull requests are preserved by Git; dirty
                  worktrees are skipped.
                </p>
                {statusMessage ? (
                  <p className="text-xs leading-4 text-muted-foreground">{statusMessage}</p>
                ) : null}
                {applyDisabledReason ? (
                  <p className="text-xs leading-4 text-muted-foreground">
                    {applyDisabledReason}
                  </p>
                ) : null}
              </div>
            </EnvironmentField>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canApply}
              onClick={onApply}
            >
              Apply
            </Button>
          </div>
        </EnvironmentPanelRow>
      </EnvironmentPanel>
    </EnvironmentSection>
  );
}

function RuntimeWorktreesSection({
  targetState,
  onRunCleanup,
  onPruneOrphan,
  onPruneWorkspace,
  onPurgeWorkspace,
  onRetryPurge,
}: {
  targetState: WorktreeSettingsTargetState;
  onRunCleanup: () => void;
  onPruneOrphan: (path: string) => void;
  onPruneWorkspace: (workspaceId: string) => void;
  onPurgeWorkspace: (workspaceId: string) => void;
  onRetryPurge: (workspaceId: string) => void;
}) {
  const rows = targetState.inventory?.rows ?? EMPTY_ROWS;

  return (
    <EnvironmentSection
      title={targetState.target.label}
      description={targetState.target.location === "cloud" ? "Cloud runtime" : "Local runtime"}
    >
      <EnvironmentPanel>
        <EnvironmentPanelRow>
          <div className="flex w-full items-center justify-between gap-3">
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-foreground">Current worktrees</h3>
              <p className="text-sm text-muted-foreground">
                Review managed checkouts, orphaned paths, git status, storage, and workspace history in this runtime.
              </p>
            </div>
            <Tooltip content={RUN_CLEANUP_TOOLTIP}>
              <Button type="button" variant="outline" size="sm" onClick={onRunCleanup}>
                <RefreshCw className="size-4" />
                Run cleanup
              </Button>
            </Tooltip>
          </div>
        </EnvironmentPanelRow>
        {targetState.isLoading ? (
          <EnvironmentPanelRow>
            <p className="text-sm text-muted-foreground">Loading worktrees...</p>
          </EnvironmentPanelRow>
        ) : targetState.error ? (
          <EnvironmentPanelRow>
            <p className="text-sm text-muted-foreground">Runtime is unavailable.</p>
          </EnvironmentPanelRow>
        ) : rows.length === 0 ? (
          <EnvironmentPanelRow>
            <p className="text-sm text-muted-foreground">No worktrees found.</p>
          </EnvironmentPanelRow>
        ) : (
          rows.map((row) => (
            <EnvironmentPanelRow key={row.id}>
              <WorktreeRow
                row={row}
                onPruneOrphan={() => onPruneOrphan(row.path)}
                onPruneWorkspace={onPruneWorkspace}
                onPurgeWorkspace={onPurgeWorkspace}
                onRetryPurge={onRetryPurge}
              />
            </EnvironmentPanelRow>
          ))
        )}
      </EnvironmentPanel>
    </EnvironmentSection>
  );
}

function WorktreeRow({
  row,
  onPruneOrphan,
  onPruneWorkspace,
  onPurgeWorkspace,
  onRetryPurge,
}: {
  row: WorktreeInventoryRow;
  onPruneOrphan: () => void;
  onPruneWorkspace: (workspaceId: string) => void;
  onPurgeWorkspace: (workspaceId: string) => void;
  onRetryPurge: (workspaceId: string) => void;
}) {
  const primaryWorkspace = row.associatedWorkspaces[0] ?? null;
  const label = worktreeRowLabel(row);
  const stateLabel = row.state.replaceAll("_", " ");
  const status = worktreeGitStatusView(row.gitStatus);
  const storageDetail = formatWorktreeStorageDetail(row.storage);

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <Tree className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">{label}</span>
            <Badge tone="neutral" className="rounded-sm uppercase">
              {stateLabel}
            </Badge>
            <Badge tone={status.tone} className="rounded-sm">
              {status.label}
            </Badge>
            {row.cleanupOperation ? (
              <Badge tone="neutral" className="rounded-sm uppercase">
                {row.cleanupOperation}
              </Badge>
            ) : null}
          </div>
          <div className="truncate text-xs text-muted-foreground">{row.path}</div>
          <div className="text-xs text-muted-foreground">
            {row.totalSessionCount} sessions - {row.materialized ? "checkout present" : "checkout missing"} - {formatWorktreeStorage(row.storage)}
          </div>
          {status.detail || storageDetail || primaryWorkspace?.cleanupOperation ? (
            <div className="text-xs text-muted-foreground">
              {[status.detail, storageDetail, primaryWorkspace?.cleanupOperation].filter(Boolean).join(" - ")}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {row.state === "orphan_checkout" && row.availableActions.includes("delete_orphan_checkout") ? (
          <Tooltip content={PRUNE_ORPHAN_TOOLTIP}>
            <Button type="button" variant="outline" size="sm" onClick={onPruneOrphan}>
              <Trash className="size-4" />
              Prune
            </Button>
          </Tooltip>
        ) : null}
        {row.associatedWorkspaces.map((workspace) => (
          <div key={workspace.id} className="flex items-center gap-2">
            {row.state !== "conflict" && row.availableActions.includes("prune_checkout") ? (
              <Tooltip content={PRUNE_WORKSPACE_TOOLTIP}>
                <Button type="button" variant="outline" size="sm" onClick={() => onPruneWorkspace(workspace.id)}>
                  <Trash className="size-4" />
                  Prune
                </Button>
              </Tooltip>
            ) : null}
            {workspace.cleanupOperation === "purge"
              && (workspace.cleanupState === "pending" || workspace.cleanupState === "failed") ? (
                <Button type="button" variant="outline" size="sm" onClick={() => onRetryPurge(workspace.id)}>
                  <RefreshCw className="size-4" />
                  Retry
                </Button>
              ) : null}
            {row.state !== "conflict" && row.availableActions.includes("delete_workspace_history") ? (
              <Button type="button" variant="outline" size="sm" onClick={() => onPurgeWorkspace(workspace.id)}>
                <Trash className="size-4" />
                Delete
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

const RUN_CLEANUP_TOOLTIP = [
  "Run cleanup",
  "Removes only clean managed checkout directories above the ideal per-repo count.",
  "Skips dirty or conflicted worktrees and keeps workspace history.",
].join("\n");

const PRUNE_WORKSPACE_TOOLTIP = [
  "Prune checkout",
  "Removes only this checkout directory.",
  "Keeps the workspace record, chats, raw events, normalized events, and Cloud product records.",
].join("\n");

const PRUNE_ORPHAN_TOOLTIP = [
  "Prune orphan checkout",
  "Deletes this orphan checkout directory.",
  "No workspace record or chat history is attached to this row.",
].join("\n");
