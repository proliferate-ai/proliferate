/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnchoredCommandPopover } from "#product/primitives/AnchoredCommandPopover";

afterEach(() => {
  cleanup();
});

function content(): HTMLElement | null {
  return document.querySelector("[data-slot=popover-content]");
}

describe("AnchoredCommandPopover", () => {
  it("names the dialog it raises", () => {
    render(
      <AnchoredCommandPopover open onOpenChange={vi.fn()} aria-label="Add a repository">
        <p>body</p>
      </AnchoredCommandPopover>,
    );

    expect(screen.getByRole("dialog", { name: "Add a repository" })).toBeTruthy();
  });

  it("layers on the semantic popover token, never a numeric z", () => {
    render(
      <AnchoredCommandPopover open onOpenChange={vi.fn()} aria-label="Add a repository">
        <p>body</p>
      </AnchoredCommandPopover>,
    );

    expect(content()?.className).toContain("z-popover");
    expect(content()?.className).not.toMatch(/(^|\s)z-\d+(\s|$)/);
  });

  it("animates only while open, so a closed surface can unmount", () => {
    render(
      <AnchoredCommandPopover open onOpenChange={vi.fn()} aria-label="Add a repository">
        <p>body</p>
      </AnchoredCommandPopover>,
    );

    expect(content()?.className).toContain("data-[state=open]:animate-popover-in");
    expect(content()?.className).not.toMatch(/(^|\s)animate-popover-in(\s|$)/);
  });

  it("carries the caller's surface class", () => {
    render(
      <AnchoredCommandPopover
        open
        onOpenChange={vi.fn()}
        aria-label="Add a repository"
        className="w-80"
      >
        <p>body</p>
      </AnchoredCommandPopover>,
    );

    expect(content()?.className).toContain("w-80");
  });

  it("renders nothing while closed", () => {
    render(
      <AnchoredCommandPopover open={false} onOpenChange={vi.fn()} aria-label="Add a repository">
        <p>body</p>
      </AnchoredCommandPopover>,
    );

    expect(content()).toBeNull();
  });
});
