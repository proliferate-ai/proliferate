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
});
