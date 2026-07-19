// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { WorkspacePathProvider } from "#product/providers/WorkspacePathProvider";
import { useFileReferenceActions } from "#product/hooks/workspaces/workflows/files/use-file-reference-actions";

const editorMocks = vi.hoisted(() => ({
  openInDefaultEditor: vi.fn(async () => undefined),
}));

const statMocks = vi.hoisted(() => ({
  kind: "file" as "file" | "directory" | "symlink" | null,
  sizeBytes: undefined as number | undefined,
  isFetching: false,
  refetch: vi.fn(async () => ({ data: { kind: "file" as "file" | "directory" } })),
}));

const viewerMocks = vi.hoisted(() => ({
  openTarget: vi.fn(),
  activateViewerTarget: vi.fn(),
}));

const hostMocks = vi.hoisted(() => ({
  desktopAvailable: true,
  writeText: vi.fn(async () => undefined),
  openTarget: vi.fn(async () => undefined),
  isDirectory: vi.fn(async () => false),
  reveal: vi.fn(async () => undefined),
  files: null as unknown as {
    isDirectory: ReturnType<typeof vi.fn>;
    openTarget: ReturnType<typeof vi.fn>;
    reveal: ReturnType<typeof vi.fn>;
  },
}));

hostMocks.files = {
  isDirectory: hostMocks.isDirectory,
  openTarget: hostMocks.openTarget,
  reveal: hostMocks.reveal,
};

vi.mock("#product/hooks/editor/workflows/use-open-in-default-editor", () => ({
  useOpenInDefaultEditor: () => ({
    defaultTarget: null,
    openInDefaultEditor: editorMocks.openInDefaultEditor,
    targets: [],
  }),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useStatWorkspaceFileQuery: () => ({
    data: statMocks.kind ? { kind: statMocks.kind, sizeBytes: statMocks.sizeBytes } : undefined,
    isFetching: statMocks.isFetching,
    refetch: statMocks.refetch,
  }),
}));

vi.mock("#product/hooks/workspaces/workflows/tabs/use-workspace-shell-activation", () => ({
  useWorkspaceShellActivation: () => ({
    activateViewerTarget: viewerMocks.activateViewerTarget,
  }),
}));

vi.mock("#product/stores/editor/workspace-viewer-tabs-store", () => ({
  useWorkspaceViewerTabsStore: (selector: (state: { openTarget: typeof viewerMocks.openTarget }) => unknown) =>
    selector({ openTarget: viewerMocks.openTarget }),
}));

vi.mock("#product/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (state: {
    selectedWorkspaceId: string;
    selectedLogicalWorkspaceId: string;
  }) => unknown) => selector({
    selectedWorkspaceId: "workspace-1",
    selectedLogicalWorkspaceId: "workspace-1",
  }),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    clipboard: { writeText: hostMocks.writeText },
    desktop: hostMocks.desktopAvailable ? {
      files: hostMocks.files,
    } : null,
  }),
}));

vi.mock("#product/hooks/workspaces/workflows/files/use-fuzzy-file-resolver", () => ({
  useFuzzyFileResolver: () => async () => null,
}));

afterEach(() => {
  hostMocks.desktopAvailable = true;
  hostMocks.isDirectory.mockResolvedValue(false);
  statMocks.kind = "file";
  statMocks.sizeBytes = undefined;
  statMocks.isFetching = false;
  statMocks.refetch.mockResolvedValue({ data: { kind: "file" } });
  vi.clearAllMocks();
});

