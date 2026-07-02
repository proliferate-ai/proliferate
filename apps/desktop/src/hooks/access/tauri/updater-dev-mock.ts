import type { UpdaterErrorSource, UpdaterPhase } from "@/stores/updater/updater-store";

const DEV_UPDATER_MOCK_KEY = "proliferate.dev.updaterMock";
export const DEV_UPDATER_MOCK_EVENT = "proliferate:dev-updater-mock";
const DEV_UPDATER_MOCK_VERSION = "0.1.3";
const DEV_UPDATER_MOCK_ERROR_MESSAGE = "Simulated updater failure";
const DEV_UPDATER_MOCK_DOWNLOAD_DELAYS_MS = [200, 450, 700];
const DEV_UPDATER_MOCK_DOWNLOAD_PROGRESS = [32, 68, 100];

type DevUpdaterMockPhase = Extract<
  UpdaterPhase,
  "current" | "available" | "downloading" | "ready" | "error"
>;

export interface DevUpdaterMockState {
  phase: DevUpdaterMockPhase;
  version: string;
  downloadProgress: number | null;
  restartPromptOpen: boolean;
  restartWhenIdle: boolean;
  lastCheckedAt: string | null;
  errorMessage: string | null;
  errorSource: UpdaterErrorSource | null;
  manualCheckCompletedAt: number | null;
}

let mockDownloadTimeouts: number[] = [];

export function isDevUpdaterMockSupported(): boolean {
  return import.meta.env.DEV && typeof window !== "undefined";
}

let envSeedApplied = false;

// Dev convenience: boot straight into a forced updater phase via
// `VITE_PROLIFERATE_UPDATER_MOCK=current|available|downloading|ready|error` (e.g. when
// running `pdev`), so the real pill / toast / confirm can be exercised without the
// playground. Runs once and never clobbers an existing mock (e.g. one the playground set).
export function seedDevUpdaterMockFromEnv(): void {
  if (!isDevUpdaterMockSupported() || envSeedApplied) {
    return;
  }
  envSeedApplied = true;

  const phase = import.meta.env.VITE_PROLIFERATE_UPDATER_MOCK?.trim();
  if (!isDevUpdaterMockPhase(phase)) {
    return;
  }
  if (window.localStorage.getItem(DEV_UPDATER_MOCK_KEY)) {
    return;
  }
  writeDevUpdaterMock(normalizeDevUpdaterMock(phase));
}

export function readDevUpdaterMock(): DevUpdaterMockState | null {
  if (!isDevUpdaterMockSupported()) {
    return null;
  }

  const raw = window.localStorage.getItem(DEV_UPDATER_MOCK_KEY);
  if (!raw) {
    return null;
  }

  try {
    return normalizeDevUpdaterMock(JSON.parse(raw));
  } catch {
    return normalizeDevUpdaterMock(raw);
  }
}

export function clearDevUpdaterMockDownload(): void {
  if (!isDevUpdaterMockSupported()) {
    return;
  }

  for (const timeoutId of mockDownloadTimeouts) {
    window.clearTimeout(timeoutId);
  }
  mockDownloadTimeouts = [];
}

export function writeDevUpdaterMock(nextState: DevUpdaterMockState | null): void {
  if (!isDevUpdaterMockSupported()) {
    return;
  }

  if (!nextState) {
    window.localStorage.removeItem(DEV_UPDATER_MOCK_KEY);
    emitDevUpdaterMockChange();
    return;
  }

  window.localStorage.setItem(DEV_UPDATER_MOCK_KEY, JSON.stringify(nextState));
  emitDevUpdaterMockChange();
}

export function updateDevUpdaterMock(
  updater: (current: DevUpdaterMockState | null) => DevUpdaterMockState | null,
): void {
  writeDevUpdaterMock(updater(readDevUpdaterMock()));
}

