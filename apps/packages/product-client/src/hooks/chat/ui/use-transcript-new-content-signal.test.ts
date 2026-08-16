/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTranscriptNewContentSignal } from "./use-transcript-new-content-signal";

describe("useTranscriptNewContentSignal", () => {
  it("starts false and stays false while pinned even as content grows", () => {
    const { result } = renderHook(() => useTranscriptNewContentSignal());
    act(() => {
      result.current.notifyContentGrew(1_000, true);
      result.current.notifyContentGrew(1_400, true);
    });
    expect(result.current.hasNewContentWhileUnpinned).toBe(false);
  });

  it("raises when scrollHeight grows while unpinned", () => {
    const { result } = renderHook(() => useTranscriptNewContentSignal());
    act(() => {
      result.current.notifyContentGrew(1_000, false);
    });
    act(() => {
      result.current.notifyContentGrew(1_400, false);
    });
    expect(result.current.hasNewContentWhileUnpinned).toBe(true);
  });

  it("does not raise on a shrink (row collapse) while unpinned", () => {
    const { result } = renderHook(() => useTranscriptNewContentSignal());
    // Baseline established while PINNED, so this observation cannot itself
    // raise the signal; only the following shrink is under test.
    act(() => {
      result.current.notifyContentGrew(1_400, true);
    });
    act(() => {
      result.current.notifyContentGrew(1_000, false);
    });
    expect(result.current.hasNewContentWhileUnpinned).toBe(false);
  });

  it("clears on clearNewContentSignal (re-pin path)", () => {
    const { result } = renderHook(() => useTranscriptNewContentSignal());
    act(() => {
      result.current.notifyContentGrew(1_000, false);
      result.current.notifyContentGrew(1_400, false);
    });
    expect(result.current.hasNewContentWhileUnpinned).toBe(true);
    act(() => {
      result.current.clearNewContentSignal();
    });
    expect(result.current.hasNewContentWhileUnpinned).toBe(false);
  });

  it("reset drops both the signal and its growth baseline", () => {
    const { result } = renderHook(() => useTranscriptNewContentSignal());
    act(() => {
      result.current.notifyContentGrew(1_000, false);
      result.current.notifyContentGrew(1_400, false);
    });
    expect(result.current.hasNewContentWhileUnpinned).toBe(true);
    act(() => {
      result.current.reset();
    });
    expect(result.current.hasNewContentWhileUnpinned).toBe(false);
    // Baseline dropped to 0: the very next observation at a real (larger)
    // height still counts as growth, exactly like the first observation
    // after a genuine session reset (no false "shrink" from carrying the
    // pre-reset height as the baseline).
    act(() => {
      result.current.notifyContentGrew(500, false);
    });
    expect(result.current.hasNewContentWhileUnpinned).toBe(true);
  });
});
