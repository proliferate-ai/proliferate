import { useState } from "react";
import type { WorktreeInventoryRow } from "@anyharness/sdk";
import { Button } from "@/components/ui/Button";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { GitBranch, RefreshCw, Trash } from "@/components/ui/icons";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import {
  EnvironmentPanel,
  EnvironmentPanelRow,
  EnvironmentSection,
} from "@/components/settings/EnvironmentSettingsLayout";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import {
  useWorktreeSettingsTargets,
  type WorktreeSettingsTargetState,
} from "@/hooks/workspaces/use-worktree-settings-targets";
import { useToastStore } from "@/stores/toast/toast-store";

const EMPTY_ROWS: WorktreeInventoryRow[] = [];

export function WorktreesPane() {
  const settings = useWorktreeSettingsTargets();
  const showToast = useToastStore((state) => state.show);
  const [confirmDelete, setConfirmDelete] = useState<{
    target: WorktreeSettingsTargetState["target"];
    workspaceId: string;
  } | null>(null);

  const runAction = (operation: () => Promise<unknown>, success: string) => {
    void operation().then((result) => {
      if (
        result
        && typeof result === "object"
        && "alreadyRunning" in result
        && result.alreadyRunning === true
      ) {
        showToast("Cleanup is already running.");
        return;
      }
      showToast(success);
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(message);
    });
  };

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Worktrees"
        description="Review checkout materialization and remove worktree state that is no longer needed."
      />

      {settings.targets.length === 0 ? (
        <EnvironmentSection title="Runtime roots">
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
          onUpdatePolicy={(value) => runAction(
            () => settings.updatePolicy(targetState.target, {
              maxMaterializedWorktreesPerRepo: value,
            }),
            "Worktree cleanup policy updated.",
          )}
          onRunCleanup={() => runAction(
            () => settings.runRetention(targetState.target),
            "Worktree cleanup finished.",
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
        description="This removes the workspace checkout and AnyHarness workspace/session history from the owning runtime. Git branches are preserved."
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

function RuntimeWorktreesSection({
  targetState,
  onUpdatePolicy,
  onRunCleanup,
  onPruneOrphan,
  onPruneWorkspace,
  onPurgeWorkspace,
  onRetryPurge,
}: {
  targetState: WorktreeSettingsTargetState;
  onUpdatePolicy: (value: number) => void;
  onRunCleanup: () => void;
  onPruneOrphan: (path: string) => void;
  onPruneWorkspace: (workspaceId: string) => void;
  onPurgeWorkspace: (workspaceId: string) => void;
  onRetryPurge: (workspaceId: string) => void;
}) {
  const policy = targetState.policy;
  const rows = targetState.inventory?.rows ?? EMPTY_ROWS;
  const [draftValue, setDraftValue] = useState("");
  const currentValue = policy?.maxMaterializedWorktreesPerRepo ?? 20;
  const parsedDraft = Number.parseInt(draftValue, 10);
  const nextValue = Number.isFinite(parsedDraft) ? parsedDraft : currentValue;

  return (
    <EnvironmentSection
      title={`${targetState.target.label} ${targetState.target.location === "cloud" ? "(cloud)" : "(local)"}`}
    >
      <EnvironmentPanel>
        <EnvironmentPanelRow>
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full max-w-56 space-y-1.5">
              <Label htmlFor={`worktree-policy-${targetState.target.key}`}>Max active checkouts per repo</Label>
              <Input
                id={`worktree-policy-${targetState.target.key}`}
                type="number"
                min={1}
                max={100}
                value={draftValue || String(currentValue)}
                onChange={(event) => setDraftValue(event.target.value)}
              />
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={nextValue < 1 || nextValue > 100}
                onClick={() => {
                  onUpdatePolicy(nextValue);
                  setDraftValue("");
                }}
              >
                Apply
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={onRunCleanup}>
                <RefreshCw className="size-4" />
                Run cleanup
              </Button>
            </div>
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
