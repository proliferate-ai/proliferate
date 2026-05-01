import { describe, expect, it } from "vitest";
import type { ToolCallItem } from "@anyharness/sdk";
import {
  isSubagentWorkComplete,
  parseAsyncSubagentLaunch,
  parseSubagentLaunchResult,
  parseSubagentProvisioningStatus,
  resolveSubagentLaunchDisplay,
  resolveSubagentExecutionState,
} from "@/lib/domain/chat/subagent-launch";

describe("parseAsyncSubagentLaunch", () => {
  it("parses completed async background launches", () => {
    const launch = parseAsyncSubagentLaunch(toolCallItem({
      status: "completed",
      semanticKind: "subagent",
      nativeToolName: "Agent",
      rawInput: { run_in_background: true },
      rawOutput: backgroundWork("pending"),
      contentParts: [
        {
          type: "tool_result_text",
          text: [
            "Async agent launched successfully.",
            "agentId: ad5087d157aab3117 (internal ID - do not mention to user.)",
            "The agent is working in the background.",
            "output_file: /tmp/task.output",
          ].join("\n"),
        },
      ],
    }));

    expect(launch).toEqual({
      rawText: [
        "Async agent launched successfully.",
        "agentId: ad5087d157aab3117 (internal ID - do not mention to user.)",
        "The agent is working in the background.",
        "output_file: /tmp/task.output",
      ].join("\n"),
      agentId: "ad5087d157aab3117",
      outputFile: "/tmp/task.output",
    });
  });

  it("returns null when the tool was not launched in the background", () => {
    expect(parseAsyncSubagentLaunch(toolCallItem({
      status: "completed",
      semanticKind: "subagent",
      nativeToolName: "Agent",
      rawInput: { run_in_background: false },
      rawOutput: backgroundWork("pending"),
      contentParts: [
        { type: "tool_result_text", text: "Finished." },
      ],
    }))).toBeNull();
  });

  it("returns null for non-subagent tools", () => {
    expect(parseAsyncSubagentLaunch(toolCallItem({
      status: "completed",
      semanticKind: "terminal",
      nativeToolName: "Bash",
      rawInput: { run_in_background: true },
      rawOutput: backgroundWork("pending"),
      contentParts: [
        { type: "tool_result_text", text: "Async agent launched successfully." },
      ],
    }))).toBeNull();
  });
});

describe("resolveSubagentExecutionState", () => {
  it("returns background for completed async launches", () => {
    expect(resolveSubagentExecutionState(toolCallItem({
      status: "completed",
      semanticKind: "subagent",
      nativeToolName: "Agent",
      rawInput: { run_in_background: true },
      rawOutput: backgroundWork("pending"),
      contentParts: [
        {
          type: "tool_result_text",
          text: "Async agent launched successfully.\nThe agent is working in the background.",
        },
      ],
    }))).toBe("background");
  });

  it("preserves failed status", () => {
    expect(resolveSubagentExecutionState(toolCallItem({
      status: "failed",
      semanticKind: "subagent",
      nativeToolName: "Agent",
      rawInput: { run_in_background: true },
      rawOutput: backgroundWork("pending"),
    }))).toBe("failed");
  });

  it("preserves in-progress status", () => {
    expect(resolveSubagentExecutionState(toolCallItem({
      status: "in_progress",
      semanticKind: "subagent",
      nativeToolName: "Agent",
      rawInput: { run_in_background: true },
      rawOutput: backgroundWork("pending"),
    }))).toBe("running");
  });

  it("marks completed background launches as completed once launch text is replaced", () => {
    expect(resolveSubagentExecutionState(toolCallItem({
      status: "completed",
      semanticKind: "subagent",
      nativeToolName: "Agent",
      rawInput: { run_in_background: true },
      rawOutput: backgroundWork("completed"),
      contentParts: [
        { type: "tool_result_text", text: "Final synthesized subagent report." },
      ],
    }))).toBe("completed_background");
  });

  it("marks expired background launches distinctly", () => {
    expect(resolveSubagentExecutionState(toolCallItem({
      status: "completed",
      semanticKind: "subagent",
      nativeToolName: "Agent",
      rawInput: { run_in_background: true },
      rawOutput: backgroundWork("expired"),
      contentParts: [
        { type: "tool_result_text", text: "Background subagent stopped updating before a final result was observed." },
      ],
    }))).toBe("expired_background");
  });
});

