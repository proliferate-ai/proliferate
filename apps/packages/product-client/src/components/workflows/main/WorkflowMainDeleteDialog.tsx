import { WORKFLOW_MAIN_COPY } from "#product/copy/workflows/workflow-main-copy";
import { Button } from "#product/primitives/Button";
import { NoticeBanner } from "#product/primitives/patterns/NoticeBanner";
import { ModalShell } from "#product/primitives/patterns/ModalShell";

export function WorkflowMainDeleteDialog({
  open,
  title,
  deleting,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  deleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell
      open={open}
      onClose={onCancel}
      disableClose={deleting}
      title={WORKFLOW_MAIN_COPY.deleteConfirmTitle}
      description={WORKFLOW_MAIN_COPY.deleteConfirmDescription(title)}
      sizeClassName="max-w-md"
      bodyClassName={error ? "px-5 pb-3 pt-1" : "px-5 pb-1"}
      footer={(
        <>
          <Button type="button" variant="ghost" size="md" disabled={deleting} onClick={onCancel}>
            {WORKFLOW_MAIN_COPY.deleteCancelLabel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="md"
            loading={deleting}
            onClick={onConfirm}
          >
            {WORKFLOW_MAIN_COPY.deleteConfirmLabel}
          </Button>
        </>
      )}
    >
      {error ? <NoticeBanner tone="destructive">{error}</NoticeBanner> : null}
    </ModalShell>
  );
}
