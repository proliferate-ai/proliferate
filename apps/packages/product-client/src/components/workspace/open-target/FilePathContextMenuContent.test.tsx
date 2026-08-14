// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilePathContextMenuContent } from "#product/components/workspace/open-target/FilePathContextMenuContent";

afterEach(cleanup);

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

  it("keeps the editor submenu open when the hovered item is clicked", () => {
    render(
      <FilePathContextMenuContent
        pathKind="file"
        canOpenInViewer
        canOpenExternal
        canReveal
        targets={[{ id: "cursor", label: "Cursor", kind: "editor", iconId: "cursor" }]}
        defaultTarget={{ id: "cursor", label: "Cursor", kind: "editor", iconId: "cursor" }}
        close={vi.fn()}
        onOpenInViewer={vi.fn()}
        onOpenDefault={vi.fn()}
        onOpenTarget={vi.fn()}
        onCopyPath={vi.fn()}
        onRevealInFinder={vi.fn()}
      />,
    );

    const openWith = screen.getByRole("menuitem", { name: "Open with" });
    // Hovering the wrapper is what opens the submenu, so a toggling click
    // would close it on the user's very first click.
    fireEvent.mouseEnter(openWith.parentElement as HTMLElement);
    expect(openWith.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(openWith);

    expect(openWith.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu", { name: "Open with" })).toBeTruthy();
  });
});
