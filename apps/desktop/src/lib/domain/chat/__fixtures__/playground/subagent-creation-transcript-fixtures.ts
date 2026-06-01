import type { TranscriptState } from "@anyharness/sdk";
import { toolCallItem } from "@/lib/domain/chat/__fixtures__/playground/tool-call-item-fixture";

const creationGroupItems = [
  subagentCreationFixture("tool-agent-api", "API Surface Check", "Check API surface consistency.", 1),
  subagentCreationFixture("tool-agent-tests", "Test Plan Review", "Review test coverage for delegated work.", 2),
];

const singleCreationItem = subagentCreationFixture(
  "tool-agent-single",
  "Runtime Survey",
  "Inspect the runtime server SDK path and report API mismatches.",
  1,
);

export const PLAYGROUND_SUBAGENT_CREATION_SINGLE_TRANSCRIPT: TranscriptState = {
  sessionMeta: {
    sessionId: "playground-subagent-creation-single",
    title: "Single subagent creation",
    updatedAt: "2026-04-12T00:00:02Z",
    nativeSessionId: null,
    sourceAgentKind: "codex",
  },
  turnOrder: ["turn-subagent-creation-single"],
  turnsById: {
    "turn-subagent-creation-single": {
      turnId: "turn-subagent-creation-single",
      itemOrder: [singleCreationItem.itemId],
      startedAt: "2026-04-12T00:00:00Z",
      completedAt: "2026-04-12T00:00:03Z",
      stopReason: "end_turn",
      fileBadges: [],
    },
  },
  itemsById: {
    [singleCreationItem.itemId]: {
      ...singleCreationItem,
      turnId: "turn-subagent-creation-single",
    },
  },
  openAssistantItemId: null,
  openThoughtItemId: null,
  pendingInteractions: [],
  availableCommands: [],
  liveConfig: null,
  currentModeId: null,
  usageState: null,
  unknownEvents: [],
  isStreaming: false,
  lastSeq: 3,
  pendingPrompts: [],
  linkCompletionsByCompletionId: {},
  latestLinkCompletionBySessionLinkId: {},
};

export const PLAYGROUND_SUBAGENT_CREATION_GROUP_TRANSCRIPT: TranscriptState = {
  sessionMeta: {
    sessionId: "playground-subagent-creations",
    title: "Subagent creation grouping",
    updatedAt: "2026-04-12T00:00:02Z",
    nativeSessionId: null,
    sourceAgentKind: "codex",
  },
  turnOrder: ["turn-subagent-creations"],
  turnsById: {
    "turn-subagent-creations": {
      turnId: "turn-subagent-creations",
      itemOrder: creationGroupItems.map((item) => item.itemId),
      startedAt: "2026-04-12T00:00:00Z",
      completedAt: "2026-04-12T00:00:03Z",
      stopReason: "end_turn",
      fileBadges: [],
    },
  },
  itemsById: Object.fromEntries(creationGroupItems.map((item) => [item.itemId, item])),
  openAssistantItemId: null,
  openThoughtItemId: null,
  pendingInteractions: [],
  availableCommands: [],
  liveConfig: null,
  currentModeId: null,
  usageState: null,
  unknownEvents: [],
  isStreaming: false,
  lastSeq: 4,
  pendingPrompts: [],
  linkCompletionsByCompletionId: {},
  latestLinkCompletionBySessionLinkId: {},
};

function subagentCreationFixture(
  itemId: string,
  label: string,
  prompt: string,
  seq: number,
) {
  return toolCallItem({
    itemId,
    toolCallId: itemId,
    turnId: "turn-subagent-creations",
    title: "mcp__subagents__create_subagent",
    nativeToolName: "mcp__subagents__create_subagent",
    semanticKind: "subagent",
    rawInput: {
      agentKind: "codex",
      label,
      modelId: "gpt-5.4",
      prompt,
    },
    rawOutput: {
      childSessionId: `child-${itemId}`,
      sessionLinkId: `link-${itemId}`,
      promptStatus: "queued",
      wakeScheduled: false,
    },
    startedSeq: seq,
    lastUpdatedSeq: seq,
    completedSeq: seq,
  });
}
