import { describe, expect, it } from "vitest";
import type { SidebarWorkspaceItemState } from "@/lib/domain/workspaces/sidebar/sidebar-model";
import { resolveMoveWorkspaceTargetId } from "./SidebarWorkspaceContent";

// Direction-aware move entry point (spec section 2.6, "Direction inference at the
// entry points"): a local/worktree row moves local->cloud with its own AnyHarness id;
// a cloud row moves cloud->local with the `cloud:<id>` synthetic form `resolveMoveDirection`
// expects -- mirroring how the local branch already uses `item.localWorkspaceId` rather
// than the logical `item.id`.

function makeItem(overrides: Partial<SidebarWorkspaceItemState>): SidebarWorkspaceItemState {
  return {
    id: "logical-1",
    localWorkspaceId: null,
    cloudWorkspaceId: null,
    name: "workspace",
    defaultName: "workspace",
    hasDisplayNameOverride: false,
    renameSupported: true,
    subtitle: null,
    active: false,
    archived: false,
    variant: "local",
    statusIndicator: null,
    detailIndicators: [],
    cloudStatus: null,
    lastInteracted: null,
    needsReview: false,
    workspaceLocationCopyLabel: null,
    workspaceLocationCopyValue: null,
    workspaceLocationCopyToastLabel: null,
    branchName: null,
    gitStatus: null,
    ...overrides,
  };
}

describe("resolveMoveWorkspaceTargetId", () => {
  it("returns the local AnyHarness id for a local workspace", () => {
    const item = makeItem({ variant: "local", localWorkspaceId: "local-ws-1" });
    expect(resolveMoveWorkspaceTargetId(item)).toBe("local-ws-1");
  });

  it("returns the local AnyHarness id for a worktree workspace", () => {
    const item = makeItem({ variant: "worktree", localWorkspaceId: "worktree-ws-1" });
    expect(resolveMoveWorkspaceTargetId(item)).toBe("worktree-ws-1");
  });

  it("returns the cloud synthetic id for a cloud workspace", () => {
    const item = makeItem({ variant: "cloud", cloudWorkspaceId: "cloud-ws-1" });
    expect(resolveMoveWorkspaceTargetId(item)).toBe("cloud:cloud-ws-1");
  });

  it("returns null for an archived workspace regardless of variant", () => {
    const local = makeItem({ variant: "local", localWorkspaceId: "local-ws-1", archived: true });
    const cloud = makeItem({ variant: "cloud", cloudWorkspaceId: "cloud-ws-1", archived: true });
    expect(resolveMoveWorkspaceTargetId(local)).toBeNull();
    expect(resolveMoveWorkspaceTargetId(cloud)).toBeNull();
  });

  it("returns null while a turn is running (blocking status kind)", () => {
    const item = makeItem({
      variant: "cloud",
      cloudWorkspaceId: "cloud-ws-1",
      statusIndicator: { kind: "iterating", tooltip: "Agent is working" },
    });
    expect(resolveMoveWorkspaceTargetId(item)).toBeNull();
  });

  it("returns null for a cloud workspace with no cloudWorkspaceId", () => {
    const item = makeItem({ variant: "cloud", cloudWorkspaceId: null });
    expect(resolveMoveWorkspaceTargetId(item)).toBeNull();
  });

  it("returns null for an ssh workspace (unsupported move source in v1)", () => {
    const item = makeItem({ variant: "ssh" });
    expect(resolveMoveWorkspaceTargetId(item)).toBeNull();
  });
});
