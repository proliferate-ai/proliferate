import { describe, expect, it } from "vitest";
import {
  createTranscriptState,
  reduceEvent,
  reduceEvents,
  selectPendingApprovalInteraction,
  selectPendingMcpElicitationInteraction,
  selectPendingUserInputInteraction,
  selectPrimaryPendingInteraction,
} from "../../index.js";
import type { ContentPart, SessionEventEnvelope, ThoughtItem, ToolCallItem } from "../../index.js";

describe("transcript reducer", () => {
  it("reduces assistant streaming lifecycle into one completed prose item", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        assistantStarted(2, "assistant-1", "Hel"),
        assistantDelta(3, "assistant-1", "lo"),
        assistantCompleted(4, "assistant-1", "Hello"),
      ],
      "session-1",
    );

    const item = state.itemsById["assistant-1"];
    expect(item.kind).toBe("assistant_prose");
    if (item.kind !== "assistant_prose") {
      throw new Error("expected assistant prose item");
    }
    expect(item.text).toBe("Hello");
    expect(item.isStreaming).toBe(false);
    expect(state.openAssistantItemId).toBeNull();
  });

  it("preserves prompt attachment content parts across item completion", () => {
    const contentParts: ContentPart[] = [
      { type: "text", text: "see attached" },
      {
        type: "image",
        attachmentId: "image-1",
        mimeType: "image/png",
        name: "screenshot.png",
        size: 2048,
      },
      {
        type: "resource",
        attachmentId: "file-1",
        uri: "file://README.md",
        name: "README.md",
        mimeType: "text/markdown",
        size: 1024,
        preview: "# Readme",
      },
      {
        type: "resource_link",
        uri: "file:///workspace/spec.pdf",
        name: "spec.pdf",
        mimeType: "application/pdf",
        size: 4096,
      },
    ];
    const state = reduceEvents(
      [
        turnStarted(1),
        userMessageStarted(2, "user-1", contentParts),
        userMessageCompleted(3, "user-1", contentParts),
      ],
      "session-1",
    );

    const item = state.itemsById["user-1"];
    expect(item.kind).toBe("user_message");
    if (item.kind !== "user_message") {
      throw new Error("expected user message item");
    }
    expect(item.text).toBe("see attached");
    expect(item.contentParts.map((part) => part.type)).toEqual([
      "text",
      "image",
      "resource",
      "resource_link",
    ]);
    expect(item.contentParts.find((part) => part.type === "resource")).toMatchObject({
      attachmentId: "file-1",
      name: "README.md",
    });
  });

  it("closes orphaned assistant and reasoning streams when a turn ends", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        assistantStarted(2, "assistant-1", "Still typing"),
        reasoningStarted(3, "reasoning-1", "Thinking"),
        turnEnded(4),
      ],
      "session-1",
    );

    expect(state.openAssistantItemId).toBeNull();
    expect(state.openThoughtItemId).toBeNull();
    expect(state.isStreaming).toBe(false);
    const assistantItem = state.itemsById["assistant-1"];
    expect(assistantItem.kind).toBe("assistant_prose");
    if (assistantItem.kind !== "assistant_prose") {
      throw new Error("expected assistant prose item");
    }
    expect(assistantItem.isStreaming).toBe(false);
    const thoughtItem = state.itemsById["reasoning-1"] as ThoughtItem;
    expect(thoughtItem.kind).toBe("thought");
    expect(thoughtItem.isStreaming).toBe(false);
  });

  it("preserves transient status thoughts and updates them in place", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        reasoningStarted(2, "status-1", "Authenticating MCP", true),
        {
          sessionId: "session-1",
          seq: 3,
          timestamp: "2026-04-04T00:00:03Z",
          turnId: "turn-1",
          itemId: "status-1",
          event: {
            type: "item_delta",
            delta: {
              isTransient: true,
              replaceContentParts: [
                { type: "reasoning", text: "Waiting for browser auth", visibility: "private" },
              ],
            },
          },
        },
      ],
      "session-1",
    );

    const item = state.itemsById["status-1"] as ThoughtItem;
    expect(item.kind).toBe("thought");
    expect(item.isTransient).toBe(true);
    expect(item.text).toBe("Waiting for browser auth");
    expect(state.turnsById["turn-1"].itemOrder).toEqual(["status-1"]);
  });

  it("keeps ordinary reasoning non-transient", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        reasoningStarted(2, "reasoning-1", "Thinking"),
      ],
      "session-1",
    );

    const item = state.itemsById["reasoning-1"] as ThoughtItem;
    expect(item.kind).toBe("thought");
    expect(item.isTransient).toBe(false);
  });

  it("merges tool deltas and re-derives semantic kind from file changes", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        {
          sessionId: "session-1",
          seq: 2,
          timestamp: "2026-04-04T00:00:02Z",
          turnId: "turn-1",
          itemId: "tool-1",
          event: {
            type: "item_started",
            item: {
              kind: "tool_invocation",
              status: "in_progress",
              sourceAgentKind: "claude",
              toolCallId: "tool-1",
              title: "Edit file",
              contentParts: [
                {
                  type: "tool_call",
                  toolCallId: "tool-1",
                  title: "Edit file",
                  toolKind: "edit",
                },
              ],
            },
          },
        },
        {
          sessionId: "session-1",
          seq: 3,
          timestamp: "2026-04-04T00:00:03Z",
          turnId: "turn-1",
          itemId: "tool-1",
          event: {
            type: "item_delta",
            delta: {
              replaceContentParts: [
                {
                  type: "tool_call",
                  toolCallId: "tool-1",
                  title: "Edit file",
                  toolKind: "edit",
                },
                {
                  type: "file_change",
                  operation: "edit",
                  path: "src/app.ts",
                  workspacePath: "src/app.ts",
                  additions: 5,
                  deletions: 1,
                },
              ],
            },
          },
        },
      ],
      "session-1",
    );

    const item = state.itemsById["tool-1"] as ToolCallItem;
    expect(item.kind).toBe("tool_call");
    expect(item.semanticKind).toBe("file_change");
    expect(item.contentParts.filter((part) => part.type === "tool_call")).toHaveLength(1);
    expect(item.contentParts.filter((part) => part.type === "file_change")).toHaveLength(1);
  });

  it("tracks permission requests and resolutions against tool items", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        completedToolItem(2, "tool-1"),
        permissionRequested(3, "tool-1"),
        {
          sessionId: "session-1",
          seq: 4,
          timestamp: "2026-04-04T00:00:04Z",
          turnId: "turn-1",
          event: {
            type: "interaction_resolved",
            requestId: "perm-1",
            kind: "permission",
            outcome: {
              outcome: "selected",
              optionId: "allow",
            },
          },
        },
      ],
      "session-1",
    );

    expect(selectPendingApprovalInteraction(state)).toBeNull();
    expect((state.itemsById["tool-1"] as ToolCallItem).approvalState).toBe("approved");
  });

  it("treats cancelled permission resolutions as cleared rather than rejected", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        completedToolItem(2, "tool-1"),
        permissionRequested(3, "tool-1"),
        {
          sessionId: "session-1",
          seq: 4,
          timestamp: "2026-04-04T00:00:04Z",
          turnId: "turn-1",
          event: {
            type: "interaction_resolved",
            requestId: "perm-1",
            kind: "permission",
            outcome: {
              outcome: "cancelled",
            },
          },
        },
      ],
      "session-1",
    );

    expect(selectPendingApprovalInteraction(state)).toBeNull();
    expect((state.itemsById["tool-1"] as ToolCallItem).approvalState).toBe("none");
  });

  it("preserves toolKind on pending approval interaction", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        completedToolItem(2, "tool-1"),
        {
          sessionId: "session-1",
          seq: 3,
          timestamp: "2026-04-04T00:00:03Z",
          turnId: "turn-1",
          itemId: "tool-1",
          event: {
            type: "interaction_requested",
            requestId: "perm-1",
            kind: "permission",
            title: "Run command",
            description: null,
            source: {
              toolCallId: "tool-1",
              toolKind: "switch_mode",
              toolStatus: null,
            },
            payload: {
              type: "permission",
              context: {
                displayName: "Write access",
                blockedPath: "/tmp/output.txt",
                decisionReason: "Needs write permission",
                agentId: "agent-1",
              },
              options: [{ optionId: "allow", label: "Allow", kind: "allow_once" }],
            },
          },
        },
      ],
      "session-1",
    );

    expect(selectPendingApprovalInteraction(state)).toMatchObject({
      requestId: "perm-1",
      toolCallId: "tool-1",
      toolKind: "switch_mode",
      title: "Run command",
      context: {
        displayName: "Write access",
        blockedPath: "/tmp/output.txt",
        decisionReason: "Needs write permission",
        agentId: "agent-1",
      },
    });
  });

  it("defaults pending approval toolKind to null when absent on the event", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        completedToolItem(2, "tool-1"),
        {
          sessionId: "session-1",
          seq: 3,
          timestamp: "2026-04-04T00:00:03Z",
          turnId: "turn-1",
          itemId: "tool-1",
          event: {
            type: "interaction_requested",
            requestId: "perm-1",
            kind: "permission",
            title: "Run command",
            description: null,
            source: {
              toolCallId: "tool-1",
              toolKind: null,
              toolStatus: null,
            },
            payload: {
              type: "permission",
              options: [{ optionId: "allow", label: "Allow", kind: "allow_once" }],
            },
          },
        },
      ],
      "session-1",
    );

    expect(selectPendingApprovalInteraction(state)?.toolKind).toBeNull();
  });

  it("tracks user input interactions without storing answers", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        {
          sessionId: "session-1",
          seq: 2,
          timestamp: "2026-04-04T00:00:02Z",
          turnId: "turn-1",
          event: {
            type: "interaction_requested",
            requestId: "input-1",
            kind: "user_input",
            title: "Provider",
            description: "Which provider should be used?",
            source: {
              toolCallId: null,
              toolKind: null,
              toolStatus: null,
            },
            payload: {
              type: "user_input",
              questions: [{
                questionId: "provider",
                header: "Provider",
                question: "Which provider should be used?",
                isOther: true,
                isSecret: false,
                options: [{ label: "Recommended", description: "Use the default" }],
              }],
            },
          },
        },
      ],
      "session-1",
    );

    expect(selectPendingApprovalInteraction(state)).toBeNull();
    expect(selectPrimaryPendingInteraction(state)).toMatchObject({
      requestId: "input-1",
      kind: "user_input",
    });
    expect(selectPendingUserInputInteraction(state)).toMatchObject({
      requestId: "input-1",
      questions: [{
        questionId: "provider",
        isOther: true,
      }],
    });
    expect(JSON.stringify(state)).not.toContain("submitted answer");
  });

  it("clears user input interactions on submitted resolution", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        {
          sessionId: "session-1",
          seq: 2,
          timestamp: "2026-04-04T00:00:02Z",
          turnId: "turn-1",
          event: {
            type: "interaction_requested",
            requestId: "input-1",
            kind: "user_input",
            title: "Provider",
            description: null,
            source: {
              toolCallId: null,
              toolKind: null,
              toolStatus: null,
            },
            payload: {
              type: "user_input",
              questions: [{
                questionId: "provider",
                header: "Provider",
                question: "Which provider should be used?",
                isOther: false,
                isSecret: false,
                options: [],
              }],
            },
          },
        },
        {
          sessionId: "session-1",
          seq: 3,
          timestamp: "2026-04-04T00:00:03Z",
          turnId: "turn-1",
          event: {
            type: "interaction_resolved",
            requestId: "input-1",
            kind: "user_input",
            outcome: {
              outcome: "submitted",
              answeredQuestionIds: ["provider"],
            },
          },
        },
      ],
      "session-1",
    );

    expect(selectPendingUserInputInteraction(state)).toBeNull();
    expect(JSON.stringify(state)).not.toContain("secret answer");
  });

  it("tracks MCP elicitations without storing raw values", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        {
          sessionId: "session-1",
          seq: 2,
          timestamp: "2026-04-04T00:00:02Z",
          turnId: "turn-1",
          event: {
            type: "interaction_requested",
            requestId: "mcp-1",
            kind: "mcp_elicitation",
            title: "MCP input needed",
            description: null,
            source: {
              toolCallId: null,
              toolKind: null,
              toolStatus: null,
            },
            payload: {
              type: "mcp_elicitation",
              serverName: "Google",
              mode: {
                mode: "form",
                message: "Pick account",
                fields: [{
                  fieldType: "single_select",
                  fieldId: "field_1",
                  label: "Account",
                  required: true,
                  options: [{ optionId: "field_1_option_1", label: "Work" }],
                }],
              },
            },
          },
        },
      ],
      "session-1",
    );

    expect(selectPendingMcpElicitationInteraction(state)).toMatchObject({
      requestId: "mcp-1",
      kind: "mcp_elicitation",
      mcpElicitation: {
        serverName: "Google",
        mode: {
          mode: "form",
        },
      },
    });
    expect(selectPrimaryPendingInteraction(state)?.kind).toBe("mcp_elicitation");
    expect(JSON.stringify(state)).not.toContain("acct_");
    expect(JSON.stringify(state)).not.toContain("original-request-id");
  });

  it("clears MCP elicitations on accepted resolution without values", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        {
          sessionId: "session-1",
          seq: 2,
          timestamp: "2026-04-04T00:00:02Z",
          turnId: "turn-1",
          event: {
            type: "interaction_requested",
            requestId: "mcp-1",
            kind: "mcp_elicitation",
            title: "MCP input needed",
            description: null,
            source: {
              toolCallId: null,
              toolKind: null,
              toolStatus: null,
            },
            payload: {
              type: "mcp_elicitation",
              serverName: "Google",
              mode: {
                mode: "form",
                message: "Pick account",
                fields: [],
              },
            },
          },
        },
        {
          sessionId: "session-1",
          seq: 3,
          timestamp: "2026-04-04T00:00:03Z",
          turnId: "turn-1",
          event: {
            type: "interaction_resolved",
            requestId: "mcp-1",
            kind: "mcp_elicitation",
            outcome: {
              outcome: "accepted",
              acceptedFieldIds: ["field_1"],
            },
          },
        },
      ],
      "session-1",
    );

    expect(selectPendingMcpElicitationInteraction(state)).toBeNull();
    expect(JSON.stringify(state)).not.toContain("submitted-secret");
  });

  it("aggregates file badges when the turn ends", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        completedToolItem(2, "tool-1", {
          type: "file_change",
          operation: "edit",
          path: "src/app.ts",
          workspacePath: "src/app.ts",
          additions: 2,
          deletions: 1,
        }),
        completedToolItem(3, "tool-2", {
          type: "file_change",
          operation: "edit",
          path: "src/app.ts",
          workspacePath: "src/app.ts",
          additions: 4,
          deletions: 3,
        }),
        turnEnded(4),
      ],
      "session-1",
    );

    expect(state.turnsById["turn-1"].fileBadges).toEqual([
      {
        path: "src/app.ts",
        additions: 6,
        deletions: 4,
      },
    ]);
  });

  it("clears pending approval on error as a defensive fallback", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        completedToolItem(2, "tool-1"),
        permissionRequested(3, "tool-1"),
        {
          sessionId: "session-1",
          seq: 4,
          timestamp: "2026-04-04T00:00:04Z",
          turnId: "turn-1",
          itemId: "error-1",
          event: {
            type: "error",
            message: "server shut down unexpectedly",
            code: null,
          },
        },
      ],
      "session-1",
    );

    expect(selectPendingApprovalInteraction(state)).toBeNull();
    expect((state.itemsById["tool-1"] as ToolCallItem).approvalState).toBe("none");
  });

  it("clears pending approval on session_ended fallback replay", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        completedToolItem(2, "tool-1"),
        permissionRequested(3, "tool-1"),
        {
          sessionId: "session-1",
          seq: 4,
          timestamp: "2026-04-04T00:00:04Z",
          event: {
            type: "session_ended",
            reason: "error",
          },
        },
      ],
      "session-1",
    );

    expect(selectPendingApprovalInteraction(state)).toBeNull();
    expect((state.itemsById["tool-1"] as ToolCallItem).approvalState).toBe("none");
    expect(state.isStreaming).toBe(false);
  });

  it("replaces async launch text in place without reordering the turn", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        backgroundLaunchToolItem(2, "tool-1"),
        assistantCompleted(3, "assistant-1", "Waiting on results now."),
        {
          sessionId: "session-1",
          seq: 4,
          timestamp: "2026-04-04T00:00:04Z",
          turnId: "turn-1",
          itemId: "tool-1",
          event: {
            type: "item_delta",
            delta: {
              status: "completed",
              rawOutput: backgroundWorkRawOutput("completed"),
              replaceContentParts: [
                {
                  type: "tool_result_text",
                  text: "Final synthesized subagent report.",
                },
              ],
            },
          },
        },
        {
          sessionId: "session-1",
          seq: 5,
          timestamp: "2026-04-04T00:00:05Z",
          turnId: "turn-1",
          itemId: "tool-1",
          event: {
            type: "item_completed",
            item: {
              kind: "tool_invocation",
              status: "completed",
              sourceAgentKind: "claude",
              toolCallId: "tool-1",
              rawOutput: backgroundWorkRawOutput("completed"),
              contentParts: [
                {
                  type: "tool_result_text",
                  text: "Final synthesized subagent report.",
                },
              ],
            },
          },
        },
      ],
      "session-1",
    );

    const item = state.itemsById["tool-1"] as ToolCallItem;
    const resultTexts = item.contentParts
      .filter((part): part is Extract<typeof item.contentParts[number], { type: "tool_result_text" }> => part.type === "tool_result_text")
      .map((part) => part.text);

    expect(resultTexts).toEqual(["Final synthesized subagent report."]);
    expect(state.turnsById["turn-1"].itemOrder).toEqual(["tool-1", "assistant-1"]);
    expect(item.lastUpdatedSeq).toBe(5);
    expect((item.rawOutput as { _anyharness?: { backgroundWork?: { state?: string } } })._anyharness?.backgroundWork?.state).toBe("completed");
  });

  it("classifies Claude cowork artifact create tool calls from captured MCP names", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        claudeCoworkArtifactCreateStarted(),
        claudeCoworkArtifactCreateCompleted(),
      ],
      "session-1",
    );

    const item = state.itemsById["tool-artifact-create"] as ToolCallItem;
    expect(item.kind).toBe("tool_call");
    expect(item.semanticKind).toBe("cowork_artifact_create");
    expect(item.nativeToolName).toBe("mcp__cowork__create_artifact");
  });

  it("classifies Claude cowork artifact update tool calls from captured MCP names", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        claudeCoworkArtifactUpdateStarted(),
        claudeCoworkArtifactUpdateCompleted(),
      ],
      "session-1",
    );

    const item = state.itemsById["tool-artifact-update"] as ToolCallItem;
    expect(item.kind).toBe("tool_call");
    expect(item.semanticKind).toBe("cowork_artifact_update");
    expect(item.nativeToolName).toBe("mcp__cowork__update_artifact");
  });

  it("does not classify unverified plain create_artifact names as cowork artifact tools", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        {
          sessionId: "session-1",
          seq: 2,
          timestamp: "2026-04-04T00:00:02Z",
          turnId: "turn-1",
          itemId: "tool-plain-artifact",
          event: {
            type: "item_completed",
            item: {
              kind: "tool_invocation",
              status: "completed",
              sourceAgentKind: "claude",
              toolCallId: "tool-plain-artifact",
              title: "create_artifact",
              nativeToolName: "create_artifact",
              contentParts: [
                {
                  type: "tool_call",
                  toolCallId: "tool-plain-artifact",
                  title: "create_artifact",
                  toolKind: "other",
                  nativeToolName: "create_artifact",
                },
              ],
            },
          },
        },
      ],
      "session-1",
    );

    const item = state.itemsById["tool-plain-artifact"] as ToolCallItem;
    expect(item.kind).toBe("tool_call");
    expect(item.semanticKind).toBe("other");
  });
});

