import { create } from "zustand";
import { showProductToast } from "#product/components/feedback/product-toast";

export interface Toast {
  id: string;
  message: string;
  type: "error" | "info";
}

interface ToastStore {
  toasts: Toast[];
  show: (message: string, type?: "error" | "info") => void;
  dismiss: (id: string) => void;
}

/**
 * Legacy toast entry point. The zustand shape survives so the ~70 existing
 * `useToastStore((s) => s.show)` call sites keep working, but presentation is
 * delegated to the unified Sonner product toast — nothing renders from this
 * store anymore (`toasts` stays empty; Sonner owns stacking and dismissal).
 */
export const useToastStore = create<ToastStore>(() => ({
  toasts: [],
  show: (message, type = "error") => {
    showProductToast(message, type);
  },
  dismiss: () => {},
}));
