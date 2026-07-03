import { describe, expect, it } from "vitest";
import { buildLogicalWorkspaces } from "@/lib/domain/workspaces/cloud/logical-workspaces";
import {
  makeCloudWorkspace,
  makeRepoRoot,
  makeWorkspace,
} from "@/lib/domain/workspaces/sidebar/sidebar-test-fixtures";
import {
  resolveWorkspaceShellStateKey,
  resolveWorkspaceUiKey,
} from "./workspace-ui-key";

describe("workspace ui keys", () => {
  it("uses the logical workspace key for selected shell state", () => {
    expect(resolveWorkspaceShellStateKey({
      workspaceId: "materialized-workspace",
      selectedWorkspaceId: "materialized-workspace",
      selectedLogicalWorkspaceId: "logical-workspace",
    })).toBe("logical-workspace");
  });

  it("uses an explicit shell workspace key before selected identity", () => {
    expect(resolveWorkspaceShellStateKey({
      workspaceId: "materialized-workspace",
      shellWorkspaceId: "explicit-shell",
      selectedWorkspaceId: "materialized-workspace",
      selectedLogicalWorkspaceId: "logical-workspace",
    })).toBe("explicit-shell");
  });

  it("falls back to materialized workspace ids for unselected shell writes", () => {
    expect(resolveWorkspaceShellStateKey({
      workspaceId: "other-workspace",
      selectedWorkspaceId: "materialized-workspace",
      selectedLogicalWorkspaceId: "logical-workspace",
    })).toBe("other-workspace");
  });

  it("resolves the workspace ui key from logical identity first", () => {
    expect(resolveWorkspaceUiKey("logical-workspace", "materialized-workspace"))
      .toBe("logical-workspace");
  });
});

// The scratch pad keys notes off `workspaceUiKey` (workspace-migration-v2.md
// §2.5), which resolves to the *logical* workspace id — built from
// (provider, owner, repo, branch), not from any local/cloud materialization
// record. A workspace_move round-trip only ever swaps which materialization
// backs a logical workspace; it never changes that identity tuple. This pins
// the "scratch survives migration with zero code" guarantee: the resolved ui
// key (= scratch pad key) is identical whether the logical workspace is
// currently materialized locally or as a cloud workspace.
describe("scratch pad key stability across local <-> cloud migration", () => {
  it("resolves the same workspace ui key for a local-only and a cloud-only materialization of the same logical workspace", () => {
    const repoRoot = makeRepoRoot();
    const localWorkspace = makeWorkspace({
      id: "local-1",
      branch: "gannet",
    });
    const cloudWorkspace = makeCloudWorkspace({
      id: "cloud-1",
      branch: "gannet",
    });

    // Shape A: the workspace as it looks before a move — materialized locally
    // only (e.g. a fresh desktop checkout, or the moment after a cloud->local
    // move's cutover has archived the cloud row).
    const beforeMove = buildLogicalWorkspaces({
      localWorkspaces: [localWorkspace],
      repoRoots: [repoRoot],
      cloudWorkspaces: [],
      currentSelectionId: null,
    })[0]!;

    // Shape B: the same logical workspace after a local->cloud move's
    // cutover — materialized as a cloud workspace only, no local record left.
    const afterMove = buildLogicalWorkspaces({
      localWorkspaces: [],
      repoRoots: [],
      cloudWorkspaces: [cloudWorkspace],
      currentSelectionId: null,
    })[0]!;

    expect(beforeMove.id).toBe(afterMove.id);

    const scratchKeyBeforeMove = resolveWorkspaceUiKey(
      beforeMove.id,
      beforeMove.preferredMaterializationId,
    );
    const scratchKeyAfterMove = resolveWorkspaceUiKey(
      afterMove.id,
      afterMove.preferredMaterializationId,
    );

    expect(scratchKeyBeforeMove).toBe(scratchKeyAfterMove);
    expect(scratchKeyBeforeMove).toBe(beforeMove.id);
  });
});
