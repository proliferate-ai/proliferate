// @vitest-environment jsdom
import { render, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAssistantRevealFrontier } from "#product/hooks/chat/ui/use-assistant-reveal-frontier";
import {
  TranscriptContextProviders,
  useTranscriptPaneLifecycle,
} from "#product/components/workspace/chat/transcript/TranscriptContexts";
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

  it("paces a fresh row that mounts inside an established pane", () => {
    // A new turn whose first store flush coalesced the turn with its opening
    // prose mounts a row already carrying content. The viewer watched it
    // arrive, so it must animate from zero — no mount floor.
    const { result } = renderHook(useAssistantRevealFrontier, {
      initialProps: {
        ...baseProps,
        itemId: "item-3",
        targetLength: 30,
        paneEstablishedAtMount: true,
      },
    });

    expect(result.current.animateAssistantRevealItemId).toBe("item-3");
    expect(getAssistantRevealProgress("item-3")).toBeNull();
  });

  it("finalizes mount-time content only for rows in the pane's initial paint", () => {
    // End-to-end through the real provider: a probe row mounted in the pane's
    // first commit is floored; a probe row mounted afterwards paces.
    const frontierByItemId = new Map<string, string | null>();
    function ProbeRow({ itemId }: { itemId: string }) {
      const paneLifecycle = useTranscriptPaneLifecycle();
      const { animateAssistantRevealItemId } = useAssistantRevealFrontier({
        ...baseProps,
        itemId,
        targetLength: 50,
        paneEstablishedAtMount: paneLifecycle.initialPaintComplete,
      });
      frontierByItemId.set(itemId, animateAssistantRevealItemId);
      return null;
    }
    function Pane({ showLateRow }: { showLateRow: boolean }) {
      return (
        <TranscriptContextProviders sessionId="session-1">
          <ProbeRow itemId="initial-row" />
          {showLateRow ? <ProbeRow itemId="late-row" /> : null}
        </TranscriptContextProviders>
      );
    }

    const view = render(<Pane showLateRow={false} />);
    expect(frontierByItemId.get("initial-row")).toBeNull();
    expect(getAssistantRevealProgress("initial-row")).toMatchObject({
      complete: true,
      visibleLength: 50,
    });

    view.rerender(<Pane showLateRow />);
    expect(frontierByItemId.get("late-row")).toBe("late-row");
    expect(getAssistantRevealProgress("late-row")).toBeNull();
  });

  it("re-floors rows when the pane swaps to another session", () => {
    const frontierByItemId = new Map<string, string | null>();
    function ProbeRow({ itemId }: { itemId: string }) {
      const paneLifecycle = useTranscriptPaneLifecycle();
      const { animateAssistantRevealItemId } = useAssistantRevealFrontier({
        ...baseProps,
        itemId,
        targetLength: 50,
        paneEstablishedAtMount: paneLifecycle.initialPaintComplete,
      });
      frontierByItemId.set(itemId, animateAssistantRevealItemId);
      return null;
    }
    function Pane({ sessionId, itemId }: { sessionId: string; itemId: string }) {
      return (
        <TranscriptContextProviders sessionId={sessionId}>
          <ProbeRow key={sessionId} itemId={itemId} />
        </TranscriptContextProviders>
      );
    }

    const view = render(<Pane sessionId="session-1" itemId="row-a" />);
    view.rerender(<Pane sessionId="session-2" itemId="row-b" />);

    // The swapped-in session's row mounts in that session's initial paint and
    // must be floored, even though the provider instance stayed mounted.
    expect(frontierByItemId.get("row-b")).toBeNull();
    expect(getAssistantRevealProgress("row-b")).toMatchObject({
      complete: true,
      visibleLength: 50,
    });
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
