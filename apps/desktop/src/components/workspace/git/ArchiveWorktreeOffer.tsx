import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { Button } from "@proliferate/ui/primitives/Button";

interface ArchiveWorktreeOfferProps {
  open: boolean;
  onArchive: () => void;
  onKeep: () => void;
}

/**
 * Non-blocking offer shown after a successful PR merge: "PR merged. Archive
 * this worktree?" with Archive / Keep buttons.
 */
export function ArchiveWorktreeOffer({
  open,
  onArchive,
  onKeep,
}: ArchiveWorktreeOfferProps) {
  return (
    <ModalShell
      open={open}
      onClose={onKeep}
      title="PR merged. Archive this worktree?"
      sizeClassName="max-w-sm"
      bodyClassName="px-5 pb-5 pt-3"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onKeep}>
            Keep
          </Button>
          <Button variant="default" size="sm" onClick={onArchive}>
            Archive
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        The pull request has been merged. You can archive this worktree to clean up,
        or keep it for further work.
      </p>
    </ModalShell>
  );
}
