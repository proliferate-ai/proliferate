import { describe, expect, it } from "vitest";
import type { ToolCallItem } from "@anyharness/sdk";
import {
  deriveModeSwitchDisplay,
  isKnownModeSwitchToolCall,
} from "./mode-switch-display";

describe("isKnownModeSwitchToolCall", () => {
  it("accepts exact known mode tool names", () => {
    expect(isKnownModeSwitchToolCall(toolCallItem({
      semanticKind: "mode_switch",
      nativeToolName: "switch_mode",
    }))).toBe(true);
    expect(isKnownModeSwitchToolCall(toolCallItem({
      semanticKind: "mode_switch",
      nativeToolName: "ExitPlanMode",
    }))).toBe(true);
  });

  it("falls back to the title when no native tool name exists", () => {
    expect(isKnownModeSwitchToolCall(toolCallItem({
      semanticKind: "mode_switch",
      nativeToolName: null,
      title: "switch_mode",
    }))).toBe(true);
  });

  it("rejects tools the SDK loosely tagged mode_switch by substring", () => {
    expect(isKnownModeSwitchToolCall(toolCallItem({
      semanticKind: "mode_switch",
      nativeToolName: "update_model_mode",
    }))).toBe(false);
    expect(isKnownModeSwitchToolCall(toolCallItem({
      semanticKind: "mode_switch",
      nativeToolName: "modem_diagnostics",
    }))).toBe(false);
  });

  it("rejects non-mode_switch semantic kinds even with a known name", () => {
    expect(isKnownModeSwitchToolCall(toolCallItem({
      semanticKind: "other",
      nativeToolName: "switch_mode",
    }))).toBe(false);
  });
});

describe("deriveModeSwitchDisplay", () => {
  it("returns null for unknown mode-ish tools", () => {
    expect(deriveModeSwitchDisplay(toolCallItem({
      semanticKind: "mode_switch",
      nativeToolName: "update_model_mode",
    }))).toBeNull();
  });

  it("formats a from → to transition from the tool input", () => {
    expect(deriveModeSwitchDisplay(toolCallItem({
      semanticKind: "mode_switch",
      nativeToolName: "switch_mode",
      rawInput: { from_mode: "plan", mode: "default" },
    }))).toEqual({ label: "Plan mode → Default" });
  });

  it("formats the target mode alone when no source is present", () => {
    expect(deriveModeSwitchDisplay(toolCallItem({
      semanticKind: "mode_switch",
      nativeToolName: "switch_mode",
      rawInput: { mode: "acceptEdits" },
    }))).toEqual({ label: "Accept edits mode" });
  });

  it("reads the transition from the tool result when the input is empty", () => {
    expect(deriveModeSwitchDisplay(toolCallItem({
      semanticKind: "mode_switch",
      nativeToolName: "switch_mode",
      rawOutput: { previous_mode: "plan", new_mode: "default" },
    }))).toEqual({ label: "Plan mode → Default" });
  });

  it("does not double a mode suffix already present in the name", () => {
    expect(deriveModeSwitchDisplay(toolCallItem({
      semanticKind: "mode_switch",
      nativeToolName: "switch_mode",
      rawInput: { mode: "plan mode" },
    }))).toEqual({ label: "Plan mode" });
  });

  it("falls back to a generic label when no mode fields exist", () => {
    expect(deriveModeSwitchDisplay(toolCallItem({
      semanticKind: "mode_switch",
      nativeToolName: "switch_mode",
    }))).toEqual({ label: "Mode changed" });
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
