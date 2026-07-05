import type { TranscriptItem, TranscriptState } from "@anyharness/sdk";
import { toolCallItem } from "@/lib/domain/chat/__fixtures__/playground/tool-call-item-fixture";

// Native-harness (Claude Task) subagent activity that streams in AFTER its
// launching `Agent` tool call — the background/async case. The launch is a
// completed `Agent` tool call in an earlier turn; the subagent's own tool
// calls arrive in a later turn tagged with `parentToolCallId` = the launch id.
// The domain re-binds those orphaned roots into a `subagent_activity` block so
// they render as one bounded, drill-in unit instead of leaking into main text.

function seq(startedSeq: number): {
  startedSeq: number;
  lastUpdatedSeq: number;
  completedSeq: number;
  completedAt: string;
  timestamp: string;
} {
  return {
    startedSeq,
    lastUpdatedSeq: startedSeq,
    completedSeq: startedSeq,
    completedAt: "2026-04-24T00:00:00Z",
    timestamp: "2026-04-24T00:00:00Z",
  };
}

function assistantProse(itemId: string, turnId: string, startedSeq: number, text: string): TranscriptItem {
  return {
    kind: "assistant_prose",
    itemId,
    turnId,
    status: "completed",
    sourceAgentKind: "claude",
    messageId: null,
    title: null,
    nativeToolName: null,
    parentToolCallId: null,
    rawInput: undefined,
    rawOutput: undefined,
    contentParts: [],
    ...seq(startedSeq),
    text,
    isStreaming: false,
  } as TranscriptItem;
}

function agentLaunch(params: {
  itemId: string;
  turnId: string;
  startedSeq: number;
  label: string;
  status?: "in_progress" | "completed" | "failed";
  backgroundState?: "pending" | "completed" | "expired" | null;
}): TranscriptItem {
  const { itemId, turnId, startedSeq, label, status = "completed", backgroundState = "completed" } = params;
  return toolCallItem({
    kind: "tool_call",
    itemId,
    toolCallId: itemId,
    turnId,
    status,
    sourceAgentKind: "claude",
    title: label,
    nativeToolName: "Agent",
    semanticKind: "subagent",
    toolKind: "think",
    rawInput: { description: label, run_in_background: true },
    rawOutput: backgroundState
      ? {
          isAsync: true,
          agentId: `agent-${itemId}`,
          outputFile: `/tmp/${itemId}.output`,
          _anyharness: {
            backgroundWork: { trackerKind: "claude_async_agent", state: backgroundState },
          },
        }
      : undefined,
    contentParts: [
      {
        type: "tool_result_text",
        text: "Async agent launched successfully.\nThe agent is working in the background.",
      },
    ],
    ...seq(startedSeq),
  }) as TranscriptItem;
}

function subagentBash(params: {
  itemId: string;
  turnId: string;
  startedSeq: number;
  parentToolCallId: string;
  command: string;
  output: string;
  status?: "in_progress" | "completed" | "failed";
}): TranscriptItem {
  const { itemId, turnId, startedSeq, parentToolCallId, command, output, status = "completed" } = params;
  return toolCallItem({
    kind: "tool_call",
    itemId,
    toolCallId: itemId,
    turnId,
    status,
    sourceAgentKind: "claude",
    parentToolCallId,
    title: command,
    nativeToolName: "Bash",
    semanticKind: "terminal",
    toolKind: "execute",
    rawInput: { command },
    contentParts: [
      { type: "terminal_output", terminalId: itemId, event: "output", data: output },
    ],
    ...seq(startedSeq),
    completedSeq: status === "in_progress" ? null : startedSeq,
    completedAt: status === "in_progress" ? null : "2026-04-24T00:00:00Z",
  }) as TranscriptItem;
}

function baseState(overrides: Partial<TranscriptState>): TranscriptState {
  return {
    sessionMeta: {
      sessionId: "playground-subagent-activity",
      title: "Background subagents",
      updatedAt: "2026-04-24T00:00:10Z",
      nativeSessionId: null,
      sourceAgentKind: "claude",
    },
    turnOrder: [],
    turnsById: {},
    itemsById: {},
    openAssistantItemId: null,
    openThoughtItemId: null,
    pendingInteractions: [],
    availableCommands: [],
    liveConfig: null,
    currentModeId: null,
    usageState: null,
    unknownEvents: [],
    isStreaming: false,
    lastSeq: 20,
    pendingPrompts: [],
    linkCompletionsByCompletionId: {},
    latestLinkCompletionBySessionLinkId: {},
    ...overrides,
  };
}

