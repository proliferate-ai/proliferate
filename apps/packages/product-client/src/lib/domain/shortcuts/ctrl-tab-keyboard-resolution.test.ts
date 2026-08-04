import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveKeyboardShortcut } from "#product/lib/domain/shortcuts/keyboard-resolution";

describe("Ctrl+Tab keyboard resolution", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Linux",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves cycling shortcuts on mac", () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });

    expect(resolveKeyboardShortcut({
      key: "Tab",
      code: "Tab",
      metaKey: false,
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "workspace.next-tab",
      shortcut: expect.objectContaining({
        id: "workspace.next-tab",
        label: "⌃⇥",
      }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "Tab",
      code: "Tab",
      metaKey: false,
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "workspace.previous-tab",
      shortcut: expect.objectContaining({
        id: "workspace.previous-tab",
        label: "⌃⇧⇥",
      }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });
  });

  it("resolves cycling shortcuts on non-mac", () => {
    expect(resolveKeyboardShortcut({
      key: "Tab",
      code: "Tab",
      metaKey: false,
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "workspace.next-tab",
      shortcut: expect.objectContaining({ id: "workspace.next-tab" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });

    expect(resolveKeyboardShortcut({
      key: "Tab",
      code: "Tab",
      metaKey: false,
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
    } as KeyboardEvent)).toEqual({
      id: "workspace.previous-tab",
      shortcut: expect.objectContaining({ id: "workspace.previous-tab" }),
      trigger: expect.objectContaining({ source: "keyboard" }),
    });
  });
});
