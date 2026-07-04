import { type ReactNode } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../kit/Dialog";
import { X } from "../icons/core";
import { cn } from "../lib/utils";
import { useNativeOverlayRegistration } from "../overlays/overlay-presence";

export interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  disableClose?: boolean;
  title: ReactNode;
  description?: ReactNode;
  headerContent?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  sizeClassName?: string;
  headerClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
  overlayClassName?: string;
  panelClassName?: string;
  showCloseButton?: boolean;
  telemetryBlocked?: boolean;
}

// NOTE: ModalShell is modal (Radix Dialog): it traps focus and disables
// pointer-events on the rest of the body while open. Non-Radix portal UI
// (e.g. FixedPositionLayer consumers) must not be rendered inside it — it
// would render outside the trap and be unreachable.
export function ModalShell({
  open,
  onClose,
  disableClose = false,
  title,
  description,
  headerContent,
  footer,
  children,
  sizeClassName = "max-w-md",
  headerClassName,
  bodyClassName = "px-5 pb-5 pt-4",
  footerClassName = "flex shrink-0 items-center justify-end gap-2 border-t border-border/60 px-5 py-3",
  overlayClassName = "bg-black/70 backdrop-blur-sm",
  panelClassName = "border-border bg-background shadow-lg",
  showCloseButton = true,
  telemetryBlocked = false,
}: ModalShellProps) {
  useNativeOverlayRegistration(open);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !disableClose) {
          onClose();
        }
      }}
    >
      <DialogContent
        overlayClassName={overlayClassName}
        showCloseButton={false}
        data-telemetry-block={telemetryBlocked ? true : undefined}
        {...(description ? {} : { "aria-describedby": undefined })}
        onEscapeKeyDown={(event) => {
          // Always shield desktop-global Escape handlers (parity with the old
          // hand-rolled shell, which preventDefault'ed every Escape while open).
          // Radix's own close path is suppressed by this, so close explicitly.
          event.preventDefault();
          if (!disableClose) {
            onClose();
          }
        }}
        onPointerDownOutside={(event) => {
          if (disableClose) {
            event.preventDefault();
          }
        }}
        className={cn(
          "flex w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl p-0",
          panelClassName,
          sizeClassName,
        )}
      >
        {showCloseButton ? (
          <DialogClose
            disabled={disableClose}
            aria-label="Close"
            className="absolute right-4 top-4 z-10 rounded-md p-1 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 disabled:opacity-30"
          >
            <X className="size-4" />
          </DialogClose>
        ) : null}

        {headerContent ? (
          <>
            <DialogTitle className="sr-only">{title}</DialogTitle>
            {description && (
              <DialogDescription className="sr-only">{description}</DialogDescription>
            )}
            <div className={headerClassName ?? `shrink-0 px-5 py-3 ${showCloseButton ? "pr-12" : ""}`}>
              {headerContent}
            </div>
          </>
        ) : (
          <div className={headerClassName ?? `shrink-0 px-5 pb-3 pt-5 ${showCloseButton ? "pr-10" : ""}`}>
            <DialogTitle className="text-xl font-medium tracking-tight text-foreground">
              {title}
            </DialogTitle>
            {description && (
              <DialogDescription className="mt-1 text-ui text-muted-foreground">
                {description}
              </DialogDescription>
            )}
          </div>
        )}

        <div className={`min-h-0 flex-1 ${bodyClassName}`}>
          {children}
        </div>

        {footer && (
          <div className={footerClassName}>
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
