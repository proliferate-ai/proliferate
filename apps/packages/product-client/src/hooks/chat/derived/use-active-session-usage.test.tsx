// @vitest-environment jsdom

import { createTranscriptState } from "@anyharness/sdk";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useActiveSessionUsage } from "#product/hooks/chat/derived/use-active-session-usage";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";

afterEach(() => {
  cleanup();
  useSessionSelectionStore.setState({
    activeSessionId: null,
    activeSessionVersion: 0,
  });
  useSessionTranscriptStore.getState().clearEntries();
});

describe("useActiveSessionUsage", () => {
  it("returns null when there is no active session", () => {
    const { result } = renderHook(() => useActiveSessionUsage());
    expect(result.current).toBeNull();
  });

  it("returns null when the active session's transcript has no usage yet", () => {
    useSessionSelectionStore.setState({
      activeSessionId: "session-1",
      activeSessionVersion: 1,
    });
    useSessionTranscriptStore.setState({
      entriesById: {
        "session-1": {
          sessionId: "session-1",
          events: [],
          transcript: createTranscriptState("session-1"),
          optimisticPrompt: null,
        },
      },
    });

    const { result } = renderHook(() => useActiveSessionUsage());
    expect(result.current).toBeNull();
  });

  it("reads the active session's usageState from the transcript store", () => {
    useSessionSelectionStore.setState({
      activeSessionId: "session-1",
      activeSessionVersion: 1,
    });
    const transcript = createTranscriptState("session-1");
    transcript.usageState = { used: 33100, size: 300000, cost: null };
    useSessionTranscriptStore.setState({
      entriesById: {
        "session-1": {
          sessionId: "session-1",
          events: [],
          transcript,
          optimisticPrompt: null,
        },
      },
    });

    const { result } = renderHook(() => useActiveSessionUsage());
    expect(result.current).toEqual({ used: 33100, size: 300000, cost: null });
  });
});
