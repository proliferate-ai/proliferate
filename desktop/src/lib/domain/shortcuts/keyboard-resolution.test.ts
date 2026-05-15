import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveKeyboardShortcut } from "@/lib/domain/shortcuts/keyboard-resolution";

describe("resolveKeyboardShortcut", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Linux",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps non-mac new cloud distinct from new local", () => {
    expect(resolveKeyboardShortcut({
      key: "n",
      code: "KeyN",
      metaKey: false,
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "workspace.new-local",
      shortcut: expect.objectContaining({ id: "workspace.new-local" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "n",
      code: "KeyN",
      metaKey: false,
      ctrlKey: true,
      shiftKey: false,
      altKey: true,
    } as KeyboardEvent)).toEqual({
      id: "workspace.new-cloud",
      shortcut: expect.objectContaining({ id: "workspace.new-cloud" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });
  });

  it("opens top-level app shortcuts on mac", () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });

    expect(resolveKeyboardShortcut({
      key: "k",
      code: "KeyK",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "workspace.open-command-palette",
      shortcut: expect.objectContaining({ id: "workspace.open-command-palette" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "p",
      code: "KeyP",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "app.go-plugins",
      shortcut: expect.objectContaining({ id: "app.go-plugins" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "u",
      code: "KeyU",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "app.go-automations",
      shortcut: expect.objectContaining({ id: "app.go-automations" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "a",
      code: "KeyA",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "app.select-all",
      shortcut: expect.objectContaining({ id: "app.select-all" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });
  });

  it("keeps command-comma settings distinct from command-shift-comma home on mac", () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });

    expect(resolveKeyboardShortcut({
      key: ",",
      code: "Comma",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "app.open-settings",
      shortcut: expect.objectContaining({ id: "app.open-settings" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "h",
      code: "KeyH",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent)).toBeNull();

    expect(resolveKeyboardShortcut({
      key: "<",
      code: "Comma",
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "app.go-home",
      shortcut: expect.objectContaining({ id: "app.go-home" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });
  });

  it("resolves command-option workspace and tab shortcuts on mac", () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });

    expect(resolveKeyboardShortcut({
      key: "ArrowDown",
      code: "ArrowDown",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
    } as KeyboardEvent)).toEqual({
      id: "workspace.next-workspace",
      shortcut: expect.objectContaining({ id: "workspace.next-workspace" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: ">",
      code: "Period",
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: true,
    } as KeyboardEvent)).toEqual({
      id: "workspace.next-tab",
      shortcut: expect.objectContaining({ id: "workspace.next-tab" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "1",
      code: "Digit1",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
    } as KeyboardEvent)).toEqual({
      id: "workspace.by-index",
      shortcut: expect.objectContaining({ id: "workspace.by-index" }),
      trigger: expect.objectContaining({ source: "keyboard", digit: 1 }),
    });
  });

  it("resolves directional chat and terminal shortcuts on mac", () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });

    expect(resolveKeyboardShortcut({
      key: "l",
      code: "KeyL",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "workspace.focus-chat",
      shortcut: expect.objectContaining({ id: "workspace.focus-chat" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "j",
      code: "KeyJ",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "workspace.open-terminal",
      shortcut: expect.objectContaining({ id: "workspace.open-terminal" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "b",
      code: "KeyB",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "workspace.toggle-left-sidebar",
      shortcut: expect.objectContaining({ id: "workspace.toggle-left-sidebar" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "∫",
      code: "KeyB",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "workspace.toggle-left-sidebar",
      shortcut: expect.objectContaining({ id: "workspace.toggle-left-sidebar" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "b",
      code: "KeyB",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
    } as KeyboardEvent)).toEqual({
      id: "workspace.toggle-right-panel",
      shortcut: expect.objectContaining({ id: "workspace.toggle-right-panel" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "∫",
      code: "KeyB",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
    } as KeyboardEvent)).toEqual({
      id: "workspace.toggle-right-panel",
      shortcut: expect.objectContaining({ id: "workspace.toggle-right-panel" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });
  });

  it("resolves directional chat and terminal shortcuts with ctrl on non-mac", () => {
    expect(resolveKeyboardShortcut({
      key: "l",
      code: "KeyL",
      metaKey: false,
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "workspace.focus-chat",
      shortcut: expect.objectContaining({ id: "workspace.focus-chat" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "j",
      code: "KeyJ",
      metaKey: false,
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "workspace.open-terminal",
      shortcut: expect.objectContaining({ id: "workspace.open-terminal" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });
  });
});
