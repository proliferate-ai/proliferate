// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChatComposerFocusRequest } from "./use-chat-composer-focus-request";

afterEach(() => {
  vi.useRealTimers();
});

describe("useChatComposerFocusRequest", () => {
  it("retries until the composer accepts focus", () => {
    vi.useFakeTimers();
    const focusComposer = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);

    renderHook(() => useChatComposerFocusRequest({
      focusRequestNonce: 1,
      focusComposer,
    }));
    act(() => vi.runAllTimers());

    expect(focusComposer).toHaveBeenCalledTimes(3);
  });

  it("stops retrying after eight attempts", () => {
    vi.useFakeTimers();
    const focusComposer = vi.fn(() => false);

    renderHook(() => useChatComposerFocusRequest({
      focusRequestNonce: 1,
      focusComposer,
    }));
    act(() => vi.runAllTimers());

    expect(focusComposer).toHaveBeenCalledTimes(8);
  });

  it("cancels a pending retry when unmounted", () => {
    vi.useFakeTimers();
    const focusComposer = vi.fn(() => false);
    const { unmount } = renderHook(() => useChatComposerFocusRequest({
      focusRequestNonce: 1,
      focusComposer,
    }));

    act(() => vi.advanceTimersByTime(0));
    expect(focusComposer).toHaveBeenCalledOnce();
    unmount();
    act(() => vi.runAllTimers());

    expect(focusComposer).toHaveBeenCalledOnce();
  });
});
