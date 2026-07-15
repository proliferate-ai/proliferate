// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChatComposerKeyboard } from "./use-chat-composer-keyboard";

function keyboardEvent(overrides: Partial<{
  key: string;
  code: string;
  repeat: boolean;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  defaultPrevented: boolean;
  nativeEvent: { isComposing?: boolean };
  currentTarget: { value: string; selectionStart: number; selectionEnd: number };
}> = {}) {
  const event = {
    key: "Enter",
    code: "Enter",
    repeat: false,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    defaultPrevented: false,
    nativeEvent: {
      isComposing: false,
      ...overrides.nativeEvent,
    },
    currentTarget: {
      value: "",
      selectionStart: 0,
      selectionEnd: 0,
    },
    preventDefault: vi.fn(() => {
      event.defaultPrevented = true;
    }),
    stopPropagation: vi.fn(),
    ...overrides,
  };
  return event;
}

describe("useChatComposerKeyboard", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("prevents repeated submit keys without submitting", () => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Linux",
    });
    const handleSubmit = vi.fn();
    const { result } = renderHook(() => useChatComposerKeyboard({
      handleSubmit,
      handleCancel: vi.fn(),
      isRunning: false,
      canSubmit: true,
      modeControl: null,
    }));
    const event = keyboardEvent({ repeat: true });

    result.current.handleKeyDown(event as never);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it("prevents repeated submit keys even when submit is currently unavailable", () => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Linux",
    });
    const handleSubmit = vi.fn();
    const { result } = renderHook(() => useChatComposerKeyboard({
      handleSubmit,
      handleCancel: vi.fn(),
      isRunning: false,
      canSubmit: false,
      modeControl: null,
    }));
    const event = keyboardEvent({ repeat: true });

    result.current.handleKeyDown(event as never);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it("submits on a non-repeated submit key", () => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Linux",
    });
    const handleSubmit = vi.fn();
    const { result } = renderHook(() => useChatComposerKeyboard({
      handleSubmit,
      handleCancel: vi.fn(),
      isRunning: false,
      canSubmit: true,
      modeControl: null,
    }));
    const event = keyboardEvent();

    result.current.handleKeyDown(event as never);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(handleSubmit).toHaveBeenCalledTimes(1);
  });

  it("edits the newest queued prompt on unmodified ArrowUp in an empty draft", () => {
    const onEditLastQueued = vi.fn();
    const { result } = renderHook(() => useChatComposerKeyboard({
      handleSubmit: vi.fn(),
      handleCancel: vi.fn(),
      isRunning: true,
      canSubmit: false,
      modeControl: null,
      onEditLastQueued,
    }));
    const event = keyboardEvent({ key: "ArrowUp", code: "ArrowUp" });

    result.current.handleKeyDown(event as never);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(onEditLastQueued).toHaveBeenCalledTimes(1);
  });

  it("leaves ArrowUp alone when the caret is inside a non-empty draft", () => {
    const onEditLastQueued = vi.fn();
    const { result } = renderHook(() => useChatComposerKeyboard({
      handleSubmit: vi.fn(),
      handleCancel: vi.fn(),
      isRunning: true,
      canSubmit: true,
      modeControl: null,
      onEditLastQueued,
    }));
    const event = keyboardEvent({
      key: "ArrowUp",
      code: "ArrowUp",
      currentTarget: { value: "draft", selectionStart: 3, selectionEnd: 3 },
    });

    result.current.handleKeyDown(event as never);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onEditLastQueued).not.toHaveBeenCalled();
  });

  it("leaves ArrowUp alone at the start of a non-empty draft", () => {
    const onEditLastQueued = vi.fn();
    const { result } = renderHook(() => useChatComposerKeyboard({
      handleSubmit: vi.fn(),
      handleCancel: vi.fn(),
      isRunning: true,
      canSubmit: true,
      modeControl: null,
      onEditLastQueued,
    }));
    const event = keyboardEvent({
      key: "ArrowUp",
      code: "ArrowUp",
      currentTarget: { value: "draft", selectionStart: 0, selectionEnd: 0 },
    });

    result.current.handleKeyDown(event as never);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onEditLastQueued).not.toHaveBeenCalled();
  });
});
