// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { WorkspacePathProvider } from "@/providers/WorkspacePathProvider";
import { useFileReferenceActions } from "./use-file-reference-actions";

const editorMocks = vi.hoisted(() => ({
  openInDefaultEditor: vi.fn(async () => undefined),
}));

const hostMocks = vi.hoisted(() => ({
  desktopAvailable: true,
  writeText: vi.fn(async () => undefined),
  openTarget: vi.fn(async () => undefined),
  isDirectory: vi.fn(async () => false),
  reveal: vi.fn(async () => undefined),
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

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    clipboard: { writeText: hostMocks.writeText },
    desktop: hostMocks.desktopAvailable ? {
      files: {
        isDirectory: hostMocks.isDirectory,
        openTarget: hostMocks.openTarget,
        reveal: hostMocks.reveal,
      },
    } : null,
  }),
}));

vi.mock("@/hooks/workspaces/workflows/files/use-fuzzy-file-resolver", () => ({
  useFuzzyFileResolver: () => async () => null,
}));

afterEach(() => {
  hostMocks.desktopAvailable = true;
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

    expect(hostMocks.reveal).toHaveBeenCalledWith("/Users/pablo/landing");
    expect(editorMocks.openInDefaultEditor).not.toHaveBeenCalled();
  });

  it("fails closed without Desktop file access", async () => {
    hostMocks.desktopAvailable = false;
    const { result } = renderHook(
      () => useFileReferenceActions({ rawPath: "/Users/pablo/landing" }),
      { wrapper: workspaceWrapper(null) },
    );

    await expect(result.current.openPrimary()).rejects.toThrow(
      "Local file access is not available.",
    );
    expect(hostMocks.isDirectory).not.toHaveBeenCalled();
    expect(hostMocks.reveal).not.toHaveBeenCalled();
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
