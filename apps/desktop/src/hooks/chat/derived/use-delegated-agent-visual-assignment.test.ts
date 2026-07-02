import { describe, expect, it } from "vitest";
import { delegatedAgentVisualAssignmentFromChildren } from "@/hooks/chat/derived/use-delegated-agent-visual-assignment";

const CHILDREN = [
  { sessionLinkId: "link-a", childSessionId: "child-a" },
  { sessionLinkId: "link-b", childSessionId: "child-b" },
  { sessionLinkId: "link-c", childSessionId: "child-c" },
];

describe("delegatedAgentVisualAssignmentFromChildren", () => {
  it("resolves the sibling position as the color index", () => {
    expect(delegatedAgentVisualAssignmentFromChildren(CHILDREN, "link-a").colorIndex).toBe(0);
    expect(delegatedAgentVisualAssignmentFromChildren(CHILDREN, "link-c").colorIndex).toBe(2);
  });

  it("returns a defined shape salt for known links", () => {
    const assignment = delegatedAgentVisualAssignmentFromChildren(CHILDREN, "link-b");

    expect(assignment.shapeSalt).toBeDefined();
    expect(assignment.shapeSalt).toBeGreaterThanOrEqual(0);
  });

  it("returns an empty assignment for unknown links or missing data", () => {
    expect(delegatedAgentVisualAssignmentFromChildren(CHILDREN, "link-zzz")).toEqual({});
    expect(delegatedAgentVisualAssignmentFromChildren(undefined, "link-a")).toEqual({});
    expect(delegatedAgentVisualAssignmentFromChildren(CHILDREN, null)).toEqual({});
  });
});
