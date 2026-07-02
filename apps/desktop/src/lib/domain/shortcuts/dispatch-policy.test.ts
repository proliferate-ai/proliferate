import { afterEach, describe, expect, it, vi } from "vitest";
import { SHORTCUTS } from "@/config/shortcuts/registry";
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

  it("allows home from text inputs when Cmd+Option+, is not already handled locally", () => {
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.goHome, {
      key: ",",
      code: "Comma",
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

  it("respects defaultPrevented for rename now that reload stays unbound", () => {
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.renameSession, {
      key: "r",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
      defaultPrevented: true,
      target: null,
    } as KeyboardEvent)).toBe(false);
  });

  it("still blocks rename in disallowed text-entry targets", () => {
    expect(shouldDispatchKeyboardShortcut({
      ...SHORTCUTS.settingsSectionByIndex,
      id: SHORTCUTS.renameSession.id,
    }, {
      key: "r",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
      defaultPrevented: false,
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

    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.settingsSectionByIndex, {
      key: "3",
      code: "Digit3",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
      target: null,
    } as KeyboardEvent)).toBe(false);
  });

  it("allows workspace commands from text-entry targets", () => {
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.addRepository, {
      key: "o",
      code: "KeyO",
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

    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.closeOtherTabsShiftAlias, {
      key: "O",
      code: "KeyO",
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      defaultPrevented: true,
      target: {
        tagName: "TEXTAREA",
        isContentEditable: false,
      } as unknown as EventTarget,
    } as KeyboardEvent)).toBe(true);
  });

  it("dispatches the keyboard shortcut sheet on Cmd+/ outside editable targets", () => {
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.showKeyboardShortcuts, {
      key: "/",
      code: "Slash",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
      target: null,
    } as KeyboardEvent)).toBe(true);
  });

  it("declines the keyboard shortcut sheet in editable targets so editors keep Mod-/", () => {
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.showKeyboardShortcuts, {
      key: "/",
      code: "Slash",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
      target: {
        tagName: "TEXTAREA",
        isContentEditable: false,
      } as unknown as EventTarget,
    } as KeyboardEvent)).toBe(false);

    // CodeMirror content is contenteditable; Cmd+/ must stay with the
    // editor's toggleComment even when the editor prevented default first.
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.showKeyboardShortcuts, {
      key: "/",
      code: "Slash",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: true,
      target: {
        tagName: "DIV",
        isContentEditable: true,
      } as unknown as EventTarget,
    } as KeyboardEvent)).toBe(false);
  });

  it("allows the keyboard shortcut sheet through default-prevented non-editable targets", () => {
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.showKeyboardShortcuts, {
      key: "/",
      code: "Slash",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: true,
      target: null,
    } as KeyboardEvent)).toBe(true);

    // The stale Cmd+Shift+/ chord no longer matches the binding-derived bypass.
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.showKeyboardShortcuts, {
      key: "?",
      code: "Slash",
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      defaultPrevented: true,
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
      key: "{",
      code: "BracketLeft",
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      defaultPrevented: false,
      target: {
        tagName: "TEXTAREA",
        isContentEditable: false,
      } as unknown as EventTarget,
    } as KeyboardEvent)).toBe(true);
  });

  it("allows tab cycling when text inputs mark Cmd+Shift+Bracket as handled", () => {
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.nextTab, {
      key: "}",
      code: "BracketRight",
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      defaultPrevented: true,
      target: {
        tagName: "TEXTAREA",
        isContentEditable: false,
      } as unknown as EventTarget,
    } as KeyboardEvent)).toBe(true);
  });

  it("allows shell tab and close shortcuts through default-prevented right-panel targets", () => {
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.tabByIndex, {
      key: "2",
      code: "Digit2",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
      defaultPrevented: true,
      target: null,
    } as KeyboardEvent)).toBe(true);

    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.workspaceByIndex, {
      key: "2",
      code: "Digit2",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: true,
      target: null,
    } as KeyboardEvent)).toBe(true);

    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.closeActiveTab, {
      key: "w",
      code: "KeyW",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: true,
      target: null,
    } as KeyboardEvent)).toBe(true);

    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.newSessionTab, {
      key: "t",
      code: "KeyT",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: true,
      target: null,
    } as KeyboardEvent)).toBe(true);
  });

  it("allows tab index shortcuts from right-panel text inputs even when handled locally", () => {
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.tabByIndex, {
      key: "3",
      code: "Digit3",
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

  it("blocks settings section index shortcuts in text-entry targets", () => {
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.settingsSectionByIndex, {
      key: "3",
      code: "Digit3",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
      target: {
        tagName: "TEXTAREA",
        isContentEditable: false,
      } as unknown as EventTarget,
    } as KeyboardEvent)).toBe(false);
  });

  it("allows tab cycling aliases from right-panel text inputs even when handled locally", () => {
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.previousTab, {
      key: "{",
      code: "BracketLeft",
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      defaultPrevented: true,
      target: {
        tagName: "TEXTAREA",
        isContentEditable: false,
      } as unknown as EventTarget,
    } as KeyboardEvent)).toBe(true);

    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.previousTabArrow, {
      key: "ArrowLeft",
      code: "ArrowLeft",
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

    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.nextTab, {
      key: "}",
      code: "BracketRight",
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      defaultPrevented: true,
      target: {
        tagName: "TEXTAREA",
        isContentEditable: false,
      } as unknown as EventTarget,
    } as KeyboardEvent)).toBe(true);

    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.nextTabArrow, {
      key: "ArrowRight",
      code: "ArrowRight",
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

  it("allows close-other-tabs aliases through default-prevented non-input targets", () => {
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.closeOtherTabs, {
      key: "o",
      code: "KeyO",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
      defaultPrevented: true,
      target: null,
    } as KeyboardEvent)).toBe(true);

    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.closeOtherTabsShiftAlias, {
      key: "O",
      code: "KeyO",
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      defaultPrevented: true,
      target: null,
    } as KeyboardEvent)).toBe(true);
  });

  it("allows tab index shortcuts from terminal focus zones", () => {
    vi.stubGlobal("document", {
      activeElement: {
        closest: () => ({
          getAttribute: () => "terminal",
        }),
      },
    });

    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.tabByIndex, {
      key: "4",
      code: "Digit4",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
      defaultPrevented: true,
      target: null,
    } as KeyboardEvent)).toBe(true);
  });

  it("allows tab cycling from browser focus zones", () => {
    vi.stubGlobal("document", {
      activeElement: {
        closest: () => ({
          getAttribute: () => "browser",
        }),
      },
    });

    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.nextTab, {
      key: "}",
      code: "BracketRight",
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      defaultPrevented: true,
      target: null,
    } as KeyboardEvent)).toBe(true);
  });
});
