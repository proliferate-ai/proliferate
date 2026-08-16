// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAssistantRevealFrontier } from "#product/hooks/chat/ui/use-assistant-reveal-frontier";
import {
  clearAssistantRevealProgressForTests,
  getAssistantRevealProgress,
  recordAssistantRevealProgress,
} from "#product/hooks/chat/ui/assistant-reveal-progress";

const baseProps = {
  itemId: "item-1",
  isLatestTurn: true,
  targetLength: 100,
  turnCompletedAt: null,
  turnId: "turn-1",
};

describe("useAssistantRevealFrontier mount floor", () => {
  beforeEach(() => {
    clearAssistantRevealProgressForTests();
  });

  it("treats content present at mount as finalized instead of replaying it", () => {
    // Stale progress left behind by a row that unmounted mid-stream while the
    // transcript kept ingesting deltas (backgrounded workspace).
    recordAssistantRevealProgress("item-1", {
      complete: false,
      phase: "active",
      visibleLength: 5,
      targetLength: 40,
      isStreaming: true,
    });

    const { result } = renderHook(useAssistantRevealFrontier, {
      initialProps: baseProps,
    });

    expect(result.current.animateAssistantRevealItemId).toBeNull();
    expect(result.current.assistantRevealComplete).toBe(true);
    expect(getAssistantRevealProgress("item-1")).toMatchObject({
      complete: true,
      visibleLength: 100,
    });
  });

  it("animates only deltas that arrive after mount", () => {
    const { result, rerender } = renderHook(useAssistantRevealFrontier, {
      initialProps: baseProps,
    });
    expect(result.current.animateAssistantRevealItemId).toBeNull();

    rerender({ ...baseProps, targetLength: 140 });

    expect(result.current.animateAssistantRevealItemId).toBe("item-1");
    expect(result.current.assistantRevealComplete).toBe(false);
    // The floor still marks everything up to the mount-time length as revealed.
    expect(getAssistantRevealProgress("item-1")?.visibleLength).toBe(100);
  });

  it("still paces an item that first appears after mount", () => {
    const { result, rerender } = renderHook(useAssistantRevealFrontier, {
      initialProps: { ...baseProps, itemId: null, targetLength: 0 },
    });
    expect(result.current.animateAssistantRevealItemId).toBeNull();

    rerender({ ...baseProps, itemId: "item-2", targetLength: 30 });

    expect(result.current.animateAssistantRevealItemId).toBe("item-2");
    expect(getAssistantRevealProgress("item-2")).toBeNull();
  });

  it("does not re-arm the reveal for a completed turn remounted later", () => {
    const { result } = renderHook(useAssistantRevealFrontier, {
      initialProps: {
        ...baseProps,
        turnCompletedAt: new Date().toISOString(),
      },
    });

    expect(result.current.animateAssistantRevealItemId).toBeNull();
    expect(result.current.assistantRevealComplete).toBe(true);
  });
});