function turnStarted(seq: number): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    event: { type: "turn_started" },
  };
}

function turnEnded(seq: number): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    event: { type: "turn_ended", stopReason: "end_turn" },
  };
}

function assistantStarted(
  seq: number,
  itemId: string,
  text: string,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_started",
      item: {
        kind: "assistant_message",
        status: "in_progress",
        sourceAgentKind: "claude",
        contentParts: [{ type: "text", text }],
      },
    },
  };
}

function assistantDelta(
  seq: number,
  itemId: string,
  appendText: string,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_delta",
      delta: {
        appendText,
      },
    },
  };
}

function assistantCompleted(
  seq: number,
  itemId: string,
  text: string,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_completed",
      item: {
        kind: "assistant_message",
        status: "completed",
        sourceAgentKind: "claude",
        contentParts: [{ type: "text", text }],
      },
    },
  };
}

function userMessageStarted(
  seq: number,
  itemId: string,
  contentParts: ContentPart[],
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_started",
      item: {
        kind: "user_message",
        status: "completed",
        sourceAgentKind: "claude",
        contentParts,
      },
    },
  };
}

function userMessageCompleted(
  seq: number,
  itemId: string,
  contentParts: ContentPart[],
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_completed",
      item: {
        kind: "user_message",
        status: "completed",
        sourceAgentKind: "claude",
        contentParts,
      },
    },
  };
}

