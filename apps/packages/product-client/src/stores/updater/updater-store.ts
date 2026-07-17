import { create } from "zustand";
import type {
  DesktopUpdate,
  DesktopUpdateDownloadProgress,
} from "@proliferate/product-client/host/desktop-updater-bridge";

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
  availableTitle: string | null;
  lastCheckedAt: string | null;
  errorMessage: string | null;
  errorSource: UpdaterErrorSource | null;
  downloadProgress: number | null;
  downloadReceivedBytes: number | null;
  downloadTotalBytes: number | null;
  restartPromptOpen: boolean;
  restartWhenIdle: boolean;
  // One-shot signal: a user-initiated check completed and found no update. Background
  // checks never set this; the consumer clears it after surfacing the result.
  manualCheckCompletedAt: number | null;
  _update: DesktopUpdate | null;

  setPhase: (phase: UpdaterPhase) => void;
  setAvailable: (
    update: DesktopUpdate,
    title?: string | null,
  ) => void;
  setDownloadProgress: (progress: DesktopUpdateDownloadProgress) => void;
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
  availableTitle: null,
  lastCheckedAt: null,
  errorMessage: null,
  errorSource: null,
  downloadProgress: null,
  downloadReceivedBytes: null,
  downloadTotalBytes: null,
  restartPromptOpen: false,
  restartWhenIdle: false,
  manualCheckCompletedAt: null,
  _update: null,

  setPhase: (phase) =>
    set({ phase, errorMessage: null, errorSource: null, restartPromptOpen: false }),

  setAvailable: (update, title = null) =>
    set({
      phase: "available",
      availableVersion: update.version,
      availableTitle: title,
      _update: update,
      errorMessage: null,
      errorSource: null,
      downloadProgress: null,
      downloadReceivedBytes: null,
      downloadTotalBytes: null,
      restartPromptOpen: false,
      restartWhenIdle: false,
    }),

  setDownloadProgress: ({ receivedBytes, totalBytes }) =>
    set({
      downloadProgress:
        totalBytes !== null && totalBytes > 0
          ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100))
          : null,
      downloadReceivedBytes: receivedBytes,
      downloadTotalBytes: totalBytes,
    }),

  // Download finished; the new version is installed on disk. We do NOT auto-open the
  // restart confirm — the pill + toast prompt, and the confirm opens on explicit click.
  setReady: () =>
    set({
      phase: "ready",
      downloadProgress: null,
      downloadReceivedBytes: null,
      downloadTotalBytes: null,
      restartPromptOpen: false,
    }),

  setError: (message, source) =>
    set({
      phase: "error",
      errorMessage: message,
      errorSource: source,
      downloadProgress: null,
      downloadReceivedBytes: null,
      downloadTotalBytes: null,
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
      availableTitle: null,
      errorMessage: null,
      errorSource: null,
      downloadProgress: null,
      downloadReceivedBytes: null,
      downloadTotalBytes: null,
      restartPromptOpen: false,
      restartWhenIdle: false,
      manualCheckCompletedAt: null,
      _update: null,
    }),
}));
