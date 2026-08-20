// @vitest-environment jsdom

import { AnyHarnessError } from "@anyharness/sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFileReferenceActions } from "#product/hooks/workspaces/workflows/files/use-file-reference-actions";
import { fileViewerTarget, viewerTargetKey } from "#product/lib/domain/workspaces/viewer/viewer-target";

const pathMocks = vi.hoisted(() => ({
  value: {
    materializedWorkspaceId: "workspace-1" as string | null,
    filesystemOrigin: { status: "settled" as const, origin: "desktop-local" as const },
    workspaceRoot: { status: "settled" as const, path: "/repo" as string | null },
  },
}));

const selectionMocks = vi.hoisted(() => ({
  selectedWorkspaceId: "workspace-1",
  selectedLogicalWorkspaceId: "workspace-1",
}));

const statMocks = vi.hoisted(() => ({
  calls: vi.fn(),
  data: { kind: "file" as "file" | "directory" | "symlink" },
  error: null as unknown,
  isPending: false,
  isFetching: false,
}));

const fuzzyMocks = vi.hoisted(() => ({
  resolve: vi.fn(async () => ({ status: "no-match" as const })),
}));

const lookupMocks = vi.hoisted(() => ({
  statFile: vi.fn(async ({ path }: { path: string }) => ({ path, kind: "file" as const })),
}));

const editorMocks = vi.hoisted(() => ({
  kinds: vi.fn(),
  openInDefaultEditor: vi.fn(async () => true),
  targets: [{ id: "cursor", label: "Cursor", kind: "editor" as const }],
}));

const viewerMocks = vi.hoisted(() => ({
  openTarget: vi.fn(),
  activateViewerTarget: vi.fn(),
  requestViewerLocation: vi.fn(),
}));

const bridgeMocks = vi.hoisted(() => ({
  desktopAvailable: true,
  writeText: vi.fn(async () => undefined),
  getHomeDirectory: vi.fn(async () => "/Users/pablo"),
  inspectPath: vi.fn(async () => ({ kind: "file" as const })),
  openTarget: vi.fn(async () => undefined),
  reveal: vi.fn(async () => undefined),
  files: null as unknown as Record<string, unknown>,
}));

vi.mock("#product/providers/WorkspacePathProvider", () => ({
  useWorkspacePath: () => pathMocks.value,
}));

vi.mock("@anyharness/sdk-react", () => ({
  useStatWorkspaceFileQuery: (input: unknown) => {
    statMocks.calls(input);
    return {
      data: statMocks.data,
      error: statMocks.error,
      isPending: statMocks.isPending,
      isFetching: statMocks.isFetching,
    };
  },
}));

vi.mock("#product/hooks/access/anyharness/files/use-workspace-file-lookup", () => ({
  useWorkspaceFileLookup: () => ({ statFile: lookupMocks.statFile }),
}));

vi.mock("#product/hooks/workspaces/workflows/files/use-fuzzy-file-resolver", () => ({
  useFuzzyFileResolver: () => fuzzyMocks.resolve,
}));

vi.mock("#product/hooks/editor/workflows/use-open-in-default-editor", () => ({
  useOpenInDefaultEditor: (kind: "file" | "directory" | null) => {
    editorMocks.kinds(kind);
    return {
      defaultTarget: kind ? editorMocks.targets[0] : null,
      openInDefaultEditor: editorMocks.openInDefaultEditor,
      targets: kind ? editorMocks.targets : [],
    };
  },
}));

vi.mock("#product/hooks/workspaces/workflows/tabs/use-workspace-shell-activation", () => ({
  useWorkspaceShellActivation: () => ({
    activateViewerTarget: viewerMocks.activateViewerTarget,
  }),
}));

vi.mock("#product/stores/editor/workspace-viewer-tabs-store", () => ({
  useWorkspaceViewerTabsStore: (
    selector: (state: {
      openTarget: typeof viewerMocks.openTarget;
      requestViewerLocation: typeof viewerMocks.requestViewerLocation;
    }) => unknown,
  ) => selector({
    openTarget: viewerMocks.openTarget,
    requestViewerLocation: viewerMocks.requestViewerLocation,
  }),
}));