function reasoningStarted(
  seq: number,
  itemId: string,
  text: string,
  isTransient = false,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_started",
      item: {
        kind: "reasoning",
        status: "in_progress",
        sourceAgentKind: "claude",
        isTransient,
        contentParts: [{ type: "reasoning", text, visibility: "private" }],
      },
    },
  };
}

function completedToolItem(
  seq: number,
  itemId: string,
  extraContentPart?: SessionEventEnvelope["event"] extends never ? never : {
    type: "file_change";
    operation: "edit" | "create" | "delete" | "move";
    path: string;
    workspacePath?: string;
    additions?: number;
    deletions?: number;
  },
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_completed",
      item: {
        kind: "tool_invocation",
        status: "completed",
        sourceAgentKind: "claude",
        toolCallId: itemId,
        title: "Tool call",
        contentParts: [
          {
            type: "tool_call",
            toolCallId: itemId,
            title: "Tool call",
            toolKind: "other",
          },
          ...(extraContentPart ? [extraContentPart] : []),
        ],
      },
    },
  };
}

function backgroundLaunchToolItem(
  seq: number,
  itemId: string,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_completed",
      item: {
        kind: "tool_invocation",
        status: "completed",
        sourceAgentKind: "claude",
        toolCallId: itemId,
        title: "Agent task",
        rawOutput: backgroundWorkRawOutput("pending"),
        contentParts: [
          {
            type: "tool_call",
            toolCallId: itemId,
            title: "Agent task",
            toolKind: "other",
          },
          {
            type: "tool_input_text",
            text: "Investigate this repo.",
          },
          {
            type: "tool_result_text",
            text: "Async agent launched successfully.\nThe agent is working in the background.",
          },
        ],
      },
    },
  };
}

