import type { TranscriptState } from "@anyharness/sdk";
import { toolCallItem } from "@/lib/domain/chat/__fixtures__/playground/tool-call-item-fixture";

const subagentItem = toolCallItem({
  itemId: "tool-agent",
  toolCallId: "tool-agent",
  title: "mcp__subagents__create_subagent",
  nativeToolName: "mcp__subagents__create_subagent",
  semanticKind: "subagent",
  rawInput: {
    agentKind: "codex",
    label: "repo-reviewer",
    modelId: "gpt-5.4",
    prompt: "Inspect the transcript rendering path and report whether nested tool calls use compact rows.",
  },
  rawOutput: {
    childSessionId: "child-repo-reviewer",
    sessionLinkId: "link-repo-reviewer",
    promptStatus: "running",
    wakeScheduleCreated: true,
    wakeScheduled: true,
  },
  contentParts: [
    {
      type: "tool_result_text",
      text: JSON.stringify({
        childSessionId: "child-repo-reviewer",
        sessionLinkId: "link-repo-reviewer",
        promptStatus: "running",
        wakeScheduleCreated: true,
        wakeScheduled: true,
      }),
    },
  ],
});

const subagentCommandItem = toolCallItem({
  itemId: "tool-agent-command",
  toolCallId: "tool-agent-command",
  parentToolCallId: "tool-agent",
  title: "npm test -- --runInBand",
  nativeToolName: "Bash",
  semanticKind: "terminal",
  rawInput: {
    command: "pnpm --dir desktop exec vitest run src/config/playground.test.ts",
  },
  contentParts: [
    {
      type: "terminal_output",
      terminalId: "terminal-playground",
      event: "output",
      data: "RUN  src/config/playground.test.ts\nPASS compact tool-call scenarios\n",
    },
  ],
});

const subagentReadItem = toolCallItem({
  itemId: "tool-agent-read",
  toolCallId: "tool-agent-read",
  parentToolCallId: "tool-agent",
  title: "Read ToolActionRow.tsx",
  nativeToolName: "Read",
  toolKind: "read",
  semanticKind: "file_read",
  contentParts: [
    {
      type: "file_read",
      path: "/Users/pablo/proliferate/apps/desktop/src/components/workspace/chat/tool-calls/ToolActionRow.tsx",
      workspacePath: "apps/desktop/src/components/workspace/chat/tool-calls/ToolActionRow.tsx",
      basename: "ToolActionRow.tsx",
      scope: "range",
      startLine: 1,
      endLine: 12,
      preview: "export function ToolActionRow() {\n  return null;\n}",
    },
  ],
});

export const PLAYGROUND_SUBAGENT_TRANSCRIPT: TranscriptState = {
  sessionMeta: {
    sessionId: "playground-subagent",
    title: "Tool row playground",
    updatedAt: "2026-04-12T00:00:02Z",
    nativeSessionId: null,
    sourceAgentKind: "codex",
  },
  turnOrder: ["turn-subagent"],
  turnsById: {
    "turn-subagent": {
      turnId: "turn-subagent",
      itemOrder: ["assistant-intro", "tool-agent"],
      startedAt: "2026-04-12T00:00:00Z",
      completedAt: "2026-04-12T00:00:03Z",
      stopReason: "end_turn",
      fileBadges: [],
    },
  },
  itemsById: {
    "assistant-intro": {
      kind: "assistant_prose",
      itemId: "assistant-intro",
      turnId: "turn-subagent",
      status: "completed",
      sourceAgentKind: "codex",
      messageId: null,
      title: null,
      nativeToolName: null,
      parentToolCallId: null,
      rawInput: undefined,
      rawOutput: undefined,
      contentParts: [],
      timestamp: "2026-04-12T00:00:00Z",
      startedSeq: 1,
      lastUpdatedSeq: 1,
      completedSeq: 1,
      completedAt: "2026-04-12T00:00:00Z",
      text: "I will delegate the transcript check and inspect the nested activity.",
      isStreaming: false,
    },
    "tool-agent": subagentItem,
    "tool-agent-command": subagentCommandItem,
    "tool-agent-read": subagentReadItem,
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
  lastSeq: 4,
  pendingPrompts: [],
  linkCompletionsByCompletionId: {},
  latestLinkCompletionBySessionLinkId: {},
};
