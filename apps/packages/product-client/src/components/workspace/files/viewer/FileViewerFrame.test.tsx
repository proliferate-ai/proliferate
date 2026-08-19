// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setSurfaceAvailability: vi.fn(),
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

function renderFrame(overrides: Partial<Parameters<typeof FileViewerFrame>[0]> = {}) {
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
      filesAvailable
      filesRequestedOpen={false}
      onToggleFiles={noop}
      onRevealFilesPath={noop}
      fileTreeDock={null}
      {...overrides}
    >
      <div>file content</div>
    </FileViewerFrame>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FileViewerFrame breadcrumbs", () => {
  it("renders the literal Files leading crumb and the path segments", () => {
    renderFrame();

    const breadcrumbs = within(screen.getByRole("navigation", { name: "File path" }));
    expect(breadcrumbs.getByText("Files")).toBeTruthy();
    expect(breadcrumbs.getByText("src")).toBeTruthy();
    expect(breadcrumbs.getByText("index.tsx")).toBeTruthy();
  });

  it("reveals the workspace root when the leading Files crumb is invoked", async () => {
    const onRevealFilesPath = vi.fn();
    const { user } = withUser(renderFrame({ onRevealFilesPath }));

    await user.click(screen.getByRole("button", { name: "Files" }));

    expect(onRevealFilesPath).toHaveBeenCalledWith("");
  });

  it("reveals the directory path when a directory crumb is invoked", async () => {
    const onRevealFilesPath = vi.fn();
    const { user } = withUser(
      renderFrame({ filePath: "src/nested/index.tsx", onRevealFilesPath }),
    );

    await user.click(screen.getByRole("button", { name: "src" }));

    expect(onRevealFilesPath).toHaveBeenCalledWith("src");
  });

  it("renders every crumb as inert text when files are unavailable", () => {
    renderFrame({ filesAvailable: false });

    const breadcrumbs = screen.getByRole("navigation", { name: "File path" });
    expect(within(breadcrumbs).queryByRole("button")).toBeNull();
    expect(within(breadcrumbs).getByText("Files")).toBeTruthy();
  });

  it("never renders the final filename crumb as a control", () => {
    renderFrame();

    const breadcrumbs = screen.getByRole("navigation", { name: "File path" });
    expect(within(breadcrumbs).queryByRole("button", { name: "index.tsx" })).toBeNull();
  });
});

describe("FileViewerFrame Files toggle — unavailable", () => {
  it("disables the toggle, ignores stale requested-open, and shows the unavailable help", () => {
    renderFrame({ filesAvailable: false, filesRequestedOpen: true });

    const toggle = screen.getByRole("button", { name: "Show files" });
    expect(toggle.hasAttribute("disabled")).toBe(true);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.getAttribute("title")).toBe("Files are unavailable for this workspace");
  });

  it("invokes no mutation when clicked while disabled", async () => {
    const onToggleFiles = vi.fn();
    renderFrame({ filesAvailable: false, onToggleFiles });

    const toggle = screen.getByRole("button", { name: "Show files" });
    expect(toggle.hasAttribute("disabled")).toBe(true);
    expect(onToggleFiles).not.toHaveBeenCalled();
  });

  it("renders inert crumbs while unavailable (caller supplies a null dock)", () => {
    renderFrame({ filesAvailable: false, fileTreeDock: null });

    expect(screen.queryByTestId("dock")).toBeNull();
  });
});

describe("FileViewerFrame Files toggle — available and closed", () => {
  it("enables Show files with aria-pressed=false and no help text", () => {
    renderFrame({ filesAvailable: true, filesRequestedOpen: false });

    const toggle = screen.getByRole("button", { name: "Show files" });
    expect(toggle.hasAttribute("disabled")).toBe(false);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.hasAttribute("title")).toBe(false);
  });

  it("requests open on toggle invocation", async () => {
    const onToggleFiles = vi.fn();
    const { user } = withUser(
      renderFrame({ filesAvailable: true, filesRequestedOpen: false, onToggleFiles }),
    );

    await user.click(screen.getByRole("button", { name: "Show files" }));

    expect(onToggleFiles).toHaveBeenCalledTimes(1);
  });

  it("renders no dock (caller supplies a null dock while closed)", () => {
    renderFrame({
      filesAvailable: true,
      filesRequestedOpen: false,
      fileTreeDock: null,
    });

    expect(screen.queryByTestId("dock")).toBeNull();
  });
});

describe("FileViewerFrame Files toggle — requested but geometry-hidden", () => {
  it("keeps Hide files enabled and pressed with the widen-window help", () => {
    renderFrame({ filesAvailable: true, filesRequestedOpen: true, fileTreeDock: null });

    const toggle = screen.getByRole("button", { name: "Hide files" });
    expect(toggle.hasAttribute("disabled")).toBe(false);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.getAttribute("title")).toBe("Widen the window to show files");
  });

  it("invoking the toggle is the explicit close", async () => {
    const onToggleFiles = vi.fn();
    const { user } = withUser(
      renderFrame({
        filesAvailable: true,
        filesRequestedOpen: true,
        fileTreeDock: null,
        onToggleFiles,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Hide files" }));

    expect(onToggleFiles).toHaveBeenCalledTimes(1);
  });

  it("renders no dock", () => {
    renderFrame({ filesAvailable: true, filesRequestedOpen: true, fileTreeDock: null });
    expect(screen.queryByTestId("dock")).toBeNull();
  });
});

describe("FileViewerFrame Files toggle — available and effectively visible", () => {
  it("shows Hide files pressed and renders the supplied dock", () => {
    renderFrame({
      filesAvailable: true,
      filesRequestedOpen: true,
      fileTreeDock: <div data-testid="dock" />,
    });

    const toggle = screen.getByRole("button", { name: "Hide files" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.hasAttribute("title")).toBe(false);
    expect(screen.getByTestId("dock")).toBeTruthy();
  });
});

describe("FileViewerFrame body/content slots", () => {
  it("exposes the body and content data attributes", () => {
    const { container } = renderFrame({ fileTreeDock: <div data-testid="dock" /> });

    expect(container.querySelector("[data-file-viewer-body]")).toBeTruthy();
    const content = container.querySelector("[data-file-viewer-content]");
    expect(content).toBeTruthy();
    expect(within(content as HTMLElement).getByText("file content")).toBeTruthy();
  });

  it("keeps the dock outside the content slot the context-menu trigger wraps", () => {
    const { container } = renderFrame({ fileTreeDock: <div data-testid="dock" /> });

    const dock = screen.getByTestId("dock");
    const content = container.querySelector("[data-file-viewer-content]") as HTMLElement;
    expect(content.contains(dock)).toBe(false);
    expect(within(content).getByText("file content")).toBeTruthy();
  });
});

// Minimal click helper: this suite only needs a synchronous click, so a
// direct DOM dispatch avoids pulling in `@testing-library/user-event` for a
// single interaction.
function withUser(renderResult: ReturnType<typeof render>) {
  return {
    ...renderResult,
    user: {
      click: async (element: Element) => {
        (element as HTMLElement).click();
      },
    },
  };
}
