import {
  createTranscriptState,
  type AgentOperationsAgent,
  type SessionEventEnvelope,
  type SessionSubagentsResponse,
  type ToolCallItem,
  type TranscriptState,
} from "@anyharness/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyHistorySubagentAuthority,
  resolveHistorySubagentAuthority,
} from "#product/hooks/sessions/lifecycle/session-history-subagent-reconciliation";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";

const PARENT_ID = "parent-durable";
const CHILD_ID = "child-durable";
const CLIENT_CHILD_ID = "child-client";
const ABSENT_CHILD_ID = "absent-durable";
const WORKSPACE_ID = "workspace-1";

describe("history subagent reconciliation authority", () => {
  beforeEach(() => {
    useSessionDirectoryStore.getState().clearEntries();
  });

  it("marks both aliases from a strict correlated historical Workspace promotion", async () => {
    const fetchParentRoster = vi.fn();
    const authority = await resolveHistorySubagentAuthority({
      parentSessionId: PARENT_ID,
      workspaceId: WORKSPACE_ID,
      events: [],
      transcript: transcriptWith(workspaceOperation("promote_subagent", CHILD_ID)),
      fetchParentRoster,
      fetchVisibleSessionIds: vi.fn(),
    });

    expect(authority).toEqual({
      current: true,
      effects: [{
        kind: "mark_session_promoted",
        childSessionId: CHILD_ID,
        workspaceId: WORKSPACE_ID,
      }],
    });
    expect(fetchParentRoster).not.toHaveBeenCalled();

    const application = applicationSpies();
    applyHistorySubagentAuthority({
      effects: authority.effects,
      resolveClientSessionId: () => CLIENT_CHILD_ID,
      ...application,
    });

    expect(application.markSessionPromoted).toHaveBeenCalledWith(
      [CHILD_ID, CLIENT_CHILD_ID],
      WORKSPACE_ID,
    );
    expect(application.recordRelationship).not.toHaveBeenCalled();
    expect(application.mountSubagentChildSession).not.toHaveBeenCalled();
  });

  it("replays strict promotion authority from a historical Codex transport envelope", async () => {
    const direct = workspaceOperation("promote_subagent", CHILD_ID);
    const wrapped: ToolCallItem = {
      ...direct,
      nativeToolName: null,
      rawInput: {
        server: "workspace",
        tool: "promote_subagent",
        arguments: direct.rawInput,
      },
      rawOutput: {
        content: [{ type: "text", text: JSON.stringify(direct.rawOutput) }],
        isError: false,
        structuredContent: direct.rawOutput,
      },
    };
    const authority = await resolveHistorySubagentAuthority({
      parentSessionId: PARENT_ID,
      workspaceId: WORKSPACE_ID,
      events: [],
      transcript: transcriptWith(wrapped),
      fetchParentRoster: vi.fn(),
      fetchVisibleSessionIds: vi.fn(),
    });

    expect(authority.effects).toEqual([{
      kind: "mark_session_promoted",
      childSessionId: CHILD_ID,
      workspaceId: WORKSPACE_ID,
    }]);
  });

  it.each(["legacy", "create"] as const)(
    "records and mounts a %s candidate only from the successful current parent roster",
    async (candidateKind) => {
      const events = candidateKind === "legacy" ? [legacyCompletion(CHILD_ID)] : [];
      const transcript = candidateKind === "create"
        ? transcriptWith(workspaceOperation("create_agent", CHILD_ID))
        : createTranscriptState(PARENT_ID);
      const authority = await resolveHistorySubagentAuthority({
        parentSessionId: PARENT_ID,
        workspaceId: WORKSPACE_ID,
        events,
        transcript,
        fetchParentRoster: vi.fn(async () => roster([CHILD_ID])),
        fetchVisibleSessionIds: vi.fn(),
      });

      expect(authority.effects).toEqual([{
        kind: "record_subagent_relationship",
        childSessionId: CHILD_ID,
        label: "Roster child",
        workspaceId: WORKSPACE_ID,
        parentSessionId: PARENT_ID,
        sessionLinkId: "roster-link-child-durable",
      }]);

      const application = applicationSpies({ shouldMount: true });
      applyHistorySubagentAuthority({
        effects: authority.effects,
        requestHeaders: { "x-test": candidateKind },
        resolveClientSessionId: () => CLIENT_CHILD_ID,
        ...application,
      });

      expect(application.recordRelationship).toHaveBeenNthCalledWith(
        1,
        CHILD_ID,
        authority.effects[0],
      );
      expect(application.recordRelationship).toHaveBeenNthCalledWith(
        2,
        CLIENT_CHILD_ID,
        authority.effects[0],
      );
      expect(application.shouldMountRelationship).toHaveBeenCalledWith(
        [CHILD_ID, CLIENT_CHILD_ID],
        PARENT_ID,
        WORKSPACE_ID,
      );
      expect(application.mountSubagentChildSession).toHaveBeenCalledWith({
        childSessionId: CLIENT_CHILD_ID,
        label: "Roster child",
        workspaceId: WORKSPACE_ID,
        parentSessionId: PARENT_ID,
        sessionLinkId: "roster-link-child-durable",
        requestHeaders: { "x-test": candidateKind },
      });
      expect(application.mountSubagentChildSession).not.toHaveBeenCalledWith(
        expect.objectContaining({ childSessionId: CHILD_ID }),
      );
    },
  );

  it("turns a roster-absent candidate into a durable root only when its exact id is visible", async () => {
    const authority = await resolveHistorySubagentAuthority({
      parentSessionId: PARENT_ID,
      workspaceId: WORKSPACE_ID,
      events: [legacyCompletion(CHILD_ID)],
      transcript: createTranscriptState(PARENT_ID),
      fetchParentRoster: vi.fn(async () => roster([])),
      fetchVisibleSessionIds: vi.fn(async () => new Set([CHILD_ID])),
    });
    const store = useSessionDirectoryStore.getState();
    store.upsertEntry({
      sessionId: CLIENT_CHILD_ID,
      materializedSessionId: CHILD_ID,
      workspaceId: WORKSPACE_ID,
      agentKind: "codex",
      sessionRelationship: {
        kind: "subagent_child",
        parentSessionId: PARENT_ID,
        relation: "subagent",
        workspaceId: WORKSPACE_ID,
      },
    });
    const markSessionPromoted = vi.fn((sessionIds: readonly string[], workspaceId: string) => {
      useSessionDirectoryStore.getState().markSessionPromoted(sessionIds, workspaceId);
    });
    const mountSubagentChildSession = vi.fn();

    applyHistorySubagentAuthority({
      effects: authority.effects,
      resolveClientSessionId: () => CLIENT_CHILD_ID,
      recordRelationship: vi.fn(),
      markSessionPromoted,
      shouldMountRelationship: vi.fn(() => true),
      mountSubagentChildSession,
    });

    const state = useSessionDirectoryStore.getState();
    expect(markSessionPromoted).toHaveBeenCalledWith(
      [CHILD_ID, CLIENT_CHILD_ID],
      WORKSPACE_ID,
    );
    expect(state.entriesById[CLIENT_CHILD_ID]?.sessionRelationship).toEqual({ kind: "root" });
    expect([...state.promotedRootSessionIds]).toEqual([CHILD_ID, CLIENT_CHILD_ID]);
    expect(mountSubagentChildSession).not.toHaveBeenCalled();
  });

  it.each(["sessions_fetch_failed", "only_client_alias_visible"] as const)(
    "grants no promotion or mount when an absent candidate has %s",
    async (caseName) => {
      const authority = await resolveHistorySubagentAuthority({
        parentSessionId: PARENT_ID,
        workspaceId: WORKSPACE_ID,
        events: [legacyCompletion(CHILD_ID)],
        transcript: createTranscriptState(PARENT_ID),
        fetchParentRoster: vi.fn(async () => roster([])),
        fetchVisibleSessionIds: caseName === "sessions_fetch_failed"
          ? vi.fn(async () => { throw new Error("workspace sessions unavailable"); })
          : vi.fn(async () => new Set([CLIENT_CHILD_ID])),
      });
      const application = applicationSpies({ shouldMount: true });

      applyHistorySubagentAuthority({
        effects: authority.effects,
        resolveClientSessionId: () => CLIENT_CHILD_ID,
        ...application,
      });

      expect(authority.effects).toEqual([]);
      expect(application.markSessionPromoted).not.toHaveBeenCalled();
      expect(application.recordRelationship).not.toHaveBeenCalled();
      expect(application.mountSubagentChildSession).not.toHaveBeenCalled();
    },
  );

  it.each(["parent", "workspace"] as const)(
    "grants no legacy authority when the current roster has a mismatched %s identity",
    async (mismatch) => {
      const currentRoster = roster([CHILD_ID]);
      const mismatchedRoster: SessionSubagentsResponse = {
        ...currentRoster,
        parent: {
          ...currentRoster.parent,
          ...(mismatch === "parent"
            ? {
              identity: {
                ...currentRoster.parent.identity,
                sessionId: "different-parent",
              },
            }
            : {
              workspace: {
                ...currentRoster.parent.workspace,
                workspaceId: "different-workspace",
              },
            }),
        },
      };
      const fetchVisibleSessionIds = vi.fn();
      const authority = await resolveHistorySubagentAuthority({
        parentSessionId: PARENT_ID,
        workspaceId: WORKSPACE_ID,
        events: [legacyCompletion(CHILD_ID)],
        transcript: createTranscriptState(PARENT_ID),
        fetchParentRoster: vi.fn(async () => mismatchedRoster),
        fetchVisibleSessionIds,
      });

      expect(authority).toEqual({ current: true, effects: [] });
      expect(fetchVisibleSessionIds).not.toHaveBeenCalled();
    },
  );

  it("keeps confirmed roster authority when another candidate's sessions lookup fails", async () => {
    const authority = await resolveHistorySubagentAuthority({
      parentSessionId: PARENT_ID,
      workspaceId: WORKSPACE_ID,
      events: [legacyCompletion(CHILD_ID), legacyCompletion(ABSENT_CHILD_ID)],
      transcript: createTranscriptState(PARENT_ID),
      fetchParentRoster: vi.fn(async () => roster([CHILD_ID])),
      fetchVisibleSessionIds: vi.fn(async () => {
        throw new Error("workspace sessions unavailable");
      }),
    });

    expect(authority.effects).toEqual([{
      kind: "record_subagent_relationship",
      childSessionId: CHILD_ID,
      label: "Roster child",
      workspaceId: WORKSPACE_ID,
      parentSessionId: PARENT_ID,
      sessionLinkId: "roster-link-child-durable",
    }]);

    const application = applicationSpies({ shouldMount: true });
    applyHistorySubagentAuthority({
      effects: authority.effects,
      resolveClientSessionId: (sessionId) =>
        sessionId === CHILD_ID ? CLIENT_CHILD_ID : null,
      ...application,
    });

    expect(application.markSessionPromoted).not.toHaveBeenCalled();
    expect(application.recordRelationship).toHaveBeenNthCalledWith(
      1,
      CHILD_ID,
      authority.effects[0],
    );
    expect(application.recordRelationship).toHaveBeenNthCalledWith(
      2,
      CLIENT_CHILD_ID,
      authority.effects[0],
    );
    expect(application.mountSubagentChildSession).toHaveBeenCalledTimes(1);
    expect(application.mountSubagentChildSession).toHaveBeenCalledWith(
      expect.objectContaining({ childSessionId: CLIENT_CHILD_ID }),
    );
    expect(application.mountSubagentChildSession).not.toHaveBeenCalledWith(
      expect.objectContaining({ childSessionId: CHILD_ID }),
    );
  });

  it("returns no applicable effects when the hydration request becomes stale", async () => {
    const authority = await resolveHistorySubagentAuthority({
      parentSessionId: PARENT_ID,
      workspaceId: WORKSPACE_ID,
      events: [legacyCompletion(CHILD_ID)],
      transcript: transcriptWith(workspaceOperation("promote_subagent", CHILD_ID)),
      fetchParentRoster: vi.fn(async () => roster([CHILD_ID])),
      fetchVisibleSessionIds: vi.fn(),
      isCurrent: () => false,
    });
    const application = applicationSpies({ shouldMount: true });

    applyHistorySubagentAuthority({
      effects: authority.effects,
      resolveClientSessionId: () => CLIENT_CHILD_ID,
      ...application,
    });

    expect(authority).toEqual({ current: false, effects: [] });
    expect(application.markSessionPromoted).not.toHaveBeenCalled();
    expect(application.recordRelationship).not.toHaveBeenCalled();
    expect(application.mountSubagentChildSession).not.toHaveBeenCalled();
  });
});

