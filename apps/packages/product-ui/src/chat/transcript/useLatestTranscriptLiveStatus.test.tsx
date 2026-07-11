// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  TranscriptState,
  TurnRecord,
} from "@proliferate/product-domain/chats/transcript/chat-transcript-state";
import { buildTranscriptVirtualRows } from "@proliferate/product-domain/chats/transcript/transcript-virtual-rows";
import { useLatestTranscriptLiveStatus } from "./useLatestTranscriptLiveStatus";

afterEach(() => {
  vi.useRealTimers();
});

describe("useLatestTranscriptLiveStatus — continuous working feedback", () => {
  it("restores the working status after completed commentary while the turn continues", () => {
    vi.useFakeTimers();
    const { transcript, turn } = transcriptWithAssistantProse(false, 1);
    const renderTurnTrailingStatus = vi.fn(() => "TAIL");

    const { result } = renderHook(() => useLatestTranscriptLiveStatus({
      latestTurnId: turn.turnId,
      latestTurn: turn,
      transcript,
      virtualRows: buildRows(transcript, turn),
      outboxStartedAtByPromptId: new Map(),
      sessionViewState: "working",
      renderTurnTrailingStatus,
    }));

    expect(result.current.latestLiveStatus).toBeNull();
    act(() => vi.advanceTimersByTime(150));
    expect(result.current.latestLiveStatus).toBe("TAIL");
  });

  it("shows status after a quiet streaming gap and hides it on the next token", () => {
    vi.useFakeTimers();
    let state = transcriptWithAssistantProse(true, 1);
    const renderTurnTrailingStatus = vi.fn(() => "TAIL");

    const { result, rerender } = renderHook(() => useLatestTranscriptLiveStatus({
      latestTurnId: state.turn.turnId,
      latestTurn: state.turn,
      transcript: state.transcript,
      virtualRows: buildRows(state.transcript, state.turn),
      outboxStartedAtByPromptId: new Map(),
      sessionViewState: "working",
      renderTurnTrailingStatus,
    }));

    act(() => vi.advanceTimersByTime(499));
    expect(result.current.latestLiveStatus).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.latestLiveStatus).toBe("TAIL");

    state = transcriptWithAssistantProse(true, 2);
    rerender();
    expect(result.current.latestLiveStatus).toBeNull();

    act(() => vi.advanceTimersByTime(500));
    expect(result.current.latestLiveStatus).toBe("TAIL");
  });
});

describe("useLatestTranscriptLiveStatus — single-shimmer rule", () => {
  it("suppresses the turn-tail status while a live action summary owns the shimmer", () => {
    const { transcript, turn } = transcriptWithReadActions();
    const virtualRows = buildTranscriptVirtualRows({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: null,
      latestTurnId: turn.turnId,
      latestTurnHasAssistantRenderableContent: false,
    });
    const renderTurnTrailingStatus = vi.fn(() => "TAIL");

    const { result } = renderHook(() =>
      useLatestTranscriptLiveStatus({
        latestTurnId: turn.turnId,
        latestTurn: turn,
        transcript,
        virtualRows,
        outboxStartedAtByPromptId: new Map(),
        sessionViewState: "working",
        renderTurnTrailingStatus,
      }),
    );

    // The collapsed read actions form a live exploration block …
    expect(result.current.latestLiveExplorationBlock).not.toBeNull();
    // … so the tail shimmer never renders a competing second sweep.
    expect(result.current.latestLiveStatus).toBeNull();
    expect(renderTurnTrailingStatus).not.toHaveBeenCalled();
  });

  it("falls back to the turn-tail status after an exploration group completes", () => {
    vi.useFakeTimers();
    const { transcript, turn } = transcriptWithReadActions(false);
    const virtualRows = buildTranscriptVirtualRows({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: null,
      latestTurnId: turn.turnId,
      latestTurnHasAssistantRenderableContent: false,
    });
    const renderTurnTrailingStatus = vi.fn(() => "TAIL");

    const { result } = renderHook(() => useLatestTranscriptLiveStatus({
      latestTurnId: turn.turnId,
      latestTurn: turn,
      transcript,
      virtualRows,
      outboxStartedAtByPromptId: new Map(),
      sessionViewState: "working",
      renderTurnTrailingStatus,
    }));

    expect(result.current.latestLiveExplorationBlock).toBeNull();
    act(() => vi.advanceTimersByTime(150));
    expect(result.current.latestLiveStatus).toBe("TAIL");
  });

  it("hands the shimmer to active exploration and restores the tail only after the quiet grace", () => {
    vi.useFakeTimers();
    let state = transcriptWithReadActions(false);
    const renderTurnTrailingStatus = vi.fn(() => "TAIL");

    const { result, rerender } = renderHook(() => useLatestTranscriptLiveStatus({
      latestTurnId: state.turn.turnId,
      latestTurn: state.turn,
      transcript: state.transcript,
      virtualRows: buildTranscriptVirtualRows({
        activeSessionId: "session-1",
        transcript: state.transcript,
        visibleOptimisticPrompt: null,
        latestTurnId: state.turn.turnId,
        latestTurnHasAssistantRenderableContent: false,
      }),
      outboxStartedAtByPromptId: new Map(),
      sessionViewState: "working",
      renderTurnTrailingStatus,
    }));

    act(() => vi.advanceTimersByTime(150));
    expect(result.current.latestLiveStatus).toBe("TAIL");

    state = transcriptWithReadActions(true);
    rerender();
    expect(result.current.latestLiveExplorationBlock).not.toBeNull();
    expect(result.current.latestLiveStatus).toBeNull();

    state = transcriptWithReadActions(false);
    rerender();
    expect(result.current.latestLiveExplorationBlock).toBeNull();
    expect(result.current.latestLiveStatus).toBeNull();

    act(() => vi.advanceTimersByTime(499));
    expect(result.current.latestLiveStatus).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.latestLiveStatus).toBe("TAIL");
  });
});

