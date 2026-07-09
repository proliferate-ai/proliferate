import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveKeyboardShortcut,
  resolveKeyboardShortcuts,
} from "@/lib/domain/shortcuts/keyboard-resolution";

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
      shiftKey: true,
      altKey: true,
    } as KeyboardEvent)).toEqual({
      id: "workspace.new-worktree",
      shortcut: expect.objectContaining({ id: "workspace.new-worktree" }),
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

    expect(resolveKeyboardShortcut({
      key: "n",
      code: "KeyN",
      metaKey: false,
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent)).toBeNull();
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
      key: "/",
      code: "Slash",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "app.show-keyboard-shortcuts",
      shortcut: expect.objectContaining({ id: "app.show-keyboard-shortcuts" }),
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
      key: "w",
      code: "KeyW",
      metaKey: true,
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "app.open-web",
      shortcut: expect.objectContaining({ id: "app.open-web" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "s",
      code: "KeyS",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "app.open-support",
      shortcut: expect.objectContaining({ id: "app.open-support" }),
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

  it("keeps command-comma settings distinct from command-option-comma home on mac", () => {
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
    } as KeyboardEvent)).toBeNull();

    expect(resolveKeyboardShortcut({
      key: ",",
      code: "Comma",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
    } as KeyboardEvent)).toEqual({
      id: "app.go-home",
      shortcut: expect.objectContaining({ id: "app.go-home" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "n",
      code: "KeyN",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent)).toBeNull();
  });

  it("resolves new workspace shortcuts by physical KeyN on mac", () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });

    expect(resolveKeyboardShortcut({
      key: "Dead",
      code: "KeyN",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
    } as KeyboardEvent)).toEqual({
      id: "workspace.new-worktree",
      shortcut: expect.objectContaining({ id: "workspace.new-worktree" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "N",
      code: "KeyN",
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "workspace.new-local",
      shortcut: expect.objectContaining({ id: "workspace.new-local" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "Unexpected",
      code: "KeyN",
      metaKey: true,
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "workspace.new-cloud",
      shortcut: expect.objectContaining({ id: "workspace.new-cloud" }),
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
      key: "}",
      code: "BracketRight",
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "workspace.next-tab",
      shortcut: expect.objectContaining({ id: "workspace.next-tab" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "ArrowLeft",
      code: "ArrowLeft",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
    } as KeyboardEvent)).toEqual({
      id: "workspace.previous-tab",
      shortcut: expect.objectContaining({
        id: "workspace.previous-tab",
        label: "⌘⌥←",
      }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "ArrowRight",
      code: "ArrowRight",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
    } as KeyboardEvent)).toEqual({
      id: "workspace.next-tab",
      shortcut: expect.objectContaining({
        id: "workspace.next-tab",
        label: "⌘⌥→",
      }),
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

    expect(resolveKeyboardShortcuts({
      key: "1",
      code: "Digit1",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent).map((resolved) => resolved.id)).toEqual([
      "workspace.tab-by-index",
      "settings.section-by-index",
    ]);

    expect(resolveKeyboardShortcut({
      key: "t",
      code: "KeyT",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "workspace.new-session-tab",
      shortcut: expect.objectContaining({ id: "workspace.new-session-tab" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "O",
      code: "KeyO",
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "workspace.close-other-tabs",
      shortcut: expect.objectContaining({
        id: "workspace.close-other-tabs",
        label: "⌘⇧O",
      }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "w",
      code: "KeyW",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
    } as KeyboardEvent)).toEqual({
      id: "workspace.open-in-web",
      shortcut: expect.objectContaining({ id: "workspace.open-in-web" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "s",
      code: "KeyS",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
    } as KeyboardEvent)).toEqual({
      id: "workspace.sync-to-web",
      shortcut: expect.objectContaining({ id: "workspace.sync-to-web" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
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

  it("resolves web shortcuts with non-mac bindings", () => {
    expect(resolveKeyboardShortcut({
      key: "w",
      code: "KeyW",
      metaKey: false,
      ctrlKey: true,
      shiftKey: false,
      altKey: true,
    } as KeyboardEvent)).toEqual({
      id: "workspace.open-in-web",
      shortcut: expect.objectContaining({ id: "workspace.open-in-web" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "s",
      code: "KeyS",
      metaKey: false,
      ctrlKey: true,
      shiftKey: false,
      altKey: true,
    } as KeyboardEvent)).toEqual({
      id: "workspace.sync-to-web",
      shortcut: expect.objectContaining({ id: "workspace.sync-to-web" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "W",
      code: "KeyW",
      metaKey: false,
      ctrlKey: true,
      shiftKey: true,
      altKey: true,
    } as KeyboardEvent)).toEqual({
      id: "app.open-web",
      shortcut: expect.objectContaining({ id: "app.open-web" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });
  });
});
