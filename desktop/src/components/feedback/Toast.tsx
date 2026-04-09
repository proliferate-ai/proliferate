import { useEffect, useRef } from "react";
import { useToastStore } from "@/stores/toast/toast-store";
import { X } from "@/components/ui/icons";

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-start gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-card-foreground shadow-floating-dark animate-toast-in"
        >
          <span className="flex-1">{t.message}</span>
          <button
            onClick={() => dismiss(t.id)}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
