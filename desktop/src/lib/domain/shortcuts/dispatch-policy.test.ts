import { afterEach, describe, expect, it, vi } from "vitest";
import { SHORTCUTS } from "@/config/shortcuts";
import { shouldDispatchKeyboardShortcut } from "@/lib/domain/shortcuts/dispatch-policy";

describe("shortcut dispatch policy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("respects defaultPrevented for non-rename shortcuts", () => {
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.openSettings, {
      key: ",",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: true,
      target: null,
    } as KeyboardEvent)).toBe(false);
  });

  it("allows the reload-blocked rename shortcut through", () => {
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.renameSession, {
      key: "r",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: true,
      target: null,
    } as KeyboardEvent)).toBe(true);
  });

  it("allows the reload-blocked close-tabs-to-right shortcut through", () => {
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.closeTabsToRight, {
      key: "r",
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      defaultPrevented: true,
      target: null,
    } as KeyboardEvent)).toBe(true);
  });

  it("still blocks rename in disallowed text-entry targets", () => {
    expect(shouldDispatchKeyboardShortcut({
      ...SHORTCUTS.addRepository,
      id: SHORTCUTS.renameSession.id,
    }, {
      key: "r",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: true,
      target: {
        tagName: "TEXTAREA",
        isContentEditable: false,
      } as unknown as EventTarget,
    } as KeyboardEvent)).toBe(false);
  });

  it("blocks input-disallowed shortcuts while terminal focus is active", () => {
    vi.stubGlobal("document", {
      activeElement: {
        closest: () => ({
          getAttribute: () => "terminal",
        }),
      },
    });

    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.toggleLeftSidebar, {
      key: "b",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
      target: null,
    } as KeyboardEvent)).toBe(false);
  });
});
