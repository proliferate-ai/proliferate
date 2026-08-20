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

  it("clears a contextual selection inside the trigger before opening", () => {
    render(
      <PopoverButton
        trigger={<button type="button"><span>notes.md</span></button>}
        triggerMode="contextMenu"
      >
        {() => <div>menu</div>}
      </PopoverButton>,
    );
    const label = screen.getByText("notes.md");
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(label);
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selection.isCollapsed).toBe(false);

    fireEvent.contextMenu(screen.getByRole("button", { name: "notes.md" }));

    expect(selection.rangeCount).toBe(0);
  });

  it("preserves a selection made elsewhere on right-click", () => {
    render(
      <div>
        <p>prose the user selected</p>
        <PopoverButton
          trigger={<button type="button">target</button>}
          triggerMode="contextMenu"
        >
          {() => <div>menu</div>}
        </PopoverButton>
      </div>,
    );
    const paragraph = screen.getByText("prose the user selected");
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.contextMenu(screen.getByRole("button", { name: "target" }));

    expect(selection.isCollapsed).toBe(false);
    expect(selection.rangeCount).toBe(1);
  });

  it("preserves a deliberate selection with one endpoint outside the trigger", () => {
    render(
      <div>
        <p>before</p>
        <PopoverButton
          trigger={<button type="button">target</button>}
          triggerMode="contextMenu"
        >
          {() => <div>menu</div>}
        </PopoverButton>
      </div>,
    );
    const paragraph = screen.getByText("before");
    const trigger = screen.getByRole("button", { name: "target" });
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(paragraph, 0);
    range.setEnd(trigger, trigger.childNodes.length);
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.contextMenu(trigger);

    expect(selection.rangeCount).toBe(1);
  });

  it("does not clear the selection when preserveContextualSelection is true", () => {
    render(
      <PopoverButton
        trigger={<button type="button"><span>notes.md</span></button>}
        triggerMode="contextMenu"
        preserveContextualSelection
      >
        {() => <div>menu</div>}
      </PopoverButton>,
    );
    const label = screen.getByText("notes.md");
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(label);
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.contextMenu(screen.getByRole("button", { name: "notes.md" }));

    expect(selection.rangeCount).toBe(1);
  });
});