export function startDevUpdaterMockDownload(): void {
  if (!isDevUpdaterMockSupported()) {
    return;
  }

  const current = readDevUpdaterMock();
  if (!current) {
    return;
  }

  clearDevUpdaterMockDownload();
  writeDevUpdaterMock({
    ...current,
    phase: "downloading",
    downloadProgress: 0,
    restartPromptOpen: false,
    restartWhenIdle: false,
    errorMessage: null,
    errorSource: null,
  });

  for (let index = 0; index < DEV_UPDATER_MOCK_DOWNLOAD_PROGRESS.length; index += 1) {
    const timeoutId = window.setTimeout(() => {
      const latest = readDevUpdaterMock();
      if (!latest) {
        return;
      }

      if (index === DEV_UPDATER_MOCK_DOWNLOAD_PROGRESS.length - 1) {
        writeDevUpdaterMock({
          ...latest,
          phase: "ready",
          downloadProgress: null,
          restartPromptOpen: true,
          errorMessage: null,
          errorSource: null,
        });
        clearDevUpdaterMockDownload();
        return;
      }

      writeDevUpdaterMock({
        ...latest,
        phase: "downloading",
        downloadProgress: DEV_UPDATER_MOCK_DOWNLOAD_PROGRESS[index],
        restartPromptOpen: false,
        errorMessage: null,
        errorSource: null,
      });
    }, DEV_UPDATER_MOCK_DOWNLOAD_DELAYS_MS[index]);

    mockDownloadTimeouts.push(timeoutId);
  }
}

function isDevUpdaterMockPhase(value: unknown): value is DevUpdaterMockPhase {
  return (
    value === "current" ||
    value === "available" ||
    value === "downloading" ||
    value === "ready" ||
    value === "error"
  );
}

function isUpdaterErrorSource(value: unknown): value is UpdaterErrorSource {
  return value === "check" || value === "download";
}

function normalizeDevUpdaterMock(raw: unknown): DevUpdaterMockState | null {
  if (typeof raw === "string" && isDevUpdaterMockPhase(raw)) {
    return {
      phase: raw,
      version: DEV_UPDATER_MOCK_VERSION,
      downloadProgress: raw === "downloading" ? 0 : null,
      restartPromptOpen: raw === "ready",
      restartWhenIdle: false,
      lastCheckedAt: null,
      errorMessage: raw === "error" ? DEV_UPDATER_MOCK_ERROR_MESSAGE : null,
      errorSource: raw === "error" ? "check" : null,
      manualCheckCompletedAt: null,
    };
  }

  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Partial<DevUpdaterMockState>;
  if (!isDevUpdaterMockPhase(candidate.phase)) {
    return null;
  }

  return {
    phase: candidate.phase,
    version: candidate.version?.trim() || DEV_UPDATER_MOCK_VERSION,
    downloadProgress:
      candidate.phase === "downloading"
        ? Math.max(0, Math.min(100, candidate.downloadProgress ?? 0))
        : null,
    restartPromptOpen:
      typeof candidate.restartPromptOpen === "boolean"
        ? candidate.restartPromptOpen
        : candidate.phase === "ready",
    // Only a downloaded ("ready") update can have an armed restart.
    restartWhenIdle: candidate.phase === "ready" && candidate.restartWhenIdle === true,
    lastCheckedAt:
      typeof candidate.lastCheckedAt === "string" ? candidate.lastCheckedAt : null,
    errorMessage:
      typeof candidate.errorMessage === "string"
        ? candidate.errorMessage
        : candidate.phase === "error"
          ? DEV_UPDATER_MOCK_ERROR_MESSAGE
          : null,
    errorSource:
      candidate.phase === "error"
        ? isUpdaterErrorSource(candidate.errorSource)
          ? candidate.errorSource
          : "check"
        : null,
    manualCheckCompletedAt:
      typeof candidate.manualCheckCompletedAt === "number"
        ? candidate.manualCheckCompletedAt
        : null,
  };
}

function emitDevUpdaterMockChange(): void {
  if (!isDevUpdaterMockSupported()) {
    return;
  }

  window.dispatchEvent(new Event(DEV_UPDATER_MOCK_EVENT));
}
