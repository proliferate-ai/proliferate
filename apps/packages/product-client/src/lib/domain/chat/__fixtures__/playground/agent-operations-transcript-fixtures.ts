import type { TranscriptState } from "@anyharness/sdk";
import type { PendingPromptQueueEntry } from "#product/domain/chats/pending-prompts/pending-prompt-queue";
import { toolCallItem } from "#product/lib/domain/chat/__fixtures__/playground/tool-call-item-fixture";

const SESSION_ID = "playground-agent-operations";
const TURN_ID = "turn-agent-operations";
const REVIEW_SESSION_ID = "agent-session-review";

const workspaceReceipt = toolCallItem({
  itemId: "create-workspace",
  toolCallId: "create-workspace",
  turnId: TURN_ID,
  title: "Create workspace",
  nativeToolName: "mcp__workspace__create_workspace",
  status: "completed",
  rawInput: {
    repositoryId: "repo-root-playground",
    creationMode: "worktree",
    branch: "main",
    displayName: "Agent operations",
  },
  rawOutput: {
    workspace: {
      identity: { runtimeId: "runtime-playground", workspaceId: "workspace-agent-operations" },
      repositoryId: "repo-root-playground",
      kind: "worktree",
      surface: "standard",
      path: "/runtime/worktrees/agent-operations",
      displayName: "Agent operations",
      originalBranch: "main",
      currentBranch: "codex/agent-operations",
      lifecycleState: "active",
      createdAt: "2026-08-10T19:00:01Z",
      updatedAt: "2026-08-10T19:00:02Z",
    },
    creationMode: "worktree",
  },
  startedSeq: 1,
  lastUpdatedSeq: 1,
  completedSeq: 1,
});

const sendReceipt = toolCallItem({
  itemId: "send-message",
  toolCallId: "send-message",
  turnId: TURN_ID,
  title: "Send message",
  nativeToolName: "mcp__workspace__send_message",
  status: "completed",
  rawInput: {
    agentId: REVIEW_SESSION_ID,
    message: "Please verify the full replay path, including long receipt content, exact whitespace, and every completion outcome before reporting back.",
  },
  rawOutput: {
    target: { runtimeId: "runtime-playground", sessionId: REVIEW_SESSION_ID },
    queueSeq: 14,
    status: "durably_queued",
  },
  startedSeq: 2,
  lastUpdatedSeq: 2,
  completedSeq: 2,
});

const failedInterruptReceipt = toolCallItem({
  itemId: "interrupt-agent-failed",
  toolCallId: "interrupt-agent-failed",
  turnId: TURN_ID,
  title: "Interrupt agent",
  nativeToolName: "mcp__workspace__interrupt_agent",
  status: "failed",
  rawInput: { agentId: REVIEW_SESSION_ID },
  rawOutput: { error: "The agent finished before the interrupt was applied." },
  startedSeq: 3,
  lastUpdatedSeq: 3,
  completedSeq: 3,
});

const closeReceipt = toolCallItem({
  itemId: "close-subagent",
  toolCallId: "close-subagent",
  turnId: TURN_ID,
  title: "Close subagent",
  nativeToolName: "mcp__workspace__close_subagent",
  status: "completed",
  rawInput: { agentId: REVIEW_SESSION_ID },
  rawOutput: agentView({
    status: { presentation: "closed", execution: "closed", hasLiveActor: false },
  }),
  startedSeq: 4,
  lastUpdatedSeq: 4,
  completedSeq: 4,
});

const incomingReply = userMessage({
  itemId: "incoming-agent-reply",
  seq: 5,
  text: "Replay is stable. The exact long reply remains available on hover and keyboard focus without creating a user-message bubble.",
  promptProvenance: {
    type: "agentSession",
    sourceSessionId: REVIEW_SESSION_ID,
    label: "Replay and receipt verification",
  },
});

const completedWake = userMessage({
  itemId: "wake-completed",
  seq: 6,
  text: "Completion payload for the successful delegated turn.",
  promptProvenance: {
    type: "subagentWake",
    sessionLinkId: "link-completed",
    completionId: "completion-completed",
    label: "API surface check",
  },
});

const failedWake = userMessage({
  itemId: "wake-failed",
  seq: 7,
  text: "Completion payload for the failed delegated turn.",
  promptProvenance: {
    type: "subagentWake",
    sessionLinkId: "link-failed",
    completionId: "completion-failed",
    label: "Failure-path audit",
  },
});

const cancelledWake = userMessage({
  itemId: "wake-cancelled",
  seq: 8,
  text: "Completion payload for the cancelled delegated turn.",
  promptProvenance: {
    type: "subagentWake",
    sessionLinkId: "link-cancelled",
    completionId: "completion-cancelled",
    label: "Cancellation audit",
  },
});

const receiptItems = [
  workspaceReceipt,
  sendReceipt,
  failedInterruptReceipt,
  closeReceipt,
  incomingReply,
  completedWake,
  failedWake,
  cancelledWake,
];

