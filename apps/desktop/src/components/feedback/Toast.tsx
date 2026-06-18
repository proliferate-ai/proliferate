import { useEffect, useRef } from "react";
import { useToastStore } from "@/stores/toast/toast-store";
import { Button } from "@proliferate/ui/primitives/Button";
import { X } from "@proliferate/ui/icons";
import { UpdateNotificationCard } from "./UpdateNotificationCard";

type ToastTimer = ReturnType<typeof setTimeout>;

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const timers = useRef<Map<string, ToastTimer>>(new Map());

  useEffect(() => {
    for (const toast of toasts) {
      if (!timers.current.has(toast.id)) {
        timers.current.set(
          toast.id,
          setTimeout(() => {
            dismiss(toast.id);
            timers.current.delete(toast.id);
          }, 5000),
        );
      }
    }
  }, [toasts, dismiss]);

  useEffect(() => {
    return () => {
      for (const timer of timers.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2"
      aria-live="polite"
      aria-atomic="true"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-start gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-card-foreground shadow-floating-dark animate-toast-in"
        >
          <span className="flex-1">{t.message}</span>
          <Button
            type="button"
            variant="unstyled"
            size="unstyled"
            onClick={() => dismiss(t.id)}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
      <UpdateNotificationCard />
    </div>
  );
}