function applicationSpies(options: { shouldMount?: boolean } = {}) {
  return {
    recordRelationship: vi.fn(),
    markSessionPromoted: vi.fn(),
    shouldMountRelationship: vi.fn(() => options.shouldMount ?? false),
    mountSubagentChildSession: vi.fn(),
  };
}

function transcriptWith(item: ToolCallItem): TranscriptState {
  const transcript = createTranscriptState(PARENT_ID);
  transcript.itemsById[item.itemId] = item;
  return transcript;
}

function workspaceOperation(
  action: "create_agent" | "promote_subagent",
  childSessionId: string,
): ToolCallItem {
  const role = action === "create_agent" ? "subagent" : "ordinary";
  return {
    kind: "tool_call",
    itemId: `tool-${action}-${childSessionId}`,
    turnId: "turn-1",
    status: "completed",
    sourceAgentKind: "codex",
    messageId: null,
    title: "Historical agent operation",
    nativeToolName: `mcp__proliferate_workspace__${action}`,
    parentToolCallId: null,
    rawInput: action === "create_agent"
      ? { workspaceId: WORKSPACE_ID, kind: "subagent", task: "Help" }
      : { agentId: childSessionId },
    rawOutput: agent(childSessionId, role === "subagent" ? PARENT_ID : null),
    contentParts: [],
    timestamp: "2026-08-11T00:00:01Z",
    startedSeq: 1,
    lastUpdatedSeq: 2,
    completedSeq: 2,
    completedAt: "2026-08-11T00:00:02Z",
    toolCallId: `tool-${action}-${childSessionId}`,
    toolKind: "other",
    semanticKind: "other",
    approvalState: "none",
  };
}

