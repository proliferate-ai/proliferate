import { useEffect, type ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";

interface PaneSideOverlayProps {
  open: boolean;
  label: string;
  widthClassName?: string;
  dataAttribute?: string;
  onClose: () => void;
  children: ReactNode;
}

export function PaneSideOverlay({
  open,
  label,
  widthClassName = "w-[min(340px,calc(100%-1rem))]",
  dataAttribute,
  onClose,
  children,
}: PaneSideOverlayProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  const dataAttributes = dataAttribute
    ? { [`data-${dataAttribute}`]: true }
    : {};

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30"
      data-pane-side-overlay
      {...dataAttributes}
    >
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        aria-label={`Close ${label}`}
        className="pointer-events-auto absolute inset-0 cursor-default bg-transparent"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-label={label}
        className={[
          "pointer-events-auto absolute bottom-2 right-2 top-2 flex min-w-0 flex-col overflow-hidden rounded-lg border border-sidebar-border/80 bg-sidebar-background/95 shadow-floating-dark backdrop-blur",
          widthClassName,
        ].join(" ")}
      >
        {children}
      </section>
    </div>
  );
}
