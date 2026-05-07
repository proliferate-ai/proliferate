import { create } from "zustand";
import { readPersistedValue } from "@/lib/infra/persistence/preferences-persistence";

export type UpdaterPhase =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "ready"
  | "error";

interface UpdaterState {
  phase: UpdaterPhase;
  availableVersion: string | null;
  lastCheckedAt: string | null;
  errorMessage: string | null;
  downloadProgress: number | null;
  restartPromptOpen: boolean;
  _updateHandle: unknown | null;

  setPhase: (phase: UpdaterPhase) => void;
  setAvailable: (version: string, handle: unknown) => void;
  setDownloadProgress: (progress: number) => void;
  setReady: () => void;
  setError: (message: string) => void;
  setChecked: (timestamp: string) => void;
  setRestartPromptOpen: (open: boolean) => void;
  reset: () => void;
}

export const useUpdaterStore = create<UpdaterState>((set) => ({
  phase: "idle",
  availableVersion: null,
  lastCheckedAt: null,
  errorMessage: null,
  downloadProgress: null,
  restartPromptOpen: false,
  _updateHandle: null,

  setPhase: (phase) => set({ phase, errorMessage: null, restartPromptOpen: false }),

  setAvailable: (version, handle) =>
    set({
      phase: "available",
      availableVersion: version,
      _updateHandle: handle,
      errorMessage: null,
      restartPromptOpen: false,
    }),

  setDownloadProgress: (progress) => set({ downloadProgress: progress }),

  setReady: () => set({ phase: "ready", downloadProgress: null, restartPromptOpen: true }),

  setError: (message) =>
    set({
      phase: "error",
      errorMessage: message,
      downloadProgress: null,
      restartPromptOpen: false,
    }),

  setChecked: (timestamp) => set({ lastCheckedAt: timestamp }),

  setRestartPromptOpen: (open) => set({ restartPromptOpen: open }),

  reset: () =>
    set({
      phase: "idle",
      availableVersion: null,
      errorMessage: null,
      downloadProgress: null,
      restartPromptOpen: false,
      _updateHandle: null,
    }),
}));

export async function loadLastCheckedAt(): Promise<string | null> {
  const metadata = await readPersistedValue<{ lastCheckedAt?: string | null }>("updater_metadata");
  if (metadata?.lastCheckedAt) {
    return metadata.lastCheckedAt;
  }
  return (await readPersistedValue<string>("updater_lastCheckedAt")) ?? null;
}
