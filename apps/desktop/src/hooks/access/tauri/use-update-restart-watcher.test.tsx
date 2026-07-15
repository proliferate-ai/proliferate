// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopUpdaterBridge } from "@proliferate/product-client/host/desktop-bridge";

import { useUpdaterStore } from "@/stores/updater/updater-store";

const runningAgentState = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/hooks/app/lifecycle/use-running-agent-count", () => ({
  useRunningAgentCount: () => runningAgentState.count,
}));

import { useUpdateRestartWatcher } from "./use-update-restart-watcher";

function makeUpdater(supported = true): DesktopUpdaterBridge {
  return {
    isSupported: vi.fn(() => supported),
    getVersion: vi.fn(),
    check: vi.fn(),
    downloadAndInstall: vi.fn(),
    relaunch: vi.fn().mockResolvedValue(undefined),
  };
}

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

  it("relaunches a supported Desktop update after the idle debounce", async () => {
    const updater = makeUpdater();
    renderHook(() => useUpdateRestartWatcher(updater));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(updater.relaunch).toHaveBeenCalledTimes(1);
  });

  it("does not arm restart when the Desktop updater is unsupported", async () => {
    const updater = makeUpdater(false);
    renderHook(() => useUpdateRestartWatcher(updater));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(updater.relaunch).not.toHaveBeenCalled();
  });
});
