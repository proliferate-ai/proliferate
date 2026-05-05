import { useState } from "react";
import type { WorktreeInventoryRow } from "@anyharness/sdk";
import { Button } from "@/components/ui/Button";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { GitBranch, RefreshCw, Trash } from "@/components/ui/icons";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import {
  EnvironmentField,
  EnvironmentPanel,
  EnvironmentPanelRow,
  EnvironmentSection,
} from "@/components/ui/EnvironmentLayout";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { useWorktreeCleanupPolicy } from "@/hooks/workspaces/use-worktree-cleanup-policy";
import {
  useWorktreeSettingsTargets,
  type WorktreeSettingsTargetState,
} from "@/hooks/workspaces/use-worktree-settings-targets";
import {
  worktreeRetentionRunMessage,
  worktreeSettingsActionFailureMessage,
} from "@/lib/domain/workspaces/worktree-settings-actions";
import { useToastStore } from "@/stores/toast/toast-store";

const EMPTY_ROWS: WorktreeInventoryRow[] = [];

export function WorktreesPane() {
  const settings = useWorktreeSettingsTargets();
  const cleanupPolicy = useWorktreeCleanupPolicy(
    settings.targets,
    settings.syncPolicyToTarget,
  );
  const showToast = useToastStore((state) => state.show);
  const [confirmDelete, setConfirmDelete] = useState<{
    target: WorktreeSettingsTargetState["target"];
    workspaceId: string;
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
    <section className="space-y-6">
      <SettingsPageHeader
        title="Worktree storage"
        description="Recommended for most users. Automatic cleanup only removes clean Proliferate-managed checkouts; it does not snapshot, push, or back up work before deleting a checkout."
      />

      <AutomaticCleanupSection
        draftValue={cleanupPolicy.draftValue}
        onDraftValueChange={cleanupPolicy.setDraftValue}
        canApply={cleanupPolicy.canApply && !cleanupPolicy.isApplying}
        applyDisabledReason={cleanupPolicy.applyDisabledReason}
        statusMessage={cleanupPolicy.statusMessage}
        onApply={() => runAction(
          cleanupPolicy.apply,
          "Worktree cleanup policy updated.",
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
            setConfirmDelete({ target: targetState.target, workspaceId });
          }}
          onRetryPurge={(workspaceId) => runAction(
            () => settings.retryPurge(targetState.target, workspaceId),
            "Purge retry finished.",
          )}
        />
      ))}

      <ConfirmationDialog
        open={confirmDelete !== null}
        title="Delete workspace history?"
        description="This removes the workspace checkout, AnyHarness workspace/session history, and local agent artifacts from the owning runtime. Uncommitted changes in the checkout will be lost. Git commits, branches, and pull requests are preserved."
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
            "Workspace deleted.",
          );
        }}
      />
    </section>
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
      title="Automatic cleanup"
      description="This policy is global. Inventories and manual actions below remain runtime-specific."
    >
      <EnvironmentPanel>
        <EnvironmentPanelRow>
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <EnvironmentField
              label="Keep up to N materialized managed checkouts per repo"
              description="When a repo exceeds this limit, Proliferate retires the oldest clean managed checkouts first. Workspace and session history stay available unless you explicitly delete the workspace."
            >
              <div className="w-full max-w-64 space-y-1.5">
                <Label htmlFor="worktree-policy-global">Auto-delete limit</Label>
                <Input
                  id="worktree-policy-global"
                  type="number"
                  min={10}
                  max={100}
                  value={draftValue}
                  onChange={(event) => onDraftValueChange(event.target.value)}
                />
                <p className="text-xs leading-4 text-muted-foreground">
                  Default is 20; minimum is 10. Commits, branches, and pull requests are
                  preserved by Git; dirty worktrees are skipped.
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
            <div className="flex shrink-0 gap-2">
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
                Review managed checkouts, orphaned paths, and workspace history in this runtime.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onRunCleanup}>
              <RefreshCw className="size-4" />
              Run cleanup
            </Button>
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
  const label = primaryWorkspace?.displayName
    ?? primaryWorkspace?.branch
    ?? row.branch
    ?? row.state.replaceAll("_", " ");
  const stateLabel = row.state.replaceAll("_", " ");

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <GitBranch className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">{label}</span>
            <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] uppercase tracking-normal text-muted-foreground">
              {stateLabel}
            </span>
            {row.cleanupOperation ? (
              <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] uppercase tracking-normal text-muted-foreground">
                {row.cleanupOperation}
              </span>
            ) : null}
          </div>
          <div className="truncate text-xs text-muted-foreground">{row.path}</div>
          <div className="text-xs text-muted-foreground">
            {row.totalSessionCount} sessions - {row.materialized ? "checkout present" : "checkout missing"}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {row.state === "orphan_checkout" && row.availableActions.includes("delete_orphan_checkout") ? (
          <Button type="button" variant="outline" size="sm" onClick={onPruneOrphan}>
            <Trash className="size-4" />
            Prune
          </Button>
        ) : null}
        {row.associatedWorkspaces.map((workspace) => (
          <div key={workspace.id} className="flex items-center gap-2">
            {row.state !== "conflict" && row.availableActions.includes("prune_checkout") ? (
              <Button type="button" variant="outline" size="sm" onClick={() => onPruneWorkspace(workspace.id)}>
                <Trash className="size-4" />
                Prune
              </Button>
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
