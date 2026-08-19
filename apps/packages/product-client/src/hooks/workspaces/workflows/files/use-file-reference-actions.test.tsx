// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { WorkspacePathProvider } from "#product/providers/WorkspacePathProvider";
import { useFileReferenceActions } from "#product/hooks/workspaces/workflows/files/use-file-reference-actions";

const editorMocks = vi.hoisted(() => ({
  openInDefaultEditor: vi.fn(async () => true),
}));

const statMocks = vi.hoisted(() => ({
  kind: "file" as "file" | "directory" | "symlink" | null,
  sizeBytes: undefined as number | undefined,
  isFetching: false,
  error: null as Error | null,
  refetch: vi.fn(async (): Promise<{
    data?: { kind: "file" | "directory" | "symlink"; sizeBytes?: number };
  }> => ({ data: { kind: "file" } })),
}));

const fuzzyMocks = vi.hoisted(() => ({
  resolve: vi.fn(async (): Promise<string | null> => null),
}));

const anyHarnessMocks = vi.hoisted(() => ({
  stat: vi.fn(async (_workspaceId: string, path: string) => ({
    path,
    kind: "file" as const,
    sizeBytes: 1,
  })),
  resolveWorkspaceConnection: vi.fn(async () => ({
    runtimeUrl: "http://runtime.test",
    anyharnessWorkspaceId: "runtime-workspace-1",
  })),
}));

const viewerMocks = vi.hoisted(() => ({
  openTarget: vi.fn(),
  activateViewerTarget: vi.fn(),
}));

const hostMocks = vi.hoisted(() => ({
  desktopAvailable: true,
  writeText: vi.fn(async () => undefined),
  getHomeDirectory: vi.fn(async () => "/Users/pablo"),
  openTarget: vi.fn(async () => undefined),
  inspectPath: vi.fn(async () => ({ kind: "file" as const })),
  reveal: vi.fn(async () => undefined),
  files: null as unknown as {
    getHomeDirectory: ReturnType<typeof vi.fn>;
    inspectPath: ReturnType<typeof vi.fn>;
    openTarget: ReturnType<typeof vi.fn>;
    reveal: ReturnType<typeof vi.fn>;
  },
}));

hostMocks.files = {
  getHomeDirectory: hostMocks.getHomeDirectory,
  inspectPath: hostMocks.inspectPath,
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
  getAnyHarnessClient: () => ({ files: { stat: anyHarnessMocks.stat } }),
  resolveWorkspaceConnectionFromContext: async () => ({
    workspaceId: "workspace-1",
    connection: {
      runtimeUrl: "http://runtime.test",
      anyharnessWorkspaceId: "runtime-workspace-1",
    },
  }),
  useAnyHarnessWorkspaceContext: () => ({
    workspaceId: "workspace-1",
    resolveConnection: anyHarnessMocks.resolveWorkspaceConnection,
  }),
  useStatWorkspaceFileQuery: () => ({
    data: statMocks.kind ? { kind: statMocks.kind, sizeBytes: statMocks.sizeBytes } : undefined,
    isFetching: statMocks.isFetching,
    error: statMocks.error,
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
  useFuzzyFileResolver: () => fuzzyMocks.resolve,
}));

