import { create } from "zustand";
import { logRendererEvent } from "@/lib/access/tauri/diagnostics";

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
  openFeedback: () => {
    set({ open: true, kind: "bug" });
    void logRendererEvent({
      source: "support",
      message: "support-report-opened kind=bug",
    }).catch(() => {});
  },
  openPrompt: () => {
    set({ open: true, kind: "feature" });
    void logRendererEvent({
      source: "support",
      message: "support-report-opened kind=feature",
    }).catch(() => {});
  },
  close: () => set({ open: false }),
}));
