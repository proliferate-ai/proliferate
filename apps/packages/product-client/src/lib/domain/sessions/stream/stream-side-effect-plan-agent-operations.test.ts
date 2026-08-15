import {
  createTranscriptState,
  type SessionEventEnvelope,
  type ToolCallItem,
} from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import { planBatchedStreamSideEffects } from "#product/lib/domain/sessions/stream/stream-side-effect-plan";

describe("planBatchedStreamSideEffects Workspace-MCP authority", () => {
  it("plans an immediate child hint, mount, and roster refresh for create", () => {
    const plan = planWorkspaceAgentOperation(
      workspaceAgentOperation("create_agent", "subagent"),
    );

    expect(plan.invalidateSessionSubagents).toBe(true);
    expect(plan.eventEffects).toEqual([
      {
        kind: "record_session_relationship_hint",
        sessionId: "workspace-agent",
        relationship: {
          kind: "subagent_child",
          parentSessionId: "session-1",
          relation: "subagent",
          workspaceId: "workspace-1",
        },
      },
      {
        kind: "mount_subagent_child_session",
        childSessionId: "workspace-agent",
        label: "Workspace agent",
        workspaceId: "workspace-1",
        parentSessionId: "session-1",
      },
    ]);
  });

  it("grants immediate create authority from a production-shaped Codex envelope", () => {
    const direct = workspaceAgentOperation("create_agent", "subagent");
    const plan = planWorkspaceAgentOperation({
      ...direct,
      nativeToolName: null,
      rawInput: {
        server: "workspace",
        tool: "create_agent",
        arguments: direct.rawInput,
      },
      rawOutput: {
        content: [{ type: "text", text: JSON.stringify(direct.rawOutput) }],
        isError: false,
        structuredContent: direct.rawOutput,
      },
    });

    expect(plan.invalidateSessionSubagents).toBe(true);
    expect(plan.eventEffects).toEqual([
      {
        kind: "record_session_relationship_hint",
        sessionId: "workspace-agent",
        relationship: {
          kind: "subagent_child",
          parentSessionId: "session-1",
          relation: "subagent",
          workspaceId: "workspace-1",
        },
      },
      {
        kind: "mount_subagent_child_session",
        childSessionId: "workspace-agent",
        label: "Workspace agent",
        workspaceId: "workspace-1",
        parentSessionId: "session-1",
      },
    ]);
  });

  it("plans a monotonic promotion mark and roster refresh for promotion", () => {
    const plan = planWorkspaceAgentOperation(
      workspaceAgentOperation("promote_subagent", "ordinary"),
    );

    expect(plan.invalidateSessionSubagents).toBe(true);
    expect(plan.eventEffects).toEqual([{
      kind: "mark_session_promoted",
      durableSessionId: "workspace-agent",
      workspaceId: "workspace-1",
    }]);
  });

  it.each([
    ["create_agent", "subagent", "in_progress", workspaceAgentView("subagent")],
    ["create_agent", "subagent", "failed", workspaceAgentView("subagent")],
    ["promote_subagent", "ordinary", "in_progress", workspaceAgentView("ordinary")],
    ["promote_subagent", "ordinary", "failed", workspaceAgentView("ordinary")],
  ] as const)(
    "does not mark or invalidate %s role=%s when status=%s",
    (action, role, status, rawOutput) => {
      const plan = planWorkspaceAgentOperation(workspaceAgentOperation(
        action,
        role,
        { status, rawOutput },
      ));

      expect(plan.invalidateSessionSubagents).toBe(false);
      expect(plan.eventEffects).toEqual([]);
    },
  );

  it.each([
    ["create_agent", "subagent", { agent: workspaceAgentView("subagent") }],
    ["create_agent", "ordinary", workspaceAgentView("ordinary")],
    ["promote_subagent", "ordinary", { agent: workspaceAgentView("ordinary") }],
    ["promote_subagent", "subagent", workspaceAgentView("subagent")],
  ] as const)(
    "only invalidates %s role=%s when its completed output cannot grant authority",
    (action, role, rawOutput) => {
      const plan = planWorkspaceAgentOperation(workspaceAgentOperation(
        action,
        role,
        { rawOutput },
      ));

      expect(plan.invalidateSessionSubagents).toBe(true);
      expect(plan.eventEffects).toEqual([]);
    },
  );

  it.each([
    ["create_agent", "subagent", withoutNestedField(
      workspaceAgentView("subagent"),
      "identity",
      "runtimeId",
    )],
    ["create_agent", "subagent", withoutField(
      workspaceAgentView("subagent"),
      "parent",
    )],
    ["promote_subagent", "ordinary", withoutNestedField(
      workspaceAgentView("ordinary"),
      "workspace",
      "runtimeId",
    )],
    ["promote_subagent", "ordinary", withoutNestedField(
      workspaceAgentView("ordinary"),
      "status",
      "hasLiveActor",
    )],
  ] as const)(
    "does not grant %s role=%s authority from a partial direct AgentView",
    (action, role, rawOutput) => {
      const plan = planWorkspaceAgentOperation(workspaceAgentOperation(
        action,
        role,
        { rawOutput },
      ));

      expect(plan.invalidateSessionSubagents).toBe(true);
      expect(plan.eventEffects).toEqual([]);
    },
  );

  it.each([
    {
      name: "a create input kind disagrees with the subagent output",
      item: workspaceAgentOperation("create_agent", "subagent", {
        rawInput: { workspaceId: "workspace-1", kind: "ordinary" },
      }),
    },
    {
      name: "a create input workspace disagrees with the output",
      item: workspaceAgentOperation("create_agent", "subagent", {
        rawInput: { workspaceId: "workspace-2", kind: "subagent", task: "Help" },
      }),
    },
    {
      name: "a created child belongs to another workspace",
      item: workspaceAgentOperation("create_agent", "subagent", {
        rawOutput: {
          ...workspaceAgentView("subagent"),
          workspace: { runtimeId: "runtime-1", workspaceId: "workspace-2" },
        },
      }),
    },
    {
      name: "a created child names another durable parent",
      item: workspaceAgentOperation("create_agent", "subagent", {
        rawOutput: {
          ...workspaceAgentView("subagent"),
          parent: { runtimeId: "runtime-1", sessionId: "session-2" },
        },
      }),
    },
    {
      name: "a created child's parent runtime disagrees",
      item: workspaceAgentOperation("create_agent", "subagent", {
        rawOutput: {
          ...workspaceAgentView("subagent"),
          parent: { runtimeId: "runtime-2", sessionId: "session-1" },
        },
      }),
    },
    {
      name: "a created child reuses the durable caller identity",
      item: workspaceAgentOperation("create_agent", "subagent", {
        rawOutput: {
          ...workspaceAgentView("subagent"),
          identity: { runtimeId: "runtime-1", sessionId: "session-1" },
        },
      }),
    },
    {
      name: "a promotion input targets another identity",
      item: workspaceAgentOperation("promote_subagent", "ordinary", {
        rawInput: { agentId: "another-agent" },
      }),
    },
    {
      name: "a promoted ordinary agent retains a parent",
      item: workspaceAgentOperation("promote_subagent", "ordinary", {
        rawOutput: {
          ...workspaceAgentView("ordinary"),
          parent: { runtimeId: "runtime-1", sessionId: "session-1" },
        },
      }),
    },
    {
      name: "a promoted agent belongs to another workspace",
      item: workspaceAgentOperation("promote_subagent", "ordinary", {
        rawOutput: {
          ...workspaceAgentView("ordinary"),
          workspace: { runtimeId: "runtime-1", workspaceId: "workspace-2" },
        },
      }),
    },
    {
      name: "a promoted agent identity runtime disagrees",
      item: workspaceAgentOperation("promote_subagent", "ordinary", {
        rawOutput: {
          ...workspaceAgentView("ordinary"),
          identity: { runtimeId: "runtime-2", sessionId: "workspace-agent" },
        },
      }),
    },
  ])("only invalidates when $name", ({ item }) => {
    const plan = planWorkspaceAgentOperation(item);

    expect(plan.invalidateSessionSubagents).toBe(true);
    expect(plan.eventEffects).toEqual([]);
  });
});

