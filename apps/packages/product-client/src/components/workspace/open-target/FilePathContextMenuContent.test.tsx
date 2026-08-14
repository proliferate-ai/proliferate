// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilePathContextMenuContent } from "#product/components/workspace/open-target/FilePathContextMenuContent";

describe("FilePathContextMenuContent", () => {
  it("exposes an accessible file menu and keyboard-openable editor submenu", () => {
    render(
      <FilePathContextMenuContent
        pathKind="file"
        canOpenInViewer
        canOpenExternal
        canReveal
        targets={[
          { id: "cursor", label: "Cursor", kind: "editor", iconId: "cursor" },
          { id: "zed", label: "Zed", kind: "editor", iconId: "zed" },
        ]}
        defaultTarget={{ id: "cursor", label: "Cursor", kind: "editor", iconId: "cursor" }}
        close={vi.fn()}
        onOpenInViewer={vi.fn()}
        onOpenDefault={vi.fn()}
        onOpenTarget={vi.fn()}
        onCopyPath={vi.fn()}
        onRevealInFinder={vi.fn()}
      />,
    );

    expect(screen.getByRole("menu", { name: "File actions" })).toBeTruthy();
    const openWith = screen.getByRole("menuitem", { name: "Open with" });
    expect(openWith.getAttribute("aria-haspopup")).toBe("menu");
    expect(openWith.getAttribute("aria-expanded")).toBe("false");

    fireEvent.keyDown(openWith, { key: "ArrowRight" });

    expect(openWith.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu", { name: "Open with" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Cursor" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Zed" })).toBeTruthy();
  });
});
