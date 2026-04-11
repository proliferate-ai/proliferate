import { describe, expect, it } from "vitest";
import type { ToolCallItem } from "@anyharness/sdk";
import { describeToolCallDisplay } from "@/lib/domain/chat/tool-call-display";

describe("describeToolCallDisplay", () => {
  it("prettifies generic MCP tool names", () => {
    const display = describeToolCallDisplay(
      toolCallItem({
        nativeToolName: "mcp__codex_apps__github_add_comment_to_issue",
      }),
      "mcp__codex_apps__github_add_comment_to_issue",
    );

    expect(display).toEqual({
      label: "Github add comment to issue",
      hint: "Codex Apps",
      iconKey: "settings",
    });
  });

  it("uses the Proliferate icon for generic cowork MCP tools", () => {
    const display = describeToolCallDisplay(
      toolCallItem({
        nativeToolName: "mcp__cowork__list_artifacts",
      }),
      "mcp__cowork__list_artifacts",
    );

    expect(display).toEqual({
      label: "List artifacts",
      hint: "Cowork",
      iconKey: "proliferate",
    });
  });

  it("keeps cowork artifact semantic kinds specialized", () => {
    const display = describeToolCallDisplay(
      toolCallItem({ semanticKind: "cowork_artifact_update" }),
      "mcp__cowork__update_artifact",
    );

    expect(display).toEqual({
      label: "Update artifact",
      hint: "Cowork",
      iconKey: "proliferate",
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
    title: null,
    nativeToolName: null,
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
    semanticKind: "other",
    approvalState: "none",
    ...overrides,
  } as ToolCallItem;
}
