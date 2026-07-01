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
          if (disableClose) {
            event.preventDefault();
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
            <DialogTitle className="text-lg font-medium leading-7 tracking-tight text-foreground">
              {title}
            </DialogTitle>
            {description && (
              <DialogDescription className="mt-1 text-xs leading-4 text-muted-foreground">
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