vi.mock("#product/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (
    selector: (state: {
      selectedWorkspaceId: string;
      selectedLogicalWorkspaceId: string;
    }) => unknown,
  ) => selector(selectionMocks),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    clipboard: { writeText: bridgeMocks.writeText },
    desktop: bridgeMocks.desktopAvailable ? { files: bridgeMocks.files } : null,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  pathMocks.value = {
    materializedWorkspaceId: "workspace-1",
    filesystemOrigin: { status: "settled", origin: "desktop-local" },
    workspaceRoot: { status: "settled", path: "/repo" },
  };
  selectionMocks.selectedWorkspaceId = "workspace-1";
  selectionMocks.selectedLogicalWorkspaceId = "workspace-1";
  statMocks.data = { kind: "file" };
  statMocks.error = null;
  statMocks.isPending = false;
  statMocks.isFetching = false;
  fuzzyMocks.resolve.mockResolvedValue({ status: "no-match" });
  lookupMocks.statFile.mockImplementation(async ({ path }) => ({ path, kind: "file" }));
  editorMocks.openInDefaultEditor.mockResolvedValue(true);
  bridgeMocks.desktopAvailable = true;
  bridgeMocks.getHomeDirectory.mockResolvedValue("/Users/pablo");
  bridgeMocks.inspectPath.mockResolvedValue({ kind: "file" });
  bridgeMocks.files = {
    getHomeDirectory: bridgeMocks.getHomeDirectory,
    inspectPath: bridgeMocks.inspectPath,
    openTarget: bridgeMocks.openTarget,
    reveal: bridgeMocks.reveal,
  };
});

