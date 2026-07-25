// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useLocalAgentLaunchOptions } from "./use-local-agent-launch-options";

const useAgentLaunchOptionsQuery = vi.hoisted(() => vi.fn());
const useRuntimeHealthQuery = vi.hoisted(() => vi.fn());

vi.mock("@anyharness/sdk-react", () => ({
  useAgentLaunchOptionsQuery,
  useRuntimeHealthQuery,
}));

describe("useLocalAgentLaunchOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentLaunchOptionsQuery.mockReturnValue({ data: undefined });
    useRuntimeHealthQuery.mockReturnValue({ data: undefined });
    useHarnessConnectionStore.setState({
      runtimeUrl: "http://127.0.0.1:8457",
      connectionState: "connecting",
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    useHarnessConnectionStore.getState().resetConnectionState();
  });

  it("does not query the fallback URL before Desktop confirms a healthy sidecar", () => {
    const { result } = renderHook(() => useLocalAgentLaunchOptions(true, true));

    expect(result.current.availability).toBe("connecting");
    expect(useAgentLaunchOptionsQuery).toHaveBeenLastCalledWith({ enabled: false });
    expect(useRuntimeHealthQuery).toHaveBeenLastCalledWith({
      enabled: false,
      pollWhileAgentSeedHydrating: true,
    });
  });

  it("enables runtime reads after the active sidecar becomes healthy", () => {
    const { result } = renderHook(() => useLocalAgentLaunchOptions(true, true));

    act(() => {
      useHarnessConnectionStore.setState({
        runtimeUrl: "http://127.0.0.1:51234",
        connectionState: "healthy",
      });
    });

    expect(result.current.availability).toBe("ready");
    expect(useAgentLaunchOptionsQuery).toHaveBeenLastCalledWith({ enabled: true });
    expect(useRuntimeHealthQuery).toHaveBeenLastCalledWith({
      enabled: true,
      pollWhileAgentSeedHydrating: true,
    });
  });

  it("reports failed bootstrap separately from a still-connecting runtime", () => {
    useHarnessConnectionStore.setState({ connectionState: "failed" });

    const { result } = renderHook(() => useLocalAgentLaunchOptions(true, true));

    expect(result.current.availability).toBe("unavailable");
  });
});