afterEach(() => {
  hostMocks.desktopAvailable = true;
  hostMocks.getHomeDirectory.mockResolvedValue("/Users/pablo");
  hostMocks.inspectPath.mockResolvedValue({ kind: "file" });
  editorMocks.openInDefaultEditor.mockResolvedValue(true);
  statMocks.kind = "file";
  statMocks.sizeBytes = undefined;
  statMocks.isFetching = false;
  statMocks.error = null;
  statMocks.refetch.mockResolvedValue({ data: { kind: "file" } });
  fuzzyMocks.resolve.mockResolvedValue(null);
  anyHarnessMocks.stat.mockImplementation(async (_workspaceId, path) => ({
    path,
    kind: "file",
    sizeBytes: 1,
  }));
  vi.clearAllMocks();
  hostMocks.files = {
    getHomeDirectory: hostMocks.getHomeDirectory,
    inspectPath: hostMocks.inspectPath,
    openTarget: hostMocks.openTarget,
    reveal: hostMocks.reveal,
  };
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
    expect(hostMocks.inspectPath).not.toHaveBeenCalled();
    expect(editorMocks.openInDefaultEditor).not.toHaveBeenCalled();
  });

  it("infers a workspace file when nullable path metadata is missing", async () => {
    const { result } = renderHook(
      () => useFileReferenceActions({
        rawPath: "src/App.tsx",
        workspacePath: null,
      }),
      { wrapper: workspaceWrapper("/repo") },
    );

    expect(result.current.reference.workspacePath).toBe("src/App.tsx");
    await expect(result.current.openPrimary()).resolves.toBe("open-viewer");
    expect(viewerMocks.openTarget).toHaveBeenCalledWith({
      kind: "file",
      path: "src/App.tsx",
    });
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
    hostMocks.inspectPath.mockResolvedValue({ kind: "directory" });
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

  it("keeps pending actions inert while the imperative primary shares the inspection", async () => {
    statMocks.kind = null;
    let resolveInspection!: (inspection: { kind: "file" }) => void;
    hostMocks.inspectPath.mockImplementationOnce(() => new Promise((resolve) => {
      resolveInspection = resolve;
    }));
    const { result } = renderHook(
      () => useFileReferenceActions({ rawPath: "/tmp/pending.txt" }),
      { wrapper: workspaceWrapper("/repo") },
    );

    await waitFor(() => expect(hostMocks.inspectPath).toHaveBeenCalledTimes(1));
    expect(result.current.pathKindPending).toBe(true);
    expect(result.current.canOpenPrimary).toBe(false);
    expect(result.current.openTargets).toEqual([]);
    expect(result.current.defaultOpenTarget).toBeNull();
    await expect(result.current.openDefault()).resolves.toBe(false);
    await result.current.openWithTarget("cursor");
    await result.current.reveal();
    expect(hostMocks.openTarget).not.toHaveBeenCalled();
    expect(hostMocks.reveal).not.toHaveBeenCalled();

    const primary = result.current.openPrimary();
    expect(hostMocks.inspectPath).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveInspection({ kind: "file" });
      await expect(primary).resolves.toBe("open-external");
    });
    expect(hostMocks.inspectPath).toHaveBeenCalledTimes(1);
    expect(editorMocks.openInDefaultEditor)
      .toHaveBeenCalledWith("/tmp/pending.txt", "file");
  });

  it.each([
    [{ kind: "missing" }, "This path was not found."],
    [{ kind: "unavailable", reason: "invalid_path" }, "This path is invalid."],
    [
      { kind: "unavailable", reason: "permission_denied" },
      "Permission denied for this path.",
    ],
    [
      { kind: "unavailable", reason: "unsupported_type" },
      "This path type is not supported.",
    ],
    [{ kind: "unavailable", reason: "io_error" }, "This path is unavailable."],
  ] as const)(
    "keeps a settled refusal inert: %#",
    async (inspection, expectedCopy) => {
      statMocks.kind = null;
      hostMocks.inspectPath.mockResolvedValue(inspection);
      const rawPath = "/tmp/refused.txt";
      const { result } = renderHook(
        () => useFileReferenceActions({ rawPath }),
        { wrapper: workspaceWrapper("/repo") },
      );

      await waitFor(() => expect(result.current.pathKindPending).toBe(false));
      expect(result.current.pathKind).toBeNull();
      expect(result.current.canOpenExternal).toBe(false);
      expect(result.current.canReveal).toBe(false);
      expect(result.current.canOpenPrimary).toBe(false);
      expect(result.current.openTargets).toEqual([]);
      expect(result.current.defaultOpenTarget).toBeNull();
      expect(result.current.primaryUnavailableReason).toBe(expectedCopy);

      await expect(result.current.openDefault()).resolves.toBe(false);
      await result.current.openWithTarget("cursor");
      await result.current.reveal();
      await expect(result.current.openPrimary()).resolves.toBe("unavailable");
      await result.current.copyPath();

      expect(hostMocks.inspectPath).toHaveBeenCalledTimes(1);
      expect(hostMocks.openTarget).not.toHaveBeenCalled();
      expect(hostMocks.reveal).not.toHaveBeenCalled();
      expect(editorMocks.openInDefaultEditor).not.toHaveBeenCalled();
      expect(hostMocks.writeText).toHaveBeenCalledWith(rawPath);
    },
  );

  it("keeps a Web directory unavailable without invoking a native action", async () => {
    hostMocks.desktopAvailable = false;
    statMocks.kind = "directory";
    const { result } = renderHook(
      () => useFileReferenceActions({ rawPath: "apps/packages" }),
      { wrapper: workspaceWrapper("/repo") },
    );

    expect(result.current.canOpenPrimary).toBe(false);
    expect(result.current.primaryUnavailableReason).toBe("This path is unavailable.");
    await expect(result.current.openPrimary()).resolves.toBe("unavailable");
    expect(hostMocks.inspectPath).not.toHaveBeenCalled();
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

  it("opens the uniquely corrected viewer target after an exact stat miss", async () => {
    statMocks.kind = null;
    statMocks.error = new Error("not found");
    statMocks.refetch.mockResolvedValue({ data: undefined });
    fuzzyMocks.resolve.mockResolvedValue("apps/product/src/App.tsx");
    const { result } = renderHook(
      () => useFileReferenceActions({ rawPath: "src/App.tsx" }),
      { wrapper: workspaceWrapper("/repo") },
    );

    await act(async () => {
      await result.current.openPrimary();
    });

    expect(fuzzyMocks.resolve).toHaveBeenCalledWith({
      workspacePath: "src/App.tsx",
      materializedWorkspaceId: "workspace-1",
    });
    expect(anyHarnessMocks.stat).toHaveBeenCalledWith(
      "runtime-workspace-1",
      "apps/product/src/App.tsx",
    );
    expect(viewerMocks.openTarget).toHaveBeenCalledWith({
      kind: "file",
      path: "apps/product/src/App.tsx",
    });
  });

  it("keeps primary opening retryable after exact stat and correction both fail", async () => {
    statMocks.kind = null;
    statMocks.error = new Error("not found");
    statMocks.refetch.mockResolvedValue({ data: undefined });
    const { result } = renderHook(
      () => useFileReferenceActions({ rawPath: "missing/App.tsx" }),
      { wrapper: workspaceWrapper("/repo") },
    );

    expect(result.current.canOpenPrimary).toBe(true);
    await act(async () => {
      await expect(result.current.openPrimary()).resolves.toBe("unavailable");
    });

    await waitFor(() => {
      expect(result.current.primaryUnavailableReason)
        .toBe("This path was not found.");
    });
    expect(result.current.canOpenPrimary).toBe(true);
    expect(viewerMocks.openTarget).not.toHaveBeenCalled();
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

  it("opens an external file with the configured Desktop target", async () => {
    statMocks.kind = null;
    const { result } = renderHook(
      () => useFileReferenceActions({ rawPath: "/tmp/outside.txt" }),
      { wrapper: workspaceWrapper("/repo") },
    );

    await waitFor(() => expect(result.current.pathKind).toBe("file"));
    expect(result.current.canOpenPrimary).toBe(true);
    expect(result.current.canOpenExternal).toBe(true);
    expect(result.current.canReveal).toBe(false);
    await expect(result.current.openPrimary()).resolves.toBe("open-external");
    await result.current.openWithTarget("cursor");
    await result.current.reveal();
    expect(editorMocks.openInDefaultEditor).toHaveBeenCalledWith("/tmp/outside.txt", "file");
    expect(hostMocks.openTarget).toHaveBeenCalledWith("cursor", "/tmp/outside.txt");
    expect(hostMocks.reveal).not.toHaveBeenCalled();
    expect(viewerMocks.openTarget).not.toHaveBeenCalled();
  });

  it("keeps a rejected home lookup unavailable without a /tmp fallback", async () => {
    statMocks.kind = null;
    hostMocks.getHomeDirectory.mockRejectedValue(new Error("home unavailable"));
    const { result } = renderHook(
      () => useFileReferenceActions({ rawPath: "~/.config/secret.txt" }),
      { wrapper: workspaceWrapper("/repo") },
    );

    await waitFor(() => expect(result.current.pathKindPending).toBe(false));
    expect(result.current.reference.absolutePath).toBeNull();
    expect(result.current.pathKind).toBeNull();
    expect(result.current.canOpenPrimary).toBe(false);
    expect(result.current.primaryUnavailableReason).toBe("This path is unavailable.");

    await expect(result.current.openPrimary()).resolves.toBe("unavailable");
    await expect(result.current.openPrimary()).resolves.toBe("unavailable");
    expect(hostMocks.getHomeDirectory).toHaveBeenCalledTimes(1);
    expect(hostMocks.inspectPath).not.toHaveBeenCalled();
    expect(hostMocks.openTarget).not.toHaveBeenCalled();
    expect(hostMocks.reveal).not.toHaveBeenCalled();
    expect(editorMocks.openInDefaultEditor).not.toHaveBeenCalled();
    expect(hostMocks.inspectPath).not.toHaveBeenCalledWith(
      expect.stringContaining("/tmp"),
    );
  });

  it("expands a home-relative hidden file before opening it on Desktop", async () => {
    statMocks.kind = null;
    let resolveHomeDirectory!: (path: string) => void;
    hostMocks.getHomeDirectory.mockImplementationOnce(() => new Promise((resolve) => {
      resolveHomeDirectory = resolve;
    }));
    const rawPath = "~/.proliferate-local/dev/profiles/wf2pablo/app/diagnostics-dev.env";
    const absolutePath = "/Users/pablo/.proliferate-local/dev/profiles/wf2pablo/app/diagnostics-dev.env";
    const { result } = renderHook(
      () => useFileReferenceActions({ rawPath }),
      { wrapper: workspaceWrapper("/repo") },
    );

    expect(result.current.canOpenPrimary).toBe(false);
    await act(async () => {
      const openPromise = result.current.openPrimary();
      resolveHomeDirectory("/Users/pablo");
      await expect(openPromise).resolves.toBe("open-external");
    });
    await waitFor(() => {
      expect(result.current.reference.absolutePath).toBe(absolutePath);
      expect(result.current.pathKind).toBe("file");
    });

    expect(hostMocks.getHomeDirectory).toHaveBeenCalledTimes(1);
    expect(hostMocks.inspectPath).toHaveBeenCalledWith(absolutePath);
    expect(editorMocks.openInDefaultEditor).toHaveBeenCalledWith(absolutePath, "file");
  });

  it("keeps an external file retryable when its Desktop target fails", async () => {
    statMocks.kind = null;
    editorMocks.openInDefaultEditor
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { result } = renderHook(
      () => useFileReferenceActions({ rawPath: "/tmp/outside.txt" }),
      { wrapper: workspaceWrapper("/repo") },
    );

    await waitFor(() => expect(result.current.pathKind).toBe("file"));
    await act(async () => {
      await expect(result.current.openPrimary()).resolves.toBe("unavailable");
    });

    await waitFor(() => {
      expect(result.current.primaryUnavailableReason)
        .toBe("Could not open this path. Click to retry.");
    });
    expect(result.current.canOpenPrimary).toBe(true);

    await act(async () => {
      await expect(result.current.openPrimary()).resolves.toBe("open-external");
    });
    await waitFor(() => {
      expect(result.current.primaryUnavailableReason).toBeNull();
    });
    expect(editorMocks.openInDefaultEditor).toHaveBeenCalledTimes(2);
    expect(hostMocks.inspectPath).toHaveBeenCalledTimes(1);
  });

  it("keeps a rejected Desktop inspection terminal for the candidate revision", async () => {
    statMocks.kind = null;
    hostMocks.inspectPath.mockRejectedValue(new Error("bridge unavailable"));
    const { result } = renderHook(
      () => useFileReferenceActions({ rawPath: "/tmp/outside.txt" }),
      { wrapper: workspaceWrapper("/repo") },
    );

    await waitFor(() => {
      expect(hostMocks.inspectPath).toHaveBeenCalled();
      expect(result.current.pathKindPending).toBe(false);
    });
    expect(result.current.canOpenPrimary).toBe(false);
    await act(async () => {
      await expect(result.current.openPrimary()).resolves.toBe("unavailable");
      await expect(result.current.openPrimary()).resolves.toBe("unavailable");
      await expect(result.current.openDefault()).resolves.toBe(false);
      await result.current.openWithTarget("cursor");
      await result.current.reveal();
    });

    expect(result.current.primaryUnavailableReason).toBe("This path is unavailable.");
    expect(hostMocks.inspectPath).toHaveBeenCalledTimes(1);
    expect(hostMocks.openTarget).not.toHaveBeenCalled();
    expect(hostMocks.reveal).not.toHaveBeenCalled();
    expect(editorMocks.openInDefaultEditor).not.toHaveBeenCalled();
  });

  it("keeps an external file unavailable on Web", async () => {
    hostMocks.desktopAvailable = false;
    statMocks.kind = null;
    const { result } = renderHook(
      () => useFileReferenceActions({ rawPath: "/tmp/outside.txt" }),
      { wrapper: workspaceWrapper("/repo") },
    );

    expect(result.current.canOpenPrimary).toBe(false);
    expect(result.current.pathKindPending).toBe(false);
    expect(result.current.primaryUnavailableReason).toBe("This path is unavailable.");
    await expect(result.current.openPrimary()).resolves.toBe("unavailable");
    expect(editorMocks.openInDefaultEditor).not.toHaveBeenCalled();
    expect(hostMocks.reveal).not.toHaveBeenCalled();
    expect(viewerMocks.openTarget).not.toHaveBeenCalled();
  });

  it("keeps a home-relative file unavailable on Web", async () => {
    hostMocks.desktopAvailable = false;
    statMocks.kind = null;
    const { result } = renderHook(
      () => useFileReferenceActions({ rawPath: "~/.config/proliferate/settings.json" }),
      { wrapper: workspaceWrapper("/repo") },
    );

    expect(result.current.canOpenPrimary).toBe(false);
    expect(result.current.primaryUnavailableReason).toBe("This path is unavailable.");
    await expect(result.current.openPrimary()).resolves.toBe("unavailable");
    expect(hostMocks.getHomeDirectory).not.toHaveBeenCalled();
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
