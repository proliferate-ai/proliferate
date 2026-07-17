import { create } from "zustand";
import type { CloudRepositoryIntent } from "#product/lib/domain/workspaces/cloud/cloud-repository-intent";

/**
 * One-shot store for the active Cloud repository intent, mirroring the
 * chat-launch / session intent idiom. The dialog host reads `activeIntent`;
 * `begin` opens the dialog with an intent and `clear` closes it. The intent is
 * a minimal serializable object (see CloudRepositoryIntent) held only in
 * memory: a browser authorization callback resumes it while the app stays
 * open, and a cold restart leaves the store empty so nothing resumes (the
 * settings surfaces are the recovery path).
 */
interface CloudRepositoryIntentState {
  activeIntent: CloudRepositoryIntent | null;
  begin: (intent: CloudRepositoryIntent) => void;
  clear: () => void;
}

export const useCloudRepositoryIntentStore = create<CloudRepositoryIntentState>((set) => ({
  activeIntent: null,
  begin: (intent) => set({ activeIntent: intent }),
  clear: () => set({ activeIntent: null }),
}));