// A single background subagent still working: launch completed in turn-1, its
// inner tool calls streaming into turn-2 with one still in progress.
export const PLAYGROUND_SUBAGENT_ACTIVITY_RUNNING: TranscriptState = baseState({
  turnOrder: ["turn-1", "turn-2"],
  turnsById: {
    "turn-1": {
      turnId: "turn-1",
      itemOrder: ["u1", "launch-a", "a-launched"],
      startedAt: "2026-04-24T00:00:00Z",
      completedAt: "2026-04-24T00:00:02Z",
      stopReason: "end_turn",
      fileBadges: [],
    },
    "turn-2": {
      turnId: "turn-2",
      itemOrder: ["a-bash-1", "a-bash-2"],
      startedAt: "2026-04-24T00:00:05Z",
      completedAt: null,
      stopReason: null,
      fileBadges: [],
    },
  },
  itemsById: {
    u1: {
      kind: "user_message",
      itemId: "u1",
      turnId: "turn-1",
      status: "completed",
      sourceAgentKind: "claude",
      messageId: null,
      title: null,
      nativeToolName: null,
      parentToolCallId: null,
      rawInput: undefined,
      rawOutput: undefined,
      contentParts: [],
      ...seq(1),
      text: "Spawn a background subagent to audit the build script.",
      isStreaming: false,
    } as TranscriptItem,
    "launch-a": agentLaunch({
      itemId: "launch-a",
      turnId: "turn-1",
      startedSeq: 2,
      label: "Audit build script",
      backgroundState: "pending",
    }),
    "a-launched": assistantProse("a-launched", "turn-1", 3, "The background agent is running. I'll continue once it reports back."),
    "a-bash-1": subagentBash({
      itemId: "a-bash-1",
      turnId: "turn-2",
      startedSeq: 4,
      parentToolCallId: "launch-a",
      command: "cat package.json",
      output: "{ \"scripts\": { \"build\": \"tsc\" } }\n",
    }),
    "a-bash-2": subagentBash({
      itemId: "a-bash-2",
      turnId: "turn-2",
      startedSeq: 5,
      parentToolCallId: "launch-a",
      command: "npm run build",
      output: "Building...\n",
      status: "in_progress",
    }),
  },
});

// A background subagent that finished: activity in turn-2, launch marked
// completed. Default-collapsed; expandable to drill in.
export const PLAYGROUND_SUBAGENT_ACTIVITY_DONE: TranscriptState = baseState({
  turnOrder: ["turn-1", "turn-2"],
  turnsById: {
    "turn-1": {
      turnId: "turn-1",
      itemOrder: ["u1", "launch-a", "a-launched"],
      startedAt: "2026-04-24T00:00:00Z",
      completedAt: "2026-04-24T00:00:02Z",
      stopReason: "end_turn",
      fileBadges: [],
    },
    "turn-2": {
      turnId: "turn-2",
      itemOrder: ["a-bash-1", "a-bash-2", "a-done", "wrap"],
      startedAt: "2026-04-24T00:00:05Z",
      completedAt: "2026-04-24T00:00:09Z",
      stopReason: "end_turn",
      fileBadges: [],
    },
  },
  itemsById: {
    u1: {
      kind: "user_message",
      itemId: "u1",
      turnId: "turn-1",
      status: "completed",
      sourceAgentKind: "claude",
      messageId: null,
      title: null,
      nativeToolName: null,
      parentToolCallId: null,
      rawInput: undefined,
      rawOutput: undefined,
      contentParts: [],
      ...seq(1),
      text: "Spawn a background subagent to count the files.",
      isStreaming: false,
    } as TranscriptItem,
    "launch-a": agentLaunch({
      itemId: "launch-a",
      turnId: "turn-1",
      startedSeq: 2,
      label: "Count files",
      backgroundState: "completed",
    }),
    "a-launched": assistantProse("a-launched", "turn-1", 3, "Background agent launched."),
    "a-bash-1": subagentBash({
      itemId: "a-bash-1",
      turnId: "turn-2",
      startedSeq: 4,
      parentToolCallId: "launch-a",
      command: "ls -1 | wc -l",
      output: "8\n",
    }),
    "a-bash-2": subagentBash({
      itemId: "a-bash-2",
      turnId: "turn-2",
      startedSeq: 5,
      parentToolCallId: "launch-a",
      command: "ls -1a | wc -l",
      output: "11\n",
    }),
    "a-done": assistantProse("a-done", "turn-2", 6, "The background agent finished: 8 regular files, 11 entries total."),
    wrap: assistantProse("wrap", "turn-2", 7, "Done — the directory has 8 files."),
  },
});

