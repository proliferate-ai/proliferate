// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { WorkspacePathProvider } from "@/providers/WorkspacePathProvider";
import { useFileReferenceActions } from "./use-file-reference-actions";

const editorMocks = vi.hoisted(() => ({
  openInDefaultEditor: vi.fn(async () => undefined),
}));

const shellMocks = vi.hoisted(() => ({
  copyPath: vi.fn(async () => undefined),
  openTarget: vi.fn(async () => undefined),
  pathIsDirectory: vi.fn(async () => false),
  revealInFinder: vi.fn(async () => undefined),
}));

const fuzzyMocks = vi.hoisted(() => ({
  resolve: vi.fn(async (_input: unknown): Promise<string | null> => null),
}));

const viewerStoreMocks = vi.hoisted(() => ({
  openTarget: vi.fn(),
}));

vi.mock("@/hooks/editor/workflows/use-open-in-default-editor", () => ({
  useOpenInDefaultEditor: () => ({
    defaultTarget: null,
    openInDefaultEditor: editorMocks.openInDefaultEditor,
    targets: [],
  }),
}));

vi.mock("@/hooks/workspaces/workflows/tabs/use-workspace-shell-activation", () => ({
  useWorkspaceShellActivation: () => ({
    activateViewerTarget: vi.fn(),
  }),
}));

vi.mock("@/lib/access/tauri/shell", () => ({
  copyPath: shellMocks.copyPath,
  openTarget: shellMocks.openTarget,
  pathIsDirectory: shellMocks.pathIsDirectory,
  revealInFinder: shellMocks.revealInFinder,
}));

vi.mock("@/hooks/workspaces/workflows/files/use-fuzzy-file-resolver", () => ({
  useFuzzyFileResolver: () => fuzzyMocks.resolve,
}));

vi.mock("@/stores/editor/workspace-viewer-tabs-store", () => ({
  useWorkspaceViewerTabsStore: (selector: (state: { openTarget: typeof viewerStoreMocks.openTarget }) => unknown) =>
    selector({ openTarget: viewerStoreMocks.openTarget }),
}));

afterEach(() => {
  vi.clearAllMocks();
  fuzzyMocks.resolve.mockResolvedValue(null);
});

describe("useFileReferenceActions", () => {
  it("reveals external absolute paths in Finder on primary click", async () => {
    const { result } = renderHook(
      () => useFileReferenceActions({ rawPath: "/Users/pablo/landing" }),
      { wrapper: workspaceWrapper("/repo") },
    );

    await act(async () => {
      await result.current.openPrimary();
    });

    expect(shellMocks.revealInFinder).toHaveBeenCalledWith("/Users/pablo/landing");
    expect(editorMocks.openInDefaultEditor).not.toHaveBeenCalled();
  });

  it("fuzzy-corrects a non-authoritative workspace path and reopens it", async () => {
    fuzzyMocks.resolve.mockResolvedValue("src/real/App.tsx");
    const { result } = renderHook(
      () => useFileReferenceActions({ rawPath: "App.tsx", workspacePath: "App.tsx" }),
      { wrapper: workspaceWrapper("/repo") },
    );

    await act(async () => {
      await result.current.openInSidebar();
    });

    expect(fuzzyMocks.resolve).toHaveBeenCalledTimes(1);
    // Opened optimistically, then reopened on the corrected path.
    expect(viewerStoreMocks.openTarget).toHaveBeenCalledTimes(2);
  });

  it("never fuzzy-corrects an authoritative tool-call path", async () => {
    fuzzyMocks.resolve.mockResolvedValue("src/real/App.tsx");
    const { result } = renderHook(
      () => useFileReferenceActions({
        rawPath: "App.tsx",
        workspacePath: "App.tsx",
        authoritativePath: true,
      }),
      { wrapper: workspaceWrapper("/repo") },
    );

    await act(async () => {
      await result.current.openInSidebar();
    });

    expect(fuzzyMocks.resolve).not.toHaveBeenCalled();
    // Opened exactly once, on the named path — no fuzzy reopen.
    expect(viewerStoreMocks.openTarget).toHaveBeenCalledTimes(1);
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
