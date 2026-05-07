import { describe, expect, it } from "vitest";
import {
  createTranscriptState,
  type ContentPart,
  type PendingPromptEntry,
  type PromptProvenance,
  type ToolCallItem,
  type TranscriptItem,
  type TranscriptState,
} from "@anyharness/sdk";
import { buildTranscriptCopyText } from "@/lib/domain/chat/transcript/transcript-copy";
import {
  assistantItem,
  parsedCommandItem,
  terminalItem,
  thoughtItem,
  toolItem,
  turnRecord,
  userItem,
} from "@/lib/domain/chat/transcript/transcript-presentation-test-fixtures";

function makeTranscript(
  items: TranscriptItem[],
  itemOrder: string[],
  completedAt: string | null = null,
): TranscriptState {
  const transcript = createTranscriptState("session-1");
  transcript.turnOrder = ["turn-1"];
  transcript.turnsById = {
    "turn-1": turnRecord(itemOrder, completedAt),
  };
  transcript.itemsById = Object.fromEntries(
    items.map((item) => [item.itemId, item]),
  );
  return transcript;
}

function copyText({
  transcript,
  visibleOptimisticPrompt = null,
  proposedPlanToolCallIds = new Set<string>(),
}: {
  transcript: TranscriptState;
  visibleOptimisticPrompt?: PendingPromptEntry | null;
  proposedPlanToolCallIds?: ReadonlySet<string>;
}): string {
  return buildTranscriptCopyText({
    transcript,
    visibleTurnIds: transcript.turnOrder,
    visibleOptimisticPrompt,
    proposedPlanToolCallIds,
  });
}