describe("isSubagentWorkComplete", () => {
  it("keeps completed tool calls with pending background work in live mode", () => {
    expect(isSubagentWorkComplete(toolCallItem({
      status: "completed",
      semanticKind: "subagent",
      nativeToolName: "Agent",
      rawInput: { run_in_background: true },
      rawOutput: backgroundWork("pending"),
      contentParts: [
        {
          type: "tool_result_text",
          text: "Async agent launched successfully.\nThe agent is working in the background.",
        },
      ],
    }))).toBe(false);
  });

  it("marks failed and completed foreground work complete", () => {
    expect(isSubagentWorkComplete(toolCallItem({
      status: "failed",
      semanticKind: "subagent",
      nativeToolName: "Agent",
    }))).toBe(true);
    expect(isSubagentWorkComplete(toolCallItem({
      status: "completed",
      semanticKind: "subagent",
      nativeToolName: "Agent",
    }))).toBe(true);
  });
});

describe("resolveSubagentLaunchDisplay", () => {
  it("uses AnyHarness subagent launch args for title and prompt without model metadata", () => {
    expect(resolveSubagentLaunchDisplay(toolCallItem({
      title: "mcp__subagents__create_subagent",
      nativeToolName: "mcp__subagents__create_subagent",
      rawInput: {
        agentKind: "codex",
        label: "repo-reviewer",
        modelId: "gpt-5.4",
        prompt: "Review the current diff.",
      },
    }))).toEqual({
      title: "repo-reviewer",
      meta: null,
      prompt: "Review the current diff.",
    });
  });

  it("keeps legacy Agent titles and prompt content parts", () => {
    expect(resolveSubagentLaunchDisplay(toolCallItem({
      title: "Task: inspect compact rows",
      nativeToolName: "Agent",
      rawInput: {},
      contentParts: [
        {
          type: "tool_input_text",
          text: "Inspect transcript rendering.",
        },
      ],
    }))).toEqual({
      title: "Task: inspect compact rows",
      meta: null,
      prompt: "Inspect transcript rendering.",
    });
  });
});

describe("parseSubagentProvisioningStatus", () => {
  it("parses structured AnyHarness create_subagent output", () => {
    const item = toolCallItem({
      nativeToolName: "mcp__subagents__create_subagent",
      semanticKind: "subagent",
      rawOutput: {
        childSessionId: "child-1",
        sessionLinkId: "link-1",
        promptStatus: "running",
        wakeScheduleCreated: true,
        wakeScheduled: true,
      },
    });

    expect(parseSubagentProvisioningStatus(item)).toEqual({
      childSessionId: "child-1",
      sessionLinkId: "link-1",
      promptStatus: "running",
      wakeScheduleCreated: true,
      wakeScheduled: true,
    });
    expect(parseSubagentLaunchResult(item)).toEqual({
      childSessionId: "child-1",
      sessionLinkId: "link-1",
    });
  });

  it("parses AnyHarness create_subagent JSON emitted as result text", () => {
    const item = toolCallItem({
      nativeToolName: "mcp__subagents__create_subagent",
      semanticKind: "subagent",
      contentParts: [{
        type: "tool_result_text",
        text: JSON.stringify({
          childSessionId: "child-2",
          sessionLinkId: "link-2",
          promptStatus: "running",
          wakeScheduleCreated: false,
          wakeScheduled: false,
        }),
      }],
    });

    expect(parseSubagentProvisioningStatus(item)).toEqual({
      childSessionId: "child-2",
      sessionLinkId: "link-2",
      promptStatus: "running",
      wakeScheduleCreated: false,
      wakeScheduled: false,
    });
    expect(parseSubagentLaunchResult(item)).toEqual({
      childSessionId: "child-2",
      sessionLinkId: "link-2",
    });
  });

  it("does not treat arbitrary result text as provisioning output", () => {
    expect(parseSubagentProvisioningStatus(toolCallItem({
      nativeToolName: "mcp__subagents__create_subagent",
      semanticKind: "subagent",
      contentParts: [{ type: "tool_result_text", text: "Finished." }],
    }))).toBeNull();
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
    nativeToolName: "Agent",
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
    toolKind: "think",
    semanticKind: "subagent",
    approvalState: "none",
    ...overrides,
  } as ToolCallItem;
}

function backgroundWork(state: "pending" | "completed" | "expired") {
  return {
    isAsync: true,
    agentId: "ad5087d157aab3117",
    outputFile: "/tmp/task.output",
    _anyharness: {
      backgroundWork: {
        trackerKind: "claude_async_agent",
        state,
      },
    },
  };
}
