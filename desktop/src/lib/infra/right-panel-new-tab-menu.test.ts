// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RIGHT_PANEL_BROWSER_TAB_EVENT,
  requestRightPanelBrowserTab,
} from "@/lib/infra/right-panel-new-tab-menu";

describe("right panel browser tab requests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports unhandled requests when no right panel listener accepts them", () => {
    expect(requestRightPanelBrowserTab()).toBe(false);
  });

  it("reports handled requests only when the listener cancels the request event", () => {
    const handler = vi.fn((event: Event) => {
      expect(event.cancelable).toBe(true);
      event.preventDefault();
    });
    window.addEventListener(RIGHT_PANEL_BROWSER_TAB_EVENT, handler);

    try {
      expect(requestRightPanelBrowserTab()).toBe(true);
    } finally {
      window.removeEventListener(RIGHT_PANEL_BROWSER_TAB_EVENT, handler);
    }

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
