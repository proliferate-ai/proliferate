import { describe, expect, it } from "vitest";
import type { CoworkManagedWorkspacesResponse } from "@anyharness/sdk";
import {
  buildCoworkChildRows,
  buildCoworkRelationshipHintSignature,
  coworkResponseSignature,
} from "@/lib/domain/workspaces/tabs/workspace-header-cowork-hierarchy";

describe("workspace header cowork hierarchy", () => {
  it("builds child rows from cowork managed workspace summaries", () => {
    const rows = buildCoworkChildRows(
      [managedWorkspace()],
      "parent-1",
      (sessionId) => sessionId === "runtime-child" ? "client-child" : sessionId,
    );

    expect(rows).toMatchObject([{
      sessionLinkId: "link-1",
      sessionId: "client-child",
      parentSessionId: "parent-1",
      workspaceId: "workspace-1",
      title: "API Surface Check",
      agentKind: "claude",
      source: "cowork",
      meta: "Auth Workspace",
      statusLabel: "Working",
      wakeScheduled: true,
    }]);
  });

  it("builds stable signatures for cowork responses and relationship hints", () => {
    const response: CoworkManagedWorkspacesResponse = {
      workspaces: [managedWorkspace()],
    };

    expect(coworkResponseSignature(response)).toContain("link-1:runtime-child");
    expect(buildCoworkRelationshipHintSignature([
      {
        sessionId: "child-b",
        parentSessionId: "parent",
        sessionLinkId: "link-b",
        workspaceId: "workspace",
      },
      {
        sessionId: "child-a",
        parentSessionId: "parent",
        sessionLinkId: "link-a",
        workspaceId: "workspace",
      },
    ])).toBe("child-a:parent:link-a:workspace|child-b:parent:link-b:workspace");
  });
});

function managedWorkspace(): CoworkManagedWorkspacesResponse["workspaces"][number] {
  return {
    coworkWorkspaceId: "cowork_workspace_1",
    ownershipId: "ownership-1",
    workspaceId: "workspace-1",
    sourceWorkspaceId: "source-1",
    label: "Auth Workspace",
    createdAt: "2026-05-14T00:00:00Z",
    sessions: [{
      coworkAgentId: "cowork_agent_1",
      sessionLinkId: "link-1",
      codingSessionId: "runtime-child",
      title: "fallback title",
      label: "API Surface Check",
      status: "running",
      agentKind: "claude",
      modelId: "sonnet",
      modeId: "default",
      wakeScheduled: true,
      linkCreatedAt: "2026-05-14T00:00:00Z",
      sessionCreatedAt: "2026-05-14T00:00:00Z",
    }],
  };
}
