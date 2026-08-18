import { describe, expect, it } from "vitest";
import type { ToolCallItem } from "@anyharness/sdk";
import {
  AGENT_OPERATIONS_READ_ACTIONS,
  AGENT_OPERATIONS_RECEIPT_ACTIONS,
  classifyAgentOperationsTool,
  deriveAgentOperationsReadTarget,
  deriveAgentOperationsReceiptPresentation,
  isWorkspaceSubagentCreationAction,
  resolveAgentOperationsTool,
} from "./agent-operations-tool-presentation";

const AGENT_VIEW = {
  identity: { runtimeId: "runtime-1", sessionId: "session-1" },
  workspace: { runtimeId: "runtime-1", workspaceId: "workspace-1" },
  parent: { runtimeId: "runtime-1", sessionId: "parent-1" },
  role: "subagent",
  title: "Review queue semantics",
  configuration: { agentKind: "codex" },
  status: { presentation: "available", execution: "idle", hasLiveActor: true },
  capabilities: [],
  createdAt: "2026-08-10T00:00:00Z",
  updatedAt: "2026-08-10T00:00:01Z",
};

function item(
  action: string,
  overrides: Partial<ToolCallItem> = {},
): ToolCallItem {
  const status = overrides.status ?? "completed";
  return {
    kind: "tool_call",
    itemId: "agent-operation",
    turnId: "turn-1",
    status,
    sourceAgentKind: "codex",
    messageId: null,
    title: "Agent operation",
    nativeToolName: `mcp__proliferate_workspace__${action}`,
    parentToolCallId: null,
    contentParts: [],
    timestamp: "2026-08-10T00:00:00Z",
    startedSeq: 1,
    lastUpdatedSeq: 1,
    completedSeq: status === "in_progress" ? null : 1,
    completedAt: status === "in_progress" ? null : "2026-08-10T00:00:01Z",
    toolCallId: "agent-operation",
    toolKind: "other",
    semanticKind: "other",
    approvalState: "none",
    rawInput: { agentId: "agent-target", kind: "subagent", message: "Exact message" },
    rawOutput: AGENT_VIEW,
    ...overrides,
  };
}

describe("classifyAgentOperationsTool", () => {
  it.each(AGENT_OPERATIONS_READ_ACTIONS)("classifies read operation %s as generic", (action) => {
    expect(classifyAgentOperationsTool(`mcp__proliferate_workspace__${action}`)).toEqual({
      action,
      presentation: "read",
    });
  });

  it.each(AGENT_OPERATIONS_RECEIPT_ACTIONS)("classifies mutation %s as a receipt", (action) => {
    expect(classifyAgentOperationsTool(`mcp__proliferate_workspace__${action}`)).toEqual({
      action,
      presentation: "receipt",
    });
  });

  it("rejects unknown owners, unknown operations, and lookalike suffixes", () => {
    expect(classifyAgentOperationsTool("mcp__subagents__create_subagent")).toBeNull();
    expect(classifyAgentOperationsTool("mcp__workspace__create_agent")).toBeNull();
    expect(classifyAgentOperationsTool("mcp__proliferate_workspace__wake_agent")).toBeNull();
    expect(
      classifyAgentOperationsTool("mcp__proliferate_workspace__create_agent_extra"),
    ).toBeNull();
  });

  it.each(["proliferate_workspace", "workspace"])(
    "classifies a trusted %s Codex MCP envelope without restoring a native alias",
    (server) => {
      const envelopeItem = item("create_agent", {
        nativeToolName: null,
        rawInput: {
          server,
          tool: "create_agent",
          arguments: { workspaceId: "workspace-1", kind: "ordinary" },
        },
      });

      expect(resolveAgentOperationsTool(envelopeItem)).toEqual({
        action: "create_agent",
        presentation: "receipt",
      });
      expect(classifyAgentOperationsTool("mcp__workspace__create_agent")).toBeNull();
    },
  );

  it("rejects untrusted or malformed Codex MCP envelopes", () => {
    expect(resolveAgentOperationsTool(item("create_agent", {
      nativeToolName: null,
      rawInput: {
        server: "other",
        tool: "create_agent",
        arguments: { workspaceId: "workspace-1", kind: "ordinary" },
      },
    }))).toBeNull();
    expect(resolveAgentOperationsTool(item("create_agent", {
      nativeToolName: null,
      rawInput: { server: "workspace", tool: "create_agent" },
    }))).toBeNull();
  });
});

