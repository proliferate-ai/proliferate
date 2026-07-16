import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@proliferate/ui/kit/AlertDialog";
import { WorkspaceReconciliationBody } from "@proliferate/product-ui/workspaces/WorkspaceReconciliationBody";
import {
  resolveWorkspaceGitReconciliation,
  type WorkspaceGitReconciliationPlan,
} from "#product/lib/domain/workspaces/cloud/workspace-git-reconciliation";
import type { WorkspaceGitSide } from "#product/lib/domain/workspaces/cloud/workspace-git-relation";
import { buildReconciliationBodyView } from "#product/lib/domain/workspaces/cloud/reconciliation-body-view";
import { useWorkspaceGitReconciliationActions } from "#product/hooks/workspaces/workflows/use-workspace-git-reconciliation-actions";
import { useMaterializationHealthPass } from "#product/hooks/workspaces/workflows/use-materialization-health-pass";
import type { LogicalWorkspace } from "#product/lib/domain/workspaces/cloud/logical-workspace-model";
import { useWorkspaceSelection } from "#product/hooks/workspaces/workflows/selection/use-workspace-selection";
import { useWorkspaceShellActions } from "#product/components/workspace/shell/providers/WorkspaceShellActionsContext";
import { useToastStore } from "#product/stores/toast/toast-store";

export interface ReconcileTarget {
  localWorkspaceId: string | null;
  cloudWorkspaceId: string | null;
  materializationId: string | null;
}

/**
 * PR 6 — the one reconciliation dialog (extends the availability host's dialog
 * anatomy). It reads the current cross-target relation, renders the This Mac /
 * Cloud / GitHub comparison, states the ONE safe next action, and says what
 * cancelling preserves. Concrete verbs only. It NEVER resets/stashes/rebases/
 * merges/force-pushes and never claims two different commits are linked. When
 * the relation re-evaluates (after a push or Retry), the newer relation wins.
 */
export function WorkspaceReconciliationDialog({
  target,
  logicalWorkspaces,
  onRelink,
  onRecreate,
  onUnlink,
  onLink,
  onClose,
}: {
  target: ReconcileTarget;
  logicalWorkspaces: LogicalWorkspace[];
  onRelink: (cloudWorkspaceId: string) => void;
  onRecreate: (cloudWorkspaceId: string) => void;
  onUnlink: (cloudWorkspaceId: string, materializationId: string) => void;
  onLink: (cloudWorkspaceId: string) => void;
  onClose: () => void;
}) {
  const { readRelation, pushLocalAndContinue } = useWorkspaceGitReconciliationActions();
  const runHealthPass = useMaterializationHealthPass();
  const { selectWorkspace } = useWorkspaceSelection();
  const shellActions = useWorkspaceShellActions();
  const showToast = useToastStore((state) => state.show);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{
    plan: WorkspaceGitReconciliationPlan;
    local: WorkspaceGitSide;
    cloud: WorkspaceGitSide;
  } | null>(null);

  const logical = useMemo(() => {
    return logicalWorkspaces.find((w) =>
      (target.cloudWorkspaceId && w.cloudWorkspace?.id === target.cloudWorkspaceId)
      || (target.localWorkspaceId && w.localWorkspace?.id === target.localWorkspaceId))
      ?? null;
  }, [logicalWorkspaces, target]);

  const refresh = useCallback(async () => {
    const result = await readRelation({
      local: logical?.localWorkspace ?? null,
      cloud: logical?.cloudWorkspace ?? null,
    });
    setState({
      plan: resolveWorkspaceGitReconciliation(result.relation),
      local: result.local,
      cloud: result.cloud,
    });
  }, [logical, readRelation]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runAction = useCallback(async () => {
    if (!state) {
      return;
    }
    const cloudId = target.cloudWorkspaceId;
    const verb = state.plan.action.verb;
    setBusy(true);
    try {
      switch (verb) {
        case "link":
          // Provably same_head: adopt via the existing link entry point.
          if (cloudId) {
            onLink(cloudId);
          }
          onClose();
          break;
        case "push-local":
        case "push-cloud":
          await pushLocalAndContinue({
            local: logical?.localWorkspace ?? null,
            cloud: logical?.cloudWorkspace ?? null,
            expected: verb === "push-local" ? "local_ahead" : "cloud_ahead",
          });
          // Re-evaluation wins: re-read and re-render the (possibly new) state.
          await refresh();
          break;
        case "open-git-panel":
          if (logical?.localWorkspace) {
            await selectWorkspace(logical.localWorkspace.id, { force: true });
            shellActions?.openPublishDialog("commit");
          } else {
            showToast("Open this workspace on this Mac to resolve it in the Git panel.");
          }
          onClose();
          break;
        case "recreate":
          if (cloudId) {
            onRecreate(cloudId);
          }
          onClose();
          break;
        case "relink":
          if (cloudId) {
            onRelink(cloudId);
          }
          onClose();
          break;
        case "unlink":
          if (cloudId && target.materializationId) {
            onUnlink(cloudId, target.materializationId);
          }
          onClose();
          break;
        case "retry":
          // Explicit Retry re-runs the bounded health pass for this workspace
          // (report/replay any drift), then re-reads the relation.
          if (logical?.cloudWorkspace) {
            await runHealthPass([logical.cloudWorkspace]);
          }
          await refresh();
          break;
        case "none":
          onClose();
          break;
      }
    } finally {
      setBusy(false);
    }
  }, [
    logical,
    onClose,
    onLink,
    onRecreate,
    onRelink,
    onUnlink,
    pushLocalAndContinue,
    refresh,
    runHealthPass,
    selectWorkspace,
    shellActions,
    showToast,
    state,
    target,
  ]);

  const view = useMemo(() => {
    if (!state) {
      return null;
    }
    return buildReconciliationBodyView({ plan: state.plan, local: state.local, cloud: state.cloud });
  }, [state]);

  return (
    <AlertDialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <AlertDialogContent overlayClassName="bg-black/70 backdrop-blur-sm" data-telemetry-block>
        <AlertDialogHeader>
          <AlertDialogTitle>{state?.plan.title ?? "Reconcile Git state"}</AlertDialogTitle>
          <AlertDialogDescription>
            {state
              ? "Compare this Mac and Cloud and choose the one safe next step."
              : "Checking the current state of both copies…"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {view ? <WorkspaceReconciliationBody view={view} /> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} onClick={() => onClose()}>
            Cancel
          </AlertDialogCancel>
          {state && state.plan.action.verb !== "none" ? (
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void runAction();
              }}
            >
              {busy ? "Working…" : state.plan.action.label}
            </AlertDialogAction>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
