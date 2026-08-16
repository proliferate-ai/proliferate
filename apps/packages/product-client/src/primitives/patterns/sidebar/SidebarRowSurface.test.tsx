// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarRowSurface } from "#product/primitives/patterns/sidebar/SidebarRowSurface";

afterEach(cleanup);

function flushFrame() {
  act(() => {
    vi.advanceTimersToNextFrame();
  });
}

describe("SidebarRowSurface", () => {
  it("always settles into bg-selected, even after many rapid re-selections in the same tick", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<SidebarRowSurface active={false}>Row</SidebarRowSurface>);
    const row = () => container.firstElementChild as HTMLElement;

    expect(row().className).not.toContain("bg-selected");

    // Simulate many workspace switches landing faster than a paint: active
    // flips true/false/true repeatedly before any frame is settled.
    for (let i = 0; i < 20; i += 1) {
      rerender(<SidebarRowSurface active={i % 2 === 0}>Row</SidebarRowSurface>);
    }
    rerender(<SidebarRowSurface active>Row</SidebarRowSurface>);

    // data-active reflects the true logical state immediately.
    expect(row().getAttribute("data-active")).toBe("true");

    // The visual class hasn't jumped yet: it settles one animation frame
    // behind so the browser always paints a real, distinct "before" frame.
    expect(row().className).not.toContain("bg-selected");

    flushFrame();

    expect(row().className).toContain("bg-selected");
    vi.useRealTimers();
  });
});
