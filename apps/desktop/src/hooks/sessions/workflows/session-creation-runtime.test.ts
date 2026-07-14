import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopRuntimeBridge } from "@proliferate/product-client/host/desktop-bridge";

import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

const mocks = vi.hoisted(() => ({
  bootstrapHarnessRuntime: vi.fn(),
}));

vi.mock("@/lib/access/anyharness/runtime-bootstrap", () => ({
  bootstrapHarnessRuntime: mocks.bootstrapHarnessRuntime,
}));

import { resolveDesktopRuntimeUrlForWorkspace } from "./session-creation-runtime";

beforeEach(() => {
  vi.clearAllMocks();
  useHarnessConnectionStore.setState({
    runtimeUrl: "",
    connectionState: "connecting",
    error: null,
  });
});

describe("session creation runtime resolution", () => {
  it("uses the injected Desktop runtime for a local workspace", async () => {
    const runtime = {
      getConnection: vi.fn(),
      restart: vi.fn(),
    } satisfies DesktopRuntimeBridge;
    mocks.bootstrapHarnessRuntime.mockImplementation(async () => {
      useHarnessConnectionStore.setState({
        runtimeUrl: "http://runtime.test",
        connectionState: "healthy",
        error: null,
      });
    });

    await expect(
      resolveDesktopRuntimeUrlForWorkspace("workspace-local", runtime),
    ).resolves.toBe("http://runtime.test");
    expect(mocks.bootstrapHarnessRuntime).toHaveBeenCalledWith(runtime);
  });

  it.each(["cloud:cloud-1", "target:target-1:workspace-runtime"])(
    "does not discover a local runtime for %s",
    async (workspaceId) => {
      await expect(
        resolveDesktopRuntimeUrlForWorkspace(workspaceId, null),
      ).resolves.toBe("");
      expect(mocks.bootstrapHarnessRuntime).not.toHaveBeenCalled();
    },
  );
});
