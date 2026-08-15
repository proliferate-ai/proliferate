import { useRef } from "react";
import { Button } from "#product/primitives/Button";
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
  // The confirm action is the dialog's default button: it takes initial focus,
  // so Enter confirms on open while Tab → Enter still reaches Cancel.
  const confirmRef = useRef<HTMLButtonElement>(null);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      disableClose={disableClose}
      initialFocusRef={confirmRef}
      title={title}
      description={description}
      headerContent={(
        <header className="flex flex-col gap-1.5 text-left">
          <div className="text-heading font-semibold leading-none tracking-tight text-foreground">{title}</div>
          {description ? (
            <div className="text-body text-muted-foreground">
              {description}
            </div>
          ) : null}
        </header>
      )}
      sizeClassName="max-w-[34rem]"
      headerClassName="shrink-0 px-6 pb-0 pt-6 pr-14"
      bodyClassName="hidden"
      overlayClassName="bg-background/60 backdrop-blur-[2px]"
      panelClassName="!rounded-xl border-border/80 bg-card shadow-modal"
      footerClassName="flex shrink-0 items-center justify-end gap-2 px-6 pb-6 pt-6"
      footer={(
        <>
          <Button
            type="button"
            variant="ghost"
            size="md"
            className="h-9 rounded-lg px-3 text-ui"
            disabled={loading}
            onClick={onClose}
          >
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            variant={confirmVariant}
            size="md"
            className="h-9 min-w-0 rounded-lg px-4 text-ui shadow-none"
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
