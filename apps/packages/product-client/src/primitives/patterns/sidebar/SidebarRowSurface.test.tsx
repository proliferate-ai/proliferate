// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SidebarRowSurface } from "#product/primitives/patterns/sidebar/SidebarRowSurface";

afterEach(cleanup);

describe("SidebarRowSurface", () => {
  it("applies bg-selected on the very next render, even after many rapid re-selections in the same tick", () => {
    const { container, rerender } = render(<SidebarRowSurface active={false}>Row</SidebarRowSurface>);
    const row = () => container.firstElementChild as HTMLElement;

    expect(row().className).not.toContain("bg-selected");

    // Simulate a fast sweep: many switches land in quick succession, with no
    // paint (and thus no animation frame) guaranteed between any of them.
    for (let i = 0; i < 20; i += 1) {
      rerender(<SidebarRowSurface active={i % 2 === 0}>Row</SidebarRowSurface>);
    }
    rerender(<SidebarRowSurface active>Row</SidebarRowSurface>);

    // The highlight must be visible on this render already: waiting on a
    // frame (rAF-style deferral) is exactly what breaks under main-thread
    // saturation, since the deferred frame may never come in time.
    expect(row().getAttribute("data-active")).toBe("true");
    expect(row().className).toContain("bg-selected");
  });

  it("excludes background-color from the transition set while active, so activation paints instantly", () => {
    const { container } = render(<SidebarRowSurface active>Row</SidebarRowSurface>);
    const row = container.firstElementChild as HTMLElement;

    expect(row.className).toContain("transition-[color,opacity]");
    expect(row.className).not.toContain("transition-[background-color,color,opacity]");
  });

  it("keeps background-color in the transition set while inactive, so deselect/hover still fades", () => {
    const { container } = render(<SidebarRowSurface active={false}>Row</SidebarRowSurface>);
    const row = container.firstElementChild as HTMLElement;

    expect(row.className).toContain("transition-[background-color,color,opacity]");
  });
});
