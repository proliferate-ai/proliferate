// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUpdaterStore } from "@/stores/updater/updater-store";

const updaterMocks = vi.hoisted(() => ({
  check: vi.fn(),
  downloadAndInstall: vi.fn(),
  getVersion: vi.fn(),
  relaunch: vi.fn(),
  isSupported: vi.fn(() => true),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({ desktop: { updater: updaterMocks } }),
}));

vi.mock("@/lib/infra/persistence/preferences-persistence", () => ({
  persistValue: vi.fn(async () => undefined),
  readPersistedValue: vi.fn(async () => null),
}));

vi.mock("@/lib/integrations/telemetry/client", () => ({
  trackProductEvent: vi.fn(),
  captureTelemetryException: vi.fn(),
}));

vi.mock("@/lib/domain/telemetry/failures", () => ({
  classifyTelemetryFailure: vi.fn(() => "unknown"),
}));

import { useUpdater } from "./use-updater";

const AUTO_CHECK_INITIAL_DELAY_MS = 10_000;
const localStorageMock = createLocalStorageMock();

describe("useUpdater", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorageMock,
    });
    window.localStorage.clear();
    useUpdaterStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("raises the one-shot up-to-date signal for a manual check that finds nothing", async () => {
    updaterMocks.check.mockResolvedValue(null);

    const { result } = renderHook(() => useUpdater());
    await act(async () => {
      await result.current.checkNow();
    });

    expect(useUpdaterStore.getState().phase).toBe("current");
    expect(useUpdaterStore.getState().manualCheckCompletedAt).toEqual(expect.any(Number));
    expect(result.current.manualCheckCompletedAt).toEqual(expect.any(Number));

    act(() => {
      result.current.clearManualCheckCompleted();
    });
    expect(useUpdaterStore.getState().manualCheckCompletedAt).toBeNull();
  });

  it("does not raise the up-to-date signal for background checks", async () => {
    updaterMocks.check.mockResolvedValue(null);

    renderHook(() => useUpdater());
    // Let the auto-check scheduler install itself, then fire the initial check.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_CHECK_INITIAL_DELAY_MS);
    });

    expect(updaterMocks.check).toHaveBeenCalledTimes(1);
    expect(useUpdaterStore.getState().phase).toBe("current");
    expect(useUpdaterStore.getState().manualCheckCompletedAt).toBeNull();
  });

  it("does not raise the up-to-date signal when a manual check finds an update", async () => {
    updaterMocks.check.mockResolvedValue({
      version: "0.2.0",
      title: "  Introducing Grok  ",
      handle: {},
    });

    const { result } = renderHook(() => useUpdater());
    await act(async () => {
      await result.current.checkNow();
    });

    expect(useUpdaterStore.getState().phase).toBe("available");
    expect(useUpdaterStore.getState().manualCheckCompletedAt).toBeNull();
    expect(useUpdaterStore.getState().availableTitle).toBe("Introducing Grok");
    expect(result.current.availableTitle).toBe("Introducing Grok");
  });

  it("attributes a failed check to the check step", async () => {
    updaterMocks.check.mockRejectedValue(new Error("release feed unreachable"));

    const { result } = renderHook(() => useUpdater());
    await act(async () => {
      await result.current.checkNow();
    });

    expect(useUpdaterStore.getState().phase).toBe("error");
    expect(useUpdaterStore.getState().errorMessage).toBe("release feed unreachable");
    expect(useUpdaterStore.getState().errorSource).toBe("check");
    expect(result.current.errorSource).toBe("check");
  });

  it("attributes a failed download to the download step", async () => {
    updaterMocks.downloadAndInstall.mockRejectedValue(new Error("disk full"));

    const { result } = renderHook(() => useUpdater());
    act(() => {
      useUpdaterStore.getState().setAvailable({
        version: "0.2.0",
        title: null,
        handle: {},
      });
    });
    await act(async () => {
      await result.current.downloadUpdate();
    });

    expect(useUpdaterStore.getState().phase).toBe("error");
    expect(useUpdaterStore.getState().errorMessage).toBe("disk full");
    expect(useUpdaterStore.getState().errorSource).toBe("download");
    expect(result.current.errorSource).toBe("download");
  });

  it("passes the exact checked update back to the bridge and maps progress", async () => {
    const update = {
      version: "0.2.0",
      title: "Introducing Grok",
      handle: { native: "opaque" },
    };
    let observedProgress: number | null = null;
    updaterMocks.check.mockResolvedValue(update);
    updaterMocks.downloadAndInstall.mockImplementation(async (_update, onProgress) => {
      onProgress?.(0.42);
      observedProgress = useUpdaterStore.getState().downloadProgress;
    });

    const { result } = renderHook(() => useUpdater());
    await act(async () => {
      await result.current.checkNow();
      await result.current.downloadUpdate();
    });

    expect(updaterMocks.downloadAndInstall).toHaveBeenCalledWith(
      update,
      expect.any(Function),
    );
    expect(observedProgress).toBe(42);
    expect(useUpdaterStore.getState().downloadProgress).toBeNull();
    expect(useUpdaterStore.getState().phase).toBe("ready");
  });

  it("exposes the armed restart-when-idle flag", async () => {
    const { result } = renderHook(() => useUpdater());
    expect(result.current.restartWhenIdle).toBe(false);

    act(() => {
      result.current.scheduleRestartWhenIdle();
    });

    expect(result.current.restartWhenIdle).toBe(true);
    expect(useUpdaterStore.getState().restartWhenIdle).toBe(true);
    expect(useUpdaterStore.getState().restartPromptOpen).toBe(false);
  });
});

function createLocalStorageMock(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => {
      entries.delete(key);
    },
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}