describe("useLatestTranscriptLiveStatus — needs-input marker", () => {
  it("renders the trailing status immediately while a pending interaction blocks the turn", () => {
    // A pending permission leaves its tool call non-completed, so the turn
    // still counts as having active tool work — the marker must render anyway.
    const { transcript, turn } = transcriptWithPendingTool();
    const virtualRows = buildTranscriptVirtualRows({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: null,
      latestTurnId: turn.turnId,
      latestTurnHasAssistantRenderableContent: false,
    });
    const renderTurnTrailingStatus = vi.fn(() => "MARKER");

    const { result } = renderHook(() =>
      useLatestTranscriptLiveStatus({
        latestTurnId: turn.turnId,
        latestTurn: turn,
        transcript,
        virtualRows,
        outboxStartedAtByPromptId: new Map(),
        sessionViewState: "needs_input",
        renderTurnTrailingStatus,
      }),
    );

    // No grace timer for a blocking state: the marker shows on first render.
    expect(result.current.latestLiveStatus).toBe("MARKER");
    expect(renderTurnTrailingStatus).toHaveBeenCalledWith(
      expect.objectContaining({ sessionViewState: "needs_input" }),
    );
  });

  it("keeps the working-state shimmer gated while a tool owns the viewport", () => {
    const { transcript, turn } = transcriptWithPendingTool();
    const virtualRows = buildTranscriptVirtualRows({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: null,
      latestTurnId: turn.turnId,
      latestTurnHasAssistantRenderableContent: false,
    });
    const renderTurnTrailingStatus = vi.fn(() => "TAIL");

    const { result } = renderHook(() =>
      useLatestTranscriptLiveStatus({
        latestTurnId: turn.turnId,
        latestTurn: turn,
        transcript,
        virtualRows,
        outboxStartedAtByPromptId: new Map(),
        sessionViewState: "working",
        renderTurnTrailingStatus,
      }),
    );

    expect(result.current.latestLiveStatus).toBeNull();
    expect(renderTurnTrailingStatus).not.toHaveBeenCalled();
  });
});

function transcriptWithPendingTool(): {
  transcript: TranscriptState;
  turn: TurnRecord;
} {
  // Keep the reads completed so the pending command is the only active work;
  // otherwise these marker tests could pass because of the exploration block.
  const base = transcriptWithReadActions(false);
  const pendingTool = {
    ...(readToolItem("bash-pending") as unknown as Record<string, unknown>),
    status: "in_progress",
    completedAt: null,
    completedSeq: null,
    toolKind: "execute",
    semanticKind: "command_run",
    approvalState: "pending",
  } as unknown as TranscriptState["itemsById"][string];
  const turn: TurnRecord = {
    ...base.turn,
    itemOrder: [...base.turn.itemOrder, "bash-pending"],
  };
  const transcript = {
    ...(base.transcript as unknown as Record<string, unknown>),
    turnsById: { [turn.turnId]: turn },
    itemsById: {
      ...base.transcript.itemsById,
      "bash-pending": pendingTool,
    },
  } as unknown as TranscriptState;
  return { transcript, turn };
}

