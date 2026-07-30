// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopUpdaterBridge } from "@proliferate/product-client/host/desktop-updater-bridge";

import { useUpdaterStore } from "#product/stores/updater/updater-store";

const runningAgentState = vi.hoisted(() => ({ count: 0 }));

vi.mock("#product/hooks/app/lifecycle/use-running-agent-count", () => ({
  useRunningAgentCount: () => runningAgentState.count,
}));

import {
  RESTART_COUNTDOWN_MS,
  useUpdateRestartWatcher,
} from "./use-update-restart-watcher";

function makeUpdater(supported = true): DesktopUpdaterBridge {
  return {
    isSupported: vi.fn(() => supported),
    getVersion: vi.fn(),
    check: vi.fn(),
    downloadAndInstall: vi.fn(),
    relaunch: vi.fn().mockResolvedValue(undefined),
  };
}

const IDLE_DEBOUNCE_MS = 5_000;

describe("useUpdateRestartWatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    runningAgentState.count = 0;
    useUpdaterStore.getState().reset();
    useUpdaterStore.setState({ phase: "ready", restartWhenIdle: true });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("announces before it relaunches: the idle debounce only starts a countdown", async () => {
    const updater = makeUpdater();
    renderHook(() => useUpdateRestartWatcher(updater));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS);
    });

    // The window must not be able to vanish with no notice, so this step is
    // purely a signal for the countdown toast.
    expect(useUpdaterStore.getState().restartCountdownStartedAt).not.toBeNull();
    expect(updater.relaunch).not.toHaveBeenCalled();
  });

  it("relaunches once the countdown expires uncancelled", async () => {
    const updater = makeUpdater();
    renderHook(() => useUpdateRestartWatcher(updater));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS + RESTART_COUNTDOWN_MS);
    });

    expect(updater.relaunch).toHaveBeenCalledTimes(1);
  });

  it("stands down for good when the user cancels the countdown", async () => {
    const updater = makeUpdater();
    renderHook(() => useUpdateRestartWatcher(updater));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS);
    });
    act(() => {
      useUpdaterStore.getState().cancelRestartCountdown();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESTART_COUNTDOWN_MS * 3);
    });

    // Cancelling disarms as well as clearing the clock: otherwise the very next
    // idle beat would restart the countdown the user just refused.
    expect(useUpdaterStore.getState().restartWhenIdle).toBe(false);
    expect(updater.relaunch).not.toHaveBeenCalled();
  });

  it("waits while work is still running", async () => {
    runningAgentState.count = 1;
    const updater = makeUpdater();
    renderHook(() => useUpdateRestartWatcher(updater));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS + RESTART_COUNTDOWN_MS);
    });

    expect(useUpdaterStore.getState().restartCountdownStartedAt).toBeNull();
    expect(updater.relaunch).not.toHaveBeenCalled();
  });

  it("does not arm restart when the Desktop updater is unsupported", async () => {
    const updater = makeUpdater(false);
    renderHook(() => useUpdateRestartWatcher(updater));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS + RESTART_COUNTDOWN_MS);
    });

    expect(updater.relaunch).not.toHaveBeenCalled();
  });
});
