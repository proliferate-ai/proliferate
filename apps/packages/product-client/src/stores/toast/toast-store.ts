import { create } from "zustand";
import type { ToastErrorInput } from "#product/primitives/utils/toast-model";
import {
  showProductErrorToast,
  showProductToast,
} from "#product/components/feedback/product-toast";

interface ToastStore {
  show: (message: string, type?: "error" | "info") => void;
  /**
   * Report a failed action. Lives alongside `show` rather than replacing it
   * because the two carry genuinely different arguments: `show` takes a
   * sentence about something that happened, `showError` takes an outcome and,
   * separately, the exception behind it. The separation is what keeps the
   * exception out of the headline.
   */
  showError: (input: ToastErrorInput) => void;
}

/**
 * Legacy toast entry point. The zustand shape survives so the ~70 existing
 * `useToastStore((s) => s.show)` call sites keep working, but presentation is
 * delegated to the unified Sonner product toast — nothing renders from this
 * store anymore.
 *
 * Which is why the surface is now only the two raises. A `toasts: []` that is
 * permanently empty and a `dismiss` that does nothing are worse than absent:
 * they read as a working API, so the next person to need dismissal wires up a
 * call that silently fails instead of reaching for `dismissToast`, which is
 * where dismissal actually lives. Neither had a caller.
 */
export const useToastStore = create<ToastStore>(() => ({
  show: (message, type = "error") => {
    showProductToast(message, type);
  },
  showError: (input) => {
    showProductErrorToast(input);
  },
}));
