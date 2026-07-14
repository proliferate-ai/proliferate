import { create } from "zustand";

export type SupportModalKind = "bug" | "feature";

interface SupportModalStore {
  open: boolean;
  kind: SupportModalKind;
  openFeedback: () => void;
  openPrompt: () => void;
  close: () => void;
}

export const useSupportModalStore = create<SupportModalStore>((set) => ({
  open: false,
  kind: "bug",
  openFeedback: () => set({ open: true, kind: "bug" }),
  openPrompt: () => set({ open: true, kind: "feature" }),
  close: () => set({ open: false }),
}));
