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
  bodyClassName?: string;
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
  bodyClassName = "px-5 pb-5 pt-4",
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
    (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        onClick={disableClose ? undefined : onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          className={`relative flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-lg ${sizeClassName}`}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={disableClose}
            aria-label="Close"
            className="absolute right-4 top-4 z-10 rounded-md p-1 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 disabled:opacity-30"
          >
            <X className="size-4" />
          </button>

          <div className="shrink-0 px-5 pb-3 pr-10 pt-5">
            <h2 id={titleId} className="text-lg font-medium tracking-tight text-foreground">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-xs text-muted-foreground">
                {description}
              </p>
            )}
          </div>

          <div className={`min-h-0 flex-1 ${bodyClassName}`}>
            {children}
          </div>

          {footer && (
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border/60 px-5 py-3">
              {footer}
            </div>
          )}
        </div>
      </div>
    ),
    document.body,
  );
}
