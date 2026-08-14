// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PopoverButton } from "#product/primitives/PopoverButton";

afterEach(cleanup);

describe("PopoverButton", () => {
  // WebKit's secondary-button mousedown default selects the word under the
  // pointer before `contextmenu` fires. PopoverButton always suppresses the
  // browser context menu, so the pre-selection must be suppressed with it —
  // otherwise right-clicking a transcript file mention flashes a text
  // highlight under the menu. fireEvent returns false iff preventDefault ran.
  it("prevents the secondary-button mousedown default on contextMenu triggers", () => {
    render(
      <PopoverButton
        trigger={<button type="button">target</button>}
        triggerMode="contextMenu"
      >
        {() => <div>menu</div>}
      </PopoverButton>,
    );
    const trigger = screen.getByRole("button", { name: "target" });

    expect(fireEvent.mouseDown(trigger, { button: 2 })).toBe(false);
  });

  it("leaves primary-button mousedown untouched", () => {
    render(
      <PopoverButton
        trigger={<button type="button">target</button>}
        triggerMode="contextMenu"
      >
        {() => <div>menu</div>}
      </PopoverButton>,
    );
    const trigger = screen.getByRole("button", { name: "target" });

    expect(fireEvent.mouseDown(trigger, { button: 0 })).toBe(true);
  });

  it("prevents the secondary-button mousedown default on click triggers too", () => {
    render(
      <PopoverButton
        trigger={<button type="button">target</button>}
      >
        {() => <div>menu</div>}
      </PopoverButton>,
    );
    const trigger = screen.getByRole("button", { name: "target" });

    expect(fireEvent.mouseDown(trigger, { button: 2 })).toBe(false);
  });

  // WebKit selects the word under the pointer while preparing the context
  // menu, before `contextmenu` is dispatched and immune to preventDefault.
  // Opening our menu must drop that selection so no highlight paints under
  // it — unless the menu covers genuinely selectable content and opts out.
  it("clears a selection inside the trigger when the context menu opens", () => {
    render(
      <PopoverButton
        trigger={<button type="button">notes.md</button>}
        triggerMode="contextMenu"
      >
        {() => <div>menu</div>}
      </PopoverButton>,
    );
    const trigger = screen.getByRole("button", { name: "notes.md" });
    const selection = selectContents(trigger);
    expect(selection.isCollapsed).toBe(false);

    fireEvent.contextMenu(trigger);

    expect(selection.rangeCount).toBe(0);
  });

  it("leaves a selection outside the trigger alone", () => {
    render(
      <>
        <p>prose the user selected</p>
        <PopoverButton
          trigger={<button type="button">notes.md</button>}
          triggerMode="contextMenu"
        >
          {() => <div>menu</div>}
        </PopoverButton>
      </>,
    );
    const selection = selectContents(screen.getByText("prose the user selected"));

    fireEvent.contextMenu(screen.getByRole("button", { name: "notes.md" }));

    expect(selection.isCollapsed).toBe(false);
  });

  it("keeps the contextual selection when preserveContextualSelection is set", () => {
    render(
      <PopoverButton
        trigger={<button type="button">file content</button>}
        triggerMode="contextMenu"
        preserveContextualSelection
      >
        {() => <div>menu</div>}
      </PopoverButton>,
    );
    const trigger = screen.getByRole("button", { name: "file content" });
    const selection = selectContents(trigger);

    fireEvent.contextMenu(trigger);

    expect(selection.isCollapsed).toBe(false);
  });
});

function selectContents(element: Element) {
  const selection = window.getSelection();
  if (!selection) throw new Error("jsdom selection unavailable");
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}
