// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspacePathContextValue } from "#product/providers/WorkspacePathProvider";

const mocks = vi.hoisted(() => ({
  workspacePath: {
    materializedWorkspaceId: "workspace-1",
    filesystemOrigin: { status: "settled", origin: "desktop-local" },
    workspaceRoot: { status: "settled", path: "/workspaces/my-repo" },
  } as WorkspacePathContextValue,
  setSurfaceAvailability: vi.fn(),
}));

vi.mock("#product/providers/WorkspacePathProvider", () => ({
  useWorkspacePath: () => mocks.workspacePath,
}));

vi.mock("#product/stores/search/content-search-store", () => ({
  useContentSearchStore: (
    selector: (state: { setSurfaceAvailability: typeof mocks.setSurfaceAvailability }) => unknown,
  ) => selector({ setSurfaceAvailability: mocks.setSurfaceAvailability }),
}));

vi.mock("#product/hooks/workspaces/ui/files/use-file-viewer-native-menu", () => ({
  useFileViewerNativeMenu: () => ({ showNativeMenu: vi.fn(async () => true) }),
  useFileViewerNativeContextMenu: () => ({ onContextMenuCapture: vi.fn() }),
}));

import { FileViewerFrame } from "#product/components/workspace/files/viewer/FileViewerFrame";

const noop = () => {};

function renderFrame() {
  return render(
    <FileViewerFrame
      filePath="src/index.tsx"
      canRenderRichPreview={false}
      wordWrap={false}
      richPreviewEnabled={false}
      canCopyContent
      canFindInFile={false}
      canOpenExternal={false}
      onToggleWordWrap={noop}
      onToggleRichPreview={noop}
      onCopyContent={noop}
      onCopyPath={noop}
      onOpenExternal={noop}
      onOpenContentSearch={noop}
      browserOpen={false}
      onToggleBrowser={noop}
      onBrowsePath={noop}
    >
      <div>file content</div>
    </FileViewerFrame>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.workspacePath = {
    materializedWorkspaceId: "workspace-1",
    filesystemOrigin: { status: "settled", origin: "desktop-local" },
    workspaceRoot: { status: "settled", path: "/workspaces/my-repo" },
  };
});

describe("FileViewerFrame breadcrumbs", () => {
  it("derives the workspace crumb from a settled normalized runtime root", () => {
    renderFrame();

    const breadcrumbs = within(screen.getByRole("navigation", { name: "File path" }));
    expect(breadcrumbs.getByText("my-repo")).toBeTruthy();
    expect(breadcrumbs.getByText("src")).toBeTruthy();
    expect(breadcrumbs.getByText("index.tsx")).toBeTruthy();
  });

  it.each(["pending", "unavailable"] as const)(
    "does not invent a workspace crumb while the root is %s",
    (status) => {
      mocks.workspacePath = {
        ...mocks.workspacePath,
        workspaceRoot: { status, path: null },
      };
      renderFrame();

      const breadcrumbs = screen.getByRole("navigation", { name: "File path" });
      expect(within(breadcrumbs).queryByText("my-repo")).toBeNull();
      expect(breadcrumbs.querySelectorAll("li")).toHaveLength(2);
    },
  );

  it("treats filesystem root as having no nonblank workspace-name segment", () => {
    mocks.workspacePath = {
      ...mocks.workspacePath,
      workspaceRoot: { status: "settled", path: "/" },
    };
    renderFrame();

    const breadcrumbs = screen.getByRole("navigation", { name: "File path" });
    expect(breadcrumbs.querySelectorAll("li")).toHaveLength(2);
    expect(within(breadcrumbs).getByText("src")).toBeTruthy();
    expect(within(breadcrumbs).getByText("index.tsx")).toBeTruthy();
  });
});
