import { createTranscriptState, type ToolCallItem } from "@anyharness/sdk";
import { SubagentCreationGroupBlock } from "#product/components/workspace/chat/transcript/SubagentCreationGroupBlock";
import { TranscriptEntryMotionProvider } from "#product/components/workspace/chat/transcript/TranscriptEntryMotionContext";
import { toolItem } from "#product/domain/chats/transcript/transcript-presentation-test-fixtures";

export function SpawnMotionFixture({
  transcript,
  itemIds,
  show = true,
}: {
  transcript: ReturnType<typeof createTranscriptState>;
  itemIds: readonly string[];
  show?: boolean;
}) {
  return (
    <TranscriptEntryMotionProvider transcript={transcript}>
      {show ? (
        <SubagentCreationGroupBlock itemIds={itemIds} transcript={transcript} animateEntries />
      ) : <div>temporarily virtualized</div>}
    </TranscriptEntryMotionProvider>
  );
}

export function transcriptWithCreates(items: readonly ToolCallItem[]) {
  const transcript = createTranscriptState("session-1");
  transcript.itemsById = Object.fromEntries(items.map((item) => [item.itemId, item]));
  return transcript;
}

export function workspaceCreateAgent(
  itemId: string,
  sessionId: string | null,
  title: string,
  status: ToolCallItem["status"] = "completed",
  workspaceId: string = "workspace-1",
  parentSessionId: string = "session-1",
): ToolCallItem {
  return {
    ...toolItem(itemId, "turn-1", 1, "other", status),
    nativeToolName: "mcp__proliferate_workspace__create_agent",
    rawInput: { workspaceId, kind: "subagent", task: title },
    rawOutput: sessionId
      ? {
        identity: { runtimeId: "runtime-1", sessionId },
        workspace: { runtimeId: "runtime-1", workspaceId },
        role: "subagent",
        parent: { runtimeId: "runtime-1", sessionId: parentSessionId },
        title,
        status: { presentation: "available", execution: "idle", hasLiveActor: true },
        configuration: { agentKind: "codex", modelId: null, modeId: null },
        capabilities: ["get_agent", "send_message"],
        createdAt: "2026-04-04T00:00:00Z",
        updatedAt: "2026-04-04T00:00:01Z",
      }
      : null,
  };
}

export function codexWorkspaceEnvelope(item: ToolCallItem): ToolCallItem {
  const toolNameParts = item.nativeToolName?.split("__") ?? [];
  const tool = toolNameParts[toolNameParts.length - 1] ?? "create_agent";
  return {
    ...item,
    nativeToolName: null,
    rawInput: { server: "workspace", tool, arguments: item.rawInput },
    rawOutput: {
      content: [{ type: "text", text: JSON.stringify(item.rawOutput) }],
      isError: item.status === "failed",
      structuredContent: item.rawOutput,
    },
  };
}
