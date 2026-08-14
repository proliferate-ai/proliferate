// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SelectedResponseActionMenu,
  type SelectedResponseAction,
} from "#product/components/workspace/chat/transcript/SelectedResponseActionMenu";
import type { SelectedResponseSelection } from "#product/domain/chats/transcript/selected-response-context";

vi.mock("#product/hooks/chat/workflows/use-selected-response-actions", () => ({
  useSelectedResponseActions: () => ({
    addToChat: vi.fn(),
    moreDetails: vi.fn(),
    askInSideChat: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SelectedResponseActionMenu", () => {
  it("exposes all three actions in order as menu items", async () => {
    renderMenu();

    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Add to chat",
      "More details",
      "Ask in side chat",
    ]);
  });

  it("highlights the first item when the keyboard requested focus", async () => {
    renderMenu({ focusRequestNonce: 1 });

    const items = await screen.findAllByRole("menuitem");
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    expect(items[0]!.hasAttribute("data-highlighted")).toBe(true);
  });

  it("leaves focus alone when the selection was made with the pointer", async () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();

    renderMenu({ focusRequestNonce: 0 });
    await screen.findAllByRole("menuitem");
    await Promise.resolve();

    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("wraps arrow navigation at both ends", async () => {
    renderMenu({ focusRequestNonce: 1 });
    const items = await screen.findAllByRole("menuitem");
    await waitFor(() => expect(document.activeElement).toBe(items[0]));

    // Forward to the last item, then one more to wrap onto the first.
    fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(items[1]));
    fireEvent.keyDown(items[1]!, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(items[2]));
    fireEvent.keyDown(items[2]!, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(items[0]));

    // Backward off the first item wraps onto the last.
    fireEvent.keyDown(items[0]!, { key: "ArrowUp" });
    await waitFor(() => expect(document.activeElement).toBe(items[2]));
  });

  it("supports Home and End", async () => {
    renderMenu({ focusRequestNonce: 1 });
    const items = await screen.findAllByRole("menuitem");
    await waitFor(() => expect(document.activeElement).toBe(items[0]));

    fireEvent.keyDown(items[0]!, { key: "End" });
    await waitFor(() => expect(document.activeElement).toBe(items[2]));

    fireEvent.keyDown(items[2]!, { key: "Home" });
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
  });

  it("activates the focused item with Enter", async () => {
    const onAction = vi.fn<(action: SelectedResponseAction) => void>();
    renderMenu({ focusRequestNonce: 1, onAction });
    const items = await screen.findAllByRole("menuitem");
    await waitFor(() => expect(document.activeElement).toBe(items[0]));

    fireEvent.keyDown(items[0]!, { key: "End" });
    await waitFor(() => expect(document.activeElement).toBe(items[2]));
    fireEvent.keyDown(items[2]!, { key: "Enter" });

    expect(onAction).toHaveBeenCalledWith("side-chat");
  });

  it("activates the focused item with Space", async () => {
    const onAction = vi.fn<(action: SelectedResponseAction) => void>();
    renderMenu({ focusRequestNonce: 1, onAction });
    const items = await screen.findAllByRole("menuitem");
    await waitFor(() => expect(document.activeElement).toBe(items[0]));

    fireEvent.keyDown(items[0]!, { key: " " });

    expect(onAction).toHaveBeenCalledWith("add-to-chat");
  });

  it("dismisses on Escape without running an action", async () => {
    const onAction = vi.fn<(action: SelectedResponseAction) => void>();
    const onEscape = vi.fn();
    renderMenu({ onAction, onEscape });
    await screen.findByRole("menu", { name: "Selected response actions" });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onEscape).toHaveBeenCalledOnce();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("runs the action on click without collapsing the live text selection", async () => {
    const onAction = vi.fn<(action: SelectedResponseAction) => void>();
    renderMenu({ onAction });
    const items = await screen.findAllByRole("menuitem");

    const paragraph = document.createElement("p");
    paragraph.textContent = "Selected response";
    document.body.append(paragraph);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const domSelection = document.getSelection()!;
    domSelection.removeAllRanges();
    domSelection.addRange(range);

    // jsdom never collapses a selection on pointerdown, so asserting the
    // selection survives cannot fail on its own — the assertion that actually
    // holds the guard is that the item CANCELS the pointerdown, which is what
    // stops the browser from moving focus and dropping the range.
    const pointerDown = new window.PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    fireEvent(items[1]!, pointerDown);
    expect(pointerDown.defaultPrevented).toBe(true);
    fireEvent.click(items[1]!);

    expect(onAction).toHaveBeenCalledWith("more-details");
    expect(document.getSelection()?.isCollapsed).toBe(false);
    paragraph.remove();
  });

  it("cancels hover pointer events so Radix cannot move focus into the menu", async () => {
    renderMenu();
    const items = await screen.findAllByRole("menuitem");

    // jsdom never moves focus on hover, so asserting focus stays put cannot
    // fail on its own — the assertion that actually holds the guard is that
    // the item CANCELS pointer-move and pointer-leave (React derives leave
    // from pointerout), which is what makes Radix skip the hover focus moves
    // that collapse the window selection on WebKit and unmount the menu
    // before a click can land.
    for (const item of items) {
      const pointerMove = new window.PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
      });
      fireEvent(item, pointerMove);
      expect(pointerMove.defaultPrevented).toBe(true);

      const pointerOut = new window.PointerEvent("pointerout", {
        bubbles: true,
        cancelable: true,
        relatedTarget: document.body,
      });
      fireEvent(item, pointerOut);
      expect(pointerOut.defaultPrevented).toBe(true);
    }
  });

  it("keeps the dismissal-suppression hook reachable from every item", async () => {
    renderMenu();
    const items = await screen.findAllByRole("menuitem");

    for (const item of items) {
      expect(item.closest("[data-selected-response-actions]")).not.toBeNull();
    }
  });

  it("does not make the page inert while open", async () => {
    renderMenu();
    await screen.findAllByRole("menuitem");

    expect(document.body.style.pointerEvents).not.toBe("none");
  });
});

function renderMenu({
  focusRequestNonce = 0,
  onAction = vi.fn(),
  onDismiss = vi.fn(),
  onEscape = vi.fn(),
}: {
  focusRequestNonce?: number;
  onAction?: (action: SelectedResponseAction) => void;
  onDismiss?: () => void;
  onEscape?: () => void;
} = {}) {
  return render(
    <SelectedResponseActionMenu
      selection={selection}
      focusRequestNonce={focusRequestNonce}
      onAction={onAction}
      onDismiss={onDismiss}
      onEscape={onEscape}
    />,
  );
}

const selection: SelectedResponseSelection = {
  text: "Selected response",
  anchorRect: {
    x: 100,
    y: 120,
    width: 160,
    height: 24,
    top: 120,
    right: 260,
    bottom: 144,
    left: 100,
  },
};
