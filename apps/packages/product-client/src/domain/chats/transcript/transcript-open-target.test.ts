import { describe, expect, it } from "vitest";
import { resolveTranscriptOpenSessionWorkspaceId } from "./transcript-open-target";

describe("resolveTranscriptOpenSessionWorkspaceId", () => {
  it("uses the loaded session slot workspace before the current transcript workspace", () => {
    expect(resolveTranscriptOpenSessionWorkspaceId({
      sessionId: "parent-session",
      role: "agent-parent",
      sessionSlots: {
        "parent-session": { workspaceId: "parent-workspace" },
      },
      fallbackWorkspaceId: "child-workspace",
    })).toBe("parent-workspace");
  });

  it("uses agent creator context for parent links when the source slot is not loaded", () => {
    expect(resolveTranscriptOpenSessionWorkspaceId({
      sessionId: "parent-session",
      role: "agent-parent",
      sessionSlots: {},
      fallbackWorkspaceId: "child-workspace",
      contextWorkspaces: [
        {
          creatorContext: {
            kind: "agent",
            sourceSessionId: "parent-session",
            sourceSessionWorkspaceId: "parent-workspace",
          },
        },
      ],
    })).toBe("parent-workspace");
  });

  it("does not route unresolved parent links to the child workspace", () => {
    expect(resolveTranscriptOpenSessionWorkspaceId({
      sessionId: "parent-session",
      role: "agent-parent",
      sessionSlots: {},
      fallbackWorkspaceId: "child-workspace",
    })).toBeNull();
  });

  it("falls back to the current workspace for linked child sessions", () => {
    expect(resolveTranscriptOpenSessionWorkspaceId({
      sessionId: "child-session",
      role: "linked-child",
      sessionSlots: {},
      fallbackWorkspaceId: "parent-workspace",
    })).toBe("parent-workspace");
  });
});
