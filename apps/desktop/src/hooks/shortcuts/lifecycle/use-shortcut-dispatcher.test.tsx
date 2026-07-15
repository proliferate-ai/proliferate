// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useShortcutDispatcher } from "@/hooks/shortcuts/lifecycle/use-shortcut-dispatcher";
import {
  clearShortcutHandlerRegistryForTests,
  registerShortcutHandler,
} from "@/lib/domain/shortcuts/registry";

describe("useShortcutDispatcher", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });
    clearShortcutHandlerRegistryForTests();
  });

  afterEach(() => {
    cleanup();
    clearShortcutHandlerRegistryForTests();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("falls through duplicate keyboard matches until a registered handler consumes one", () => {
    const settingsHandler = vi.fn();
    registerShortcutHandler("settings.section-by-index", settingsHandler);
    renderHook(() => useShortcutDispatcher());

    const event = new KeyboardEvent("keydown", {
      key: "1",
      code: "Digit1",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(settingsHandler).toHaveBeenCalledWith({
      source: "keyboard",
      digit: 1,
    });
    expect(event.defaultPrevented).toBe(true);
  });
});
