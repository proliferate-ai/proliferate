import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isComposerMentionSelectKey,
  isComposerSubmitKey,
  isRawComposerSubmitKey,
  type ComposerKeyboardEventLike,
} from "@/lib/domain/chat/composer-keyboard";

function event(overrides: Partial<ComposerKeyboardEventLike> = {}): ComposerKeyboardEventLike {
  return {
    ...{
      key: "Enter",
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    },
    ...overrides,
    nativeEvent: {
      isComposing: false,
      ...overrides.nativeEvent,
    },
  };
}

describe("composer keyboard predicates", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits on raw Enter only without modifiers or composition", () => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Linux",
    });

    expect(isRawComposerSubmitKey(event())).toBe(true);
    expect(isRawComposerSubmitKey(event({ shiftKey: true }))).toBe(false);
    expect(isRawComposerSubmitKey(event({ altKey: true }))).toBe(false);
    expect(isRawComposerSubmitKey(event({ ctrlKey: true }))).toBe(false);
    expect(isRawComposerSubmitKey(event({ metaKey: true }))).toBe(false);
    expect(isRawComposerSubmitKey(event({ nativeEvent: { isComposing: true } }))).toBe(false);
  });

  it("submits on Command Enter on Apple platforms", () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });

    expect(isComposerSubmitKey(event({ metaKey: true }))).toBe(true);
    expect(isComposerSubmitKey(event({ ctrlKey: true }))).toBe(false);
    expect(isComposerSubmitKey(event({ metaKey: true, shiftKey: true }))).toBe(false);
  });

  it("submits on Ctrl Enter on non-Apple platforms", () => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Linux",
    });

    expect(isComposerSubmitKey(event({ ctrlKey: true }))).toBe(true);
    expect(isComposerSubmitKey(event({ metaKey: true }))).toBe(false);
    expect(isComposerSubmitKey(event({ ctrlKey: true, altKey: true }))).toBe(false);
  });

  it("uses raw Enter or unshifted Tab for mention selection only", () => {
    expect(isComposerMentionSelectKey(event())).toBe(true);
    expect(isComposerMentionSelectKey(event({ key: "Tab" }))).toBe(true);
    expect(isComposerMentionSelectKey(event({ key: "Tab", shiftKey: true }))).toBe(false);
    expect(isComposerMentionSelectKey(event({ metaKey: true }))).toBe(false);
    expect(isComposerMentionSelectKey(event({ ctrlKey: true }))).toBe(false);
    expect(isComposerMentionSelectKey(event({ nativeEvent: { isComposing: true } }))).toBe(false);
  });
});
