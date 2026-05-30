import { Button } from "./Button";
import { ModalShell } from "./ModalShell";

interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  confirmVariant?: "primary" | "destructive";
  disableClose?: boolean;
  loading?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  confirmVariant = "primary",
  disableClose = false,
  loading = false,
  onClose,
  onConfirm,
}: ConfirmationDialogProps) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      disableClose={disableClose}
      title={title}
      description={description}
      sizeClassName="max-w-md"
      bodyClassName="hidden"
      overlayClassName="bg-background/60 backdrop-blur-[2px]"
      panelClassName="border-border/70 bg-background/95 shadow-floating"
      footer={(
        <>
          <Button type="button" variant="ghost" size="md" disabled={loading} onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            size="md"
            loading={loading}
            disabled={loading}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      )}
    >
      {null}
    </ModalShell>
  );
}
