// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Tooltip } from "../src/primitives/Tooltip";

function hover(element: HTMLElement) {
  fireEvent.pointerEnter(element, { pointerType: "mouse" });
  fireEvent.mouseEnter(element);
  fireEvent.pointerMove(element, { pointerType: "mouse" });
}

describe("scratch", () => {
  afterEach(cleanup);

  it("keyboard focus then Escape / blur", async () => {
    render(
      <Tooltip content="Reasoning: High" keepOpenOnPress>
        <button type="button">bars</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button");
    // Keyboard focus on the wrapper (the actual TooltipTrigger element)
    const wrapper = trigger.parentElement!;
    fireEvent.focus(wrapper);
    await waitFor(() => {
      expect(screen.getAllByText("Reasoning: High").length).toBeGreaterThan(0);
    });
    // Escape
    fireEvent.keyDown(document, { key: "Escape" });
    await new Promise((r) => setTimeout(r, 50));
    console.log("after Escape open?", screen.queryAllByText("Reasoning: High").length);
    fireEvent.blur(wrapper);
    await new Promise((r) => setTimeout(r, 50));
    console.log("after blur open?", screen.queryAllByText("Reasoning: High").length);
  });

  it("hover then trigger becomes disabled/unmount-ish: scroll close", async () => {
    render(
      <Tooltip content="Reasoning: High" keepOpenOnPress>
        <button type="button">bars</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button");
    hover(trigger.parentElement!);
    await waitFor(() => {
      expect(screen.getAllByText("Reasoning: High").length).toBeGreaterThan(0);
    });
    fireEvent.scroll(document.body);
    await new Promise((r) => setTimeout(r, 50));
    console.log("after scroll open?", screen.queryAllByText("Reasoning: High").length);
  });

  it("two keepOpen tooltips: second open does not close first", async () => {
    render(
      <div>
        <Tooltip content="AAA" keepOpenOnPress>
          <button type="button">a</button>
        </Tooltip>
        <Tooltip content="BBB" keepOpenOnPress>
          <button type="button">b</button>
        </Tooltip>
      </div>,
    );
    const a = screen.getByRole("button", { name: "a" });
    const b = screen.getByRole("button", { name: "b" });
    hover(a.parentElement!);
    await waitFor(() => expect(screen.queryAllByText("AAA").length).toBeGreaterThan(0));
    hover(b.parentElement!);
    await new Promise((r) => setTimeout(r, 50));
    console.log("A count", screen.queryAllByText("AAA").length, "B count", screen.queryAllByText("BBB").length);
  });

  it("pointerdown then pointerleave from inner button (not wrapper)", async () => {
    render(
      <Tooltip content="Reasoning: High" keepOpenOnPress>
        <button type="button">bars</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button");
    hover(trigger.parentElement!);
    await waitFor(() => expect(screen.queryAllByText("Reasoning: High").length).toBeGreaterThan(0));
    // pointerleave dispatched only on the inner button without bubbling to wrapper
    fireEvent(trigger, new PointerEvent("pointerleave", { bubbles: false, pointerType: "mouse" }));
    await new Promise((r) => setTimeout(r, 50));
    console.log("after inner-only pointerleave:", screen.queryAllByText("Reasoning: High").length);
  });
});