describe("buildTranscriptCopyText", () => {
  it("serializes user and assistant content in rendered turn order with attachments", () => {
    const user = {
      ...userItem("user", "turn-1", 1),
      text: "fallback user text",
      contentParts: [
        { type: "text", text: "User text" },
        {
          type: "image",
          attachmentId: "img-1",
          name: "diagram.png",
          uri: "file://diagram.png",
          mimeType: "image/png",
          size: null,
        },
      ] satisfies ContentPart[],
    };
    const assistant = {
      ...assistantItem("assistant", "turn-1", 2),
      text: "Assistant text",
    };
    const transcript = makeTranscript([user, assistant], ["user", "assistant"]);

    expect(copyText({ transcript })).toBe([
      "User text",
      "Image: diagram.png",
      "file://diagram.png",
      "Assistant text",
    ].join("\n\n"));
  });

  it("copies wake provenance as the visible badge instead of hidden prompt text", () => {
    const wakeProvenance = {
      type: "subagentWake",
      completionId: "completion-1",
      sessionLinkId: "link-1",
      label: "Typo finder",
    } satisfies PromptProvenance;
    const user = {
      ...userItem("wake", "turn-1", 1),
      text: "Hidden wake instructions with child session IDs",
      promptProvenance: wakeProvenance,
    };
    const transcript = makeTranscript([user], ["wake"]);
    transcript.linkCompletionsByCompletionId["completion-1"] = {
      relation: "subagent",
      completionId: "completion-1",
      sessionLinkId: "link-1",
      parentSessionId: "parent",
      childSessionId: "child",
      childTurnId: "turn-child",
      childLastEventSeq: 7,
      outcome: "completed",
      label: "Typo finder result",
      seq: 12,
      timestamp: "2026-04-04T00:00:00Z",
    } satisfies TranscriptState["linkCompletionsByCompletionId"][string];

    const copied = copyText({ transcript });

    expect(copied).toBe("Typo finder finished");
    expect(copied).not.toContain("Hidden wake instructions");
  });

  it("copies review-feedback provenance as transcript chrome instead of raw feedback prompt text", () => {
    const user = {
      ...userItem("review", "turn-1", 1),
      text: "Review feedback is ready.\nReview run: run-1\nRound: 1\nFull hidden critique payload",
      promptProvenance: {
        type: "reviewFeedback",
        reviewRunId: "run-1",
        reviewRoundId: "round-1",
        feedbackJobId: "job-1",
        label: null,
      } satisfies PromptProvenance,
    };
    const transcript = makeTranscript([user], ["review"]);

    const copied = copyText({ transcript });

    expect(copied).toBe("Review feedback");
    expect(copied).not.toContain("Full hidden critique payload");
  });

  it("serializes completed history once before final assistant prose", () => {
    const read = {
      ...toolItem("read", "turn-1", 2, "file_read"),
      contentParts: [{
        type: "file_read",
        path: "src/app.ts",
        workspacePath: "src/app.ts",
        basename: "app.ts",
        scope: "full",
        preview: "export const value = 1;",
      }] satisfies ContentPart[],
    };
    const draft = {
      ...assistantItem("draft", "turn-1", 3),
      text: "Draft analysis",
    };
    const final = {
      ...assistantItem("final", "turn-1", 4),
      text: "Final answer",
    };
    const transcript = makeTranscript(
      [userItem("user", "turn-1", 1), read, draft, final],
      ["user", "read", "draft", "final"],
      "2026-04-04T00:00:10Z",
    );
    const copied = copyText({ transcript });

    expect(copied).toContain("src/app.ts");
    expect(copied).toContain("export const value = 1;");
    expect(copied).toContain("Draft analysis");
    expect(copied).toMatch(/Draft analysis\n\nFinal answer/);
    expect(copied).not.toContain("Final message");
  });

  it("serializes collapsed action item ids rather than summary labels", () => {
    const read = toolItem("read", "turn-1", 1, "file_read");
    const command = terminalItem("command", "turn-1", 2, "pnpm test");
    const transcript = makeTranscript([read, command], ["read", "command"]);
    const copied = copyText({ transcript });

    expect(copied).toContain("read.ts");
    expect(copied).toContain("pnpm test");
    expect(copied).toContain("ok");
    expect(copied).not.toContain("Worked");
  });

  it("serializes grouped subagent launch, result, and child work", () => {
    const agent = {
      ...toolItem("agent", "turn-1", 1, "subagent"),
      rawInput: {
        label: "Implementation agent",
        agentKind: "codex",
        modelId: "gpt-5",
        prompt: "Patch the tests",
      },
      contentParts: [{
        type: "tool_result_text",
        text: "```text\nAgent result\n```",
      }] satisfies ContentPart[],
    };
    const child = {
      ...assistantItem("child", "turn-1", 2, "agent"),
      text: "Child work summary",
    };
    const transcript = makeTranscript([agent, child], ["agent", "child"]);
    const copied = copyText({ transcript });

    expect(copied).toContain("Implementation agent");
    expect(copied).not.toContain("Codex · gpt-5");
    expect(copied).toContain("Patch the tests");
    expect(copied).toContain("Agent result");
    expect(copied).toContain("Child work summary");
  });

  it("suppresses duplicate Claude plan fallback when a first-class proposed plan exists", () => {
    const proposed = proposedPlanItem("plan", "tool-1", "Approved plan body");
    const fallback: ToolCallItem = {
      ...toolItem("fallback", "turn-1", 2, "mode_switch"),
      sourceAgentKind: "claude",
      nativeToolName: "ExitPlanMode",
      toolCallId: "tool-1",
      contentParts: [{ type: "tool_result_text", text: "Fallback plan body" }],
    };
    const transcript = makeTranscript([proposed, fallback], ["plan", "fallback"]);
    const copied = copyText({
      transcript,
      proposedPlanToolCallIds: new Set(["tool-1"]),
    });

    expect(copied).toContain("Approved plan body");
    expect(copied).not.toContain("Fallback plan body");
  });

  it("serializes plan references, non-transient thoughts, and tool command details", () => {
    const user = {
      ...userItem("user", "turn-1", 1),
      text: "",
      contentParts: [{
        type: "plan_reference",
        planId: "plan-1",
        snapshotHash: "hash",
        title: "Stored plan",
        bodyMarkdown: "Stored plan body",
        sourceKind: "review",
        sourceSessionId: "session-1",
        sourceItemId: null,
        sourceToolCallId: null,
        sourceTurnId: null,
      }] satisfies ContentPart[],
    };
    const thought = {
      ...thoughtItem("thought", "turn-1", 2, false),
      text: "Private but durable thought",
    };
    const command = parsedCommandItem("command", "turn-1", 3, [{
      type: "search",
      cmd: "rg buildTranscriptCopyText desktop/src",
      query: "buildTranscriptCopyText",
      path: "desktop/src",
    }]);
    const transcript = makeTranscript([user, thought, command], ["user", "thought", "command"]);
    const copied = copyText({ transcript });

    expect(copied).toContain("Stored plan");
    expect(copied).toContain("Stored plan body");
    expect(copied).toContain("Private but durable thought");
    expect(copied).toContain("rg buildTranscriptCopyText desktop/src");
    expect(copied).toContain("desktop/src");
  });

  it("appends the visible optimistic prompt", () => {
    const transcript = createTranscriptState("session-1");
    const optimisticPrompt: PendingPromptEntry = {
      seq: 1,
      promptId: "prompt-1",
      text: "Fallback optimistic text",
      contentParts: [{
        type: "resource_link",
        name: "Spec",
        title: "Spec doc",
        uri: "https://example.test/spec",
        mimeType: "text/markdown",
        description: "Project spec",
        size: null,
      }],
      queuedAt: "2026-04-04T00:00:00Z",
      promptProvenance: null,
    };

    expect(copyText({ transcript, visibleOptimisticPrompt: optimisticPrompt })).toBe([
      "Resource link: Spec doc",
      "https://example.test/spec",
      "Project spec",
    ].join("\n\n"));
  });

  it("copies optimistic prompt provenance using queued transcript chrome", () => {
    const transcript = createTranscriptState("session-1");
    const optimisticPrompt: PendingPromptEntry = {
      seq: 1,
      promptId: "prompt-1",
      text: "Hidden optimistic review payload",
      contentParts: [],
      queuedAt: "2026-04-04T00:00:00Z",
      promptProvenance: {
        type: "reviewFeedback",
        reviewRunId: "run-1",
        reviewRoundId: "round-1",
        feedbackJobId: "job-1",
        label: null,
      },
    };

    expect(copyText({ transcript, visibleOptimisticPrompt: optimisticPrompt })).toBe(
      "Review feedback queued",
    );
  });
});

function proposedPlanItem(
  itemId: string,
  sourceToolCallId: string,
  bodyMarkdown: string,
): Extract<TranscriptItem, { kind: "proposed_plan" }> {
  return {
    kind: "proposed_plan",
    itemId,
    turnId: "turn-1",
    status: "completed",
    sourceAgentKind: "claude",
    messageId: null,
    title: "Plan",
    nativeToolName: null,
    parentToolCallId: null,
    contentParts: [],
    timestamp: "2026-04-04T00:00:00Z",
    startedSeq: 1,
    lastUpdatedSeq: 1,
    completedSeq: 1,
    completedAt: "2026-04-04T00:00:00Z",
    plan: {
      type: "proposed_plan",
      planId: "plan-1",
      title: "Approved plan",
      bodyMarkdown,
      snapshotHash: "hash",
      sourceKind: "claude",
      sourceSessionId: "session-1",
      sourceTurnId: "turn-1",
      sourceItemId: itemId,
      sourceToolCallId,
    },
    decision: null,
  };
}
