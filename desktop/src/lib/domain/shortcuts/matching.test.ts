import { describe, expect, it } from "vitest";
import { matchShortcut, isTextEntryTarget } from "@/lib/domain/shortcuts/matching";

describe("shortcut matching", () => {
  it("matches fixed keys case-insensitively for character shortcuts", () => {
    expect(matchShortcut(
      { kind: "fixed", key: "n", meta: true, shift: false, alt: false },
      {
        key: "N",
        code: "KeyN",
        metaKey: true,
        ctrlKey: false,
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
        metaKey: true,
        ctrlKey: false,
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
