import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPOSER_SHORTCUTS, SHORTCUTS } from "@/config/shortcuts";
import {
  getShortcutDisplayLabel,
  isTextEntryTarget,
  matchShortcut,
  matchShortcutDef,
} from "@/lib/domain/shortcuts/matching";

describe("shortcut matching", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Linux",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("matches fixed keys case-insensitively for character shortcuts", () => {
    expect(matchShortcut(
      { kind: "fixed", key: "n", meta: true, shift: false, alt: false },
      {
        key: "N",
        code: "KeyN",
        metaKey: false,
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
      } as KeyboardEvent,
    )).toEqual({});
  });

  it("matches digit shortcuts by key", () => {
    expect(matchShortcut(
      { kind: "digit-key", meta: true, shift: false, alt: false },
      {
        key: "7",
        code: "Digit7",
        metaKey: false,
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
      } as KeyboardEvent,
    )).toEqual({ digit: 7 });
  });

  it("matches digit shortcuts by code", () => {
    expect(matchShortcut(
      { kind: "digit-code", meta: true, shift: false, alt: true },
      {
        key: "&",
        code: "Digit7",
        metaKey: false,
        ctrlKey: true,
        shiftKey: false,
        altKey: true,
      } as KeyboardEvent,
    )).toEqual({ digit: 7 });
  });

  it("requires exact shift and alt modifiers", () => {
    expect(matchShortcut(
      { kind: "fixed", key: "p", meta: true, shift: false, alt: false },
      {
        key: "p",
        code: "KeyP",
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
        altKey: false,
      } as KeyboardEvent,
    )).toBeNull();
  });

  it("requires control in addition to command for ctrl-qualified mac shortcuts", () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });

    expect(matchShortcut(
      { kind: "fixed", key: "n", meta: true, ctrl: true, shift: false, alt: false },
      {
        key: "n",
        code: "KeyN",
        metaKey: true,
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
      } as KeyboardEvent,
    )).toEqual({});

    expect(matchShortcut(
      { kind: "fixed", key: "n", meta: true, ctrl: true, shift: false, alt: false },
      {
        key: "n",
        code: "KeyN",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      } as KeyboardEvent,
    )).toBeNull();
  });

  it("uses the non-mac cloud shortcut binding and label", () => {
    expect(getShortcutDisplayLabel(SHORTCUTS.newCloud)).toBe("Ctrl+Alt+N");

    expect(matchShortcutDef(
      SHORTCUTS.newCloud,
      {
        key: "n",
        code: "KeyN",
        metaKey: false,
        ctrlKey: true,
        shiftKey: false,
        altKey: true,
      } as KeyboardEvent,
    )).toEqual({});

    expect(matchShortcut(
      { kind: "fixed", key: "n", meta: true, ctrl: true, shift: false, alt: false },
      {
        key: "n",
        code: "KeyN",
        metaKey: false,
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
      } as KeyboardEvent,
    )).toBeNull();
  });

  it("uses platform-specific composer shortcut labels", () => {
    expect(getShortcutDisplayLabel(COMPOSER_SHORTCUTS.submitMessage)).toBe("↵ / Ctrl+Enter");

    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });

    expect(getShortcutDisplayLabel(COMPOSER_SHORTCUTS.submitMessage)).toBe("↵ / ⌘↵");
  });
});

describe("isTextEntryTarget", () => {
  it("accepts inputs, textareas, and contentEditable elements", () => {
    const input = { tagName: "INPUT", isContentEditable: false };
    const textarea = { tagName: "TEXTAREA", isContentEditable: false };
    const editable = { tagName: "DIV", isContentEditable: true };

    expect(isTextEntryTarget(input as unknown as EventTarget)).toBe(true);
    expect(isTextEntryTarget(textarea as unknown as EventTarget)).toBe(true);
    expect(isTextEntryTarget(editable as unknown as EventTarget)).toBe(true);
  });

  it("rejects non-text elements", () => {
    expect(isTextEntryTarget({
      tagName: "BUTTON",
      isContentEditable: false,
    } as unknown as EventTarget)).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});
