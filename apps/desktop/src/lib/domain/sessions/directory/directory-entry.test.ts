import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_ACTION_CAPABILITIES,
  createDirectoryEntry,
  directoryEntryEqual,
  normalizeDirectoryEntryInput,
  normalizePatchedDirectoryEntry,
} from "@/lib/domain/sessions/directory/directory-entry";

describe("session directory entry model", () => {
  it("normalizes defaults, existing values, activity overlays, and relationship hints", () => {
    const existing = createDirectoryEntry({
      sessionId: "session-a",
      materializedSessionId: "runtime-a",
      workspaceId: "workspace-a",
      agentKind: "proliferate",
      modelId: "model-a",
      title: "Existing title",
      activity: {
        isStreaming: true,
        transcriptTitle: "Transcript title",
      },
    });

    const entry = normalizeDirectoryEntryInput(
      {
        sessionId: "session-a",
        agentKind: "proliferate",
        title: null,
        activity: {
          errorAttentionKey: "session-a:error",
        },
      },
      existing,
      {
        kind: "linked_child",
        parentSessionId: "parent-a",
        workspaceId: "workspace-a",
      },
    );

    expect(entry).toMatchObject({
      sessionId: "session-a",
      materializedSessionId: "runtime-a",
      workspaceId: "workspace-a",
      agentKind: "proliferate",
      modelId: "model-a",
      title: "Existing title",
      actionCapabilities: DEFAULT_SESSION_ACTION_CAPABILITIES,
      streamConnectionState: "disconnected",
      transcriptHydrated: false,
      sessionRelationship: {
        kind: "linked_child",
        parentSessionId: "parent-a",
        workspaceId: "workspace-a",
      },
      activity: {
        isStreaming: true,
        pendingInteractions: [],
        transcriptTitle: "Transcript title",
        errorAttentionKey: "session-a:error",
      },
    });
  });

  it("merges activity patches and compares relationship values structurally", () => {
    const entry = createDirectoryEntry({
      sessionId: "session-a",
      workspaceId: "workspace-a",
      agentKind: "proliferate",
      sessionRelationship: {
        kind: "subagent_child",
        parentSessionId: "parent-a",
        sessionLinkId: "link-a",
        workspaceId: "workspace-a",
      },
      activity: {
        isStreaming: true,
        transcriptTitle: "Old title",
      },
    });

    const patched = normalizePatchedDirectoryEntry(entry, {
      activity: {
        transcriptTitle: "New title",
      },
    });

    expect(patched.activity).toEqual({
      ...entry.activity,
      transcriptTitle: "New title",
    });
    expect(directoryEntryEqual(entry, {
      ...entry,
      sessionRelationship: {
        kind: "subagent_child",
        parentSessionId: "parent-a",
        sessionLinkId: "link-a",
        workspaceId: "workspace-a",
      },
    })).toBe(true);
  });
});
