import { create } from "zustand";

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
  restartWhenIdle: boolean;
  _updateHandle: unknown | null;

  setPhase: (phase: UpdaterPhase) => void;
  setAvailable: (version: string, handle: unknown) => void;
  setDownloadProgress: (progress: number) => void;
  setReady: () => void;
  setError: (message: string) => void;
  setChecked: (timestamp: string) => void;
  setRestartPromptOpen: (open: boolean) => void;
  setRestartWhenIdle: (armed: boolean) => void;
  reset: () => void;
}

export const useUpdaterStore = create<UpdaterState>((set) => ({
  phase: "idle",
  availableVersion: null,
  lastCheckedAt: null,
  errorMessage: null,
  downloadProgress: null,
  restartPromptOpen: false,
  restartWhenIdle: false,
  _updateHandle: null,

  setPhase: (phase) => set({ phase, errorMessage: null, restartPromptOpen: false }),

  setAvailable: (version, handle) =>
    set({
      phase: "available",
      availableVersion: version,
      _updateHandle: handle,
      errorMessage: null,
      restartPromptOpen: false,
      restartWhenIdle: false,
    }),

  setDownloadProgress: (progress) => set({ downloadProgress: progress }),

  // Download finished; the new version is installed on disk. We do NOT auto-open the
  // restart confirm — the pill + toast prompt, and the confirm opens on explicit click.
  setReady: () => set({ phase: "ready", downloadProgress: null, restartPromptOpen: false }),

  setError: (message) =>
    set({
      phase: "error",
      errorMessage: message,
      downloadProgress: null,
      restartPromptOpen: false,
    }),

  setChecked: (timestamp) => set({ lastCheckedAt: timestamp }),

  setRestartPromptOpen: (open) => set({ restartPromptOpen: open }),

  setRestartWhenIdle: (armed) => set({ restartWhenIdle: armed }),

  reset: () =>
    set({
      phase: "idle",
      availableVersion: null,
      errorMessage: null,
      downloadProgress: null,
      restartPromptOpen: false,
      restartWhenIdle: false,
      _updateHandle: null,
    }),
}));
