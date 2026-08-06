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

const { openPrimaryMock, fileReferenceOpenState } = vi.hoisted(() => ({
  openPrimaryMock: vi.fn(),
  fileReferenceOpenState: {
    canOpenPrimary: true,
    canOpenInSidebar: true,
    canOpenExternal: true,
    canReveal: true,
    pathKind: "file" as "file" | "directory" | null,
  },
}));

vi.mock("#product/hooks/workspaces/workflows/files/use-file-reference-actions", () => ({
  useFileReferenceActions: (args: { rawPath: string; workspacePath?: string | null }) => ({
    reference: {
      rawPath: args.rawPath,
      path: args.rawPath,
      line: null,
      column: null,
      absolutePath: `/repo/${args.rawPath}`,
      workspacePath: args.rawPath,
    },
    openTargets: [],
    defaultOpenTarget: null,
    ...fileReferenceOpenState,
    copyPath: vi.fn(),
    openInSidebar: vi.fn(),
    openDefault: vi.fn(),
    openPrimary: openPrimaryMock,
    openWithTarget: vi.fn(),
    reveal: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  openPrimaryMock.mockClear();
  fileReferenceOpenState.canOpenPrimary = true;
  fileReferenceOpenState.canOpenInSidebar = true;
  fileReferenceOpenState.canOpenExternal = true;
  fileReferenceOpenState.canReveal = true;
  fileReferenceOpenState.pathKind = "file";
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
});