function backgroundWorkRawOutput(state: "pending" | "completed" | "expired") {
  return {
    isAsync: true,
    agentId: "agent-1",
    outputFile: "/tmp/agent.output",
    _anyharness: {
      backgroundWork: {
        trackerKind: "claude_async_agent",
        state,
      },
    },
  };
}

function permissionRequested(
  seq: number,
  toolCallId: string,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId: toolCallId,
    event: {
      type: "interaction_requested",
      requestId: "perm-1",
      kind: "permission",
      title: "Run command",
      description: null,
      source: {
        toolCallId,
        toolKind: "execute",
        toolStatus: null,
      },
      payload: {
        type: "permission",
        options: [{ optionId: "allow", label: "Allow", kind: "allow_once" }],
      },
    },
  };
}

function claudeCoworkArtifactCreateStarted(): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq: 2,
    timestamp: "2026-04-12T19:13:00.100000+00:00",
    turnId: "turn-1",
    itemId: "tool-artifact-create",
    event: {
      type: "item_started",
      item: {
        kind: "tool_invocation",
        status: "in_progress",
        sourceAgentKind: "claude",
        title: "mcp__cowork__create_artifact",
        toolCallId: "tool-artifact-create",
        nativeToolName: "mcp__cowork__create_artifact",
        rawInput: {},
        contentParts: [
          {
            type: "tool_call",
            toolCallId: "tool-artifact-create",
            title: "mcp__cowork__create_artifact",
            toolKind: "other",
            nativeToolName: "mcp__cowork__create_artifact",
          },
        ],
      },
    },
  };
}