function agent(
  sessionId: string,
  parentSessionId: string | null,
): AgentOperationsAgent {
  return {
    capabilities: ["get_agent", "send_message"],
    configuration: { agentKind: "codex", modelId: null, modeId: null },
    createdAt: "2026-08-11T00:00:00Z",
    identity: { runtimeId: "runtime-1", sessionId },
    parent: parentSessionId
      ? { runtimeId: "runtime-1", sessionId: parentSessionId }
      : null,
    role: parentSessionId ? "subagent" : "ordinary",
    status: {
      execution: "idle",
      hasLiveActor: true,
      presentation: "available",
    },
    title: sessionId === PARENT_ID ? "Parent" : "Receipt child",
    updatedAt: "2026-08-11T00:00:01Z",
    workspace: { runtimeId: "runtime-1", workspaceId: WORKSPACE_ID },
  };
}

function roster(childSessionIds: readonly string[]): SessionSubagentsResponse {
  return {
    parent: agent(PARENT_ID, null),
    children: childSessionIds.map((childSessionId) => ({
      agent: {
        ...agent(childSessionId, PARENT_ID),
        title: "Roster agent",
      },
      latestCompletion: null,
      relationship: {
        childSessionId,
        createdAt: "2026-08-11T00:00:00Z",
        label: "Roster child",
        parentSessionId: PARENT_ID,
        sessionLinkId: `roster-link-${childSessionId}`,
      },
    })),
  };
}

function legacyCompletion(childSessionId: string): SessionEventEnvelope {
  return {
    sessionId: PARENT_ID,
    seq: childSessionId === CHILD_ID ? 1 : 2,
    timestamp: "2026-08-11T00:00:01Z",
    event: {
      type: "subagent_turn_completed",
      completionId: `completion-${childSessionId}`,
      sessionLinkId: `legacy-link-${childSessionId}`,
      parentSessionId: PARENT_ID,
      childSessionId,
      childTurnId: `turn-${childSessionId}`,
      childLastEventSeq: 10,
      outcome: "completed",
      label: "Legacy child",
    },
  };
}
