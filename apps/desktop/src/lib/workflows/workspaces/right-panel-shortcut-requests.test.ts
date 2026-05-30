// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RIGHT_PANEL_SHORTCUT_EVENT,
  requestRightPanelCloseActiveTab,
  requestRightPanelRelativeTab,
  requestRightPanelTabByIndex,
  rightPanelShortcutRequestFromEvent,
} from "@/lib/workflows/workspaces/right-panel-shortcut-requests";

describe("right panel shortcut requests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports unhandled requests when no right panel listener accepts them", () => {
    expect(requestRightPanelCloseActiveTab()).toBe(false);
    expect(requestRightPanelRelativeTab(1)).toBe(false);
    expect(requestRightPanelTabByIndex(2)).toBe(false);
  });

  it("reports handled requests only when the listener cancels the request event", () => {
    const handler = vi.fn((event: Event) => {
      event.preventDefault();
    });
    window.addEventListener(RIGHT_PANEL_SHORTCUT_EVENT, handler);

    try {
      expect(requestRightPanelRelativeTab(-1)).toBe(true);
    } finally {
      window.removeEventListener(RIGHT_PANEL_SHORTCUT_EVENT, handler);
    }

    expect(handler).toHaveBeenCalledTimes(1);
    expect(rightPanelShortcutRequestFromEvent(handler.mock.calls[0]![0])).toEqual({
      kind: "relative-tab",
      delta: -1,
    });
  });

  it("parses close-active-tab requests", () => {
    const handler = vi.fn((event: Event) => {
      event.preventDefault();
    });
    window.addEventListener(RIGHT_PANEL_SHORTCUT_EVENT, handler);

    try {
      expect(requestRightPanelCloseActiveTab()).toBe(true);
    } finally {
      window.removeEventListener(RIGHT_PANEL_SHORTCUT_EVENT, handler);
    }

    expect(rightPanelShortcutRequestFromEvent(handler.mock.calls[0]![0])).toEqual({
      kind: "close-active-tab",
    });
  });
});
