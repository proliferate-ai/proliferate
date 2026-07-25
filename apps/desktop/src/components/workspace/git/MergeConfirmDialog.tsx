import { useCallback, useState } from "react";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { Button } from "@proliferate/ui/primitives/Button";
import { useMergePullRequestMutation } from "@anyharness/sdk-react";
import { useToastStore } from "@/stores/toast/toast-store";

interface MergeConfirmDialogProps {
  open: boolean;
  workspaceId: string | null;
  repoRootId?: string | null;
  prNumber: number | null;
  prChecksFailing: boolean;
  onClose: () => void;
  onMerged: () => void;
}

export function MergeConfirmDialog({
  open,
  workspaceId,
  repoRootId,
  prNumber,
  prChecksFailing,
  onClose,
  onMerged,
}: MergeConfirmDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const mergeMutation = useMergePullRequestMutation({ workspaceId, repoRootId });
  const showToast = useToastStore((state) => state.show);

  const handleMerge = useCallback(async () => {
    if (isSubmitting || prNumber == null) return;
    setIsSubmitting(true);
    try {
      await mergeMutation.mutateAsync({ method: "squash", prNumber });
      showToast(`PR #${prNumber} merged.`, "info");
      onClose();
      onMerged();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, mergeMutation, prNumber, showToast, onClose, onMerged]);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={`Squash and merge PR #${prNumber ?? ""}?`}
      sizeClassName="max-w-sm"
      bodyClassName="px-5 pb-5 pt-3"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleMerge}
            loading={isSubmitting}
          >
            Merge
          </Button>
        </>
      }
    >
      {prChecksFailing && (
        <p className="text-sm text-destructive">
          Checks are failing on this PR. Merging anyway may introduce issues.
        </p>
      )}
      {!prChecksFailing && (
        <p className="text-sm text-muted-foreground">
          This will squash and merge the pull request into the base branch.
        </p>
      )}
    </ModalShell>
  );
}