function planWorkspaceAgentOperation(item: ToolCallItem) {
  const transcript = createTranscriptState("session-1");
  transcript.itemsById[item.itemId] = item;
  return planBatchedStreamSideEffects({
    sessionId: "session-1",
    workspaceId: "workspace-1",
    envelopes: [itemCompleted(2, item.itemId)],
    transcript,
    pendingConfigChanges: {},
    reconciledIntents: [],
  });
}

function workspaceAgentOperation(
  action: "create_agent" | "promote_subagent",
  role: "subagent" | "ordinary",
  overrides: Partial<ToolCallItem> = {},
): ToolCallItem {
  return {
    kind: "tool_call",
    itemId: "tool-1",
    turnId: "turn-1",
    status: "completed",
    sourceAgentKind: "codex",
    messageId: null,
    title: "Agent operation",
    nativeToolName: `mcp__proliferate_workspace__${action}`,
    parentToolCallId: null,
    rawInput: action === "create_agent"
      ? { workspaceId: "workspace-1", kind: "subagent", task: "Help" }
      : { agentId: "workspace-agent" },
    rawOutput: workspaceAgentView(role),
    contentParts: [],
    timestamp: "2026-04-04T00:00:01Z",
    startedSeq: 1,
    lastUpdatedSeq: 2,
    completedSeq: 2,
    completedAt: "2026-04-04T00:00:02Z",
    toolCallId: "tool-1",
    toolKind: "other",
    semanticKind: "other",
    approvalState: "none",
    ...overrides,
  };
}

function workspaceAgentView(role: "subagent" | "ordinary") {
  return {
    identity: { runtimeId: "runtime-1", sessionId: "workspace-agent" },
    workspace: { runtimeId: "runtime-1", workspaceId: "workspace-1" },
    parent: role === "subagent"
      ? { runtimeId: "runtime-1", sessionId: "session-1" }
      : null,
    role,
    title: "Workspace agent",
    configuration: { agentKind: "codex", modelId: null, modeId: null },
    status: { presentation: "available", execution: "idle", hasLiveActor: true },
    capabilities: ["get_agent", "send_message"],
    createdAt: "2026-04-04T00:00:00Z",
    updatedAt: "2026-04-04T00:00:01Z",
  };
}

function withoutField(
  value: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
}

function withoutNestedField(
  value: Record<string, unknown>,
  field: string,
  nestedField: string,
): Record<string, unknown> {
  const nested = value[field] as Record<string, unknown>;
  return {
    ...value,
    [field]: withoutField(nested, nestedField),
  };
}

function itemCompleted(seq: number, itemId: string): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_completed",
      item: {
        kind: "tool_call",
        status: "completed",
        sourceAgentKind: "codex",
        contentParts: [],
      },
    },
  } as SessionEventEnvelope;
}