describe("deriveAgentOperationsReceiptPresentation", () => {
  it.each([
    "create_agent",
    "resume_agent",
    "interrupt_agent",
    "close_subagent",
    "open_subagent",
    "promote_subagent",
  ] as const)("reads %s from a direct AgentView", (action) => {
    expect(deriveAgentOperationsReceiptPresentation(item(action))).toMatchObject({
      action,
      agent: {
        runtimeId: "runtime-1",
        sessionId: "session-1",
        workspaceId: "workspace-1",
        parentSessionId: "parent-1",
        title: "Review queue semantics",
        role: "subagent",
        closed: false,
      },
    });
  });

  it("preserves an omitted direct AgentView title for create-agent task fallback", () => {
    const titlelessAgentView = Object.fromEntries(
      Object.entries(AGENT_VIEW).filter(([key]) => key !== "title"),
    );
    expect(deriveAgentOperationsReceiptPresentation(item("create_agent", {
      rawInput: {
        workspaceId: "workspace-1",
        kind: "subagent",
        task: "Inspect the replay boundary",
      },
      rawOutput: titlelessAgentView,
    }))).toMatchObject({
      action: "create_agent",
      agent: { sessionId: "session-1", title: null },
    });
  });

  it("reads configure_agent only from its MCP agent wrapper", () => {
    expect(deriveAgentOperationsReceiptPresentation(item("configure_agent", {
      rawOutput: { agent: AGENT_VIEW, applyState: "queued" },
    }))).toMatchObject({
      action: "configure_agent",
      detailLabel: "Queued",
      agent: { sessionId: "session-1" },
    });
  });

  it.each([
    [{ agent: AGENT_VIEW }, "missing applyState"],
    [{ agent: AGENT_VIEW, applyState: "eventually" }, "unknown applyState"],
    [{ agent: AGENT_VIEW, relationship: { id: "link-1" } }, "HTTP-shaped wrapper"],
  ] as const)("rejects configure_agent %s (%s)", (rawOutput) => {
    expect(deriveAgentOperationsReceiptPresentation(item("configure_agent", {
      rawInput: { agentId: "durable-config-target" },
      rawOutput,
    }))).toMatchObject({
      agent: { sessionId: "durable-config-target", workspaceId: null, title: null },
      detailLabel: null,
    });
  });

  it("reads send_message target identity and preserves the exact input message", () => {
    expect(deriveAgentOperationsReceiptPresentation(item("send_message", {
      rawOutput: {
        target: { runtimeId: "runtime-1", sessionId: "session-2" },
        queueSeq: 14,
        status: "durably_queued",
      },
      rawInput: { agentId: "target-2", message: "Keep  two\nlines exactly." },
    }))).toMatchObject({
      action: "send_message",
      targetAgentId: "target-2",
      message: "Keep  two\nlines exactly.",
      detailLabel: "Durably queued",
      agent: { sessionId: "session-2" },
    });
  });

  it.each([
    [{ target: { runtimeId: "runtime-1", sessionId: "session-2" }, status: "durably_queued" }, "missing queueSeq"],
    [{ target: { runtimeId: "runtime-1", sessionId: "session-2" }, queueSeq: 1, status: "queued" }, "wrong status"],
    [{ target: { sessionId: "session-2" }, queueSeq: 1, status: "durably_queued" }, "partial target"],
  ] as const)("rejects send_message %s (%s)", (rawOutput) => {
    expect(deriveAgentOperationsReceiptPresentation(item("send_message", {
      rawInput: { agentId: "durable-send-target", message: "Exact message" },
      rawOutput,
    }))).toMatchObject({
      agent: { sessionId: "durable-send-target", workspaceId: null, title: null },
      detailLabel: null,
    });
  });

  it("reads create_workspace from its workspace envelope", () => {
    expect(deriveAgentOperationsReceiptPresentation(item("create_workspace", {
      rawInput: {
        repositoryId: "proliferate-ai/proliferate",
        creationMode: "worktree",
        branch: "main",
      },
      rawOutput: {
        workspace: {
          identity: { runtimeId: "runtime-1", workspaceId: "workspace-2" },
          displayName: "Agent ops",
          repositoryName: "proliferate",
          currentBranch: "agent-ops",
        },
        creationMode: "worktree",
      },
    }))).toMatchObject({
      action: "create_workspace",
      workspace: {
        workspaceId: "workspace-2",
        displayName: "Agent ops",
        repositoryLabel: "proliferate",
        branchLabel: "agent-ops",
        creationMode: "worktree",
      },
      detailLabel: "proliferate · worktree from agent-ops",
    });
  });

  it.each([
    ["pin_workspace", true, "Requested pin"],
    ["unpin_workspace", false, "Requested unpin"],
  ] as const)("reads %s from its requested workspace envelope", (action, pinned, actionLabel) => {
    expect(deriveAgentOperationsReceiptPresentation(item(action, {
      rawInput: { workspaceId: "workspace-2" },
      rawOutput: {
        requestId: "11111111-1111-4111-8111-111111111111",
        workspace: {
          identity: { runtimeId: "runtime-1", workspaceId: "workspace-2" },
          repositoryId: "repo-1",
          kind: "local",
          surface: "standard",
          path: "/tmp/workspace-2",
          displayName: "Pin target",
          lifecycleState: "active",
          createdAt: "2026-08-10T00:00:00Z",
          updatedAt: "2026-08-10T00:00:01Z",
        },
        pinned,
        status: "requested",
      },
    }))).toMatchObject({
      action,
      actionLabel,
      workspace: {
        runtimeId: "runtime-1",
        workspaceId: "workspace-2",
        displayName: "Pin target",
      },
    });
  });

  it("unwraps production-shaped Codex arguments and structured output", () => {
    const ordinaryAgent = {
      ...AGENT_VIEW,
      role: "ordinary",
      parent: null,
      title: "Ordinary reviewer",
    };
    expect(deriveAgentOperationsReceiptPresentation(item("create_agent", {
      nativeToolName: null,
      rawInput: {
        server: "workspace",
        tool: "create_agent",
        arguments: { workspaceId: "workspace-1", kind: "ordinary" },
      },
      rawOutput: {
        content: [{ type: "text", text: JSON.stringify(ordinaryAgent) }],
        isError: false,
        structuredContent: ordinaryAgent,
      },
    }))).toMatchObject({
      action: "create_agent",
      agent: {
        sessionId: "session-1",
        title: "Ordinary reviewer",
        role: "ordinary",
      },
    });
  });

  it.each(["in_progress", "failed"] as const)(
    "does not mint create identity from a %s Codex result",
    (status) => {
      expect(deriveAgentOperationsReceiptPresentation(item("create_agent", {
        status,
        nativeToolName: null,
        rawInput: {
          server: "proliferate_workspace",
          tool: "create_agent",
          arguments: { workspaceId: "workspace-1", kind: "subagent", task: "Review" },
        },
        rawOutput: {
          content: [],
          isError: status === "failed",
          structuredContent: AGENT_VIEW,
        },
      }))?.agent).toBeNull();
    },
  );

  it("unwraps a production-shaped Codex create_workspace result", () => {
    const workspace = {
      identity: { runtimeId: "runtime-1", workspaceId: "workspace-2" },
      displayName: "Envelope workspace",
      repositoryName: "proliferate",
      currentBranch: "main",
    };
    expect(deriveAgentOperationsReceiptPresentation(item("create_workspace", {
      nativeToolName: null,
      rawInput: {
        server: "proliferate_workspace",
        tool: "create_workspace",
        arguments: {
          repositoryId: "repo-1",
          creationMode: "worktree",
          branch: "main",
        },
      },
      rawOutput: {
        content: [],
        isError: false,
        structuredContent: { workspace, creationMode: "worktree" },
      },
    }))).toMatchObject({
      action: "create_workspace",
      workspace: { workspaceId: "workspace-2", displayName: "Envelope workspace" },
    });
  });

  it.each([
    [{ workspace: { identity: { runtimeId: "runtime-1", workspaceId: "workspace-2" } } }, "missing creationMode"],
    [{
      workspace: { identity: { runtimeId: "runtime-1", workspaceId: "workspace-2" } },
      creationMode: "ephemeral",
    }, "unknown creationMode"],
  ] as const)("rejects create_workspace %s (%s)", (rawOutput) => {
    expect(deriveAgentOperationsReceiptPresentation(item("create_workspace", {
      rawOutput,
    }))).toMatchObject({ workspace: null, detailLabel: null });
  });

  it("projects a production WorkspaceView for uncached navigation and human naming", () => {
    const presentation = deriveAgentOperationsReceiptPresentation(item("create_workspace", {
      rawInput: {
        repositoryId: "repo-root_opaque_7ce90",
        creationMode: "worktree",
        branch: "codex/transcript-receipts",
      },
      rawOutput: {
        workspace: {
          identity: { runtimeId: "runtime-1", workspaceId: "workspace-fresh" },
          repositoryId: "repo-root_opaque_7ce90",
          kind: "worktree",
          surface: "standard",
          path: "/runtime/worktrees/transcript-receipts",
          originalBranch: "main",
          currentBranch: "codex/transcript-receipts",
          lifecycleState: "active",
          createdAt: "2026-08-10T01:00:00Z",
          updatedAt: "2026-08-10T01:00:01Z",
        },
        creationMode: "worktree",
      },
    }));

    expect(presentation?.workspace).toMatchObject({
      workspaceId: "workspace-fresh",
      displayName: "Transcript receipts",
      repositoryLabel: null,
      branchLabel: "codex/transcript-receipts",
      knownWorkspace: {
        id: "workspace-fresh",
        repoRootId: "repo-root_opaque_7ce90",
        path: "/runtime/worktrees/transcript-receipts",
        kind: "worktree",
        surface: "standard",
      },
    });
    expect(presentation?.detailLabel).not.toContain("repo-root_opaque_7ce90");
    expect(presentation?.detailLabel).toBe("worktree from codex/transcript-receipts");
  });

  it("parses JSON rawOutput and JSON tool-result content", () => {
    expect(deriveAgentOperationsReceiptPresentation(item("resume_agent", {
      rawOutput: JSON.stringify(AGENT_VIEW),
    }))?.agent?.sessionId).toBe("session-1");

    expect(deriveAgentOperationsReceiptPresentation(item("open_subagent", {
      rawOutput: undefined,
      contentParts: [{ type: "tool_result_text", text: JSON.stringify(AGENT_VIEW) }],
    }))?.agent?.sessionId).toBe("session-1");
  });

  it("keeps existing-target identity from agentId when a result is malformed", () => {
    expect(deriveAgentOperationsReceiptPresentation(item("resume_agent", {
      rawInput: { agentId: "not-a-session" },
      rawOutput: "{malformed",
      contentParts: [{ type: "tool_result_text", text: "also not json" }],
    }))).toMatchObject({
      targetAgentId: "not-a-session",
      agent: { sessionId: "not-a-session", title: null },
    });
  });

  it.each([
    "configure_agent",
    "resume_agent",
    "send_message",
    "interrupt_agent",
    "close_subagent",
    "open_subagent",
    "promote_subagent",
  ] as const)("attributes running and failed %s receipts from durable agentId", (action) => {
    for (const status of ["in_progress", "failed"] as const) {
      expect(deriveAgentOperationsReceiptPresentation(item(action, {
        status,
        rawInput: { agentId: "durable-agent-session", message: "Exact message" },
        rawOutput: null,
      }))).toMatchObject({
        action,
        targetAgentId: "durable-agent-session",
        agent: {
          sessionId: "durable-agent-session",
          title: null,
        },
        isRunning: status === "in_progress",
        isFailed: status === "failed",
      });
    }
  });

  it("waits for output identity when create_agent has not settled", () => {
    expect(deriveAgentOperationsReceiptPresentation(item("create_agent", {
      status: "in_progress",
      rawInput: { agentId: "not-a-create-identity", kind: "subagent" },
      rawOutput: null,
    }))?.agent).toBeNull();
  });

  it("rejects HTTP lifecycle wrappers for direct MCP lifecycle actions", () => {
    expect(deriveAgentOperationsReceiptPresentation(item("close_subagent", {
      rawOutput: { agent: AGENT_VIEW, relationship: { id: "link-1" } },
    }))?.agent).toMatchObject({
      sessionId: "agent-target",
      title: null,
    });
  });

  it.each([
    ["create_workspace", "Failed to create workspace"],
    ["pin_workspace", "Failed to pin workspace"],
    ["unpin_workspace", "Failed to unpin workspace"],
    ["create_agent", "Failed to create agent"],
    ["configure_agent", "Failed to configure agent"],
    ["resume_agent", "Failed to resume agent"],
    ["send_message", "Message to agent failed"],
    ["interrupt_agent", "Failed to interrupt agent"],
    ["close_subagent", "Failed to close subagent"],
    ["open_subagent", "Failed to open subagent"],
    ["promote_subagent", "Failed to promote subagent"],
  ] as const)("uses failure copy for %s rather than claiming success", (action, actionLabel) => {
    expect(deriveAgentOperationsReceiptPresentation(item(action, {
      status: "failed",
    }))).toMatchObject({ action, actionLabel, isFailed: true });
  });

  it("does not specialize read operations", () => {
    expect(deriveAgentOperationsReceiptPresentation(item("list_agents"))).toBeNull();
  });
});

