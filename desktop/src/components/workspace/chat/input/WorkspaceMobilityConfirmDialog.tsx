import { Button } from "@/components/ui/Button";
import { ModalShell } from "@/components/ui/ModalShell";
import { mobilityModalCopy, mobilityReconnectCopy } from "@/config/mobility-copy";
import { summarizeNonMigratingState } from "@/lib/domain/workspaces/mobility-warnings";
import type { WorkspaceMobilityConfirmSnapshot } from "@/stores/workspaces/workspace-mobility-ui-store";

export function WorkspaceMobilityConfirmDialog({
  snapshot,
  open,
  isPending,
  onClose,
  onConfirm,
}: {
  snapshot: WorkspaceMobilityConfirmSnapshot | null;
  open: boolean;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  if (!snapshot) {
    return null;
  }

  const copy = mobilityModalCopy(snapshot.direction);
  const canConfirm = snapshot.sourcePreflight.canMove && snapshot.cloudPreflight.canStart;
  const branchName = snapshot.sourcePreflight.branchName ?? snapshot.cloudPreflight.workspace.repo.branch;
  const baseCommitSha = snapshot.sourcePreflight.baseCommitSha?.trim() ?? null;
  const nonMigratingSummary = summarizeNonMigratingState(snapshot.sourcePreflight);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      disableClose={isPending}
      title={copy.title}
      description={copy.body}
      sizeClassName="max-w-md"
      overlayClassName="bg-background/60 backdrop-blur-[2px]"
      panelClassName="border-border/70 bg-background/95 shadow-floating"
      footer={(
        <>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              void onConfirm();
            }}
            disabled={!canConfirm}
            loading={isPending}
          >
            {copy.confirmLabel}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <dl className="space-y-3 text-sm">
          <div className="space-y-1">
            <dt className="text-xs uppercase tracking-[0.08em] text-muted-foreground/70">
              Branch
            </dt>
            <dd className="text-foreground">{branchName}</dd>
          </div>

          <div className="space-y-1">
            <dt className="text-xs uppercase tracking-[0.08em] text-muted-foreground/70">
              Sync basis
            </dt>
            <dd className="text-foreground">
              {baseCommitSha ? `Base commit ${baseCommitSha.slice(0, 8)}` : "Current workspace base"}
            </dd>
          </div>
        </dl>

        {nonMigratingSummary && (
          <p className="text-sm text-muted-foreground">
            {nonMigratingSummary}
          </p>
        )}

        <p className="text-sm text-muted-foreground">
          {mobilityReconnectCopy(snapshot.direction)}
        </p>
      </div>
    </ModalShell>
  );
}
