import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";

import { createRuntimeHarness, type RuntimeHarness } from "../../harness/runtime-harness.js";

describe("runtime workspace operations", () => {
  let harness!: RuntimeHarness;

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

      const write = await harness.client.files.write(resolved.id, {
        path: "notes.txt",
        content: "hello from anyharness\n",
        expectedVersionToken: "",
      });
      expect(write.path).toBe("notes.txt");

      const read = await harness.client.files.read(resolved.id, "notes.txt");
      expect(read.content).toBe("hello from anyharness\n");

      const statusBeforeStage = await harness.client.git.getStatus(resolved.id);
      expect(statusBeforeStage.files.length).toBeGreaterThan(0);

      await harness.client.git.stagePaths(resolved.id, ["notes.txt"]);
      const commit = await harness.client.git.commit(resolved.id, {
        summary: "Add notes",
      });
      expect(commit.summary).toBe("Add notes");

      const statusAfterCommit = await harness.client.git.getStatus(resolved.id);
      expect(statusAfterCommit.files.length).toBe(0);

      const worktreeResponse = await harness.client.workspaces.createWorktree({
        sourceWorkspaceId: resolved.id,
        targetPath: worktreePath,
        newBranchName: "feature/test-worktree",
      });
      expect(worktreeResponse.workspace.kind).toBe("worktree");
      expect(worktreeResponse.workspace.sourceWorkspaceId).toBe(resolved.id);
    } finally {
      if (workspace.pathAccess === "local") {
        await rm(worktreePath, { recursive: true, force: true });
      }
      await workspace.cleanup();
    }
  });
});
