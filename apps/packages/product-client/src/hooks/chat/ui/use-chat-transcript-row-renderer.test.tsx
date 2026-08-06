/* @vitest-environment jsdom */

import { render, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createTranscriptState, type TranscriptState } from "@anyharness/sdk";
import type { ReactNode } from "react";
import type { TranscriptVirtualRow } from "#product/domain/chats/transcript/transcript-virtual-rows";
import type { ChatTranscriptTurnRowRenderInput } from "./chat-transcript-view-types";
import { MemoizedVirtualTranscriptRow } from "#product/components/workspace/chat/transcript/VirtualTranscriptRow";
import { useChatTranscriptRowRenderer } from "./use-chat-transcript-row-renderer";

const HISTORICAL_ROW = {
  kind: "turn",
  key: "turn:history:block:content",
  turnId: "history",
} as TranscriptVirtualRow;
const LATEST_ROW = {
  kind: "turn",
  key: "turn:latest:block:content",
  turnId: "latest",
} as TranscriptVirtualRow;
const EMPTY_OUTBOX_ENTRIES = [] as const;
const OUTBOX_ACTIONS = {
  retryPrompt: (_clientPromptId: string) => {},
  dismissPrompt: (_clientPromptId: string) => {},
};
const OUTBOX_STARTED_AT_BY_PROMPT_ID = new Map<string, string>();
const MEASURE_ELEMENT = (_element: Element | null) => {};

function IntegratedLatestRow({
  latestLiveStatus,
  renderTurnRow,
  transcript,
}: {
  latestLiveStatus: ReactNode;
  renderTurnRow: (input: ChatTranscriptTurnRowRenderInput) => ReactNode;
  transcript: TranscriptState;
}) {
  const rendering = useChatTranscriptRowRenderer({
    activeSessionId: "session-1",
    latestLiveExplorationBlock: null,
    latestLiveStatus,
    latestCompletedTurnId: null,
    latestTurnId: "latest",
    optimisticPromptTrailingStatus: null,
    outboxActions: OUTBOX_ACTIONS,
    outboxStartedAtByPromptId: OUTBOX_STARTED_AT_BY_PROMPT_ID,
    renderPendingPromptRow: () => null,
    renderTurnRow,
    selectedWorkspaceId: "workspace-1",
    sessionViewState: "working",
    transcript,
    visibleOutboxEntries: EMPTY_OUTBOX_ENTRIES,
    visibleOptimisticPrompt: null,
  });
  return (
    <MemoizedVirtualTranscriptRow
      row={LATEST_ROW}
      rowIndex={0}
      virtualIndex={0}
      renderRow={rendering.renderRow}
      renderRevision={rendering.getRowRenderRevision(LATEST_ROW)}
      measureElement={MEASURE_ELEMENT}
    />
  );
}

describe("useChatTranscriptRowRenderer", () => {
  it("keeps historical revisions stable across stream batches and targets live status", () => {
    const renderPendingPromptRow = vi.fn(() => null);
    const renderTurnRow = vi.fn(() => null);
    const outboxActions = { retryPrompt: vi.fn(), dismissPrompt: vi.fn() };
    const outboxStartedAtByPromptId = new Map<string, string>();
    let transcript = createTranscriptState("session-1");
    let latestLiveStatus = null as ReactNode;

    const { result, rerender } = renderHook(() => useChatTranscriptRowRenderer({
      activeSessionId: "session-1",
      latestLiveExplorationBlock: null,
      latestLiveStatus,
      latestCompletedTurnId: "history",
      latestTurnId: "latest",
      optimisticPromptTrailingStatus: null,
      outboxActions,
      outboxStartedAtByPromptId,
      renderPendingPromptRow,
      renderTurnRow,
      selectedWorkspaceId: "workspace-1",
      sessionViewState: "working",
      transcript,
      visibleOutboxEntries: [],
      visibleOptimisticPrompt: null,
    }));
    const historicalRevision = result.current.getRowRenderRevision(HISTORICAL_ROW);
    const latestRevision = result.current.getRowRenderRevision(LATEST_ROW);
    const firstRenderer = result.current.renderRow;

    transcript = { ...transcript, itemsById: { ...transcript.itemsById } };
    rerender();

    expect(result.current.renderRow).not.toBe(firstRenderer);
    expect(result.current.getRowRenderRevision(HISTORICAL_ROW)).toBe(historicalRevision);
    expect(result.current.getRowRenderRevision(LATEST_ROW)).toBe(latestRevision);

    latestLiveStatus = <span>Working</span>;
    rerender();

    expect(result.current.getRowRenderRevision(HISTORICAL_ROW)).toBe(historicalRevision);
    expect(result.current.getRowRenderRevision(LATEST_ROW)).not.toBe(latestRevision);

    const historicalRevisionBeforeLinkMetadata = result.current.getRowRenderRevision(HISTORICAL_ROW);
    transcript = {
      ...transcript,
      linkCompletionsByCompletionId: { ...transcript.linkCompletionsByCompletionId },
    };
    rerender();

    expect(result.current.getRowRenderRevision(HISTORICAL_ROW))
      .not.toBe(historicalRevisionBeforeLinkMetadata);
  });

  it("updates the mounted latest row only for row-visible revision changes", () => {
    let transcript = createTranscriptState("session-1");
    transcript = {
      ...transcript,
      sessionMeta: { ...transcript.sessionMeta, title: "Original" },
      turnOrder: ["latest"],
      turnsById: {
        latest: {
          turnId: "latest",
          itemOrder: [],
          startedAt: "2026-08-05T00:00:00.000Z",
          completedAt: null,
          stopReason: null,
          fileBadges: [],
        },
      },
    };
    let latestLiveStatus: ReactNode = "idle";
    const renderTurnRow = vi.fn((input: ChatTranscriptTurnRowRenderInput) => (
      <div data-testid="integrated-latest-row">
        {input.latestLiveStatus}:{input.transcript.sessionMeta.title}
      </div>
    ));
    const rendered = render(
      <IntegratedLatestRow
        latestLiveStatus={latestLiveStatus}
        renderTurnRow={renderTurnRow}
        transcript={transcript}
      />,
    );

    expect(rendered.getByTestId("integrated-latest-row").textContent).toBe("idle:Original");
    expect(renderTurnRow).toHaveBeenCalledTimes(1);

    transcript = { ...transcript, itemsById: { ...transcript.itemsById } };
    rendered.rerender(
      <IntegratedLatestRow
        latestLiveStatus={latestLiveStatus}
        renderTurnRow={renderTurnRow}
        transcript={transcript}
      />,
    );
    expect(renderTurnRow).toHaveBeenCalledTimes(1);

    latestLiveStatus = "working";
    rendered.rerender(
      <IntegratedLatestRow
        latestLiveStatus={latestLiveStatus}
        renderTurnRow={renderTurnRow}
        transcript={transcript}
      />,
    );
    expect(rendered.getByTestId("integrated-latest-row").textContent).toBe("working:Original");
    expect(renderTurnRow).toHaveBeenCalledTimes(2);

    transcript = {
      ...transcript,
      sessionMeta: { ...transcript.sessionMeta, title: "Renamed" },
    };
    rendered.rerender(
      <IntegratedLatestRow
        latestLiveStatus={latestLiveStatus}
        renderTurnRow={renderTurnRow}
        transcript={transcript}
      />,
    );
    expect(rendered.getByTestId("integrated-latest-row").textContent).toBe("working:Renamed");
    expect(renderTurnRow).toHaveBeenCalledTimes(3);
  });
});
