// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUpdaterStore } from "@/stores/updater/updater-store";

const tauriUpdaterMocks = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  downloadAndInstall: vi.fn(),
  relaunch: vi.fn(),
  isTauriPackaged: vi.fn(() => true),
}));

vi.mock("@/lib/access/tauri/updater", () => tauriUpdaterMocks);

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

describe("useUpdater", () => {
  beforeEach(() => {
    vi.useFakeTimers();
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
    tauriUpdaterMocks.checkForUpdate.mockResolvedValue({ kind: "current" });

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
    tauriUpdaterMocks.checkForUpdate.mockResolvedValue({ kind: "current" });

    renderHook(() => useUpdater());
    // Let the auto-check scheduler install itself, then fire the initial check.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_CHECK_INITIAL_DELAY_MS);
    });

    expect(tauriUpdaterMocks.checkForUpdate).toHaveBeenCalledTimes(1);
    expect(useUpdaterStore.getState().phase).toBe("current");
    expect(useUpdaterStore.getState().manualCheckCompletedAt).toBeNull();
  });

  it("does not raise the up-to-date signal when a manual check finds an update", async () => {
    tauriUpdaterMocks.checkForUpdate.mockResolvedValue({
      kind: "available",
      version: "0.2.0",
      title: "  Introducing Grok  ",
      update: {},
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
    tauriUpdaterMocks.checkForUpdate.mockResolvedValue({
      kind: "error",
      message: "release feed unreachable",
    });

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
    tauriUpdaterMocks.downloadAndInstall.mockRejectedValue(new Error("disk full"));

    const { result } = renderHook(() => useUpdater());
    act(() => {
      useUpdaterStore.getState().setAvailable("0.2.0", {});
    });
    await act(async () => {
      await result.current.downloadUpdate();
    });

    expect(useUpdaterStore.getState().phase).toBe("error");
    expect(useUpdaterStore.getState().errorMessage).toBe("disk full");
    expect(useUpdaterStore.getState().errorSource).toBe("download");
    expect(result.current.errorSource).toBe("download");
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
