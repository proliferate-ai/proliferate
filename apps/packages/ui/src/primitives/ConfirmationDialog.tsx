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
        <header className="flex flex-col gap-1.5 text-left">
          <div className="text-lg font-semibold leading-none tracking-tight text-foreground">{title}</div>
          {description ? (
            <div className="text-base leading-6 text-muted-foreground">
              {description}
            </div>
          ) : null}
        </header>
      )}
      sizeClassName="max-w-[34rem]"
      headerClassName="shrink-0 px-6 pb-0 pt-6 pr-14"
      bodyClassName="hidden"
      overlayClassName="bg-background/60 backdrop-blur-[2px]"
      panelClassName="!rounded-xl border-border/80 bg-card shadow-floating"
      footerClassName="flex shrink-0 items-center justify-end gap-2 px-6 pb-6 pt-6"
      footer={(
        <>
          <Button
            type="button"
            variant="ghost"
            size="md"
            className="h-9 rounded-lg px-3 text-sm"
            disabled={loading}
            onClick={onClose}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            size="md"
            className="h-9 min-w-0 rounded-lg px-4 text-sm shadow-none"
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