function claudeCoworkArtifactCreateCompleted(): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq: 3,
    timestamp: "2026-04-12T19:13:01.353997+00:00",
    turnId: "turn-1",
    itemId: "tool-artifact-create",
    event: {
      type: "item_completed",
      item: {
        kind: "tool_invocation",
        status: "completed",
        sourceAgentKind: "claude",
        title: "mcp__cowork__create_artifact",
        toolCallId: "tool-artifact-create",
        nativeToolName: "mcp__cowork__create_artifact",
        rawInput: {
          path: "aurora.jsx",
          title: "Aurora - Interactive Ambient Display",
          description:
            "A beautiful interactive ambient display with flowing aurora gradients, floating particles, and a real-time clock.",
        },
        rawOutput:
          "{\"createdAt\":\"2026-04-12T19:13:01.353997+00:00\",\"description\":\"A beautiful interactive ambient display with flowing aurora gradients, floating particles, and a real-time clock.\",\"exists\":true,\"id\":\"art_001386b254d0414a8f96f2baa8d976c2\",\"modifiedAt\":\"2026-04-12T19:13:01.354198186+00:00\",\"path\":\"aurora.jsx\",\"sizeBytes\":9792,\"title\":\"Aurora - Interactive Ambient Display\",\"type\":\"application/vnd.proliferate.react\",\"updatedAt\":\"2026-04-12T19:13:01.353997+00:00\"}",
        contentParts: [
          {
            type: "tool_call",
            toolCallId: "tool-artifact-create",
            title: "mcp__cowork__create_artifact",
            toolKind: "other",
            nativeToolName: "mcp__cowork__create_artifact",
          },
          {
            type: "tool_result_text",
            text:
              "{\"createdAt\":\"2026-04-12T19:13:01.353997+00:00\",\"description\":\"A beautiful interactive ambient display with flowing aurora gradients, floating particles, and a real-time clock.\",\"exists\":true,\"id\":\"art_001386b254d0414a8f96f2baa8d976c2\",\"modifiedAt\":\"2026-04-12T19:13:01.354198186+00:00\",\"path\":\"aurora.jsx\",\"sizeBytes\":9792,\"title\":\"Aurora - Interactive Ambient Display\",\"type\":\"application/vnd.proliferate.react\",\"updatedAt\":\"2026-04-12T19:13:01.353997+00:00\"}",
          },
        ],
      },
    },
  };
}

