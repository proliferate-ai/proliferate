// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DesktopFilesBridge } from "@proliferate/product-client/host/desktop-bridge";
import { useHomeRelativeFileReference } from "#product/hooks/workspaces/workflows/files/use-home-relative-file-reference";

function bridge(getHomeDirectory = vi.fn(async () => "/Users/pablo/")) {
  return { getHomeDirectory } as unknown as DesktopFilesBridge;
}

describe("useHomeRelativeFileReference", () => {
  it("normalizes a valid native home for an authority-gated candidate", async () => {
    const files = bridge();
    const { result } = renderHook(() => useHomeRelativeFileReference({
      files,
      candidatePath: "~/.config/file",
    }));
    await waitFor(() => expect(result.current.homeDirectory).toBe("/Users/pablo"));
    expect(files.getHomeDirectory).toHaveBeenCalledTimes(1);
  });

  it.each(["", "relative", "/bad/../home", "/bad\0home"])(
    "rejects and does not cache invalid native home %s",
    async (nativeHome) => {
      const getHomeDirectory = vi.fn(async () => nativeHome);
      const files = bridge(getHomeDirectory);
      const { result } = renderHook(() => useHomeRelativeFileReference({
        files,
        candidatePath: "~/file",
      }));
      await waitFor(() => expect(result.current.rejected).toBe(true));
      await act(async () => {
        await expect(result.current.resolveHomeDirectory()).resolves.toBeNull();
      });
      expect(getHomeDirectory).toHaveBeenCalledTimes(1);
    },
  );

  it("performs zero lookup when the caller supplies no authority-gated candidate", () => {
    const files = bridge();
    const { result } = renderHook(() => useHomeRelativeFileReference({
      files,
      candidatePath: null,
    }));
    expect(result.current).toMatchObject({ homeDirectory: null, pending: false, rejected: false });
    expect(files.getHomeDirectory).not.toHaveBeenCalled();
  });

  it("drops a stale completion after candidate and bridge change", async () => {
    let resolveOld!: (path: string) => void;
    const oldFiles = bridge(vi.fn(() => new Promise<string>((resolve) => {
      resolveOld = resolve;
    })));
    const newFiles = bridge(vi.fn(async () => "/Users/new"));
    const { result, rerender } = renderHook(
      ({ files, candidatePath }) => useHomeRelativeFileReference({ files, candidatePath }),
      { initialProps: { files: oldFiles, candidatePath: "~/old" as string | null } },
    );
    await waitFor(() => expect(oldFiles.getHomeDirectory).toHaveBeenCalledTimes(1));
    rerender({ files: newFiles, candidatePath: "~/new" });
    await waitFor(() => expect(result.current.homeDirectory).toBe("/Users/new"));
    await act(async () => resolveOld("/Users/old"));
    expect(result.current.homeDirectory).toBe("/Users/new");
  });
});
