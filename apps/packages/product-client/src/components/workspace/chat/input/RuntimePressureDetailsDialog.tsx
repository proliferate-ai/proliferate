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
 * The searchable worktrees modal: the same section/row anatomy as the
 * workspace-status card's hover lists (EnvironmentCardSections), hosted in a
 * modal. Opened from the card's Resources row (composer) and from the
 * settings worktree-storage pane.
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
        // Same surface recipe as the composer status card (and its hover
        // lists): popover background + 0.5px ring, compact header — moving
        // between hover card and modal shouldn't change the UI language.
        headerContent={(
          <div className="min-w-0 space-y-0.5">
            <h2 className="text-ui font-medium text-foreground">Worktrees</h2>
            <p className="truncate text-ui-sm text-muted-foreground">
              {targetState.target.label}
            </p>
          </div>
        )}
        sizeClassName="max-w-[420px] max-h-[84vh]"
        panelClassName="border-0 rounded-[1.25rem] bg-popover ring-0 shadow-[0_0_0_0.5px_var(--color-popover-ring),0_3px_7.5px_rgba(0,0,0,0.25),0_0_20px_rgba(0,0,0,0.28)]"
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