describe("useFileReferenceActions", () => {
  it.each([
    ["src/App.tsx", "src/App.tsx"],
    ["/repo/src/App.tsx", "src/App.tsx"],
  ])("stats and opens workspace file %s only in the viewer", async (rawPath, expectedPath) => {
    const { result } = renderHook(() => useFileReferenceActions({ rawPath }));

    await expect(result.current.openPrimary()).resolves.toBe("open-viewer");

    expect(statMocks.calls).toHaveBeenLastCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      path: expectedPath,
      enabled: true,
    }));
    expect(viewerMocks.openTarget).toHaveBeenCalledWith({ kind: "file", path: expectedPath });
    expect(bridgeMocks.inspectPath).not.toHaveBeenCalled();
    expect(bridgeMocks.openTarget).not.toHaveBeenCalled();
    expect(bridgeMocks.reveal).not.toHaveBeenCalled();
  });

  it("stats root as an empty workspace path and exposes reveal only as a secondary action", async () => {
    statMocks.data = { kind: "directory" };
    const { result } = renderHook(() => useFileReferenceActions({
      rawPath: ".",
      workspacePath: ".",
    }));

    expect(statMocks.calls).toHaveBeenLastCalledWith(expect.objectContaining({ path: "" }));
    expect(result.current.reference.locator).toEqual({
      authority: "workspace",
      workspacePath: "",
      localCompanionPath: "/repo",
    });
    expect(result.current.canOpenPrimary).toBe(false);
    expect(result.current.canOpenExternal).toBe(false);
    expect(result.current.canReveal).toBe(true);
    expect(result.current.openTargets).toEqual([]);
    expect(editorMocks.kinds).toHaveBeenLastCalledWith(null);
    await expect(result.current.openPrimary()).resolves.toBe("unavailable");
    await expect(result.current.openDefault()).resolves.toBe(false);
    await result.current.openWithTarget("cursor");
    await result.current.reveal();
    expect(bridgeMocks.reveal).toHaveBeenCalledWith("/repo");
    expect(editorMocks.openInDefaultEditor).not.toHaveBeenCalled();
    expect(bridgeMocks.openTarget).not.toHaveBeenCalled();
    expect(viewerMocks.openTarget).not.toHaveBeenCalled();
  });

  it("allows explicit header-owned workspace root target discovery", () => {
    statMocks.data = { kind: "directory" };
    const { result } = renderHook(() => useFileReferenceActions({
      rawPath: ".",
      workspacePath: ".",
      nativeCapabilityKind: "directory",
    }));

    expect(result.current.canOpenExternal).toBe(true);
    expect(result.current.canReveal).toBe(true);
    expect(result.current.openTargets).toEqual(editorMocks.targets);
    expect(editorMocks.kinds).toHaveBeenLastCalledWith("directory");
  });

  it("opens a remote workspace file while forbidding every native operation", async () => {
    pathMocks.value = {
      ...pathMocks.value,
      filesystemOrigin: { status: "settled", origin: "remote" },
    };
    const { result } = renderHook(() => useFileReferenceActions({ rawPath: "README.md" }));

    expect(result.current.nativePathKind).toBeNull();
    await expect(result.current.openPrimary()).resolves.toBe("open-viewer");
    await result.current.openDefault();
    await result.current.openWithTarget("cursor");
    await result.current.reveal();
    expect(viewerMocks.openTarget).toHaveBeenCalledOnce();
    expect(bridgeMocks.getHomeDirectory).not.toHaveBeenCalled();
    expect(bridgeMocks.inspectPath).not.toHaveBeenCalled();
    expect(bridgeMocks.openTarget).not.toHaveBeenCalled();
    expect(bridgeMocks.reveal).not.toHaveBeenCalled();
  });

  it.each([
    ["remote", { status: "settled", origin: "remote" }],
    ["pending", { status: "pending", origin: null }],
    ["rejected", { status: "rejected", origin: null }],
  ] as const)("rejects an outside absolute path with %s origin before native access", async (_label, origin) => {
    pathMocks.value = { ...pathMocks.value, filesystemOrigin: origin };
    const { result } = renderHook(() => useFileReferenceActions({ rawPath: "/tmp/outside" }));

    expect(result.current.accessState.status).toBe("unavailable");
    expect(statMocks.calls).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
    expect(bridgeMocks.inspectPath).not.toHaveBeenCalled();
    expect(editorMocks.kinds).toHaveBeenLastCalledWith(null);
  });

  it.each(["file:///tmp/a", "//server/a", "\\\\server\\a", "#fragment", "C:/a", "~user/a", "a/../b"])(
    "keeps rejected syntax %s inert",
    async (rawPath) => {
      const { result } = renderHook(() => useFileReferenceActions({ rawPath }));
      expect(result.current.canOpenPrimary).toBe(false);
      await result.current.openPrimary();
      expect(statMocks.calls).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
      expect(fuzzyMocks.resolve).not.toHaveBeenCalled();
      expect(bridgeMocks.getHomeDirectory).not.toHaveBeenCalled();
      expect(bridgeMocks.inspectPath).not.toHaveBeenCalled();
      expect(bridgeMocks.openTarget).not.toHaveBeenCalled();
      expect(bridgeMocks.reveal).not.toHaveBeenCalled();
    },
  );

  it.each(["", "   "])("keeps supplied structured value %j authoritative and inert", async (workspacePath) => {
    const { result } = renderHook(() => useFileReferenceActions({
      rawPath: "src/visible.ts",
      workspacePath,
    }));
    expect(result.current.reference.displayPath).toBe("src/visible.ts");
    expect(result.current.reference.locator).toEqual({ authority: "unavailable", reason: "invalid" });
    expect(statMocks.calls).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
    expect(bridgeMocks.getHomeDirectory).not.toHaveBeenCalled();
    expect(bridgeMocks.inspectPath).not.toHaveBeenCalled();
  });

  it("inspects and opens an authority-proven Desktop file", async () => {
    const { result } = renderHook(() => useFileReferenceActions({ rawPath: "/tmp/outside.txt" }));
    await waitFor(() => expect(result.current.accessState.status).toBe("settled"));

    expect(result.current.nativePathKind).toBe("file");
    await expect(result.current.openPrimary()).resolves.toBe("open-external");
    await result.current.openWithTarget("cursor");
    await result.current.openWithTarget("removed-target");

    expect(bridgeMocks.inspectPath).toHaveBeenCalledWith("/tmp/outside.txt");
    expect(editorMocks.openInDefaultEditor).toHaveBeenCalledWith("/tmp/outside.txt", "file");
    expect(bridgeMocks.openTarget).toHaveBeenCalledTimes(1);
    expect(bridgeMocks.openTarget).toHaveBeenCalledWith("cursor", "/tmp/outside.txt");
  });

  it("uses reveal as the Desktop directory primary action", async () => {
    bridgeMocks.inspectPath.mockResolvedValue({ kind: "directory" });
    const { result } = renderHook(() => useFileReferenceActions({ rawPath: "/tmp/folder" }));
    await waitFor(() => expect(result.current.nativePathKind).toBe("directory"));

    expect(result.current.canOpenExternal).toBe(true);
    expect(result.current.openTargets).toEqual(editorMocks.targets);
    await expect(result.current.openPrimary()).resolves.toBe("reveal");
    await result.current.openWithTarget("cursor");
    expect(bridgeMocks.reveal).toHaveBeenCalledWith("/tmp/folder");
    expect(bridgeMocks.openTarget).toHaveBeenCalledWith("cursor", "/tmp/folder");
    expect(editorMocks.openInDefaultEditor).not.toHaveBeenCalled();
  });

  it("expands a gated home reference and rejects an invalid native home without inspection", async () => {
    const { result, rerender } = renderHook(
      ({ rawPath }) => useFileReferenceActions({ rawPath }),
      { initialProps: { rawPath: "~/notes/file.md" } },
    );
    await waitFor(() => expect(result.current.nativePathKind).toBe("file"));
    expect(bridgeMocks.inspectPath).toHaveBeenCalledWith("/Users/pablo/notes/file.md");

    bridgeMocks.files = {
      ...bridgeMocks.files,
      getHomeDirectory: vi.fn(async () => "relative-home"),
    };
    rerender({ rawPath: "~/other.md" });
    await waitFor(() => expect(result.current.pathKindPending).toBe(false));
    expect(result.current.reference.locator).toEqual({
      authority: "unavailable",
      reason: "home_unavailable",
    });
    expect(bridgeMocks.inspectPath).toHaveBeenCalledTimes(1);
  });

  it("offers one bounded recovery only for an exact typed missing error", async () => {
    statMocks.data = undefined as never;
    statMocks.error = problem("FILE_NOT_FOUND", 404);
    fuzzyMocks.resolve.mockResolvedValue({
      status: "match",
      workspacePath: "Apps/Web/SRC/App.tsx",
    });
    const { result } = renderHook(() => useFileReferenceActions({ rawPath: "src/App.tsx" }));

    expect(result.current.accessState.status).toBe("exact-missing");
    await act(async () => {
      await expect(result.current.openPrimary()).resolves.toBe("open-viewer");
    });
    await waitFor(() => expect(result.current.accessState.status).toBe("settled"));
    await expect(result.current.openPrimary()).resolves.toBe("open-viewer");

    expect(fuzzyMocks.resolve).toHaveBeenCalledTimes(1);
    expect(lookupMocks.statFile).toHaveBeenCalledTimes(1);
    expect(lookupMocks.statFile).toHaveBeenCalledWith({
      materializedWorkspaceId: "workspace-1",
      path: "Apps/Web/SRC/App.tsx",
    });
    expect(viewerMocks.openTarget).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ status: "no-match" }, "not_found"],
    [{ status: "ambiguous" }, "ambiguous_match"],
    [{ status: "search-error" }, "runtime_unavailable"],
  ] as const)("makes %s recovery terminal and non-repeatable", async (outcome, reason) => {
    statMocks.data = undefined as never;
    statMocks.error = problem("FILE_NOT_FOUND", 404);
    fuzzyMocks.resolve.mockResolvedValue(outcome);
    const { result } = renderHook(() => useFileReferenceActions({ rawPath: "missing.ts" }));

    await act(async () => {
      await expect(result.current.openPrimary()).resolves.toBe("unavailable");
    });
    await waitFor(() => expect(result.current.accessState).toEqual({ status: "unavailable", reason }));
    await expect(result.current.openPrimary()).resolves.toBe("unavailable");
    expect(fuzzyMocks.resolve).toHaveBeenCalledTimes(1);
    expect(lookupMocks.statFile).not.toHaveBeenCalled();
  });

  it("does not recover a missing lookalike or any stable nonmissing runtime refusal", () => {
    for (const error of [
      Object.assign(new Error("missing"), { problem: { code: "FILE_NOT_FOUND" } }),
      problem("PATH_OUTSIDE_WORKSPACE", 400),
      problem("INVALID_FILE_PATH", 400),
      problem("FILE_PERMISSION_DENIED", 403),
      problem("NOT_A_DIRECTORY", 400),
      problem("UNEXPECTED", 500),
    ]) {
      statMocks.data = undefined as never;
      statMocks.error = error;
      const { result, unmount } = renderHook(() => useFileReferenceActions({ rawPath: "missing.ts" }));
      expect(result.current.accessState.status).toBe("unavailable");
      expect(result.current.canOpenPrimary).toBe(false);
      unmount();
    }
    expect(fuzzyMocks.resolve).not.toHaveBeenCalled();
  });

  it.each([
    ["directory", { kind: "directory" }, "unsupported_type"],
    ["refusal", problem("FILE_PERMISSION_DENIED", 403), "permission_denied"],
    ["transport", new Error("offline"), "runtime_unavailable"],
  ] as const)("makes a corrected %s terminal", async (_label, corrected, reason) => {
    statMocks.data = undefined as never;
    statMocks.error = problem("FILE_NOT_FOUND", 404);
    fuzzyMocks.resolve.mockResolvedValue({ status: "match", workspacePath: "actual.ts" });
    if (corrected instanceof Error) lookupMocks.statFile.mockRejectedValue(corrected);
    else lookupMocks.statFile.mockResolvedValue({ path: "actual.ts", ...corrected });
    const { result } = renderHook(() => useFileReferenceActions({ rawPath: "missing.ts" }));

    await act(async () => void await result.current.openPrimary());
    await waitFor(() => expect(result.current.accessState).toEqual({ status: "unavailable", reason }));
    await result.current.openPrimary();
    expect(fuzzyMocks.resolve).toHaveBeenCalledTimes(1);
    expect(lookupMocks.statFile).toHaveBeenCalledTimes(1);
    expect(viewerMocks.openTarget).not.toHaveBeenCalled();
  });

  it("resets consumed recovery when locator identity changes", async () => {
    statMocks.data = undefined as never;
    statMocks.error = problem("FILE_NOT_FOUND", 404);
    const { result, rerender } = renderHook(
      ({ rawPath }) => useFileReferenceActions({ rawPath }),
      { initialProps: { rawPath: "one.ts" } },
    );
    await consumeMissingRecovery(result);
    await result.current.openPrimary();
    expect(fuzzyMocks.resolve).toHaveBeenCalledTimes(1);

    rerender({ rawPath: "two.ts" });
    expect(result.current.accessState.status).toBe("exact-missing");
    await act(async () => void await result.current.openPrimary());
    expect(fuzzyMocks.resolve).toHaveBeenCalledTimes(2);
  });

  it("resets consumed recovery when the materialized workspace changes", async () => {
    statMocks.data = undefined as never;
    statMocks.error = problem("FILE_NOT_FOUND", 404);
    const { result, rerender } = renderHook(() => (
      useFileReferenceActions({ rawPath: "missing.ts" })
    ));
    await consumeMissingRecovery(result);

    selectionMocks.selectedWorkspaceId = "workspace-2";
    selectionMocks.selectedLogicalWorkspaceId = "workspace-2";
    rerender();
    expect(result.current.accessState.status).toBe("exact-missing");
    await act(async () => void await result.current.openPrimary());
    expect(fuzzyMocks.resolve).toHaveBeenCalledTimes(2);
    expect(fuzzyMocks.resolve).toHaveBeenLastCalledWith({
      materializedWorkspaceId: "workspace-2",
      workspacePath: "missing.ts",
    });
  });

  it("resets consumed recovery when runtime-root state or path changes", async () => {
    statMocks.data = undefined as never;
    statMocks.error = problem("FILE_NOT_FOUND", 404);
    pathMocks.value = {
      ...pathMocks.value,
      filesystemOrigin: { status: "settled", origin: "remote" },
      workspaceRoot: { status: "pending", path: null },
    };
    const { result, rerender } = renderHook(() => (
      useFileReferenceActions({ rawPath: "missing.ts" })
    ));
    await consumeMissingRecovery(result);

    pathMocks.value = {
      ...pathMocks.value,
      workspaceRoot: { status: "settled", path: "/repo" },
    };
    rerender();
    expect(result.current.accessState.status).toBe("exact-missing");
    await act(async () => void await result.current.openPrimary());
    pathMocks.value = {
      ...pathMocks.value,
      workspaceRoot: { status: "settled", path: "/other" },
    };
    rerender();
    expect(result.current.accessState.status).toBe("exact-missing");
    await act(async () => void await result.current.openPrimary());

    expect(fuzzyMocks.resolve).toHaveBeenCalledTimes(3);
  });

  it("resets consumed recovery when filesystem-origin state or value changes", async () => {
    statMocks.data = undefined as never;
    statMocks.error = problem("FILE_NOT_FOUND", 404);
    pathMocks.value = {
      ...pathMocks.value,
      filesystemOrigin: { status: "pending", origin: null },
      workspaceRoot: { status: "unavailable", path: null },
    };
    const { result, rerender } = renderHook(() => (
      useFileReferenceActions({ rawPath: "missing.ts" })
    ));
    await consumeMissingRecovery(result);

    pathMocks.value = {
      ...pathMocks.value,
      filesystemOrigin: { status: "rejected", origin: null },
    };
    rerender();
    expect(result.current.accessState.status).toBe("exact-missing");
    await act(async () => void await result.current.openPrimary());

    pathMocks.value = {
      ...pathMocks.value,
      filesystemOrigin: { status: "settled", origin: "remote" },
    };
    rerender();
    expect(result.current.accessState.status).toBe("exact-missing");
    await act(async () => void await result.current.openPrimary());

    pathMocks.value = {
      ...pathMocks.value,
      filesystemOrigin: { status: "settled", origin: "desktop-local" },
    };
    rerender();
    expect(result.current.accessState.status).toBe("exact-missing");
    await act(async () => void await result.current.openPrimary());

    expect(fuzzyMocks.resolve).toHaveBeenCalledTimes(4);
  });

  it("does not reset consumed recovery for rerenders, bridge replacement, or native kind", async () => {
    statMocks.data = undefined as never;
    statMocks.error = problem("FILE_NOT_FOUND", 404);
    const { result, rerender } = renderHook(
      ({ nativeCapabilityKind, renderKey }: {
        nativeCapabilityKind?: "file" | "directory";
        renderKey: number;
      }) => {
        void renderKey;
        return useFileReferenceActions({ rawPath: "missing.ts", nativeCapabilityKind });
      },
      { initialProps: { nativeCapabilityKind: undefined, renderKey: 0 } },
    );
    await consumeMissingRecovery(result);

    rerender({ nativeCapabilityKind: undefined, renderKey: 1 });
    await result.current.openPrimary();
    bridgeMocks.files = { ...bridgeMocks.files };
    rerender({ nativeCapabilityKind: undefined, renderKey: 2 });
    await result.current.openPrimary();
    rerender({ nativeCapabilityKind: "directory", renderKey: 3 });
    await result.current.openPrimary();

    expect(result.current.accessState).toEqual({ status: "unavailable", reason: "not_found" });
    expect(fuzzyMocks.resolve).toHaveBeenCalledTimes(1);
  });

  it("treats an unexpected symlink kind as terminal without size inference", () => {
    statMocks.data = { kind: "symlink" };
    const { result } = renderHook(() => useFileReferenceActions({ rawPath: "linked" }));
    expect(result.current.accessState).toEqual({ status: "unavailable", reason: "unexpected_kind" });
    expect(result.current.canOpenPrimary).toBe(false);
  });

  it("uses a stable current-copy handler and no-ops a captured callback after the path becomes empty", async () => {
    const { result, rerender } = renderHook(
      ({ rawPath }) => useFileReferenceActions({ rawPath }),
      { initialProps: { rawPath: "src/App.tsx" } },
    );
    const captured = result.current.copyCurrentPath;
    await captured();
    expect(bridgeMocks.writeText).toHaveBeenCalledWith("/repo/src/App.tsx");

    rerender({ rawPath: "   " });
    expect(result.current.copyPath).toBeNull();
    await captured();
    expect(bridgeMocks.writeText).toHaveBeenCalledTimes(1);
  });

  it("fails closed for stale native callbacks after provenance changes", async () => {
    const { result, rerender } = renderHook(() => useFileReferenceActions({ rawPath: "/tmp/a" }));
    await waitFor(() => expect(result.current.nativePathKind).toBe("file"));
    const staleOpen = result.current.openDefault;
    const staleTarget = result.current.openWithTarget;
    const staleReveal = result.current.reveal;

    pathMocks.value = {
      ...pathMocks.value,
      filesystemOrigin: { status: "settled", origin: "remote" },
    };
    rerender();
    await staleOpen();
    await staleTarget("cursor");
    await staleReveal();

    expect(editorMocks.openInDefaultEditor).not.toHaveBeenCalled();
    expect(bridgeMocks.openTarget).not.toHaveBeenCalled();
    expect(bridgeMocks.reveal).not.toHaveBeenCalled();
  });

  describe("location request enqueue (03D)", () => {
    beforeEach(() => {
      viewerMocks.activateViewerTarget.mockReturnValue({
        result: "completed",
        surface: "viewer",
        shellActivationEpoch: 1,
      });
    });

    it("enqueues the final target's location for an exact workspace file with a valid line", async () => {
      const { result } = renderHook(() => useFileReferenceActions({ rawPath: "src/App.tsx:40" }));

      await expect(result.current.openPrimary()).resolves.toBe("open-viewer");

      expect(viewerMocks.requestViewerLocation).toHaveBeenCalledWith(
        viewerTargetKey(fileViewerTarget("src/App.tsx")),
        40,
      );
    });

    it("enqueues again on an identical repeat activation", async () => {
      const { result } = renderHook(() => useFileReferenceActions({ rawPath: "src/App.tsx:40" }));

      await expect(result.current.openPrimary()).resolves.toBe("open-viewer");
      await expect(result.current.openPrimary()).resolves.toBe("open-viewer");

      expect(viewerMocks.requestViewerLocation).toHaveBeenCalledTimes(2);
    });

    it.each([
      ["src/App.tsx", null],
      ["src/App.tsx:0", 0],
      ["src/App.tsx:", null],
    ])("does not enqueue for an absent or non-positive line (%s)", async (rawPath) => {
      const { result } = renderHook(() => useFileReferenceActions({ rawPath }));

      await expect(result.current.openPrimary()).resolves.toBe("open-viewer");

      expect(viewerMocks.requestViewerLocation).not.toHaveBeenCalled();
    });

    it("does not enqueue for a directory target", async () => {
      statMocks.data = { kind: "directory" };
      const { result } = renderHook(() => useFileReferenceActions({
        rawPath: "src:12",
        workspacePath: "src",
      }));

      await result.current.openPrimary();

      expect(viewerMocks.openTarget).not.toHaveBeenCalled();
      expect(viewerMocks.requestViewerLocation).not.toHaveBeenCalled();
    });

    it("does not enqueue when the shell activation outcome is stale", async () => {
      viewerMocks.activateViewerTarget.mockReturnValue({
        result: "stale",
        surface: "viewer",
        reason: "workspace-changed",
      });
      const { result } = renderHook(() => useFileReferenceActions({ rawPath: "src/App.tsx:40" }));

      await expect(result.current.openPrimary()).resolves.toBe("open-viewer");

      expect(viewerMocks.requestViewerLocation).not.toHaveBeenCalled();
    });

    it("enqueues only the corrected target's location after fuzzy recovery", async () => {
      statMocks.data = undefined as never;
      statMocks.error = problem("FILE_NOT_FOUND", 404);
      fuzzyMocks.resolve.mockResolvedValue({
        status: "match",
        workspacePath: "Apps/Web/SRC/App.tsx",
      });
      const { result } = renderHook(() => useFileReferenceActions({ rawPath: "src/App.tsx:40" }));

      await act(async () => {
        await expect(result.current.openPrimary()).resolves.toBe("open-viewer");
      });
      await waitFor(() => expect(result.current.accessState.status).toBe("settled"));

      expect(viewerMocks.requestViewerLocation).toHaveBeenCalledTimes(1);
      expect(viewerMocks.requestViewerLocation).toHaveBeenCalledWith(
        viewerTargetKey(fileViewerTarget("Apps/Web/SRC/App.tsx")),
        40,
      );
    });
  });
});

function problem(code: string, status: number): AnyHarnessError {
  return new AnyHarnessError({
    type: "about:blank",
    title: "File request failed",
    status,
    code,
  });
}

async function consumeMissingRecovery(result: {
  readonly current: ReturnType<typeof useFileReferenceActions>;
}) {
  await act(async () => void await result.current.openPrimary());
  await waitFor(() => expect(result.current.accessState).toEqual({
    status: "unavailable",
    reason: "not_found",
  }));
}
