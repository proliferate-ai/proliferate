import type { ToolCallItem, TranscriptState } from "@anyharness/sdk";
import { toolCallItem } from "#product/lib/domain/chat/__fixtures__/playground/tool-call-item-fixture";

const TURN_GROUP = "turn-subagent-creations";
const TURN_SINGLE = "turn-subagent-creation-single";

const creationGroupItems = [
  workspaceSubagentCreationFixture(
    "tool-agent-api",
    "agent-session-api",
    "API surface check",
    "Check API surface consistency.",
    1,
    "completed",
    TURN_GROUP,
  ),
  workspaceSubagentCreationFixture(
    "tool-agent-tests",
    "agent-session-tests",
    "Test plan review",
    "Review test coverage for delegated work.",
    2,
    "completed",
    TURN_GROUP,
  ),
  workspaceSubagentCreationFixture(
    "tool-agent-failed",
    null,
    "Failure-path audit",
    "Verify failed creation remains attributable without inventing identity.",
    3,
    "failed",
    TURN_GROUP,
  ),
];

const singleCreationItem = workspaceSubagentCreationFixture(
  "tool-agent-single",
  "agent-session-single",
  "Runtime survey",
  "Inspect the runtime server SDK path and report API mismatches.",
  1,
  "completed",
  TURN_SINGLE,
);

export const PLAYGROUND_SUBAGENT_CREATION_SINGLE_TRANSCRIPT = transcript(
  "playground-subagent-creation-single",
  "Single subagent creation",
  TURN_SINGLE,
  [singleCreationItem],
  true,
);

export const PLAYGROUND_SUBAGENT_CREATION_GROUP_TRANSCRIPT = transcript(
  "playground-subagent-creations",
  "Subagent creation grouping",
  TURN_GROUP,
  creationGroupItems,
  true,
);

export function buildPlaygroundSubagentInsertionTranscript(
  settledCount: 1 | 2,
): TranscriptState {
  return transcript(
    "playground-agent-operations-grouping",
    "Agent creation insertion",
    TURN_GROUP,
    creationGroupItems.slice(0, settledCount),
    false,
  );
}

export function workspaceSubagentCreationFixture(
  itemId: string,
  sessionId: string | null,
  title: string,
  task: string,
  seq: number,
  status: ToolCallItem["status"],
  turnId: string = TURN_GROUP,
): ToolCallItem {
  const rawOutput = sessionId
    ? {
      identity: { runtimeId: "runtime-playground", sessionId },
      workspace: { runtimeId: "runtime-playground", workspaceId: "playground-workspace" },
      role: "subagent",
      title,
      configuration: {
        agentKind: "codex",
        modelId: "gpt-5.6-sol",
        modeId: "unattended",
      },
      status: { presentation: "available", execution: "idle", hasLiveActor: true },
      capabilities: ["get_agent", "send_message"],
      createdAt: "2026-08-10T19:00:00Z",
      updatedAt: "2026-08-10T19:00:01Z",
    }
    : null;
  return toolCallItem({
    itemId,
    toolCallId: itemId,
    turnId,
    title: "Create agent",
    nativeToolName: "mcp__proliferate_workspace__create_agent",
    semanticKind: "other",
    toolKind: "other",
    status,
    rawInput: {
      workspaceId: "playground-workspace",
      kind: "subagent",
      task,
      agentKind: "codex",
      modelId: "gpt-5.6-sol",
      modeId: "unattended",
    },
    rawOutput,
    contentParts: [{
      type: "tool_call",
      toolCallId: itemId,
      title: "Create agent",
      toolKind: "other",
      nativeToolName: "mcp__proliferate_workspace__create_agent",
    }],
    startedSeq: seq,
    lastUpdatedSeq: seq,
    completedSeq: status === "in_progress" ? null : seq,
    completedAt: status === "in_progress" ? null : "2026-08-10T19:00:01Z",
  });
}

function transcript(
  sessionId: string,
  title: string,
  turnId: string,
  items: ToolCallItem[],
  completed: boolean,
): TranscriptState {
  return {
    sessionMeta: {
      sessionId,
      title,
      updatedAt: "2026-08-10T19:00:02Z",
      nativeSessionId: null,
      sourceAgentKind: "codex",
    },
    turnOrder: [turnId],
    turnsById: {
      [turnId]: {
        turnId,
        itemOrder: items.map((item) => item.itemId),
        startedAt: "2026-08-10T19:00:00Z",
        completedAt: completed ? "2026-08-10T19:00:03Z" : null,
        stopReason: completed ? "end_turn" : null,
        fileBadges: [],
      },
    },
    itemsById: Object.fromEntries(items.map((item) => [item.itemId, item])),
    openAssistantItemId: null,
    openThoughtItemId: null,
    pendingInteractions: [],
    availableCommands: [],
    liveConfig: null,
    currentModeId: null,
    usageState: null,
    unknownEvents: [],
    isStreaming: !completed,
    lastSeq: Math.max(0, ...items.map((item) => item.lastUpdatedSeq)),
    pendingPrompts: [],
    linkCompletionsByCompletionId: {},
    latestLinkCompletionBySessionLinkId: {},
  };
}
