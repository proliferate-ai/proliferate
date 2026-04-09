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

let nextId = 0;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  show: (message, type = "error") => {
    const id = String(++nextId);
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
  },
  dismiss: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
