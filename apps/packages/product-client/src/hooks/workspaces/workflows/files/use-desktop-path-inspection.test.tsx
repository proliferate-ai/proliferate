// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  DesktopFilesBridge,
  DesktopPathInspection,
} from "@proliferate/product-client/host/desktop-bridge";
import {
  resolveInspectionPathKind,
  resolveInspectionUnavailableCopy,
  useDesktopPathInspection,
} from "#product/hooks/workspaces/workflows/files/use-desktop-path-inspection";

function filesBridge(
  inspectPath: (path: string) => Promise<DesktopPathInspection>,
): DesktopFilesBridge {
  return { inspectPath } as DesktopFilesBridge;
}

describe("useDesktopPathInspection", () => {
  it("shares the pending effect attempt with an imperative inspection", async () => {
    let resolveInspection!: (inspection: DesktopPathInspection) => void;
    const inspectPath = vi.fn(() => new Promise<DesktopPathInspection>((resolve) => {
      resolveInspection = resolve;
    }));
    const files = filesBridge(inspectPath);
    const routeRevision = {};
    const { result } = renderHook(() => useDesktopPathInspection({
      candidatePath: "/tmp/pending.txt",
      files,
      routeRevision,
    }));

    await waitFor(() => expect(inspectPath).toHaveBeenCalledTimes(1));
    expect(result.current.state).toEqual({ status: "pending" });

    const imperative = result.current.ensureInspection("/tmp/pending.txt");
    expect(inspectPath).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveInspection({ kind: "file" });
      await expect(imperative).resolves.toEqual({ kind: "file" });
    });

    expect(result.current.state).toEqual({
      status: "settled",
      inspection: { kind: "file" },
    });
    await expect(result.current.ensureInspection("/tmp/pending.txt"))
      .resolves.toEqual({ kind: "file" });
    expect(inspectPath).toHaveBeenCalledTimes(1);
  });

  it("keeps a rejected attempt terminal for its candidate revision", async () => {
    const inspectPath = vi.fn(async () => {
      throw new Error("transport failed");
    });
    const files = filesBridge(inspectPath);
    const routeRevision = {};
    const { result } = renderHook(() => useDesktopPathInspection({
      candidatePath: "/tmp/rejected.txt",
      files,
      routeRevision,
    }));

    await waitFor(() => expect(result.current.state).toEqual({ status: "rejected" }));
    await expect(result.current.ensureInspection("/tmp/rejected.txt")).resolves.toBeNull();
    expect(inspectPath).toHaveBeenCalledTimes(1);
  });

  it("ignores stale completion after the candidate revision changes", async () => {
    let resolveFirst!: (inspection: DesktopPathInspection) => void;
    const inspectPath = vi.fn()
      .mockImplementationOnce(() => new Promise<DesktopPathInspection>((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce({ kind: "directory" });
    const files = filesBridge(inspectPath);
    const firstRevision = {};
    const secondRevision = {};
    const { result, rerender } = renderHook(
      ({ candidatePath, routeRevision }) => useDesktopPathInspection({
        candidatePath,
        files,
        routeRevision,
      }),
      {
        initialProps: {
          candidatePath: "/tmp/first.txt",
          routeRevision: firstRevision,
        },
      },
    );

    await waitFor(() => expect(inspectPath).toHaveBeenCalledTimes(1));
    const staleAttempt = result.current.ensureInspection("/tmp/first.txt");
    rerender({ candidatePath: "/tmp/second", routeRevision: secondRevision });
    await waitFor(() => expect(result.current.state).toEqual({
      status: "settled",
      inspection: { kind: "directory" },
    }));

    await act(async () => {
      resolveFirst({ kind: "file" });
      await Promise.resolve();
    });
    await expect(staleAttempt).resolves.toBeNull();
    expect(result.current.state).toEqual({
      status: "settled",
      inspection: { kind: "directory" },
    });
    expect(inspectPath).toHaveBeenCalledTimes(2);
  });

  it("ignores completion after unmount for an imperative waiter", async () => {
    let resolveInspection!: (inspection: DesktopPathInspection) => void;
    const inspectPath = vi.fn(() => new Promise<DesktopPathInspection>((resolve) => {
      resolveInspection = resolve;
    }));
    const files = filesBridge(inspectPath);
    const routeRevision = {};
    const { result, unmount } = renderHook(() => useDesktopPathInspection({
      candidatePath: "/tmp/unmounted.txt",
      files,
      routeRevision,
    }));

    await waitFor(() => expect(inspectPath).toHaveBeenCalledTimes(1));
    const imperative = result.current.ensureInspection("/tmp/unmounted.txt");
    unmount();
    resolveInspection({ kind: "file" });

    await expect(imperative).resolves.toBeNull();
    expect(inspectPath).toHaveBeenCalledTimes(1);
  });
});

describe("desktop inspection projections", () => {
  it.each([
    [{ status: "idle" }, null, "Checking whether this path is a file or folder…"],
    [{ status: "pending" }, null, "Checking whether this path is a file or folder…"],
    [{ status: "settled", inspection: { kind: "file" } }, "file", null],
    [{ status: "settled", inspection: { kind: "directory" } }, "directory", null],
    [{ status: "settled", inspection: { kind: "missing" } }, null, "This path was not found."],
    [{ status: "rejected" }, null, "This path is unavailable."],
  ] as const)("projects bounded state %#", (state, pathKind, copy) => {
    expect(resolveInspectionPathKind(state)).toBe(pathKind);
    expect(resolveInspectionUnavailableCopy(state)).toBe(copy);
  });
});
