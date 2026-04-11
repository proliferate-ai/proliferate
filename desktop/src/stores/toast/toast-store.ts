import { create } from "zustand";

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

function createToastId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  show: (message, type = "error") => {
    const id = createToastId();
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
  },
  dismiss: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
