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
  revealInFinder: vi.fn(async () => undefined),
}));

vi.mock("@/hooks/editor/workflows/use-open-in-default-editor", () => ({
  useOpenInDefaultEditor: () => ({
    defaultTarget: null,
    openInDefaultEditor: editorMocks.openInDefaultEditor,
    targets: [],
  }),
}));

vi.mock("@/hooks/workspaces/tabs/use-workspace-shell-activation", () => ({
  useWorkspaceShellActivation: () => ({
    activateViewerTarget: vi.fn(),
  }),
}));

vi.mock("@/lib/access/tauri/shell", () => ({
  copyPath: shellMocks.copyPath,
  openTarget: shellMocks.openTarget,
  revealInFinder: shellMocks.revealInFinder,
}));

afterEach(() => {
  vi.clearAllMocks();
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
