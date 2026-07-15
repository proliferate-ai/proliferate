// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const downloadsMocks = vi.hoisted(() => ({
  fetchDesktopReleaseManifest: vi.fn(),
}));

vi.mock("@/lib/access/downloads/desktop-release-manifest", () => downloadsMocks);

import { useDesktopReleaseManifest } from "./use-desktop-release-manifest";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe("useDesktopReleaseManifest", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns a normalized title for an exact version match", async () => {
    downloadsMocks.fetchDesktopReleaseManifest.mockResolvedValue({
      version: "0.3.25",
      notes: "  Introducing Grok  ",
    });

    const { result } = renderHook(
      () => useDesktopReleaseManifest(" 0.3.25 "),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(downloadsMocks.fetchDesktopReleaseManifest).toHaveBeenCalledWith("0.3.25");
    expect(result.current.data).toEqual({
      version: "0.3.25",
      title: "Introducing Grok",
    });
  });

  it("rejects a response for another version", async () => {
    downloadsMocks.fetchDesktopReleaseManifest.mockResolvedValue({
      version: "0.3.26",
      notes: "Introducing Grok",
    });

    const { result } = renderHook(
      () => useDesktopReleaseManifest("0.3.25"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("keeps a no-title manifest successful and disables an invalid request", async () => {
    downloadsMocks.fetchDesktopReleaseManifest.mockResolvedValue({ version: "0.3.25" });
    const valid = renderHook(
      () => useDesktopReleaseManifest("0.3.25"),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(valid.result.current.isSuccess).toBe(true));
    expect(valid.result.current.data).toEqual({ version: "0.3.25", title: null });

    downloadsMocks.fetchDesktopReleaseManifest.mockClear();
    const invalid = renderHook(
      () => useDesktopReleaseManifest("  "),
      { wrapper: createWrapper() },
    );
    expect(invalid.result.current.fetchStatus).toBe("idle");
    expect(downloadsMocks.fetchDesktopReleaseManifest).not.toHaveBeenCalled();
  });
});
