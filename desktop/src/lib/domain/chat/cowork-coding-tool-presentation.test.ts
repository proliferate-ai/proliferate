import { describe, expect, it } from "vitest";
import type { ToolCallItem } from "@anyharness/sdk";
import { deriveCoworkCodingToolPresentation } from "@/lib/domain/chat/cowork-coding-tool-presentation";

describe("deriveCoworkCodingToolPresentation", () => {
  it("treats workspace creation as pure provisioning without a prompt", () => {
    const presentation = deriveCoworkCodingToolPresentation(toolCallItem({
      nativeToolName: "mcp__cowork__create_coding_workspace",
      rawInput: {
        sourceWorkspaceId: "source-1",
        label: "runtime sweep",
      },
      rawOutput: {
        workspaceId: "workspace-1",
        status: "ready",
        ready: true,
      },
    }));

    expect(presentation).toMatchObject({
      action: "create_workspace",
      label: "Created coding workspace",
      prompt: null,
      sourceWorkspaceId: "source-1",
      workspaceId: "workspace-1",
      codingSessionId: null,
      promptStatus: "ready",
    });
  });

  it("reads wake scheduling metadata for coding session creation", () => {
    const presentation = deriveCoworkCodingToolPresentation(toolCallItem({
      nativeToolName: "mcp__cowork__create_coding_session",
      rawInput: {
        workspaceId: "workspace-1",
        prompt: "Investigate the runtime.",
        label: "runtime sweep",
        agentKind: "claude",
        modelId: "sonnet",
      },
      rawOutput: {
        codingSessionId: "session-1",
        sessionLinkId: "link-1",
        promptStatus: "running",
        wakeScheduled: true,
      },
    }));

    expect(presentation).toMatchObject({
      action: "create_session",
      displayName: "runtime sweep",
      meta: "Claude · sonnet",
      prompt: "Investigate the runtime.",
      workspaceId: "workspace-1",
      codingSessionId: "session-1",
      promptStatus: "running",
      wakeScheduled: true,
    });
  });
});

function toolCallItem(overrides: Partial<ToolCallItem>): ToolCallItem {
  return {
    kind: "tool_call",
    itemId: "tool-1",
    turnId: "turn-1",
    status: "completed",
    sourceAgentKind: "claude",
    messageId: null,
    title: "Cowork coding",
    nativeToolName: "mcp__cowork__create_coding_session",
    parentToolCallId: null,
    rawInput: undefined,
    rawOutput: undefined,
    contentParts: [],
    timestamp: "2026-04-12T00:00:00Z",
    startedSeq: 1,
    lastUpdatedSeq: 1,
    completedSeq: 2,
    completedAt: "2026-04-12T00:00:01Z",
    toolCallId: "toolu_1",
    toolKind: "other",
    semanticKind: "cowork_coding",
    approvalState: "none",
    ...overrides,
  } as ToolCallItem;
}
