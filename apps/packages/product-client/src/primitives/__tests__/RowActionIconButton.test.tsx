// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PopoverButton } from "#product/primitives/PopoverButton";
import { RowActionIconButton } from "#product/primitives/RowActionIconButton";
import { SidebarActionButton } from "#product/primitives/patterns/sidebar/SidebarActionButton";

afterEach(cleanup);

/**
 * [ROW-ACTION-01] (retune-spec.md §5.6). The reveal contract is expressed
 * entirely in `opacity`, so the primitive's transition list MUST include
 * opacity — a colors-only transition makes every revealed row action snap in
 * instantly and makes consumers' `transform-gpu`/`will-change-[opacity]`
 * WKWebView hints meaningless. twMerge treats every `transition-*` spelling as
 * one group, so this is also the reason no adapter may declare its own.
 */
describe("RowActionIconButton reveal transition", () => {
  it("transitions opacity, not only colors, when revealed on group hover", () => {
    render(
      <RowActionIconButton label="Dismiss">
        <span>x</span>
      </RowActionIconButton>,
    );

    const className = screen.getByRole("button", { name: "Dismiss" }).className;
    expect(className).toContain("opacity-0");
    expect(className).toContain("group-hover:opacity-100");
    expect(className).toContain("opacity");
    expect(className).toMatch(/transition-\[[^\]]*opacity[^\]]*\]/);
    expect(className).toContain("duration-hover");
    // A bare colors-only transition is the regression this locks out.
    expect(className).not.toMatch(/(?:^|\s)transition-colors(?:\s|$)/);
  });

  it("keeps the transition when a consumer adds its own classes", () => {
    render(
      <RowActionIconButton
        label="Dismiss card"
        className="absolute right-2 top-2 rounded-full transform-gpu will-change-[opacity]"
      >
        <span>x</span>
      </RowActionIconButton>,
    );

    const className = screen.getByRole("button", { name: "Dismiss card" }).className;
    expect(className).toMatch(/transition-\[[^\]]*opacity[^\]]*\]/);
    expect(className).toContain("will-change-[opacity]");
  });

  it("still transitions opacity through the sidebar tone adapter", () => {
    render(<SidebarActionButton title="Add repository"><span>+</span></SidebarActionButton>);

    const className = screen.getByRole("button", { name: "Add repository" }).className;
    // The adapter re-tones ink and box but must not re-own motion: any
    // `transition-*` it declared would replace the base's whole property list.
    expect(className).toMatch(/transition-\[[^\]]*opacity[^\]]*\]/);
    expect(className).toContain("size-6");
    expect(className).toContain("opacity-0");
  });

  it("drops the reveal classes but keeps the transition when always visible", () => {
    render(
      <RowActionIconButton label="Pinned" visibility="always">
        <span>p</span>
      </RowActionIconButton>,
    );

    const className = screen.getByRole("button", { name: "Pinned" }).className;
    expect(className).not.toContain("opacity-0");
    expect(className).toMatch(/transition-\[[^\]]*opacity[^\]]*\]/);
  });
});

/**
 * PRO-133: the adapter must forward Radix trigger attributes to the base
 * `<button>` — without them its `data-[state=open]:*` classes can never
 * match, so a section trigger lost its highlight the moment the cursor left,
 * even with its menu still open. The open state mirrors the hover ink.
 */
describe("SidebarActionButton as a popover trigger", () => {
  it("carries data-state to the DOM and keeps the hover ink while open", () => {
    render(
      <PopoverButton
        trigger={(
          <SidebarActionButton title="Repository options" variant="section">
            <span>…</span>
          </SidebarActionButton>
        )}
      >
        {() => <div>menu</div>}
      </PopoverButton>,
    );

    const button = screen.getByRole("button", { name: "Repository options" });
    expect(button.getAttribute("data-state")).toBe("closed");

    fireEvent.click(button);

    expect(button.getAttribute("data-state")).toBe("open");
    expect(button.className).toContain("data-[state=open]:text-sidebar-foreground");
    expect(button.className).toContain("data-[state=open]:opacity-100");
    expect(button.className).toContain("data-[state=open]:bg-transparent");
  });
});
