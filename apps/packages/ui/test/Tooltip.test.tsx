// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Tooltip } from "../src/primitives/Tooltip";

/**
 * The primitive opens on hover via pointer events, so hovering has to be driven
 * with the pointer sequence a real device sends rather than a bare mouseOver.
 */
function hover(element: HTMLElement) {
  fireEvent.pointerEnter(element, { pointerType: "mouse" });
  fireEvent.mouseEnter(element);
  fireEvent.pointerMove(element, { pointerType: "mouse" });
}

function unhover(element: HTMLElement) {
  fireEvent.pointerLeave(element, { pointerType: "mouse" });
  fireEvent.mouseLeave(element);
}

function press(element: HTMLElement) {
  fireEvent.pointerDown(element, { pointerType: "mouse" });
  fireEvent.mouseDown(element);
  fireEvent.pointerUp(element, { pointerType: "mouse" });
  fireEvent.mouseUp(element);
  fireEvent.click(element);
}

describe("Tooltip", () => {
  afterEach(cleanup);

  /**
   * Regression for "hovering reasoning must ALWAYS show the tooltip even if you
   * are clicking": the underlying primitive dismisses on pointer-down, which
   * made the tooltip blink out on every step of an in-place stepper. Opting into
   * `keepOpenOnPress` keeps it up across clicks while the pointer stays put.
   */
  it("stays open across clicks when keepOpenOnPress is set", async () => {
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

    press(trigger);
    press(trigger);
    expect(screen.getAllByText("Reasoning: High").length).toBeGreaterThan(0);
  });

  it("closes once the pointer leaves a keepOpenOnPress trigger", async () => {
    render(
      <Tooltip content="Reasoning: High" keepOpenOnPress>
        <button type="button">bars</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole("button");
    const wrapper = trigger.parentElement!;
    hover(wrapper);
    await waitFor(() => {
      expect(screen.getAllByText("Reasoning: High").length).toBeGreaterThan(0);
    });

    press(trigger);
    unhover(wrapper);
    await waitFor(() => {
      expect(screen.queryByText("Reasoning: High")).toBeNull();
    });
  });

  /**
   * Escape and blur are the only dismissals a keyboard or switch-access user
   * has for hover/focus content (WCAG 1.4.13), so `keepOpenOnPress` must
   * suppress the press dismissal *only*. Suppressing every close request left
   * the tooltip stuck open with no pointer-free way out.
   */
  it("still closes on Escape when keepOpenOnPress is set", async () => {
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

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByText("Reasoning: High")).toBeNull();
    });
  });

  /**
   * The three presses that produce no `click`. An earlier fix cleared its
   * suppression on the click that follows a press, which meant each of these
   * left it set forever and Escape dead — the tooltip pinned over the composer
   * with no keystroke able to remove it. Escape must work mid-press, not merely
   * after a well-formed one.
   */
  it.each([
    [
      "a press released off the trigger",
      (trigger: HTMLElement) => {
        fireEvent.pointerDown(trigger, { pointerType: "mouse" });
        fireEvent.pointerUp(document.body, { pointerType: "mouse" });
      },
    ],
    [
      "a right-click, which dispatches contextmenu instead of click",
      (trigger: HTMLElement) => {
        fireEvent.pointerDown(trigger, { pointerType: "mouse", button: 2 });
        fireEvent.contextMenu(trigger);
      },
    ],
    [
      "a press still being held",
      (trigger: HTMLElement) => {
        fireEvent.pointerDown(trigger, { pointerType: "mouse" });
      },
    ],
  ])("still closes on Escape after %s", async (_name, doPress) => {
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

    doPress(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByText("Reasoning: High")).toBeNull();
    });
  });

  /**
   * Touch fires `pointerenter` but never `pointerleave`, so opening on enter
   * pinned the tooltip open on a tap with no dismissal a touch-only user can
   * reach — Escape is not available to them. Touch keeps the primitive's own
   * pointer-down dismissal instead.
   */
  it("does not pin itself open on a touch tap", async () => {
    render(
      <Tooltip content="Reasoning: High" keepOpenOnPress>
        <button type="button">bars</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole("button");
    fireEvent.pointerEnter(trigger.parentElement!, { pointerType: "touch" });
    fireEvent.pointerDown(trigger, { pointerType: "touch" });
    fireEvent.pointerUp(trigger, { pointerType: "touch" });
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.queryByText("Reasoning: High")).toBeNull();
    });
  });

  it("still closes when focus leaves a keepOpenOnPress trigger", async () => {
    render(
      <Tooltip content="Reasoning: High" keepOpenOnPress>
        <button type="button">bars</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole("button");
    fireEvent.focus(trigger);
    await waitFor(() => {
      expect(screen.getAllByText("Reasoning: High").length).toBeGreaterThan(0);
    });

    fireEvent.blur(trigger);
    await waitFor(() => {
      expect(screen.queryByText("Reasoning: High")).toBeNull();
    });
  });

  it("renders content without any hover when open is controlled on", async () => {
    render(
      <Tooltip content="Reasoning: High" open>
        <button type="button">bars</button>
      </Tooltip>,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Reasoning: High").length).toBeGreaterThan(0);
    });
  });

  /**
   * A controlled tooltip must not let the internal hover/press machinery
   * fight the caller: with `open={false}` the caller's value is the whole
   * truth, so hovering and pressing change nothing.
   */
  it("stays closed under hover and press when open is controlled off", async () => {
    render(
      <Tooltip content="Reasoning: High" keepOpenOnPress open={false}>
        <button type="button">bars</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole("button");
    hover(trigger.parentElement!);
    press(trigger);
    await waitFor(() => {
      expect(screen.queryByText("Reasoning: High")).toBeNull();
    });
  });

  it("leaves the default press-to-dismiss behavior alone when not opted in", async () => {
    render(
      <Tooltip content="Opens a menu">
        <button type="button">menu</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole("button");
    hover(trigger.parentElement!);
    await waitFor(() => {
      expect(screen.getAllByText("Opens a menu").length).toBeGreaterThan(0);
    });

    press(trigger);
    await waitFor(() => {
      expect(screen.queryByText("Opens a menu")).toBeNull();
    });
  });
});
