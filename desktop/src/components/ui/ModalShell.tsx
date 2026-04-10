import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "@/components/ui/icons";

export interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  disableClose?: boolean;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  sizeClassName?: string;
}

export function ModalShell({
  open,
  onClose,
  disableClose = false,
  title,
  description,
  footer,
  children,
  sizeClassName = "max-w-md",
}: ModalShellProps) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      if (disableClose) {
        return;
      }
      onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [disableClose, onClose, open]);

  if (!open) {
    return null;
  }

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
        onClick={disableClose ? undefined : onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          className={`relative w-full rounded-xl border border-border bg-background p-6 shadow-lg ${sizeClassName}`}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={disableClose}
            className="absolute top-4 right-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>

          <div className="mb-4 pr-8">
            <h2 id={titleId} className="text-sm font-medium text-foreground">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-xs text-muted-foreground">
                {description}
              </p>
            )}
          </div>

          {children}

          {footer && (
            <div className="mt-4 flex items-center justify-end gap-2">
              {footer}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
