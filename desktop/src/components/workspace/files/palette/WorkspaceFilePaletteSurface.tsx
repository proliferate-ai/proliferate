import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface WorkspaceFilePaletteSurfaceProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function WorkspaceFilePaletteSurface({
  open,
  onClose,
  children,
}: WorkspaceFilePaletteSurfaceProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return createPortal(
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-50"
        onClick={onClose}
      />
      <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center px-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Open file"
          className="pointer-events-auto w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-composer-background text-foreground shadow-sm"
        >
          {children}
        </div>
      </div>
    </>,
    document.body,
  );
}
