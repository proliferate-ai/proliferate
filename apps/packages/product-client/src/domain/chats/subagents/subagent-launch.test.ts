import { describe, expect, it } from "vitest";
import { createTranscriptState } from "@anyharness/sdk";
import type { ToolCallItem, TranscriptState } from "@anyharness/sdk";
import {
  findSubagentLaunchItem,
  isSubagentLaunchStatusVisibleInTranscript,
  isSubagentWorkComplete,
  parseAsyncSubagentLaunch,
  resolveSubagentIdForItem,
  resolveSubagentLaunchDisplay,
  resolveSubagentExecutionState,
} from "./subagent-launch";

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

  it("parses the launch receipt even without pending background metadata", () => {
    const launch = parseAsyncSubagentLaunch(toolCallItem({
      status: "completed",
      semanticKind: "subagent",
      nativeToolName: "Agent",
      rawInput: { run_in_background: true },
      rawOutput: undefined,
      contentParts: [
        {
          type: "tool_result_text",
          text: "Async agent launched successfully.\nThe agent is working in the background.",
        },
      ],
    }));

    expect(launch).toEqual({
      rawText: "Async agent launched successfully.\nThe agent is working in the background.",
      agentId: null,
      outputFile: null,
    });
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

  it("treats a bare async launch receipt (no background metadata) as running", () => {
    expect(resolveSubagentExecutionState(toolCallItem({
      status: "completed",
      semanticKind: "subagent",
      nativeToolName: "Agent",
      rawInput: { run_in_background: true },
      rawOutput: undefined,
      contentParts: [
        {
          type: "tool_result_text",
          text: [
            "Async agent launched successfully.",
            "agentId: ad5087d157aab3117 (internal ID - do not mention to user.)",
            "output_file: /tmp/task.output",
          ].join("\n"),
        },
      ],
    }))).toBe("background");
  });

  it("marks a background launch complete once a structured summary is present", () => {
    expect(resolveSubagentExecutionState(toolCallItem({
      status: "completed",
      semanticKind: "subagent",
      nativeToolName: "Agent",
      rawInput: { run_in_background: true },
      rawOutput: { summary: "The subagent finished the task." },
      contentParts: [
        { type: "tool_result_text", text: "The subagent finished the task." },
      ],
    }))).toBe("completed_background");
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

  it("keeps a bare async launch receipt (no background metadata) as still running", () => {
    expect(isSubagentWorkComplete(toolCallItem({
      status: "completed",
      semanticKind: "subagent",
      nativeToolName: "Agent",
      rawInput: { run_in_background: true },
      rawOutput: undefined,
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
  it("uses native Agent launch args for title and prompt without model metadata", () => {
    expect(resolveSubagentLaunchDisplay(toolCallItem({
      title: "Task: review current diff",
      nativeToolName: "Agent",
      rawInput: {
        label: "repo-reviewer",
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

describe("isSubagentLaunchStatusVisibleInTranscript", () => {
  it("suppresses the three retired transcript status lines", () => {
    expect(isSubagentLaunchStatusVisibleInTranscript("running")).toBe(false);
    expect(isSubagentLaunchStatusVisibleInTranscript("background")).toBe(false);
    expect(isSubagentLaunchStatusVisibleInTranscript("completed_background")).toBe(false);
  });

  it("keeps every other execution state's status line visible", () => {
    expect(isSubagentLaunchStatusVisibleInTranscript("completed")).toBe(true);
    expect(isSubagentLaunchStatusVisibleInTranscript("failed")).toBe(true);
    expect(isSubagentLaunchStatusVisibleInTranscript("expired_background")).toBe(true);
  });
});

describe("findSubagentLaunchItem", () => {
  it("finds the parent transcript's launch tool call by background-work agentId", () => {
    const item = toolCallItem({
      itemId: "tool-launch",
      status: "completed",
      semanticKind: "subagent",
      nativeToolName: "Agent",
      rawInput: { run_in_background: true, prompt: "Inspect the repo." },
      rawOutput: backgroundWork("pending"),
    });
    const transcript = createTranscriptState("session-1");
    transcript.itemsById[item.itemId] = item;

    expect(findSubagentLaunchItem(transcript, "ad5087d157aab3117")).toBe(item);
  });

  it("returns null when no tool call correlates to the subagent id", () => {
    const item = toolCallItem({
      itemId: "tool-launch",
      status: "completed",
      semanticKind: "subagent",
      nativeToolName: "Agent",
      rawInput: { run_in_background: true },
      rawOutput: backgroundWork("pending"),
    });
    const transcript = createTranscriptState("session-1");
    transcript.itemsById[item.itemId] = item;

    expect(findSubagentLaunchItem(transcript, "some-other-agent-id")).toBeNull();
  });

  it("returns null for harnesses with no background-work correlation (e.g. Codex)", () => {
    const item = toolCallItem({
      itemId: "tool-launch",
      status: "completed",
      semanticKind: "subagent",
      nativeToolName: "Agent",
      rawInput: { prompt: "Inspect the repo." },
      rawOutput: undefined,
    });
    const transcript = createTranscriptState("session-1");
    transcript.itemsById[item.itemId] = item;

    expect(findSubagentLaunchItem(transcript, "codex-thread-1")).toBeNull();
  });

  it("ignores non-tool-call items", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById["message-1"] = {
      kind: "assistant_prose",
      itemId: "message-1",
      turnId: "turn-1",
    } as unknown as TranscriptState["itemsById"][string];

    expect(findSubagentLaunchItem(transcript, "ad5087d157aab3117")).toBeNull();
  });
});

describe("resolveSubagentIdForItem", () => {
  // Delivery Spec — Background Work Slice 1, rung R4 fix-forward review
  // round 2: this is now load-bearing for navigation
  // (`TranscriptAgentGroupBlock`'s click-to-open-pane affordance), so it
  // gets direct unit coverage of the pure function rather than only
  // integration-level coverage through the component.
  it("returns the agentId on the happy path (valid claude_async_agent background-work metadata)", () => {
    const item = toolCallItem({
      status: "completed",
      semanticKind: "subagent",
      nativeToolName: "Agent",
      rawInput: { run_in_background: true },
      rawOutput: backgroundWork("pending"),
    });

    expect(resolveSubagentIdForItem(item)).toBe("ad5087d157aab3117");
  });

  it("returns null when rawOutput is a string, not a record", () => {
    const item = toolCallItem({
      rawOutput: "Async agent launched successfully." as unknown as ToolCallItem["rawOutput"],
    });

    expect(resolveSubagentIdForItem(item)).toBeNull();
  });

  it("returns null when rawOutput is an array, not a record", () => {
    const item = toolCallItem({
      rawOutput: ["agentId", "ad5087d157aab3117"] as unknown as ToolCallItem["rawOutput"],
    });

    expect(resolveSubagentIdForItem(item)).toBeNull();
  });

  it("returns null when _anyharness.backgroundWork is present but trackerKind is unrecognized", () => {
    const item = toolCallItem({
      rawOutput: {
        agentId: "ad5087d157aab3117",
        _anyharness: {
          backgroundWork: {
            trackerKind: "codex_thread",
            state: "pending",
          },
        },
      },
    });

    expect(resolveSubagentIdForItem(item)).toBeNull();
  });

  it("returns null when rawOutput has no _anyharness.backgroundWork at all", () => {
    const item = toolCallItem({
      rawOutput: { agentId: "ad5087d157aab3117" },
    });

    expect(resolveSubagentIdForItem(item)).toBeNull();
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
