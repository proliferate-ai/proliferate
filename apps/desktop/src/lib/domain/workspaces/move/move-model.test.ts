import { describe, expect, it } from "vitest";
import { resolveHandoffMoveId, sourceFateForWorkspaceKind } from "./move-model";

describe("resolveHandoffMoveId", () => {
  it("returns null when there is no runtime state", () => {
    expect(resolveHandoffMoveId(null)).toBeNull();
    expect(resolveHandoffMoveId(undefined)).toBeNull();
  });

  it("returns null for a workspace in normal mode", () => {
    expect(resolveHandoffMoveId({ mode: "normal", handoffOpId: null })).toBeNull();
  });

  it("returns null for a remote_owned workspace (move already completed)", () => {
    expect(resolveHandoffMoveId({ mode: "remote_owned", handoffOpId: null })).toBeNull();
  });

  it("recovers the move id from a frozen-for-handoff runtime state -- the 'Desktop was killed mid-move' recovery path", () => {
    expect(resolveHandoffMoveId({ mode: "frozen_for_handoff", handoffOpId: "move-123" })).toBe(
      "move-123",
    );
  });

  it("returns null if frozen but the engine never recorded a handoff id", () => {
    expect(resolveHandoffMoveId({ mode: "frozen_for_handoff", handoffOpId: null })).toBeNull();
  });
});

describe("sourceFateForWorkspaceKind", () => {
  it("destroys managed worktrees", () => {
    expect(sourceFateForWorkspaceKind("worktree")).toBe("destroy");
  });

  it("only marks plain local-directory workspaces remote_owned", () => {
    expect(sourceFateForWorkspaceKind("local")).toBe("mark_remote_owned");
  });
});
