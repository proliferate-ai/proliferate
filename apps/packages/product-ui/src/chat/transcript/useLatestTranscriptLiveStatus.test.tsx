// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  TranscriptState,
  TurnRecord,
} from "@proliferate/product-domain/chats/transcript/chat-transcript-state";
import { buildTranscriptVirtualRows } from "@proliferate/product-domain/chats/transcript/transcript-virtual-rows";
import { useLatestTranscriptLiveStatus } from "./useLatestTranscriptLiveStatus";

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
  const base = transcriptWithReadActions();
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

function transcriptWithReadActions(): {
  transcript: TranscriptState;
  turn: TurnRecord;
} {
  const items = [readToolItem("read-1"), readToolItem("read-2")];
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

function readToolItem(itemId: string): TranscriptState["itemsById"][string] {
  return {
    kind: "tool_call",
    itemId,
    turnId: "turn-1",
    status: "completed",
    sourceAgentKind: "codex",
    messageId: null,
    title: "Read file",
    nativeToolName: "Read",
    parentToolCallId: null,
    contentParts: [],
    timestamp: "2026-04-13T12:00:01.000Z",
    startedSeq: 1,
    lastUpdatedSeq: 1,
    completedSeq: 1,
    completedAt: "2026-04-13T12:00:02.000Z",
    toolCallId: itemId,
    toolKind: "read",
    semanticKind: "file_read",
    approvalState: "none",
  } as unknown as TranscriptState["itemsById"][string];
}
