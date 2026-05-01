import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveKeyboardShortcut } from "@/hooks/shortcuts/use-shortcut-dispatcher";

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

  it("opens the command palette with command-k on mac", () => {
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
    } as KeyboardEvent)).toBeNull();
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
