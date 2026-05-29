import { describe, expect, it } from "vitest";
import { canAcceptChatFileDrop, isFileDrag } from "./prompt-attachment-drag";

describe("prompt attachment drag", () => {
  it("detects file drags from file count or drag types", () => {
    expect(isFileDrag({ filesLength: 1, types: [] })).toBe(true);
    expect(isFileDrag({ filesLength: 0, types: ["Files"] })).toBe(true);
    expect(isFileDrag({ filesLength: 0, types: ["text/plain"] })).toBe(false);
  });

  it("gates chat-wide drops on edit, disabled, session, and capability state", () => {
    const base = {
      isEditingQueuedPrompt: false,
      isDisabled: false,
      areRuntimeControlsDisabled: false,
      hasActiveSession: true,
      supportsAttachments: true,
    };
    expect(canAcceptChatFileDrop(base)).toBe(true);
    expect(canAcceptChatFileDrop({ ...base, isEditingQueuedPrompt: true })).toBe(false);
    expect(canAcceptChatFileDrop({ ...base, isDisabled: true })).toBe(false);
    expect(canAcceptChatFileDrop({ ...base, hasActiveSession: false })).toBe(false);
    expect(canAcceptChatFileDrop({ ...base, supportsAttachments: false })).toBe(false);
  });
});
