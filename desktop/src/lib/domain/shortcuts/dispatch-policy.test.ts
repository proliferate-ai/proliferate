import { afterEach, describe, expect, it, vi } from "vitest";
import { SHORTCUTS } from "@/config/shortcuts";
import { shouldDispatchKeyboardShortcut } from "@/lib/domain/shortcuts/dispatch-policy";

describe("shortcut dispatch policy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("respects defaultPrevented for non-rename shortcuts", () => {
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.openTerminal, {
      key: "j",
      code: "KeyJ",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: true,
      target: null,
    } as KeyboardEvent)).toBe(false);
  });

  it("allows settings through when the WebView marks Cmd+, as handled", () => {
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.openSettings, {
      key: ",",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: true,
      target: null,
    } as KeyboardEvent)).toBe(true);
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

    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.addRepository, {
      key: "i",
      code: "KeyI",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
      target: null,
    } as KeyboardEvent)).toBe(false);
  });

  it("allows left-sidebar toggle from text-entry and terminal focus targets", () => {
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.toggleLeftSidebar, {
      key: "b",
      code: "KeyB",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
      target: {
        tagName: "TEXTAREA",
        isContentEditable: false,
      } as unknown as EventTarget,
    } as KeyboardEvent)).toBe(true);

    vi.stubGlobal("document", {
      activeElement: {
        closest: () => ({
          getAttribute: () => "terminal",
        }),
      },
    });

    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.toggleLeftSidebar, {
      key: "b",
      code: "KeyB",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
      target: null,
    } as KeyboardEvent)).toBe(true);
  });

  it("allows right-panel toggle from text-entry and terminal focus targets", () => {
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.toggleRightPanel, {
      key: "b",
      code: "KeyB",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
      defaultPrevented: false,
      target: {
        tagName: "TEXTAREA",
        isContentEditable: false,
      } as unknown as EventTarget,
    } as KeyboardEvent)).toBe(true);

    vi.stubGlobal("document", {
      activeElement: {
        closest: () => ({
          getAttribute: () => "terminal",
        }),
      },
    });

    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.toggleRightPanel, {
      key: "b",
      code: "KeyB",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
      defaultPrevented: false,
      target: null,
    } as KeyboardEvent)).toBe(true);
  });

  it("allows only the exact left-sidebar toggle through when defaultPrevented", () => {
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.toggleLeftSidebar, {
      key: "b",
      code: "KeyB",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: true,
      target: null,
    } as KeyboardEvent)).toBe(true);

    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.toggleLeftSidebar, {
      key: "b",
      code: "KeyB",
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      defaultPrevented: true,
      target: null,
    } as KeyboardEvent)).toBe(false);
  });

  it("allows only the exact right-panel toggle through when defaultPrevented", () => {
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.toggleRightPanel, {
      key: "b",
      code: "KeyB",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
      defaultPrevented: true,
      target: null,
    } as KeyboardEvent)).toBe(true);

    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.toggleRightPanel, {
      key: "b",
      code: "KeyB",
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: true,
      defaultPrevented: true,
      target: null,
    } as KeyboardEvent)).toBe(false);
  });

  it("allows tab cycling from text-entry targets", () => {
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.previousTab, {
      key: "ArrowLeft",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
      defaultPrevented: false,
      target: {
        tagName: "TEXTAREA",
        isContentEditable: false,
      } as unknown as EventTarget,
    } as KeyboardEvent)).toBe(true);
  });

  it("allows tab cycling when text inputs mark Cmd+Option+Arrow as handled", () => {
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.nextTab, {
      key: "ArrowRight",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
      defaultPrevented: true,
      target: {
        tagName: "TEXTAREA",
        isContentEditable: false,
      } as unknown as EventTarget,
    } as KeyboardEvent)).toBe(true);
  });
});
