// @vitest-environment jsdom

import { createTranscriptState } from "@anyharness/sdk";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  useActivePendingPrompts,
} from "@/hooks/chat/derived/use-active-pending-session-interactions";
import {
  useActiveSessionConfigState,
  useActiveSessionLaunchState,
} from "@/hooks/chat/derived/use-active-session-config-state";
import {
  useActiveTranscriptPaneState,
} from "@/hooks/chat/derived/use-active-session-transcript-state";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";

afterEach(() => {
  cleanup();
  useSessionSelectionStore.setState({
    activeSessionId: null,
    activeSessionVersion: 0,
  });
  useSessionTranscriptStore.getState().clearEntries();
  useSessionDirectoryStore.getState().clearEntries();
  useSessionIntentStore.getState().clear();
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
    useSessionIntentStore.getState().enqueuePrompt({
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

describe("useActiveSessionConfigState", () => {
  it("keeps intent-derived pending config stable across unchanged snapshots", () => {
    useSessionSelectionStore.setState({
      activeSessionId: "session-1",
      activeSessionVersion: 1,
    });
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "session-1",
      agentKind: "claude",
      modelId: "claude-sonnet",
      workspaceId: "workspace-1",
    });
    useSessionIntentStore.getState().enqueueConfig({
      clientSessionId: "session-1",
      configId: "model",
      value: "claude-opus",
      now: "2026-01-01T00:00:00.000Z",
    });

    const { result, rerender } = renderHook(() => useActiveSessionConfigState());

    const firstPendingConfigChanges = result.current.pendingConfigChanges;
    expect(firstPendingConfigChanges).toMatchObject({
      model: {
        rawConfigId: "model",
        value: "claude-opus",
        status: "queued",
      },
    });

    rerender();

    expect(result.current.pendingConfigChanges).toBe(firstPendingConfigChanges);
  });
});

describe("useActiveSessionLaunchState", () => {
  it("uses the requested model for the active launch identity before live model control arrives", () => {
    useSessionSelectionStore.setState({
      activeSessionId: "session-1",
      activeSessionVersion: 1,
    });
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "session-1",
      agentKind: "claude",
      modelId: "sonnet",
      requestedModelId: "us.anthropic.claude-opus-4-7",
      workspaceId: "workspace-1",
    });

    const { result } = renderHook(() => useActiveSessionLaunchState());

    expect(result.current.currentLaunchIdentity).toEqual({
      kind: "claude",
      modelId: "us.anthropic.claude-opus-4-7",
    });
  });

  it("uses the live runtime model once model control truth arrives", () => {
    useSessionSelectionStore.setState({
      activeSessionId: "session-1",
      activeSessionVersion: 1,
    });
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "session-1",
      agentKind: "cursor",
      modelId: "composer-2.5[fast=true]",
      requestedModelId: "auto",
      workspaceId: "workspace-1",
      liveConfig: {
        normalizedControls: {
          model: {
            rawConfigId: "cursor.model",
            key: "model",
            label: "Model",
            description: null,
            settable: true,
            currentValue: "composer-2.5[fast=true]",
            values: [
              {
                value: "auto",
                label: "Auto",
                description: null,
              },
              {
                value: "composer-2.5[fast=true]",
                label: "Composer 2.5",
                description: null,
              },
            ],
          },
          extras: [],
        },
      } as never,
    });

    const { result } = renderHook(() => useActiveSessionLaunchState());

    expect(result.current.currentLaunchIdentity).toEqual({
      kind: "cursor",
      modelId: "composer-2.5[fast=true]",
    });
  });

  it("uses the effective Gemini model when Gemini does not expose a live model control", () => {
    useSessionSelectionStore.setState({
      activeSessionId: "session-1",
      activeSessionVersion: 1,
    });
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "session-1",
      agentKind: "gemini",
      modelId: "gemini-3-flash-preview",
      requestedModelId: "auto-gemini-3",
      workspaceId: "workspace-1",
      liveConfig: {
        normalizedControls: {
          model: null,
          mode: {
            rawConfigId: "mode",
            key: "mode",
            label: "Mode",
            description: null,
            settable: true,
            currentValue: "default",
            values: [],
          },
          extras: [],
        },
      } as never,
    });

    const { result } = renderHook(() => useActiveSessionLaunchState());

    expect(result.current.currentLaunchIdentity).toEqual({
      kind: "gemini",
      modelId: "gemini-3-flash-preview",
    });
  });

  it("uses the latest Gemini session-state event when the directory still has requested Auto", () => {
    useSessionSelectionStore.setState({
      activeSessionId: "session-1",
      activeSessionVersion: 1,
    });
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "session-1",
      agentKind: "gemini",
      modelId: "auto-gemini-3",
      requestedModelId: "auto-gemini-3",
      workspaceId: "workspace-1",
      liveConfig: {
        normalizedControls: {
          model: null,
          mode: {
            rawConfigId: "mode",
            key: "mode",
            label: "Mode",
            description: null,
            settable: true,
            currentValue: "default",
            values: [],
          },
          extras: [],
        },
      } as never,
    });
    useSessionTranscriptStore.setState({
      entriesById: {
        "session-1": {
          sessionId: "session-1",
          transcript: createTranscriptState("session-1"),
          events: [
            {
              sessionId: "session-1",
              seq: 36648,
              timestamp: "2026-06-02T09:30:05.000Z",
              event: {
                type: "session_state_update",
                modelId: "gemini-3-flash-preview",
                requestedModelId: "auto-gemini-3",
                modeId: "default",
              },
            },
          ],
          optimisticPrompt: null,
        } as never,
      },
    });

    const { result } = renderHook(() => useActiveSessionLaunchState());

    expect(result.current.modelId).toBe("gemini-3-flash-preview");
    expect(result.current.currentLaunchIdentity).toEqual({
      kind: "gemini",
      modelId: "gemini-3-flash-preview",
    });
  });
});
