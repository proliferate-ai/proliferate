import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";

import { createRuntimeHarness, type RuntimeHarness } from "../../harness/runtime-harness.js";

describe("runtime workspace operations", () => {
  let harness!: RuntimeHarness;
  const notesPath = "anyharness-cloud-runtime-notes.md";

  beforeAll(async () => {
    harness = await createRuntimeHarness({ requireAgents: false });
  });

  afterAll(async () => {
    await harness?.close();
  });

  it("supports file, git, and worktree flows against a real repo", async () => {
    const workspace = await harness.createTestWorkspace("workspace-ops");
    const worktreePath = `${workspace.path}-feature`;

    try {
      const resolved = await harness.client.workspaces.resolveFromPath(workspace.path);
      const workspaceId = resolved.workspace.id;
      const repoRootId = resolved.repoRoot.id;

      const write = await harness.client.files.write(workspaceId, {
        path: notesPath,
        content: "hello from anyharness\n",
        expectedVersionToken: "",
      });
      expect(write.path).toBe(notesPath);

      const read = await harness.client.files.read(workspaceId, notesPath);
      expect(read.content).toBe("hello from anyharness\n");

      const statusBeforeStage = await harness.client.git.getStatus(workspaceId);
      expect(statusBeforeStage.files.length).toBeGreaterThan(0);

      await harness.client.git.stagePaths(workspaceId, [notesPath]);
      const commit = await harness.client.git.commit(workspaceId, {
        summary: "Add notes",
      });
      expect(commit.summary).toBe("Add notes");

      const statusAfterCommit = await harness.client.git.getStatus(workspaceId);
      expect(statusAfterCommit.files.length).toBe(0);

      const worktreeResponse = await harness.client.workspaces.createWorktree({
        repoRootId,
        targetPath: worktreePath,
        newBranchName: "feature/test-worktree",
      });
      expect(worktreeResponse.workspace.kind).toBe("worktree");
      expect(worktreeResponse.workspace.repoRootId).toBe(repoRootId);
    } finally {
      if (workspace.pathAccess === "local") {
        await rm(worktreePath, { recursive: true, force: true });
      }
      await workspace.cleanup();
    }
  });
});