describe("deriveAgentOperationsReadTarget", () => {
  it.each(["get_agent", "list_agent_config_options", "get_task_output"] as const)(
    "uses the durable agentId for targeted read %s",
    (action) => {
      expect(deriveAgentOperationsReadTarget(item(action, {
        rawInput: { agentId: "target-agent" },
        rawOutput: action === "get_agent"
          ? {
            ...AGENT_VIEW,
            identity: { runtimeId: "runtime-1", sessionId: "target-agent" },
            title: "Target agent",
          }
          : null,
      }))).toMatchObject({ sessionId: "target-agent" });
    },
  );

  it("does not attribute workspace-wide reads to an agent", () => {
    expect(deriveAgentOperationsReadTarget(item("list_agents"))).toBeNull();
  });
});

describe("isWorkspaceSubagentCreationAction", () => {
  it("uses rawInput.kind and excludes ordinary agents", () => {
    expect(isWorkspaceSubagentCreationAction(item("create_agent", {
      rawInput: { kind: "subagent" },
    }))).toBe(true);
    expect(isWorkspaceSubagentCreationAction(item("create_agent", {
      rawInput: { kind: "ordinary" },
    }))).toBe(false);
    expect(isWorkspaceSubagentCreationAction(item("create_agent", {
      rawInput: JSON.stringify({ kind: "subagent" }),
    }))).toBe(false);
  });

  it("reads kind from a trusted Codex arguments envelope", () => {
    expect(isWorkspaceSubagentCreationAction(item("create_agent", {
      nativeToolName: null,
      rawInput: {
        server: "workspace",
        tool: "create_agent",
        arguments: { workspaceId: "workspace-1", kind: "subagent", task: "Review" },
      },
    }))).toBe(true);
  });
});
