import { describe, expect, it } from "vitest";
import {
  isUsableWorkspace,
} from "@/lib/domain/workspaces/display/usability";
import type { Workspace } from "@anyharness/sdk";

function makeWorkspace(overrides: Partial<Workspace>): Workspace {
  return {
    id: "workspace-1",
    kind: "local",
    repoRootId: "repo-root-1",
    path: "/tmp/repo",
    surface: "standard",
    lifecycleState: "active",
    cleanupState: "none",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("workspace usability", () => {
  it("keeps worktrees usable", () => {
    const workspace = makeWorkspace({
      id: "worktree-1",
      kind: "worktree",
      path: "/tmp/repo-feature",
    });

    expect(isUsableWorkspace(workspace)).toBe(true);
  });

  it("keeps local workspaces usable", () => {
    const workspace = makeWorkspace({
      id: "local-1",
      kind: "local",
    });

    expect(isUsableWorkspace(workspace)).toBe(true);
  });
});
