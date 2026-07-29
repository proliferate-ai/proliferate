import { create } from "zustand";
import type { ToastErrorInput } from "@proliferate/ui/utils/toast-model";
import {
  showProductErrorToast,
  showProductToast,
} from "#product/components/feedback/product-toast";

export interface Toast {
  id: string;
  message: string;
  type: "error" | "info";
}

interface ToastStore {
  toasts: Toast[];
  show: (message: string, type?: "error" | "info") => void;
  /**
   * Report a failed action. Lives alongside `show` rather than replacing it
   * because the two carry genuinely different arguments: `show` takes a
   * sentence about something that happened, `showError` takes an outcome and,
   * separately, the exception behind it. The separation is what keeps the
   * exception out of the headline.
   */
  showError: (input: ToastErrorInput) => void;
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
  showError: (input) => {
    showProductErrorToast(input);
  },
  dismiss: () => {},
}));
