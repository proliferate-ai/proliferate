import { describe, expect, it } from "vitest";
import {
  resolveHandoffMoveId,
  resolveMoveDirection,
  resolvePostMoveNavigation,
  sourceFateForWorkspaceKind,
} from "./move-model";

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

describe("resolvePostMoveNavigation", () => {
  it("does nothing when the moved workspace is not the one on screen", () => {
    expect(resolvePostMoveNavigation({
      movedWorkspaceId: "ws-1",
      selectedWorkspaceId: "ws-2",
      destinationCloudWorkspaceId: "cloud-ws-1",
    })).toEqual({ kind: "none" });
  });

  it("does nothing when nothing is selected", () => {
    expect(resolvePostMoveNavigation({
      movedWorkspaceId: "ws-1",
      selectedWorkspaceId: null,
      destinationCloudWorkspaceId: "cloud-ws-1",
    })).toEqual({ kind: "none" });
  });

  it("hands off to the new cloud workspace when the moved workspace was on screen", () => {
    expect(resolvePostMoveNavigation({
      movedWorkspaceId: "ws-1",
      selectedWorkspaceId: "ws-1",
      destinationCloudWorkspaceId: "cloud-ws-1",
    })).toEqual({ kind: "select_cloud", cloudWorkspaceId: "cloud-ws-1" });
  });

  it("falls back to home when the on-screen source moved but its destination id is unknown", () => {
    expect(resolvePostMoveNavigation({
      movedWorkspaceId: "ws-1",
      selectedWorkspaceId: "ws-1",
      destinationCloudWorkspaceId: null,
    })).toEqual({ kind: "home" });
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

describe("resolveMoveDirection", () => {
  it("resolves local_to_cloud for a plain local workspace id", () => {
    expect(resolveMoveDirection("ws-1")).toBe("local_to_cloud");
  });

  it("resolves cloud_to_local for a cloud synthetic workspace id", () => {
    expect(resolveMoveDirection("cloud:ws-1")).toBe("cloud_to_local");
  });

  it("returns null when there is no workspace id", () => {
    expect(resolveMoveDirection(null)).toBeNull();
  });

  it("returns null for an SSH target synthetic id (unsupported move source in v1)", () => {
    expect(resolveMoveDirection("target:target-1:ws-1")).toBeNull();
  });
});
