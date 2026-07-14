// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopRuntimeBridge } from "@proliferate/product-client/host/desktop-bridge";
import type { AuthState } from "@proliferate/product-client/host/product-host";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

const mocks = vi.hoisted(() => ({
  bootstrapHarnessRuntime: vi.fn(),
  logRendererEvent: vi.fn(),
  recordBootDiagnostic: vi.fn(),
  logStartupDebug: vi.fn(),
}));

vi.mock("@/lib/access/anyharness/runtime-bootstrap", () => ({
  bootstrapHarnessRuntime: mocks.bootstrapHarnessRuntime,
}));
vi.mock("@/lib/access/tauri/diagnostics", () => ({
  logRendererEvent: mocks.logRendererEvent,
}));
vi.mock("@/lib/infra/measurement/boot-stall-diagnostics", () => ({
  recordBootDiagnostic: mocks.recordBootDiagnostic,
}));
vi.mock("@/lib/infra/measurement/debug-startup", () => ({
  elapsedStartupMs: () => 10,
  logStartupDebug: mocks.logStartupDebug,
  startStartupTimer: () => 1,
}));

import { useDesktopRuntimeBootstrapLifecycle } from "./use-desktop-runtime-bootstrap-lifecycle";

function makeRuntime(): DesktopRuntimeBridge {
  return {
    getConnection: vi.fn(),
    restart: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bootstrapHarnessRuntime.mockResolvedValue(undefined);
  mocks.logRendererEvent.mockResolvedValue(undefined);
  useHarnessConnectionStore.getState().resetConnectionState();
});

afterEach(cleanup);

describe("useDesktopRuntimeBootstrapLifecycle", () => {
  it("waits for auth loading to finish", async () => {
    const runtime = makeRuntime();
    const { rerender, unmount } = renderHook(
      ({ status }: { status: AuthState["status"] }) =>
        useDesktopRuntimeBootstrapLifecycle(runtime, status),
      { initialProps: { status: "loading" as AuthState["status"] } },
    );

    expect(mocks.bootstrapHarnessRuntime).not.toHaveBeenCalled();

    rerender({ status: "anonymous" });
    await waitFor(() => expect(mocks.bootstrapHarnessRuntime).toHaveBeenCalledTimes(1));
    expect(mocks.bootstrapHarnessRuntime.mock.calls[0]?.[0]).toBe(runtime);
    const signal = mocks.bootstrapHarnessRuntime.mock.calls[0]?.[1] as AbortSignal;
    expect(signal.aborted).toBe(false);

    unmount();
    expect(signal.aborted).toBe(true);
  });

  it("does not duplicate bootstrap when unrelated parent input changes", async () => {
    const runtime = makeRuntime();
    const { rerender } = renderHook(
      ({ runtimeValue, status }: {
        runtimeValue: DesktopRuntimeBridge;
        status: AuthState["status"];
        unrelatedValue: number;
      }) =>
        useDesktopRuntimeBootstrapLifecycle(runtimeValue, status),
      {
        initialProps: {
          runtimeValue: runtime,
          status: "authenticated" as AuthState["status"],
          unrelatedValue: 1,
        },
      },
    );

    await waitFor(() => expect(mocks.bootstrapHarnessRuntime).toHaveBeenCalledTimes(1));
    rerender({
      runtimeValue: runtime,
      status: "authenticated",
      unrelatedValue: 2,
    });

    expect(mocks.bootstrapHarnessRuntime).toHaveBeenCalledTimes(1);
  });

  it("keeps one bootstrap when auth changes between ready states", async () => {
    const runtime = makeRuntime();
    const { rerender } = renderHook(
      ({ status }: { status: AuthState["status"] }) =>
        useDesktopRuntimeBootstrapLifecycle(runtime, status),
      { initialProps: { status: "anonymous" as AuthState["status"] } },
    );

    await waitFor(() => expect(mocks.bootstrapHarnessRuntime).toHaveBeenCalledTimes(1));
    const signal = mocks.bootstrapHarnessRuntime.mock.calls[0]?.[1] as AbortSignal;

    rerender({ status: "authenticated" });
    expect(mocks.bootstrapHarnessRuntime).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(false);

    rerender({ status: "anonymous" });
    expect(mocks.bootstrapHarnessRuntime).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(false);
  });

  it("revokes the published runtime state when its bridge lifecycle ends", async () => {
    const runtime = makeRuntime();
    const { unmount } = renderHook(() =>
      useDesktopRuntimeBootstrapLifecycle(runtime, "authenticated"),
    );
    await waitFor(() => expect(mocks.bootstrapHarnessRuntime).toHaveBeenCalledTimes(1));
    useHarnessConnectionStore.setState({
      runtimeUrl: "http://127.0.0.1:9999",
      connectionState: "healthy",
      error: null,
    });

    unmount();

    expect(useHarnessConnectionStore.getState()).toMatchObject({
      runtimeUrl: "",
      connectionState: "connecting",
      error: null,
    });
  });
});
