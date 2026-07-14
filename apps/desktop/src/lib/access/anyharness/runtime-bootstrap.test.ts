import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopRuntimeBridge } from "@proliferate/product-client/host/desktop-bridge";

const mocks = vi.hoisted(() => ({
  getHealth: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  getAnyHarnessClient: () => ({
    runtime: { getHealth: mocks.getHealth },
  }),
}));

import { DEFAULT_RUNTIME_URL } from "@/config/runtime";
import {
  bootstrapHarnessRuntime,
  restartHarnessRuntime,
} from "@/lib/access/anyharness/runtime-bootstrap";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

function makeRuntime(): DesktopRuntimeBridge {
  return {
    getConnection: vi.fn(),
    restart: vi.fn(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useHarnessConnectionStore.setState({
    runtimeUrl: "",
    connectionState: "connecting",
    error: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("bootstrapHarnessRuntime", () => {
  it("activates an already healthy bridge connection immediately", async () => {
    const runtime = makeRuntime();
    vi.mocked(runtime.getConnection).mockResolvedValue({
      connection: { runtimeUrl: "http://127.0.0.1:9001" },
      status: "healthy",
    });
    mocks.getHealth.mockResolvedValue({ status: "ok" });

    await bootstrapHarnessRuntime(runtime);

    expect(runtime.getConnection).toHaveBeenCalledTimes(1);
    expect(useHarnessConnectionStore.getState()).toMatchObject({
      runtimeUrl: "http://127.0.0.1:9001",
      connectionState: "healthy",
      error: null,
    });
  });

  it("polls through the bridge, adopts a changed url, and becomes healthy", async () => {
    const runtime = makeRuntime();
    vi.mocked(runtime.getConnection)
      .mockResolvedValueOnce({
        connection: { runtimeUrl: "http://127.0.0.1:9001" },
        status: "starting",
      })
      .mockResolvedValueOnce({
        connection: { runtimeUrl: "http://127.0.0.1:9002" },
        status: "healthy",
      });
    mocks.getHealth
      .mockRejectedValueOnce(new Error("starting"))
      .mockResolvedValueOnce({ status: "ok" });

    const bootstrap = bootstrapHarnessRuntime(runtime);
    await vi.advanceTimersByTimeAsync(500);
    await bootstrap;

    expect(runtime.getConnection).toHaveBeenCalledTimes(2);
    expect(useHarnessConnectionStore.getState()).toMatchObject({
      runtimeUrl: "http://127.0.0.1:9002",
      connectionState: "healthy",
      error: null,
    });
  });

  it("fails immediately when the native snapshot reports failure", async () => {
    const runtime = makeRuntime();
    vi.mocked(runtime.getConnection).mockResolvedValue({
      connection: { runtimeUrl: "http://127.0.0.1:9001" },
      status: "failed",
    });
    mocks.getHealth.mockRejectedValue(new Error("unavailable"));

    await bootstrapHarnessRuntime(runtime);

    expect(vi.getTimerCount()).toBe(0);
    expect(useHarnessConnectionStore.getState()).toMatchObject({
      runtimeUrl: "http://127.0.0.1:9001",
      connectionState: "failed",
      error: "Runtime status: failed",
    });
  });

  it("retains the browser-only Desktop fallback when native discovery is unavailable", async () => {
    const runtime = makeRuntime();
    vi.mocked(runtime.getConnection).mockRejectedValue(new Error("Tauri unavailable"));
    mocks.getHealth.mockResolvedValue({ status: "ok" });

    const bootstrap = bootstrapHarnessRuntime(runtime);
    await vi.advanceTimersByTimeAsync(500);
    await bootstrap;

    expect(useHarnessConnectionStore.getState()).toMatchObject({
      runtimeUrl: DEFAULT_RUNTIME_URL,
      connectionState: "healthy",
      error: null,
    });
  });

  it("preserves the bounded timeout failure", async () => {
    const runtime = makeRuntime();
    vi.mocked(runtime.getConnection).mockResolvedValue({
      connection: { runtimeUrl: "http://127.0.0.1:9001" },
      status: "starting",
    });
    mocks.getHealth.mockRejectedValue(new Error("starting"));

    const bootstrap = bootstrapHarnessRuntime(runtime);
    await vi.advanceTimersByTimeAsync(60_000);
    await bootstrap;

    expect(useHarnessConnectionStore.getState()).toMatchObject({
      connectionState: "failed",
      error: "Runtime did not become healthy in time.",
    });
  });

  it("stops polling without publishing new state when its lifecycle is cancelled", async () => {
    const runtime = makeRuntime();
    vi.mocked(runtime.getConnection).mockResolvedValue({
      connection: { runtimeUrl: "http://127.0.0.1:9001" },
      status: "starting",
    });
    mocks.getHealth.mockRejectedValue(new Error("starting"));
    const controller = new AbortController();

    const bootstrap = bootstrapHarnessRuntime(runtime, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await bootstrap;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(runtime.getConnection).toHaveBeenCalledTimes(1);
    expect(useHarnessConnectionStore.getState()).toMatchObject({
      runtimeUrl: "http://127.0.0.1:9001",
      connectionState: "connecting",
      error: null,
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("restartHarnessRuntime", () => {
  it("calls the bridge restart exactly once and reconnects", async () => {
    const runtime = makeRuntime();
    vi.mocked(runtime.restart).mockResolvedValue({
      connection: { runtimeUrl: "http://127.0.0.1:9010" },
      status: "healthy",
    });
    mocks.getHealth.mockResolvedValue({ status: "ok" });

    await restartHarnessRuntime(runtime);

    expect(runtime.restart).toHaveBeenCalledTimes(1);
    expect(runtime.getConnection).not.toHaveBeenCalled();
    expect(useHarnessConnectionStore.getState()).toMatchObject({
      runtimeUrl: "http://127.0.0.1:9010",
      connectionState: "healthy",
      error: null,
    });
  });

  it("publishes a failed state when bridge restart rejects", async () => {
    const runtime = makeRuntime();
    vi.mocked(runtime.restart).mockRejectedValue(new Error("restart failed"));

    await restartHarnessRuntime(runtime);

    expect(runtime.restart).toHaveBeenCalledTimes(1);
    expect(useHarnessConnectionStore.getState()).toMatchObject({
      connectionState: "failed",
      error: "Error: restart failed",
    });
  });
});
