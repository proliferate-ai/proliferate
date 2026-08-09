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
  it("exposes all actions and supports roving keyboard focus", async () => {
    const onAction = vi.fn<(action: SelectedResponseAction) => void>();
    renderMenu({ focusRequestNonce: 1, onAction });

    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Add to chat",
      "More details",
      "Ask in side chat",
    ]);
    expect(items.map((item) => item.tabIndex)).toEqual([0, -1, -1]);
    await waitFor(() => expect(document.activeElement).toBe(items[0]));

    fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    expect(items.map((item) => item.tabIndex)).toEqual([-1, 0, -1]);
    fireEvent.click(items[2]!);
    expect(onAction).toHaveBeenCalledWith("side-chat");
  });

  it("dismisses on Escape", async () => {
    const onEscape = vi.fn();
    renderMenu({ onEscape });
    const menu = await screen.findByRole("menu", { name: "Selected response actions" });

    fireEvent.keyDown(menu, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledOnce();
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
