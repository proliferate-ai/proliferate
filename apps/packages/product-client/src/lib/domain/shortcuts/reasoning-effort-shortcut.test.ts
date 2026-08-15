import { afterEach, expect, it, vi } from "vitest";
import { resolveKeyboardShortcut } from "#product/lib/domain/shortcuts/keyboard-resolution";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("resolves literal Control-Shift-E, but not Command-Shift-E, on macOS", () => {
  vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "Mac OS X" });

  expect(resolveKeyboardShortcut({
    key: "E",
    code: "KeyE",
    metaKey: false,
    ctrlKey: true,
    shiftKey: true,
    altKey: false,
  } as KeyboardEvent)).toEqual({
    id: "workspace.cycle-reasoning-effort",
    shortcut: expect.objectContaining({ id: "workspace.cycle-reasoning-effort", label: "⌃⇧E" }),
    trigger: expect.objectContaining({ source: "keyboard" }),
  });

  expect(resolveKeyboardShortcut({
    key: "E",
    code: "KeyE",
    metaKey: true,
    ctrlKey: false,
    shiftKey: true,
    altKey: false,
  } as KeyboardEvent)).toBeNull();
});

it("resolves Ctrl-Shift-E on non-Apple platforms", () => {
  vi.stubGlobal("navigator", { platform: "Linux x86_64", userAgent: "Linux" });

  expect(resolveKeyboardShortcut({
    key: "E",
    code: "KeyE",
    metaKey: false,
    ctrlKey: true,
    shiftKey: true,
    altKey: false,
  } as KeyboardEvent)).toEqual(expect.objectContaining({
    id: "workspace.cycle-reasoning-effort",
  }));
});

it("resolves Control-Alt-Shift-E to the backward step on macOS", () => {
  vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "Mac OS X" });

  expect(resolveKeyboardShortcut({
    key: "E",
    code: "KeyE",
    metaKey: false,
    ctrlKey: true,
    shiftKey: true,
    altKey: true,
  } as KeyboardEvent)).toEqual({
    id: "workspace.cycle-reasoning-effort-back",
    shortcut: expect.objectContaining({ id: "workspace.cycle-reasoning-effort-back", label: "⌃⌥⇧E" }),
    trigger: expect.objectContaining({ source: "keyboard" }),
  });
});

it("resolves Ctrl-Alt-Shift-E to the backward step on non-Apple platforms", () => {
  vi.stubGlobal("navigator", { platform: "Linux x86_64", userAgent: "Linux" });

  // On non-Apple, the physical Ctrl key stands in for the "meta" field (see
  // matching.ts's matchesModifiers), matching the existing forward-chord test
  // below rather than a literal metaKey press.
  expect(resolveKeyboardShortcut({
    key: "E",
    code: "KeyE",
    metaKey: false,
    ctrlKey: true,
    shiftKey: true,
    altKey: true,
  } as KeyboardEvent)).toEqual(expect.objectContaining({
    id: "workspace.cycle-reasoning-effort-back",
  }));
});

it("still resolves the forward chord (alt: false) without regressing to the backward step", () => {
  vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "Mac OS X" });

  expect(resolveKeyboardShortcut({
    key: "E",
    code: "KeyE",
    metaKey: false,
    ctrlKey: true,
    shiftKey: true,
    altKey: false,
  } as KeyboardEvent)).toEqual(expect.objectContaining({
    id: "workspace.cycle-reasoning-effort",
  }));
});
