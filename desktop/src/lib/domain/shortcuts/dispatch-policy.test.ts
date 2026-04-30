import { describe, expect, it } from "vitest";
import { SHORTCUTS } from "@/config/shortcuts";
import { shouldDispatchKeyboardShortcut } from "@/lib/domain/shortcuts/dispatch-policy";

describe("shortcut dispatch policy", () => {
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
});
