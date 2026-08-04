import { afterEach, expect, it, vi } from "vitest";
import { resolveKeyboardShortcut } from "#product/lib/domain/shortcuts/keyboard-resolution";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("resolves literal Control-Shift-M, but not Command-Shift-M, on macOS", () => {
  vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "Mac OS X" });

  expect(resolveKeyboardShortcut({
    key: "M",
    code: "KeyM",
    metaKey: false,
    ctrlKey: true,
    shiftKey: true,
    altKey: false,
  } as KeyboardEvent)).toEqual({
    id: "workspace.open-model-selector",
    shortcut: expect.objectContaining({ id: "workspace.open-model-selector", label: "⌃⇧M" }),
    trigger: expect.objectContaining({ source: "keyboard" }),
  });

  expect(resolveKeyboardShortcut({
    key: "M",
    code: "KeyM",
    metaKey: true,
    ctrlKey: false,
    shiftKey: true,
    altKey: false,
  } as KeyboardEvent)).toBeNull();
});
