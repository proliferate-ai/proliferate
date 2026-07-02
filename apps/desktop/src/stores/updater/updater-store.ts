import { create } from "zustand";

export type UpdaterPhase =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "ready"
  | "error";

/** Which step of the update flow produced the current error phase. */
export type UpdaterErrorSource = "check" | "download";

interface UpdaterState {
  phase: UpdaterPhase;
  availableVersion: string | null;
  lastCheckedAt: string | null;
  errorMessage: string | null;
  errorSource: UpdaterErrorSource | null;
  downloadProgress: number | null;
  restartPromptOpen: boolean;
  restartWhenIdle: boolean;
  // One-shot signal: a user-initiated check completed and found no update. Background
  // checks never set this; the consumer clears it after surfacing the result.
  manualCheckCompletedAt: number | null;
  _updateHandle: unknown | null;

  setPhase: (phase: UpdaterPhase) => void;
  setAvailable: (version: string, handle: unknown) => void;
  setDownloadProgress: (progress: number) => void;
  setReady: () => void;
  setError: (message: string, source: UpdaterErrorSource) => void;
  setChecked: (timestamp: string) => void;
  setManualCheckCompleted: (completedAt: number) => void;
  clearManualCheckCompleted: () => void;
  setRestartPromptOpen: (open: boolean) => void;
  setRestartWhenIdle: (armed: boolean) => void;
  reset: () => void;
}

export const useUpdaterStore = create<UpdaterState>((set) => ({
  phase: "idle",
  availableVersion: null,
  lastCheckedAt: null,
  errorMessage: null,
  errorSource: null,
  downloadProgress: null,
  restartPromptOpen: false,
  restartWhenIdle: false,
  manualCheckCompletedAt: null,
  _updateHandle: null,

  setPhase: (phase) =>
    set({ phase, errorMessage: null, errorSource: null, restartPromptOpen: false }),

  setAvailable: (version, handle) =>
    set({
      phase: "available",
      availableVersion: version,
      _updateHandle: handle,
      errorMessage: null,
      errorSource: null,
      restartPromptOpen: false,
      restartWhenIdle: false,
    }),

  setDownloadProgress: (progress) => set({ downloadProgress: progress }),

  // Download finished; the new version is installed on disk. We do NOT auto-open the
  // restart confirm — the pill + toast prompt, and the confirm opens on explicit click.
  setReady: () => set({ phase: "ready", downloadProgress: null, restartPromptOpen: false }),

  setError: (message, source) =>
    set({
      phase: "error",
      errorMessage: message,
      errorSource: source,
      downloadProgress: null,
      restartPromptOpen: false,
    }),

  setChecked: (timestamp) => set({ lastCheckedAt: timestamp }),

  setManualCheckCompleted: (completedAt) => set({ manualCheckCompletedAt: completedAt }),

  clearManualCheckCompleted: () => set({ manualCheckCompletedAt: null }),

  setRestartPromptOpen: (open) => set({ restartPromptOpen: open }),

  setRestartWhenIdle: (armed) => set({ restartWhenIdle: armed }),

  reset: () =>
    set({
      phase: "idle",
      availableVersion: null,
      errorMessage: null,
      errorSource: null,
      downloadProgress: null,
      restartPromptOpen: false,
      restartWhenIdle: false,
      manualCheckCompletedAt: null,
      _updateHandle: null,
    }),
}));