describe("useFileReferenceActions", () => {
  it.each([
    ["relative", "src/App.tsx", "src/App.tsx"],
    ["absolute", "/repo/src/App.tsx", "src/App.tsx"],
  ])("opens a resolved %s file in the workspace viewer", async (_label, rawPath, expectedPath) => {
    const { result } = renderHook(
      () => useFileReferenceActions({ rawPath }),
      { wrapper: workspaceWrapper("/repo") },
    );

    await act(async () => {
      await result.current.openPrimary();
    });

    expect(viewerMocks.openTarget).toHaveBeenCalledWith({ kind: "file", path: expectedPath });
    expect(hostMocks.reveal).not.toHaveBeenCalled();
    expect(hostMocks.isDirectory).not.toHaveBeenCalled();
    expect(editorMocks.openInDefaultEditor).not.toHaveBeenCalled();
  });

  it("reveals a workspace directory in Finder instead of opening it as a file", async () => {
    statMocks.kind = "directory";
    const { result } = renderHook(
      () => useFileReferenceActions({ rawPath: "apps/packages" }),
      { wrapper: workspaceWrapper("/repo") },
    );

    await act(async () => {
      await result.current.openPrimary();
    });

    expect(hostMocks.reveal).toHaveBeenCalledWith("/repo/apps/packages");
    expect(viewerMocks.openTarget).not.toHaveBeenCalled();
  });

  it("resolves and reveals an external directory on Desktop", async () => {
    statMocks.kind = null;
    hostMocks.isDirectory.mockResolvedValue(true);
    const { result } = renderHook(
      () => useFileReferenceActions({ rawPath: "/Users/pablo/landing" }),
      { wrapper: workspaceWrapper("/repo") },
    );

    await act(async () => {
      await result.current.openPrimary();
    });

    expect(hostMocks.reveal).toHaveBeenCalledWith("/Users/pablo/landing");
    expect(viewerMocks.openTarget).not.toHaveBeenCalled();
  });

  it("keeps a Web directory unavailable without invoking a native action", async () => {
    hostMocks.desktopAvailable = false;
    statMocks.kind = "directory";
    const { result } = renderHook(
      () => useFileReferenceActions({ rawPath: "apps/packages" }),
      { wrapper: workspaceWrapper("/repo") },
    );

    expect(result.current.canOpenPrimary).toBe(false);
    expect(result.current.primaryUnavailableReason).toContain("Desktop app");
    await expect(result.current.openPrimary()).resolves.toBe("unavailable");
    expect(hostMocks.isDirectory).not.toHaveBeenCalled();
    expect(hostMocks.reveal).not.toHaveBeenCalled();
    expect(viewerMocks.openTarget).not.toHaveBeenCalled();
  });

  it("still opens a resolved workspace file in the viewer on Web", async () => {
    hostMocks.desktopAvailable = false;
    const { result } = renderHook(
      () => useFileReferenceActions({ rawPath: "README.md" }),
      { wrapper: workspaceWrapper("/repo") },
    );

    await act(async () => {
      await result.current.openPrimary();
    });

    expect(viewerMocks.openTarget).toHaveBeenCalledWith({ kind: "file", path: "README.md" });
    expect(hostMocks.reveal).not.toHaveBeenCalled();
  });

  it.each([
    ["file", 0, true],
    ["directory", undefined, false],
  ])("resolves a workspace symlink to its %s target on Web", async (_target, sizeBytes, opensViewer) => {
    hostMocks.desktopAvailable = false;
    statMocks.kind = "symlink";
    statMocks.sizeBytes = sizeBytes;
    const { result } = renderHook(
      () => useFileReferenceActions({ rawPath: "linked-entry" }),
      { wrapper: workspaceWrapper("/repo") },
    );

    await expect(result.current.openPrimary()).resolves.toBe(
      opensViewer ? "open-viewer" : "unavailable",
    );
    expect(viewerMocks.openTarget).toHaveBeenCalledTimes(opensViewer ? 1 : 0);
  });

  it("fails closed for an external file that cannot be represented in the viewer", async () => {
    statMocks.kind = null;
    const { result } = renderHook(
      () => useFileReferenceActions({ rawPath: "/tmp/outside.txt" }),
      { wrapper: workspaceWrapper("/repo") },
    );

    await waitFor(() => expect(result.current.pathKind).toBe("file"));
    expect(result.current.canOpenPrimary).toBe(false);
    await expect(result.current.openPrimary()).resolves.toBe("unavailable");
    expect(hostMocks.reveal).not.toHaveBeenCalled();
    expect(viewerMocks.openTarget).not.toHaveBeenCalled();
  });
});

function workspaceWrapper(workspacePath: string | null) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <WorkspacePathProvider workspacePath={workspacePath}>
        {children}
      </WorkspacePathProvider>
    );
  };
}
