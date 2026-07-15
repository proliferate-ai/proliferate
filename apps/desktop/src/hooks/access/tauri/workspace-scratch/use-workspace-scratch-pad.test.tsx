// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopScratchBridge } from "@proliferate/product-client/host/desktop-bridge";

import { useWorkspaceScratchPad } from "./use-workspace-scratch-pad";
import { useWorkspaceScratchPadMutations } from "./use-workspace-scratch-pad-mutations";

const hostState = vi.hoisted(() => ({
  scratch: null as DesktopScratchBridge | null,
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    desktop: hostState.scratch ? { scratch: hostState.scratch } : null,
  }),
}));

function makeScratch(): DesktopScratchBridge {
  return {
    read: vi.fn(),
    write: vi.fn(),
  };
}

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  hostState.scratch = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("workspace scratch access", () => {
  it("does not read and rejects writes when Desktop scratch is absent", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const read = renderHook(() => useWorkspaceScratchPad("workspace-1"), {
      wrapper: wrapper(queryClient),
    });
    const write = renderHook(() => useWorkspaceScratchPadMutations("workspace-1"), {
      wrapper: wrapper(queryClient),
    });

    expect(read.result.current.fetchStatus).toBe("idle");
    await expect(write.result.current.writeScratchPad("note"))
      .rejects.toThrow("only available in Desktop");
  });

  it("reads and writes through the Desktop scratch bridge", async () => {
    const scratch = makeScratch();
    vi.mocked(scratch.read).mockResolvedValue({ content: "note", updatedAtMs: 1 });
    vi.mocked(scratch.write).mockResolvedValue({ updatedAtMs: 2 });
    hostState.scratch = scratch;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const read = renderHook(() => useWorkspaceScratchPad("workspace-1"), {
      wrapper: wrapper(queryClient),
    });
    const write = renderHook(() => useWorkspaceScratchPadMutations("workspace-1"), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => {
      expect(read.result.current.data).toEqual({ content: "note", updatedAtMs: 1 });
    });
    await act(async () => {
      await write.result.current.writeScratchPad("next");
    });

    expect(scratch.read).toHaveBeenCalledWith("workspace-1");
    expect(scratch.write).toHaveBeenCalledWith("workspace-1", "next");
  });
});
