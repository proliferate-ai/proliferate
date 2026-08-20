// @vitest-environment jsdom

import { AnyHarnessError } from "@anyharness/sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFileReferenceActions } from "#product/hooks/workspaces/workflows/files/use-file-reference-actions";
import { fileViewerTarget, viewerTargetKey } from "#product/lib/domain/workspaces/viewer/viewer-target";

// This file holds the "location request enqueue (03D)" cases split out of
// use-file-reference-actions.test.tsx to keep both files under the
// PROD-SIZE-1 line cap (600). Setup below is duplicated (not shared) from
// that file's mocks, trimmed to what these cases need.

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

function problem(code: string, status: number): AnyHarnessError {
  return new AnyHarnessError({
    type: "about:blank",
    title: "File request failed",
    status,
    code,
  });
}