// A background subagent that failed mid-flight: its last inner tool call
// failed and the launch is marked failed.
export const PLAYGROUND_SUBAGENT_ACTIVITY_FAILED: TranscriptState = baseState({
  turnOrder: ["turn-1", "turn-2"],
  turnsById: {
    "turn-1": {
      turnId: "turn-1",
      itemOrder: ["u1", "launch-a"],
      startedAt: "2026-04-24T00:00:00Z",
      completedAt: "2026-04-24T00:00:02Z",
      stopReason: "end_turn",
      fileBadges: [],
    },
    "turn-2": {
      turnId: "turn-2",
      itemOrder: ["a-bash-1", "wrap"],
      startedAt: "2026-04-24T00:00:05Z",
      completedAt: "2026-04-24T00:00:07Z",
      stopReason: "end_turn",
      fileBadges: [],
    },
  },
  itemsById: {
    u1: {
      kind: "user_message",
      itemId: "u1",
      turnId: "turn-1",
      status: "completed",
      sourceAgentKind: "claude",
      messageId: null,
      title: null,
      nativeToolName: null,
      parentToolCallId: null,
      rawInput: undefined,
      rawOutput: undefined,
      contentParts: [],
      ...seq(1),
      text: "Spawn a background subagent to run the flaky test.",
      isStreaming: false,
    } as TranscriptItem,
    "launch-a": agentLaunch({
      itemId: "launch-a",
      turnId: "turn-1",
      startedSeq: 2,
      label: "Run flaky test",
      status: "failed",
      backgroundState: null,
    }),
    "a-bash-1": subagentBash({
      itemId: "a-bash-1",
      turnId: "turn-2",
      startedSeq: 3,
      parentToolCallId: "launch-a",
      command: "pytest -q",
      output: "E   assert 1 == 2\n1 failed\n",
      status: "failed",
    }),
    wrap: assistantProse("wrap", "turn-2", 4, "The background agent failed while running the test."),
  },
});

// Three concurrent background subagents (the screenshot case): three launches
// in turn-1, their interleaved activity in turn-2. Each groups into its own
// bounded block keyed by its launching Agent id.
export const PLAYGROUND_SUBAGENT_ACTIVITY_CONCURRENT: TranscriptState = baseState({
  turnOrder: ["turn-1", "turn-2"],
  turnsById: {
    "turn-1": {
      turnId: "turn-1",
      itemOrder: ["u1", "launch-a", "launch-b", "launch-c", "spawned"],
      startedAt: "2026-04-24T00:00:00Z",
      completedAt: "2026-04-24T00:00:03Z",
      stopReason: "end_turn",
      fileBadges: [],
    },
    "turn-2": {
      turnId: "turn-2",
      itemOrder: ["a-1", "b-1", "c-1", "a-2", "b-2", "wrap"],
      startedAt: "2026-04-24T00:00:06Z",
      completedAt: "2026-04-24T00:00:12Z",
      stopReason: "end_turn",
      fileBadges: [],
    },
  },
  itemsById: {
    u1: {
      kind: "user_message",
      itemId: "u1",
      turnId: "turn-1",
      status: "completed",
      sourceAgentKind: "claude",
      messageId: null,
      title: null,
      nativeToolName: null,
      parentToolCallId: null,
      rawInput: undefined,
      rawOutput: undefined,
      contentParts: [],
      ...seq(1),
      text: "Spawn three background subagents to survey the three packages in parallel.",
      isStreaming: false,
    } as TranscriptItem,
    "launch-a": agentLaunch({ itemId: "launch-a", turnId: "turn-1", startedSeq: 2, label: "Survey desktop", backgroundState: "completed" }),
    "launch-b": agentLaunch({ itemId: "launch-b", turnId: "turn-1", startedSeq: 3, label: "Survey product-ui", backgroundState: "pending" }),
    "launch-c": agentLaunch({ itemId: "launch-c", turnId: "turn-1", startedSeq: 4, label: "Survey product-domain", backgroundState: "completed" }),
    spawned: assistantProse("spawned", "turn-1", 5, "All three background agents are running."),
    "a-1": subagentBash({ itemId: "a-1", turnId: "turn-2", startedSeq: 6, parentToolCallId: "launch-a", command: "find apps/desktop -name '*.tsx' | wc -l", output: "412\n" }),
    "b-1": subagentBash({ itemId: "b-1", turnId: "turn-2", startedSeq: 7, parentToolCallId: "launch-b", command: "find product-ui/src -name '*.tsx' | wc -l", output: "88\n", status: "in_progress" }),
    "c-1": subagentBash({ itemId: "c-1", turnId: "turn-2", startedSeq: 8, parentToolCallId: "launch-c", command: "find product-domain/src -name '*.ts' | wc -l", output: "196\n" }),
    "a-2": subagentBash({ itemId: "a-2", turnId: "turn-2", startedSeq: 9, parentToolCallId: "launch-a", command: "wc -l apps/desktop/src/App.tsx", output: "142 App.tsx\n" }),
    "b-2": subagentBash({ itemId: "b-2", turnId: "turn-2", startedSeq: 10, parentToolCallId: "launch-b", command: "cat product-ui/package.json", output: "{ \"name\": \"@proliferate/product-ui\" }\n" }),
    wrap: assistantProse("wrap", "turn-2", 11, "Two agents finished; product-ui is still surveying."),
  },
});
