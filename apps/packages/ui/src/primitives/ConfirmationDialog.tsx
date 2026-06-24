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
      headerContent={(
        <div className="py-1">
          <div className="text-base font-[560] leading-5 text-foreground">{title}</div>
          {description ? (
            <div className="mt-1.5 text-sm leading-5 text-muted-foreground">
              {description}
            </div>
          ) : null}
        </div>
      )}
      sizeClassName="max-w-[26rem]"
      bodyClassName="hidden"
      overlayClassName="bg-background/60 backdrop-blur-[2px]"
      panelClassName="!rounded-xl border-border/70 bg-background/95 shadow-floating"
      footerClassName="flex shrink-0 items-center justify-end gap-2 px-5 pb-5 pt-1"
      footer={(
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="px-3"
            disabled={loading}
            onClick={onClose}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            size="sm"
            className="min-w-28"
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
