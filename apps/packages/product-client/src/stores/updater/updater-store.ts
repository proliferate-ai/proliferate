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
  /**
   * Bytes frozen past the stall threshold, or a download that advertised no
   * total size and so has no progress bar to watch. Naming it is what turns
   * "Starting download… forever" into a state with copy and a manual retry.
   */
  | "stalled"
  | "ready"
  | "error";

/** Which step of the update flow produced the current error phase. */
export type UpdaterErrorSource = "check" | "download";

/**
 * Who asked. A manual check owes the user an answer either way; a background
 * check that finds nothing must stay silent, because a check the user didn't
 * ask for never speaks.
 */
export type UpdaterCheckOrigin = "manual" | "background";

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
  /** When `downloadReceivedBytes` last advanced — the stall clock's zero. */
  lastProgressAt: number | null;
  /**
   * When the first byte of this download arrived. Two timestamps are needed
   * rather than one because they answer different questions: the first byte
   * anchors the average rate (and so the remaining-time estimate), while the
   * latest byte anchors the silence that defines a stall.
   */
  downloadStartedAt: number | null;
  /** How many times this download has been retried, for the stall copy. */
  downloadRetryCount: number;
  restartPromptOpen: boolean;
  restartWhenIdle: boolean;
  /** Set when the deferred restart's cancellable countdown is running. */
  restartCountdownStartedAt: number | null;
  /** Which kind of check produced the current phase. */
  checkOrigin: UpdaterCheckOrigin | null;
  // One-shot signal: a user-initiated check completed and found no update. Background
  // checks never set this; the consumer clears it after surfacing the result.
  manualCheckCompletedAt: number | null;
  /** Versions the user explicitly skipped; never re-announced. */
  skippedVersions: string[];
  _update: DesktopUpdate | null;

  setPhase: (phase: UpdaterPhase) => void;
  setCheckOrigin: (origin: UpdaterCheckOrigin) => void;
  setAvailable: (
    update: DesktopUpdate,
    title?: string | null,
  ) => void;
  setDownloadProgress: (
    progress: DesktopUpdateDownloadProgress,
    now?: number,
  ) => void;
  setStalled: () => void;
  retryDownload: () => void;
  setReady: () => void;
  setError: (message: string, source: UpdaterErrorSource) => void;
  setChecked: (timestamp: string) => void;
  setManualCheckCompleted: (completedAt: number) => void;
  clearManualCheckCompleted: () => void;
  setRestartPromptOpen: (open: boolean) => void;
  setRestartWhenIdle: (armed: boolean) => void;
  startRestartCountdown: (startedAt: number) => void;
  cancelRestartCountdown: () => void;
  skipVersion: (version: string) => void;
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
  lastProgressAt: null,
  downloadStartedAt: null,
  downloadRetryCount: 0,
  restartPromptOpen: false,
  restartWhenIdle: false,
  restartCountdownStartedAt: null,
  checkOrigin: null,
  manualCheckCompletedAt: null,
  skippedVersions: [],
  _update: null,

  setPhase: (phase) =>
    set({ phase, errorMessage: null, errorSource: null, restartPromptOpen: false }),

  setCheckOrigin: (origin) => set({ checkOrigin: origin }),

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
      lastProgressAt: null,
      downloadStartedAt: null,
      downloadRetryCount: 0,
      restartPromptOpen: false,
      restartWhenIdle: false,
      restartCountdownStartedAt: null,
    }),

  // Any progress event is proof of life: it re-arms the stall clock and, if the
  // download had already been named stalled, un-names it. That recovery is why
  // stalled is a phase rather than a terminal error.
  setDownloadProgress: ({ receivedBytes, totalBytes }, now = Date.now()) =>
    set((state) => ({
      phase: state.phase === "stalled" ? "downloading" : state.phase,
      downloadProgress:
        totalBytes !== null && totalBytes > 0
          ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100))
          : null,
      downloadReceivedBytes: receivedBytes,
      downloadTotalBytes: totalBytes,
      lastProgressAt:
        receivedBytes === state.downloadReceivedBytes ? state.lastProgressAt : now,
      downloadStartedAt: state.downloadStartedAt ?? now,
    })),

  // Bytes went quiet. Progress figures are kept deliberately: "stalled at 38%"
  // is only sayable if the last known percentage survives the transition.
  setStalled: () => set({ phase: "stalled" }),

  retryDownload: () =>
    set((state) => ({
      phase: "downloading",
      downloadRetryCount: state.downloadRetryCount + 1,
      lastProgressAt: Date.now(),
    })),

  // Download finished; the new version is installed on disk. We do NOT auto-open the
  // restart confirm — the pill + toast prompt, and the confirm opens on explicit click.
  setReady: () =>
    set({
      phase: "ready",
      downloadProgress: null,
      downloadReceivedBytes: null,
      downloadTotalBytes: null,
      lastProgressAt: null,
      downloadStartedAt: null,
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
      lastProgressAt: null,
      downloadStartedAt: null,
      restartPromptOpen: false,
    }),

  setChecked: (timestamp) => set({ lastCheckedAt: timestamp }),

  setManualCheckCompleted: (completedAt) => set({ manualCheckCompletedAt: completedAt }),

  clearManualCheckCompleted: () => set({ manualCheckCompletedAt: null }),

  setRestartPromptOpen: (open) => set({ restartPromptOpen: open }),

  setRestartWhenIdle: (armed) =>
    set((state) => ({
      restartWhenIdle: armed,
      // Disarming also stands down a countdown already in flight.
      restartCountdownStartedAt: armed ? state.restartCountdownStartedAt : null,
    })),

  startRestartCountdown: (startedAt) => set({ restartCountdownStartedAt: startedAt }),

  // Cancelling the countdown also disarms the deferred restart: the user just
  // said no, and leaving the arm set would relaunch on the next idle beat.
  cancelRestartCountdown: () =>
    set({ restartCountdownStartedAt: null, restartWhenIdle: false }),

  // Skipping leaves the flow entirely: the available version is cleared along
  // with the phase, because a version still sitting in state is one a later
  // render can reintroduce. The skip list itself deliberately survives `reset`
  // — resetting the flow is not the user changing their mind.
  skipVersion: (version) =>
    set((state) => ({
      phase: "idle",
      availableVersion: null,
      availableTitle: null,
      _update: null,
      skippedVersions: state.skippedVersions.includes(version)
        ? state.skippedVersions
        : [...state.skippedVersions, version],
    })),

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
      lastProgressAt: null,
      downloadStartedAt: null,
      downloadRetryCount: 0,
      restartPromptOpen: false,
      restartWhenIdle: false,
      restartCountdownStartedAt: null,
      checkOrigin: null,
      manualCheckCompletedAt: null,
      _update: null,
    }),
}));
