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
