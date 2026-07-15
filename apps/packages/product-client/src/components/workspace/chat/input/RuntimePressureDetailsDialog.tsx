import { useState } from "react";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import type {
  RuntimePressureTargetState,
} from "#product/hooks/workspaces/facade/use-runtime-pressure-control-state";
import {
  EnvironmentCardSections,
  type EnvironmentCardActions,
} from "#product/components/workspace/chat/input/EnvironmentStatusCard";

/**
 * Settings-pane worktree dialog: the same section/row anatomy as the
 * composer's environment card (EnvironmentCardSections), hosted in a modal.
 * The composer itself no longer opens this — the pressure ring anchors the
 * card as a popover (RuntimeEnvironmentControl).
 */
export function RuntimePressureDetailsDialog({
  open,
  targetState,
  actions,
  onClose,
}: {
  open: boolean;
  targetState: RuntimePressureTargetState;
  actions: EnvironmentCardActions;
  onClose: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState<{
    workspaceId: string;
    label: string;
  } | null>(null);

  return (
    <>
      <ModalShell
        open={open}
        onClose={onClose}
        title="Worktrees"
        description={targetState.target.label}
        sizeClassName="max-w-[420px] max-h-[84vh]"
        panelClassName="border-0 ring-[0.5px] ring-popover-ring shadow-popover"
        bodyClassName="flex min-h-0 flex-col gap-3 overflow-y-auto px-0 pb-3 pt-1"
      >
        <EnvironmentCardSections
          targetState={targetState}
          onRequestPurge={(workspaceId, label) => setConfirmDelete({ workspaceId, label })}
          onDeleteOrphan={(path) => actions.pruneOrphan(targetState.target, { path })}
        />
      </ModalShell>
      <ConfirmationDialog
        open={confirmDelete !== null}
        title={`Delete runtime history for ${confirmDelete?.label ?? "this workspace"}?`}
        description="This permanently deletes the AnyHarness runtime workspace record, chats, raw events, normalized events, checkout, and local agent artifacts for this runtime. Git commits, branches, pull requests, and Cloud product records are preserved."
        confirmLabel="Delete"
        confirmVariant="destructive"
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          const pending = confirmDelete;
          if (!pending) {
            return;
          }
          setConfirmDelete(null);
          actions.purgeWorkspace(targetState.target, pending.workspaceId);
        }}
      />
    </>
  );
}
