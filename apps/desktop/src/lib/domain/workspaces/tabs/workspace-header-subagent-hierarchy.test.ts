import { describe, expect, it } from "vitest";
import type {
  CoworkManagedWorkspacesResponse,
  SessionSubagentsResponse,
} from "@anyharness/sdk";
import {
  buildWorkspaceHeaderSubagentHierarchy,
  type HeaderHierarchyQueryRow,
} from "@/lib/domain/workspaces/tabs/workspace-header-subagent-hierarchy";
import {
  DELEGATED_AGENT_COLOR_COUNT,
  identiconSeedFromSalt,
  stableIndex,
} from "@/lib/domain/delegated-work/identity";
import {
  delegatedAgentIdenticonCells,
  identiconKey,
} from "@/lib/domain/delegated-work/identicon";

describe("buildWorkspaceHeaderSubagentHierarchy sibling pass", () => {
  it("assigns distinct color indices across the merged subagent + cowork list", () => {
    const hierarchy = buildWorkspaceHeaderSubagentHierarchy({
      rows: [queryRow({ subagentCount: 3, coworkCount: 2 })],
      resolveClientSessionId: (sessionId) => sessionId,
    });

    const children = hierarchy.childrenByParentSessionId.get("parent-1") ?? [];
    expect(children).toHaveLength(5);
    expect(children.map((child) => child.source))
      .toEqual(["subagent", "subagent", "subagent", "cowork", "cowork"]);
    expect(children.map((child) => child.colorIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  it("wraps the color index past the palette size instead of throwing", () => {
    const hierarchy = buildWorkspaceHeaderSubagentHierarchy({
      rows: [queryRow({ subagentCount: DELEGATED_AGENT_COLOR_COUNT + 2, coworkCount: 0 })],
      resolveClientSessionId: (sessionId) => sessionId,
    });

    const children = hierarchy.childrenByParentSessionId.get("parent-1") ?? [];
    expect(children[DELEGATED_AGENT_COLOR_COUNT]?.colorIndex).toBe(0);
    expect(children[DELEGATED_AGENT_COLOR_COUNT + 1]?.colorIndex).toBe(1);
  });

  it("stamps shape salts that leave every sibling with a distinct identicon", () => {
    const hierarchy = buildWorkspaceHeaderSubagentHierarchy({
      rows: [queryRow({ subagentCount: 40, coworkCount: 0 })],
      resolveClientSessionId: (sessionId) => sessionId,
    });

    const children = hierarchy.childrenByParentSessionId.get("parent-1") ?? [];
    const shapeKeys = children.map((child) =>
      identiconKey(delegatedAgentIdenticonCells(
        identiconSeedFromSalt(stableIndex(child.sessionLinkId), child.shapeSalt ?? 0),
      ))
    );

    expect(children).toHaveLength(40);
    expect(new Set(shapeKeys).size).toBe(40);
  });
});

function queryRow(input: {
  subagentCount: number;
  coworkCount: number;
}): HeaderHierarchyQueryRow {
  return {
    sessionId: "parent-1",
    subagentSuccess: true,
    subagentData: subagentsResponse(input.subagentCount),
    reviewSuccess: false,
    reviewData: null,
    coworkSuccess: input.coworkCount > 0,
    coworkData: input.coworkCount > 0 ? coworkResponse(input.coworkCount) : null,
  };
}

function subagentsResponse(count: number): SessionSubagentsResponse {
  return {
    parent: null,
    children: Array.from({ length: count }, (_, index) => ({
      sessionLinkId: `link-subagent-${index}`,
      childSessionId: `child-subagent-${index}`,
      title: `task-${index}`,
      agentKind: "claude",
      status: "running" as const,
      wakeScheduled: false,
      childCreatedAt: "2026-07-01T00:00:00Z",
      linkCreatedAt: "2026-07-01T00:00:00Z",
    })),
  };
}

function coworkResponse(count: number): CoworkManagedWorkspacesResponse {
  return {
    workspaces: [{
      coworkWorkspaceId: "cowork_workspace_1",
      ownershipId: "ownership-1",
      workspaceId: "workspace-1",
      sourceWorkspaceId: "source-1",
      label: "Cowork Workspace",
      createdAt: "2026-07-01T00:00:00Z",
      sessions: Array.from({ length: count }, (_, index) => ({
        coworkAgentId: `cowork_agent_${index}`,
        sessionLinkId: `link-cowork-${index}`,
        codingSessionId: `child-cowork-${index}`,
        title: `cowork-${index}`,
        label: `cowork-${index}`,
        status: "running",
        agentKind: "claude",
        modelId: "sonnet",
        modeId: "default",
        wakeScheduled: false,
        linkCreatedAt: "2026-07-01T00:00:00Z",
        sessionCreatedAt: "2026-07-01T00:00:00Z",
      })),
    }],
  };
}
