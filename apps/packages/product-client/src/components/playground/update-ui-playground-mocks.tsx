import { type UpdaterErrorSource } from "#product/hooks/access/tauri/use-updater";
import {
  updateDevUpdaterMock,
  type DevUpdaterMockState,
} from "#product/hooks/access/tauri/updater-dev-mock";

export type ProductionSurfacePreview =
  | "available"
  | "downloading"
  | "stalled"
  | "stalled-no-total"
  | "verifying"
  | "reusing-staged"
  | "ready-reminder"
  | "restart-dialog"
  | "ready-armed"
  | "restart-countdown"
  | "manual-check-current"
  | "check-error"
  | "download-error";

const PREVIEW_VERSION = "0.1.42";
const PREVIEW_TITLE = "Introducing Grok";
const CHECK_ERROR_MESSAGE = "Couldn't reach the update server.";
const DOWNLOAD_ERROR_MESSAGE = "Couldn't finish downloading the update.";
export const PREVIEW_DOWNLOAD_TOTAL_BYTES = 125_000_000;
/** Comfortably past the 8s stall threshold, so the copy reads "12 seconds". */
const PREVIEW_STALL_SILENCE_MS = 12_000;
export const PRODUCTION_SURFACE_PREVIEWS: {
  id: ProductionSurfacePreview;
  label: string;
}[] = [
  { id: "available", label: "Available" },
  { id: "downloading", label: "Downloading" },
  { id: "stalled", label: "Stalled" },
  { id: "stalled-no-total", label: "Stalled (no size)" },
  { id: "verifying", label: "Verifying" },
  { id: "reusing-staged", label: "Reusing staged" },
  { id: "ready-reminder", label: "Ready reminder" },
  { id: "restart-dialog", label: "Restart dialog" },
  { id: "ready-armed", label: "Restart armed" },
  { id: "restart-countdown", label: "Restart countdown" },
  { id: "manual-check-current", label: "Up to date" },
  { id: "check-error", label: "Check failed" },
  { id: "download-error", label: "Download failed" },
];

export function setDevUpdaterMockErrorSource(source: UpdaterErrorSource): void {
  updateDevUpdaterMock((current) =>
    current && current.phase === "error"
      ? {
          ...current,
          errorSource: source,
          errorMessage:
            source === "check" ? CHECK_ERROR_MESSAGE : DOWNLOAD_ERROR_MESSAGE,
        }
      : current,
  );
}

export function buildProductionSurfaceMock(
  preview: ProductionSurfacePreview,
): DevUpdaterMockState {
  const baseState = {
    version: PREVIEW_VERSION,
    title: PREVIEW_TITLE,
    downloadProgress: null,
    downloadReceivedBytes: null,
    downloadTotalBytes: null,
    restartPromptOpen: false,
    restartWhenIdle: false,
    lastCheckedAt: new Date().toISOString(),
    errorMessage: null,
    errorSource: null,
    manualCheckCompletedAt: null,
    lastProgressAt: null,
    downloadRetryCount: 0,
    downloadStartedAt: null,
    restartCountdownStartedAt: null,
  } satisfies Omit<DevUpdaterMockState, "phase">;

  if (preview === "downloading") {
    return {
      ...baseState,
      phase: "downloading",
      downloadProgress: 68,
      downloadReceivedBytes: 85_000_000,
      downloadTotalBytes: PREVIEW_DOWNLOAD_TOTAL_BYTES,
      // 68% in 30s: gives the pill's remaining-time estimate real inputs, which
      // is the only way that label can be reviewed here.
      downloadStartedAt: Date.now() - 30_000,
      lastProgressAt: Date.now(),
    };
  }

  // Bytes frozen at a known percentage, twice retried: the full stall copy.
  if (preview === "stalled") {
    return {
      ...baseState,
      phase: "stalled",
      downloadProgress: 38,
      downloadReceivedBytes: 47_500_000,
      downloadTotalBytes: PREVIEW_DOWNLOAD_TOTAL_BYTES,
      lastProgressAt: Date.now() - PREVIEW_STALL_SILENCE_MS,
      downloadStartedAt: Date.now() - PREVIEW_STALL_SILENCE_MS - 40_000,
      downloadRetryCount: 2,
    };
  }

  // The other stall shape: a server that advertised no total, so there is no
  // percentage to name and no bar to freeze — only the silence.
  if (preview === "stalled-no-total") {
    return {
      ...baseState,
      phase: "stalled",
      downloadTotalBytes: null,
      lastProgressAt: Date.now() - PREVIEW_STALL_SILENCE_MS,
    };
  }

  // All bytes are staged; the native side is recomputing sha256 + re-checking
  // minisign. A full bar with "verifying" copy.
  if (preview === "verifying") {
    return {
      ...baseState,
      phase: "verifying",
      downloadProgress: 100,
      downloadReceivedBytes: PREVIEW_DOWNLOAD_TOTAL_BYTES,
      downloadTotalBytes: PREVIEW_DOWNLOAD_TOTAL_BYTES,
      downloadStartedAt: Date.now() - 45_000,
      lastProgressAt: Date.now(),
    };
  }

  // A verified artifact for this version was already staged (e.g. from a prior
  // session), so there is nothing to download on the way to ready.
  if (preview === "reusing-staged") {
    return {
      ...baseState,
      phase: "reusingStaged",
    };
  }

  if (preview === "ready-reminder") {
    return {
      ...baseState,
      phase: "ready",
    };
  }

  if (preview === "restart-dialog") {
    return {
      ...baseState,
      phase: "ready",
      restartPromptOpen: true,
    };
  }

  if (preview === "ready-armed") {
    return {
      ...baseState,
      phase: "ready",
      restartWhenIdle: true,
    };
  }

  // Armed, sessions have gone idle, clock running: the cancellable warning.
  if (preview === "restart-countdown") {
    return {
      ...baseState,
      phase: "ready",
      restartWhenIdle: true,
      restartCountdownStartedAt: Date.now(),
    };
  }

  if (preview === "manual-check-current") {
    return {
      ...baseState,
      phase: "current",
      manualCheckCompletedAt: Date.now(),
    };
  }

  if (preview === "check-error") {
    return {
      ...baseState,
      phase: "error",
      errorMessage: CHECK_ERROR_MESSAGE,
      errorSource: "check",
    };
  }

  if (preview === "download-error") {
    return {
      ...baseState,
      phase: "error",
      errorMessage: DOWNLOAD_ERROR_MESSAGE,
      errorSource: "download",
    };
  }

  return {
    ...baseState,
    phase: "available",
  };
}
