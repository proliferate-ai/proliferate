// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { createTranscriptState, type TranscriptState } from "@anyharness/sdk";
import {
  selectVisibleContentSearchMatchIds,
  useContentSearchStore,
} from "@/stores/search/content-search-store";
import { useChatTranscriptContentSearch } from "./use-chat-transcript-content-search";

function resetStore() {
  useContentSearchStore.setState({
    open: false,
    query: "",
    surface: "chat",
    activeMatchIndex: 0,
    activeMatchId: null,
    unitsById: {},
    nextUnitOrder: 0,
  });
}

function transcriptWithAssistantProse(text: string): TranscriptState {
  const transcript = createTranscriptState("session-1");
  transcript.turnOrder.push("turn-0");
  transcript.turnsById["turn-0"] = {
    turnId: "turn-0",
    itemOrder: ["item-0"],
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    stopReason: "stop",
    fileBadges: [],
  };
  transcript.itemsById["item-0"] = {
    kind: "assistant_prose",
    itemId: "item-0",
    turnId: "turn-0",
    status: "completed",
    sourceAgentKind: "claude",
    messageId: null,
    title: null,
    nativeToolName: null,
    parentToolCallId: null,
    contentParts: [],
    timestamp: "2026-01-01T00:00:00.000Z",
    startedSeq: 1,
    lastUpdatedSeq: 1,
    completedSeq: 1,
    completedAt: "2026-01-01T00:00:00.000Z",
    text,
    isStreaming: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return transcript;
}

function renderIndex(transcript: TranscriptState) {
  return renderHook(() =>
    useChatTranscriptContentSearch({
      transcript,
      activeSessionId: "session-1",
      optimisticPrompt: null,
      outboxEntries: [],
      goalEvents: [],
    }),
  );
}

describe("useChatTranscriptContentSearch", () => {
  beforeEach(resetStore);
  afterEach(() => {
    cleanup();
    resetStore();
  });

  it("registers a per-row unit with one match id per occurrence", () => {
    useContentSearchStore.setState({ open: true, surface: "chat", query: "foo" });
    const transcript = transcriptWithAssistantProse("foo bar **foo** baz foo");
    renderIndex(transcript);

    expect(selectVisibleContentSearchMatchIds(useContentSearchStore.getState())).toEqual([
      "chatrow:turn:turn-0:block:content:0",
      "chatrow:turn:turn-0:block:content:1",
      "chatrow:turn:turn-0:block:content:2",
    ]);
  });

  it("stays inert while search is closed", () => {
    const transcript = transcriptWithAssistantProse("foo foo");
    renderIndex(transcript);
    expect(useContentSearchStore.getState().unitsById).toEqual({});
  });

  it("stays inert on the file surface", () => {
    useContentSearchStore.setState({ open: true, surface: "file", query: "foo" });
    const transcript = transcriptWithAssistantProse("foo foo");
    renderIndex(transcript);
    expect(selectVisibleContentSearchMatchIds(useContentSearchStore.getState())).toEqual([]);
  });

  it("unregisters units on unmount", () => {
    useContentSearchStore.setState({ open: true, surface: "chat", query: "foo" });
    const transcript = transcriptWithAssistantProse("foo");
    const { unmount } = renderIndex(transcript);
    expect(Object.keys(useContentSearchStore.getState().unitsById)).toHaveLength(1);
    unmount();
    expect(useContentSearchStore.getState().unitsById).toEqual({});
  });
});