function transcriptWithAssistantProse(
  isStreaming: boolean,
  lastUpdatedSeq: number,
): { transcript: TranscriptState; turn: TurnRecord } {
  const item = {
    kind: "assistant_prose",
    itemId: "assistant-1",
    turnId: "turn-1",
    status: isStreaming ? "in_progress" : "completed",
    sourceAgentKind: "codex",
    messageId: null,
    title: null,
    nativeToolName: null,
    parentToolCallId: null,
    contentParts: [],
    timestamp: "2026-04-13T12:00:01.000Z",
    startedSeq: 1,
    lastUpdatedSeq,
    completedSeq: isStreaming ? null : lastUpdatedSeq,
    completedAt: isStreaming ? null : "2026-04-13T12:00:02.000Z",
    text: "Assistant text",
    isStreaming,
  } as unknown as TranscriptState["itemsById"][string];
  const turn: TurnRecord = {
    turnId: "turn-1",
    itemOrder: [item.itemId],
    startedAt: "2026-04-13T12:00:01.000Z",
    completedAt: null,
    stopReason: null,
    fileBadges: [],
  };
  const transcript = {
    ...transcriptWithReadActions().transcript,
    turnOrder: [turn.turnId],
    turnsById: { [turn.turnId]: turn },
    itemsById: { [item.itemId]: item },
    lastSeq: lastUpdatedSeq,
  } as TranscriptState;
  return { transcript, turn };
}

function buildRows(transcript: TranscriptState, turn: TurnRecord) {
  return buildTranscriptVirtualRows({
    activeSessionId: "session-1",
    transcript,
    visibleOptimisticPrompt: null,
    latestTurnId: turn.turnId,
    latestTurnHasAssistantRenderableContent: true,
  });
}

function transcriptWithReadActions(hasActiveRead = true): {
  transcript: TranscriptState;
  turn: TurnRecord;
} {
  const items = [
    readToolItem("read-1"),
    readToolItem("read-2", hasActiveRead ? "in_progress" : "completed"),
  ];
  const turn: TurnRecord = {
    turnId: "turn-1",
    itemOrder: items.map((item) => item.itemId),
    startedAt: "2026-04-13T12:00:01.000Z",
    completedAt: null,
    stopReason: null,
    fileBadges: [],
  };
  const transcript = {
    sessionMeta: {
      sessionId: "session-1",
      title: null,
      updatedAt: null,
      nativeSessionId: null,
      sourceAgentKind: null,
    },
    turnOrder: [turn.turnId],
    turnsById: { [turn.turnId]: turn },
    itemsById: Object.fromEntries(items.map((item) => [item.itemId, item])),
    openAssistantItemId: null,
    openThoughtItemId: null,
    pendingInteractions: [],
    availableCommands: [],
    liveConfig: null,
    currentModeId: null,
    usageState: null,
    unknownEvents: [],
    isStreaming: true,
    lastSeq: 2,
    pendingPrompts: [],
    linkCompletionsByCompletionId: {},
    latestLinkCompletionBySessionLinkId: {},
  } as unknown as TranscriptState;
  return { transcript, turn };
}

function readToolItem(
  itemId: string,
  status: "in_progress" | "completed" = "completed",
): TranscriptState["itemsById"][string] {
  const isCompleted = status === "completed";
  return {
    kind: "tool_call",
    itemId,
    turnId: "turn-1",
    status,
    sourceAgentKind: "codex",
    messageId: null,
    title: "Read file",
    nativeToolName: "Read",
    parentToolCallId: null,
    contentParts: [],
    timestamp: "2026-04-13T12:00:01.000Z",
    startedSeq: 1,
    lastUpdatedSeq: 1,
    completedSeq: isCompleted ? 1 : null,
    completedAt: isCompleted ? "2026-04-13T12:00:02.000Z" : null,
    toolCallId: itemId,
    toolKind: "read",
    semanticKind: "file_read",
    approvalState: "none",
  } as unknown as TranscriptState["itemsById"][string];
}
