// @vitest-environment jsdom

import { createTranscriptState } from "@anyharness/sdk";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  useActivePendingPrompts,
  useActiveTranscriptPaneState,
} from "@/hooks/chat/use-active-chat-session-selectors";
import { usePromptOutboxStore } from "@/stores/chat/prompt-outbox-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";

afterEach(() => {
  cleanup();
  useSessionSelectionStore.setState({
    activeSessionId: null,
    activeSessionVersion: 0,
  });
  useSessionTranscriptStore.getState().clearEntries();
  usePromptOutboxStore.getState().clear();
});

describe("useActiveTranscriptPaneState", () => {
  it("tolerates legacy transcript entries without an events array", () => {
    useSessionSelectionStore.setState({
      activeSessionId: "session-1",
      activeSessionVersion: 1,
    });
    useSessionTranscriptStore.setState({
      entriesById: {
        "session-1": {
          sessionId: "session-1",
          transcript: createTranscriptState("session-1"),
          optimisticPrompt: null,
        } as never,
      },
    });

    const { result } = renderHook(() => useActiveTranscriptPaneState());

    expect(result.current.activeSessionId).toBe("session-1");
    expect(result.current.oldestLoadedEventSeq).toBeNull();
    expect(result.current.transcript?.sessionMeta.sessionId).toBe("session-1");
  });
});

describe("useActivePendingPrompts", () => {
  it("tolerates transcript entries without a transcript object", () => {
    useSessionSelectionStore.setState({
      activeSessionId: "session-1",
      activeSessionVersion: 1,
    });
    useSessionTranscriptStore.setState({
      entriesById: {
        "session-1": {
          sessionId: "session-1",
          events: [],
          optimisticPrompt: null,
        } as never,
      },
    });

    const { result } = renderHook(() => useActivePendingPrompts());

    expect(result.current).toEqual([]);
  });

  it("projects local queued outbox prompts into the composer queue", () => {
    useSessionSelectionStore.setState({
      activeSessionId: "session-1",
      activeSessionVersion: 1,
    });
    usePromptOutboxStore.getState().enqueue({
      clientPromptId: "prompt-1",
      clientSessionId: "session-1",
      text: "queued behind active turn",
      blocks: [{ type: "text", text: "queued behind active turn" }],
      placement: "queue",
      now: "2026-01-01T00:00:00.000Z",
    });

    const { result } = renderHook(() => useActivePendingPrompts());

    expect(result.current).toEqual([
      expect.objectContaining({
        promptId: "prompt-1",
        text: "queued behind active turn",
      }),
    ]);
    expect(result.current[0]?.seq).toBeLessThan(0);
  });
});
