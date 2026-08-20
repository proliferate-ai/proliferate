// @vitest-environment jsdom

import type { PropsWithChildren, ReactElement } from "react";
import {
  cleanup,
  fireEvent,
  render as testingRender,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { EditRows } from "#product/components/workspace/chat/tool-calls/CollapsedEditActionRows";
import { toolItem } from "#product/domain/chats/transcript/transcript-presentation-test-fixtures";

const webTestHost = { desktop: null } as ProductHost;

function WebProductHostWrapper({ children }: PropsWithChildren) {
  return <ProductHostProvider host={webTestHost}>{children}</ProductHostProvider>;
}

function render(ui: ReactElement) {
  return testingRender(ui, { wrapper: WebProductHostWrapper });
}

const { openPrimaryMock, fileReferenceOpenState, fileReferenceActionsCalls } = vi.hoisted(() => ({
  openPrimaryMock: vi.fn(),
  fileReferenceActionsCalls: [] as Array<{ rawPath: string; workspacePath?: string | null }>,
  fileReferenceOpenState: {
    canOpenPrimary: true,
    canOpenInSidebar: true,
    canOpenExternal: true,
    canReveal: true,
    pathKind: "file" as "file" | "directory" | null,
  },
}));

vi.mock("#product/hooks/workspaces/workflows/files/use-file-reference-actions", () => ({
  useFileReferenceActions: (args: { rawPath: string; workspacePath?: string | null }) => {
    fileReferenceActionsCalls.push(args);
    const locator = {
      authority: "workspace" as const,
      workspacePath: typeof args.workspacePath === "string" ? args.workspacePath : args.rawPath,
      localCompanionPath: null,
    };
    return {
      reference: {
      rawPath: args.rawPath,
      parsedPath: args.rawPath,
      displayPath: args.rawPath || "File",
      line: null,
      column: null,
      locator,
      },
      accessState: { status: "settled", locator, kind: "file" },
      nativePathKind: null,
      openTargets: [],
      defaultOpenTarget: null,
      pathKindPending: false,
      primaryUnavailableReason: null,
      copyPath: args.rawPath || null,
      copyCurrentPath: vi.fn(),
      ...fileReferenceOpenState,
      openInSidebar: vi.fn(),
      openDefault: vi.fn(),
      openPrimary: openPrimaryMock,
      openWithTarget: vi.fn(),
      reveal: vi.fn(),
    };
  },
}));

afterEach(() => {
  cleanup();
  openPrimaryMock.mockClear();
  fileReferenceOpenState.canOpenPrimary = true;
  fileReferenceOpenState.canOpenInSidebar = true;
  fileReferenceOpenState.canOpenExternal = true;
  fileReferenceOpenState.canReveal = true;
  fileReferenceOpenState.pathKind = "file";
  fileReferenceActionsCalls.length = 0;
});

function editItem({ patch = false }: { patch?: boolean } = {}) {
  const item = toolItem("edit-1", "turn-1", 1, "file_change");
  const part = item.contentParts[0];
  if (patch && part?.type === "file_change") {
    part.patch = "@@ -1 +1 @@\n-old\n+new";
  }
  return item;
}

describe("CollapsedEditActionRows", () => {
  it("toggles the diff from the row and opens the file from its name or arrow", () => {
    render(<EditRows item={editItem({ patch: true })} />);

    const toggle = screen.getByRole("button", { name: "Toggle diff for edit-1.ts" });
    fireEvent.click(toggle);
    expect(document.body.innerHTML).toContain("data-diff-surface=\"chat\"");
    expect(openPrimaryMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "edit-1.ts" }));
    expect(openPrimaryMock).toHaveBeenCalledOnce();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Open edit-1.ts" }));
    expect(openPrimaryMock).toHaveBeenCalledTimes(2);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps file controls available while the path kind is resolving", () => {
    fileReferenceOpenState.canOpenInSidebar = false;
    fileReferenceOpenState.canOpenExternal = false;
    fileReferenceOpenState.canReveal = false;
    fileReferenceOpenState.pathKind = null;

    render(<EditRows item={editItem()} />);
    fireEvent.click(screen.getByRole("button", { name: "edit-1.ts" }));
    fireEvent.click(screen.getByRole("button", { name: "Open edit-1.ts" }));

    expect(openPrimaryMock).toHaveBeenCalledTimes(2);
  });

  it("opens the context menu without opening the file or toggling its diff", () => {
    render(<EditRows item={editItem({ patch: true })} />);

    const fileName = screen.getByRole("button", { name: "edit-1.ts" });
    const toggle = screen.getByRole("button", { name: "Toggle diff for edit-1.ts" });
    fireEvent.contextMenu(fileName);

    expect(screen.getByRole("menuitem", { name: "Copy path" })).toBeTruthy();
    expect(openPrimaryMock).not.toHaveBeenCalled();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("preserves a blank new structured path beside the raw new path", () => {
    const item = editItem();
    const part = item.contentParts[0];
    if (part?.type === "file_change") {
      part.path = "old/raw.ts";
      part.workspacePath = "old/workspace.ts";
      part.newPath = "new/raw.ts";
      part.newWorkspacePath = "";
    }
    render(<EditRows item={item} />);
    expect(fileReferenceActionsCalls).toContainEqual({
      rawPath: "new/raw.ts",
      workspacePath: "",
    });
  });

  it("routes a move outside the workspace to its destination, not the source", () => {
    const item = editItem();
    const part = item.contentParts[0];
    if (part?.type === "file_change") {
      part.path = "src/a.ts";
      part.workspacePath = "src/a.ts";
      part.newPath = "/tmp/a.ts";
      part.newWorkspacePath = null;
    }
    render(<EditRows item={item} />);
    expect(fileReferenceActionsCalls).toContainEqual({
      rawPath: "/tmp/a.ts",
      workspacePath: null,
    });
  });

  it("keeps an unavailable filename as inert text, not a pointer dead zone over the row's toggle layer", () => {
    fileReferenceOpenState.canOpenPrimary = false;

    render(<EditRows item={editItem({ patch: true })} />);

    // Unavailable: the filename is inert text, not a button — clicking it
    // does not open the file.
    expect(screen.queryByRole("button", { name: "edit-1.ts" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open edit-1.ts" })).toBeNull();
    const filenameLabel = screen.getByText("edit-1.ts");
    expect(filenameLabel.tagName).toBe("SPAN");
    // Never re-enables pointer events over the row's toggle layer: the
    // ancestor wraps everything in `pointer-events-none`, and only the
    // actionable Button variants opt back in with `pointer-events-auto`.
    // The inert label carries no such override, so a real click on its
    // screen position still hits the toggle overlay underneath.
    expect(filenameLabel.className).not.toContain("pointer-events-auto");

    fireEvent.click(filenameLabel);
    expect(openPrimaryMock).not.toHaveBeenCalled();
  });

  it("keeps workspacePath for a plain edit with no newPath", () => {
    const item = editItem();
    const part = item.contentParts[0];
    if (part?.type === "file_change") {
      part.path = "src/a.ts";
      part.workspacePath = "src/a.ts";
      part.newPath = null;
      part.newWorkspacePath = null;
    }
    render(<EditRows item={item} />);
    expect(fileReferenceActionsCalls).toContainEqual({
      rawPath: "src/a.ts",
      workspacePath: "src/a.ts",
    });
  });
});
