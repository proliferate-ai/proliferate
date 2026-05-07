import { describe, expect, it } from "vitest";
import type { ToolCallItem } from "@anyharness/sdk";
import {
  extractClaudePlanBody,
  isClaudeExitPlanModeCall,
} from "@/lib/domain/chat/tools/claude-plan-tool-call";

describe("isClaudeExitPlanModeCall", () => {
  it("returns true for Claude ExitPlanMode native tool name", () => {
    expect(
      isClaudeExitPlanModeCall(toolCallItem({
        sourceAgentKind: "claude",
        nativeToolName: "ExitPlanMode",
      })),
    ).toBe(true);
  });

  it("returns true for Claude mode_switch titled 'Ready to code?'", () => {
    expect(
      isClaudeExitPlanModeCall(toolCallItem({
        sourceAgentKind: "claude",
        title: "Ready to code?",
        semanticKind: "mode_switch",
      })),
    ).toBe(true);
  });

  it("is case-insensitive on title", () => {
    expect(
      isClaudeExitPlanModeCall(toolCallItem({
        sourceAgentKind: "claude",
        title: "  READY TO  CODE?  ",
        semanticKind: "mode_switch",
      })),
    ).toBe(true);
  });

  it("returns false for non-Claude agents", () => {
    expect(
      isClaudeExitPlanModeCall(toolCallItem({
        sourceAgentKind: "codex",
        nativeToolName: "ExitPlanMode",
      })),
    ).toBe(false);
  });

  it("returns false for Claude tool calls that aren't ExitPlanMode", () => {
    expect(
      isClaudeExitPlanModeCall(toolCallItem({
        sourceAgentKind: "claude",
        nativeToolName: "Bash",
        title: "Run tests",
      })),
    ).toBe(false);
  });
});

describe("extractClaudePlanBody", () => {
  it("prefers tool_result_text content parts", () => {
    const body = extractClaudePlanBody(toolCallItem({
      sourceAgentKind: "claude",
      contentParts: [
        { type: "tool_result_text", text: "# Plan\n\n- step 1" },
      ],
      rawInput: { plan: "ignored raw input" },
    }));

    expect(body).toBe("# Plan\n\n- step 1");
  });

  it("joins multiple tool_result_text parts with blank lines", () => {
    const body = extractClaudePlanBody(toolCallItem({
      sourceAgentKind: "claude",
      contentParts: [
        { type: "tool_result_text", text: "first" },
        { type: "tool_result_text", text: "second" },
      ],
    }));

    expect(body).toBe("first\n\nsecond");
  });

  it("falls back to rawInput.plan when no content parts carry text", () => {
    const body = extractClaudePlanBody(toolCallItem({
      sourceAgentKind: "claude",
      contentParts: [],
      rawInput: { plan: "# Plan from rawInput" },
    }));

    expect(body).toBe("# Plan from rawInput");
  });

  it("falls back to rawOutput.plan when rawInput has no plan", () => {
    const body = extractClaudePlanBody(toolCallItem({
      sourceAgentKind: "claude",
      contentParts: [],
      rawInput: {},
      rawOutput: { plan: "# Plan from rawOutput" },
    }));

    expect(body).toBe("# Plan from rawOutput");
  });

  it("returns null when no body is available", () => {
    const body = extractClaudePlanBody(toolCallItem({
      sourceAgentKind: "claude",
      contentParts: [],
    }));

    expect(body).toBeNull();
  });
});

function toolCallItem(overrides: Partial<ToolCallItem>): ToolCallItem {
  return {
    kind: "tool_call",
    itemId: "tool-1",
    turnId: "turn-1",
    status: "in_progress",
    sourceAgentKind: "claude",
    messageId: null,
    title: null,
    nativeToolName: null,
    parentToolCallId: null,
    rawInput: undefined,
    rawOutput: undefined,
    contentParts: [],
    timestamp: "2026-04-10T00:00:00Z",
    startedSeq: 1,
    lastUpdatedSeq: 1,
    completedSeq: null,
    completedAt: null,
    toolCallId: "toolu_1",
    toolKind: "switch_mode",
    semanticKind: "mode_switch",
    approvalState: "pending",
    ...overrides,
  } as ToolCallItem;
}