function claudeCoworkArtifactUpdateStarted(): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq: 2,
    timestamp: "2026-04-12T19:14:10.100000+00:00",
    turnId: "turn-1",
    itemId: "tool-artifact-update",
    event: {
      type: "item_started",
      item: {
        kind: "tool_invocation",
        status: "in_progress",
        sourceAgentKind: "claude",
        title: "mcp__cowork__update_artifact",
        toolCallId: "tool-artifact-update",
        nativeToolName: "mcp__cowork__update_artifact",
        rawInput: {},
        contentParts: [
          {
            type: "tool_call",
            toolCallId: "tool-artifact-update",
            title: "mcp__cowork__update_artifact",
            toolKind: "other",
            nativeToolName: "mcp__cowork__update_artifact",
          },
        ],
      },
    },
  };
}

function claudeCoworkArtifactUpdateCompleted(): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq: 3,
    timestamp: "2026-04-12T19:14:11.353997+00:00",
    turnId: "turn-1",
    itemId: "tool-artifact-update",
    event: {
      type: "item_completed",
      item: {
        kind: "tool_invocation",
        status: "completed",
        sourceAgentKind: "claude",
        title: "mcp__cowork__update_artifact",
        toolCallId: "tool-artifact-update",
        nativeToolName: "mcp__cowork__update_artifact",
        rawInput: {
          id: "art_001386b254d0414a8f96f2baa8d976c2",
          title: "Aurora - Interactive Ambient Display",
          description:
            "A beautiful interactive ambient display with flowing aurora gradients, floating particles, and a real-time clock.",
        },
        rawOutput:
          "{\"createdAt\":\"2026-04-12T19:13:01.353997+00:00\",\"description\":\"A beautiful interactive ambient display with flowing aurora gradients, floating particles, and a real-time clock.\",\"exists\":true,\"id\":\"art_001386b254d0414a8f96f2baa8d976c2\",\"modifiedAt\":\"2026-04-12T19:14:11.354198186+00:00\",\"path\":\"aurora.jsx\",\"sizeBytes\":9792,\"title\":\"Aurora - Interactive Ambient Display\",\"type\":\"application/vnd.proliferate.react\",\"updatedAt\":\"2026-04-12T19:14:11.353997+00:00\"}",
        contentParts: [
          {
            type: "tool_call",
            toolCallId: "tool-artifact-update",
            title: "mcp__cowork__update_artifact",
            toolKind: "other",
            nativeToolName: "mcp__cowork__update_artifact",
          },
          {
            type: "tool_result_text",
            text:
              "{\"createdAt\":\"2026-04-12T19:13:01.353997+00:00\",\"description\":\"A beautiful interactive ambient display with flowing aurora gradients, floating particles, and a real-time clock.\",\"exists\":true,\"id\":\"art_001386b254d0414a8f96f2baa8d976c2\",\"modifiedAt\":\"2026-04-12T19:14:11.354198186+00:00\",\"path\":\"aurora.jsx\",\"sizeBytes\":9792,\"title\":\"Aurora - Interactive Ambient Display\",\"type\":\"application/vnd.proliferate.react\",\"updatedAt\":\"2026-04-12T19:14:11.353997+00:00\"}",
          },
        ],
      },
    },
  };
}
