// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

function editItem({
  patch = false,
  failed = false,
}: { patch?: boolean; failed?: boolean } = {}) {
  const item = toolItem("edit-1", "turn-1", 1, "file_change", failed ? "failed" : "completed");
  const part = item.contentParts[0];
  if (patch && part?.type === "file_change") {
    part.patch = "@@ -1 +1 @@\n-old\n+new";
  }
  return item;
}

function editRow(): HTMLElement {
  const row = document.querySelector("[data-edit-action-row]");
  if (!(row instanceof HTMLElement)) {
    throw new Error("expected an edit action row");
  }
  return row;
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

  it("keeps the context menu scoped to the filename", () => {
    render(<EditRows item={editItem({ patch: true })} />);

    const toggle = screen.getByRole("button", { name: "Toggle diff for edit-1.ts" });
    fireEvent.contextMenu(toggle);

    expect(screen.queryByRole("menuitem", { name: "Copy path" })).toBeNull();
    expect(openPrimaryMock).not.toHaveBeenCalled();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps a failed row destructive through hover and focus", () => {
    render(<EditRows item={editItem({ failed: true })} />);
    const row = editRow();

    // The group-level promote-to-foreground rule in authenticated.css is
    // unlayered, so it outranks any Tailwind text-color utility. A failed row
    // opts out through this flag and promotes itself with group variants;
    // without both halves the row loses its red tint exactly on hover/focus.
    expect(row.getAttribute("data-edit-action-failed")).toBe("true");
    expect(row.className).toContain("text-destructive/80");
    expect(row.className).toContain("group-hover/edit-action:text-destructive");
    expect(row.className).toContain("group-focus-within/edit-action:text-destructive");
    expect(row.className).not.toContain("hover:text-foreground");
  });

  it("leaves a succeeded row promoting to foreground", () => {
    render(<EditRows item={editItem()} />);
    const row = editRow();

    expect(row.getAttribute("data-edit-action-failed")).toBeNull();
    expect(row.className).toContain("text-foreground/60");
  });

  it("keeps an unavailable filename from swallowing the row's diff toggle", () => {
    fileReferenceOpenState.canOpenPrimary = false;
    render(<EditRows item={editItem({ patch: true })} />);

    const badge = document.querySelector("[data-file-reference-unavailable='true']");
    // The row's diff toggle is an absolute overlay behind a pointer-events-none
    // content layer. An inert filename must not re-enable pointer events, or it
    // becomes a dead zone over the toggle.
    expect(badge?.className).not.toContain("pointer-events-auto");
  });

  it("shows a persistent copy action in the expanded diff header", () => {
    render(<EditRows item={editItem({ patch: true })} />);

    fireEvent.click(screen.getByRole("button", { name: "Toggle diff for edit-1.ts" }));

    const copy = screen.getByRole("button", { name: "Copy diff for edit-1.ts" });
    expect(copy.closest(".opacity-100")).toBeTruthy();
  });
});

describe("edit-action row hover promotion CSS", () => {
  const AUTHENTICATED_CSS = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../../app/authenticated.css"),
    "utf8",
  );

  it("excludes failed rows from the unlayered promote-to-foreground rule", () => {
    // Unlayered CSS beats every Tailwind utility regardless of specificity, so
    // without this :not() a failed row turns foreground-grey on hover/focus —
    // the one moment its destructive tint matters most.
    expect(AUTHENTICATED_CSS).toContain(
      "[data-edit-action-row]:not([data-edit-action-failed])",
    );
    expect(AUTHENTICATED_CSS).not.toMatch(
      /:is\(:hover, :focus-within\)\s+\[data-edit-action-row\]\s*\{/,
    );
  });
});