export const PLAYGROUND_AGENT_OPERATIONS_RECEIPTS_TRANSCRIPT = {
  sessionMeta: {
    sessionId: SESSION_ID,
    title: "Agent Operations receipts",
    updatedAt: "2026-08-10T19:00:10Z",
    nativeSessionId: null,
    sourceAgentKind: "codex",
  },
  turnOrder: [TURN_ID],
  turnsById: {
    [TURN_ID]: {
      turnId: TURN_ID,
      itemOrder: receiptItems.map((item) => item.itemId),
      startedAt: "2026-08-10T19:00:00Z",
      completedAt: "2026-08-10T19:00:10Z",
      stopReason: "end_turn",
      fileBadges: [],
    },
  },
  itemsById: Object.fromEntries(receiptItems.map((item) => [item.itemId, item])),
  openAssistantItemId: null,
  openThoughtItemId: null,
  pendingInteractions: [],
  availableCommands: [],
  liveConfig: null,
  currentModeId: null,
  usageState: null,
  unknownEvents: [],
  isStreaming: false,
  lastSeq: 8,
  pendingPrompts: [],
  linkCompletionsByCompletionId: {
    "completion-completed": completion("completion-completed", "link-completed", "agent-session-api", "completed", 6),
    "completion-failed": completion("completion-failed", "link-failed", "agent-session-failed", "failed", 7),
    "completion-cancelled": completion("completion-cancelled", "link-cancelled", "agent-session-cancelled", "cancelled", 8),
  },
  latestLinkCompletionBySessionLinkId: {
    "link-completed": "completion-completed",
    "link-failed": "completion-failed",
    "link-cancelled": "completion-cancelled",
  },
} as TranscriptState;

export const PLAYGROUND_AGENT_OPERATIONS_PENDING_ENTRIES: PendingPromptQueueEntry[] = [
  {
    seq: 21,
    text: "User follow-up stays first",
    contentParts: [],
    isBeingEdited: false,
  },
  {
    seq: 22,
    text: "Hidden update one",
    contentParts: [],
    isBeingEdited: false,
    promptProvenance: {
      type: "agentSession",
      sourceSessionId: REVIEW_SESSION_ID,
      label: "Replay and receipt verification",
    },
  },
  {
    seq: 23,
    text: "Hidden update two",
    contentParts: [],
    isBeingEdited: false,
    promptProvenance: {
      type: "agentSession",
      sourceSessionId: REVIEW_SESSION_ID,
      label: "Replay and receipt verification",
    },
  },
  {
    seq: 24,
    text: "Hidden cowork update",
    contentParts: [],
    isBeingEdited: false,
    promptProvenance: {
      type: "linkWake",
      relation: "cowork_coding_session",
      sessionLinkId: "link-pending-cowork",
      completionId: "completion-pending-cowork",
      label: "Coding pass",
    },
  },
];

export const PLAYGROUND_AGENT_OPERATIONS_PENDING_COMPLETIONS: TranscriptState["linkCompletionsByCompletionId"] = {
  "completion-pending-cowork": completion(
    "completion-pending-cowork",
    "link-pending-cowork",
    "agent-session-cowork",
    "completed",
    24,
    "cowork_coding_session",
  ),
};

export const PLAYGROUND_AGENT_OPERATIONS_DIRECTORY_ENTRY = {
  sessionId: "client-session:review",
  materializedSessionId: REVIEW_SESSION_ID,
  workspaceId: "playground-workspace",
  agentKind: "codex",
  title: "Replay and receipt verification",
} as const;

function agentView(overrides: Record<string, unknown> = {}) {
  return {
    identity: { runtimeId: "runtime-playground", sessionId: REVIEW_SESSION_ID },
    workspace: { runtimeId: "runtime-playground", workspaceId: "playground-workspace" },
    role: "subagent",
    title: "Replay and receipt verification",
    configuration: {
      agentKind: "codex",
      modelId: "gpt-5.6-sol",
      modeId: "unattended",
    },
    status: { presentation: "available", execution: "idle", hasLiveActor: true },
    capabilities: ["get_agent", "send_message"],
    createdAt: "2026-08-10T19:00:00Z",
    updatedAt: "2026-08-10T19:00:01Z",
    ...overrides,
  };
}

function userMessage({
  itemId,
  seq,
  text,
  promptProvenance,
}: {
  itemId: string;
  seq: number;
  text: string;
  promptProvenance: Record<string, unknown>;
}) {
  return {
    kind: "user_message" as const,
    itemId,
    turnId: TURN_ID,
    status: "completed" as const,
    sourceAgentKind: "system",
    messageId: null,
    title: null,
    nativeToolName: null,
    parentToolCallId: null,
    rawInput: undefined,
    rawOutput: undefined,
    contentParts: [],
    timestamp: "2026-08-10T19:00:05Z",
    startedSeq: seq,
    lastUpdatedSeq: seq,
    completedSeq: seq,
    completedAt: "2026-08-10T19:00:05Z",
    text,
    isStreaming: false,
    promptProvenance,
  };
}

function completion(
  completionId: string,
  sessionLinkId: string,
  childSessionId: string,
  outcome: "completed" | "failed" | "cancelled",
  seq: number,
  relation = "subagent",
) {
  return {
    relation,
    completionId,
    sessionLinkId,
    parentSessionId: SESSION_ID,
    childSessionId,
    childTurnId: `turn-${childSessionId}`,
    childLastEventSeq: seq,
    outcome,
    label: null,
    seq,
    timestamp: "2026-08-10T19:00:05Z",
  };
}
