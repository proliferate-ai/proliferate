import { describe, expect, it } from "vitest";
import type {
  AgentOperationsAgent,
  SubagentParentRoster,
  SubagentRosterEntry,
} from "@anyharness/sdk";
import {
  buildAgentsPaneModel,
} from "#product/lib/domain/delegated-work/agents-pane-model";

function agent(input: {
  sessionId: string;
  title?: string | null;
  execution?: AgentOperationsAgent["status"]["execution"];
  presentation?: AgentOperationsAgent["status"]["presentation"];
  hasLiveActor?: boolean;
}): AgentOperationsAgent {
  return {
    capabilities: [],
    configuration: { agentKind: "claude" },
    createdAt: "2026-08-11T00:00:00Z",
    identity: { runtimeId: "rt-1", sessionId: input.sessionId },
    parent: null,
    role: "subagent",
    status: {
      execution: input.execution ?? "running",
      hasLiveActor: input.hasLiveActor ?? false,
      presentation: input.presentation ?? "running",
    },
    title: input.title ?? null,
    updatedAt: "2026-08-11T00:00:00Z",
    workspace: { runtimeId: "rt-1", workspaceId: "ws-1" },
  };
}

function entry(input: {
  sessionId: string;
  linkId: string;
  label?: string | null;
  title?: string | null;
  execution?: AgentOperationsAgent["status"]["execution"];
  presentation?: AgentOperationsAgent["status"]["presentation"];
}): SubagentRosterEntry {
  return {
    agent: agent(input),
    latestCompletion: null,
    relationship: {
      childSessionId: input.sessionId,
      createdAt: "2026-08-11T00:00:00Z",
      label: input.label ?? null,
      parentSessionId: "parent-1",
      sessionLinkId: input.linkId,
    },
  };
}

function roster(
  parentSessionId: string,
  children: SubagentRosterEntry[],
  title?: string,
): SubagentParentRoster {
  return {
    parent: agent({ sessionId: parentSessionId, title: title ?? null }),
    children,
  };
}

describe("buildAgentsPaneModel", () => {
  it("preserves server parent order across two parents", () => {
    const model = buildAgentsPaneModel([
      roster("parent-b", [entry({ sessionId: "c1", linkId: "l1" })]),
      roster("parent-a", [entry({ sessionId: "c2", linkId: "l2" })]),
    ]);

    expect(model.parents.map((parent) => parent.sessionId))
      .toEqual(["parent-b", "parent-a"]);
  });

  it("retains a parent whose children are all Closed and flags it", () => {
    const model = buildAgentsPaneModel([
      roster("parent-1", [
        entry({
          sessionId: "c1",
          linkId: "l1",
          execution: "closed",
          presentation: "closed",
        }),
        entry({
          sessionId: "c2",
          linkId: "l2",
          execution: "closed",
          presentation: "closed",
        }),
      ]),
    ]);

    expect(model.parents).toHaveLength(1);
    expect(model.parents[0]?.closedOnly).toBe(true);
    const closed = model.parents[0]?.groups.find((g) => g.key === "closed");
    expect(closed?.children.map((child) => child.sessionId))
      .toEqual(["c1", "c2"]);
  });

  it("groups strictly by status.presentation into Running/Available/Closed, preserving server order in each group", () => {
    const model = buildAgentsPaneModel([
      roster("parent-1", [
        entry({ sessionId: "run-1", linkId: "l1", presentation: "running" }),
        entry({
          sessionId: "avail-1",
          linkId: "l2",
          execution: "idle",
          presentation: "available",
        }),
        entry({ sessionId: "run-2", linkId: "l3", presentation: "running" }),
        entry({
          sessionId: "closed-1",
          linkId: "l4",
          execution: "closed",
          presentation: "closed",
        }),
        entry({
          sessionId: "avail-2",
          linkId: "l5",
          execution: "awaiting_interaction",
          presentation: "available",
        }),
      ]),
    ]);

    const groups = model.parents[0]?.groups ?? [];
    expect(groups.map((group) => group.key))
      .toEqual(["running", "available", "closed"]);
    expect(groups.map((group) => group.label))
      .toEqual(["Running", "Available", "Closed"]);
    expect(groups[0]?.children.map((child) => child.sessionId))
      .toEqual(["run-1", "run-2"]);
    expect(groups[1]?.children.map((child) => child.sessionId))
      .toEqual(["avail-1", "avail-2"]);
    expect(groups[1]?.children[0]?.detailLabel).toBe("Available");
    expect(groups[2]?.children.map((child) => child.sessionId))
      .toEqual(["closed-1"]);
  });

  it("keeps execution=errored in Available with a truthful Failed detail", () => {
    const model = buildAgentsPaneModel([
      roster("parent-1", [
        entry({
          sessionId: "err-1",
          linkId: "l1",
          execution: "errored",
          presentation: "available",
        }),
      ]),
    ]);

    const available = model.parents[0]?.groups.find((g) => g.key === "available");
    expect(available?.children).toHaveLength(1);
    expect(available?.children[0]?.group).toBe("available");
    expect(available?.children[0]?.detailLabel).toBe("Failed");
  });

  it("exposes only Open for Closed children and Close+Promote otherwise", () => {
    const model = buildAgentsPaneModel([
      roster("parent-1", [
        entry({ sessionId: "run-1", linkId: "l1", presentation: "running" }),
        entry({
          sessionId: "avail-1",
          linkId: "l2",
          execution: "errored",
          presentation: "available",
        }),
        entry({
          sessionId: "closed-1",
          linkId: "l3",
          execution: "closed",
          presentation: "closed",
        }),
      ]),
    ]);

    const children = (model.parents[0]?.groups ?? [])
      .flatMap((group) => group.children);
    const byId = new Map(children.map((child) => [child.sessionId, child]));
    expect(byId.get("run-1")?.actions).toEqual(["close", "promote"]);
    expect(byId.get("avail-1")?.actions).toEqual(["close", "promote"]);
    expect(byId.get("closed-1")?.actions).toEqual(["open"]);
  });
});
