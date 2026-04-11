import { describe, expect, it } from "vitest";
import type { CoworkArtifactSummary, ToolCallItem, TranscriptState } from "@anyharness/sdk";
import {
  collectTurnCoworkArtifactToolCalls,
  deriveCoworkArtifactToolPresentation,
} from "@/lib/domain/chat/cowork-artifact-tool-presentation";

const SUMMARY: CoworkArtifactSummary = {
  id: "art_123",
  path: "artifacts/todo-list.jsx",
  type: "application/vnd.proliferate.react",
  title: "Todo list",
  description: "Interactive task manager",
  createdAt: "2026-04-12T00:00:00Z",
  updatedAt: "2026-04-12T00:00:01Z",
  exists: true,
  sizeBytes: 128,
  modifiedAt: "2026-04-12T00:00:01Z",
};

describe("deriveCoworkArtifactToolPresentation", () => {
  it("reads parsed object rawOutput", () => {
    const presentation = deriveCoworkArtifactToolPresentation(toolCallItem({
      semanticKind: "cowork_artifact_create",
      rawOutput: SUMMARY,
    }));

    expect(presentation).toMatchObject({
      action: "create",
      running: false,
      summary: SUMMARY,
      provisional: {},
    });
  });

  it("reads string-encoded JSON rawOutput", () => {
    const presentation = deriveCoworkArtifactToolPresentation(toolCallItem({
      semanticKind: "cowork_artifact_update",
      rawOutput: JSON.stringify(SUMMARY),
    }));

    expect(presentation?.summary).toEqual(SUMMARY);
    expect(presentation?.action).toBe("update");
  });

  it("falls back to JSON in tool_result_text content", () => {
    const presentation = deriveCoworkArtifactToolPresentation(toolCallItem({
      rawOutput: "not-json",
      contentParts: [
        {
          type: "tool_result_text",
          text: JSON.stringify({ result: SUMMARY }),
        },
      ],
    }));

    expect(presentation?.summary).toEqual(SUMMARY);
  });

  it("falls back to provisional metadata when decoding fails", () => {
    const presentation = deriveCoworkArtifactToolPresentation(toolCallItem({
      rawInput: {
        title: "Draft chart",
        path: "artifacts/chart.jsx",
        description: "Provisional artifact metadata",
      },
      rawOutput: "not-json",
    }));

    expect(presentation).toMatchObject({
      summary: null,
      provisional: {
        title: "Draft chart",
        path: "artifacts/chart.jsx",
        description: "Provisional artifact metadata",
      },
    });
  });

  it("surfaces a failure message for failed tool calls", () => {
    const presentation = deriveCoworkArtifactToolPresentation(toolCallItem({
      status: "failed",
      rawOutput: "Artifact creation failed",
    }));

    expect(presentation?.failureMessage).toBe("Artifact creation failed");
    expect(presentation?.summary).toBeNull();
  });

  it("collects cowork artifact tool calls in turn order", () => {
    const artifactCreate = toolCallItem({
      itemId: "artifact-create",
      toolCallId: "artifact-create",
      semanticKind: "cowork_artifact_create",
    });
    const genericTool = toolCallItem({
      itemId: "generic-tool",
      toolCallId: "generic-tool",
      semanticKind: "other",
      nativeToolName: "mcp__github__add_comment",
    });
    const artifactUpdate = toolCallItem({
      itemId: "artifact-update",
      toolCallId: "artifact-update",
      semanticKind: "cowork_artifact_update",
      title: "Update artifact",
      nativeToolName: "mcp__cowork__update_artifact",
    });
    const transcript = {
      itemsById: {
        "artifact-create": artifactCreate,
        "generic-tool": genericTool,
        "artifact-update": artifactUpdate,
      },
    } as Pick<TranscriptState, "itemsById">;

    const collected = collectTurnCoworkArtifactToolCalls(
      { itemOrder: ["artifact-create", "generic-tool", "artifact-update"] },
      transcript,
    );

    expect(collected).toEqual([artifactCreate, artifactUpdate]);
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
    title: "Create artifact",
    nativeToolName: "mcp__cowork__create_artifact",
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
    semanticKind: "cowork_artifact_create",
    approvalState: "none",
    ...overrides,
  } as ToolCallItem;
}
