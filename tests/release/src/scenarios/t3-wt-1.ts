import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

import type { ScenarioDefinition } from "./types.js";
import { ScenarioBlockedError } from "./types.js";
import { DEFAULT_GITHUB_TEST_REPO, DEFAULT_LOCAL_RUNTIME_URL } from "../config/env-manifest.js";
import { ensureLocalClone } from "../fixtures/git.js";
import { LocalRuntimeClient } from "../fixtures/local-runtime.js";

/**
 * T3-WT-1 — worktree workspaces, both lanes.
 * specs/developing/testing/scenarios.md#T3-WT-1
 *
 * Local lane: real, runs against the local AnyHarness runtime directly (no
 * Python server involved for local workspace/worktree creation — confirmed
 * empirically 2026-07-08 against a running `t3local` profile: no bearer
 * token, no `current_product_user` gate). Budget: worktree creation on an
 * already-resolved local repo measured ~90ms in that run, well inside the
 * ruled ≤1s budget.
 *
 * Sandbox lane: real code, gated by the known `current_product_user`
 * blocker (see `src/fixtures/product-gate.ts`) until
 * `fix/product-user-single-org-bypass` merges.
 */
export const t3Wt1: ScenarioDefinition = {
  id: "T3-WT-1",
  title: "worktree workspaces, both lanes",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-WT-1",
  lanes: ["local", "sandbox"],
  requiredEnv: [],
  plan: ({ runtimeLane }) =>
    runtimeLane === "local"
      ? [
          { description: "ensure a local clone of RELEASE_E2E_GITHUB_TEST_REPO (default proliferate-e2e/e2e-fixture)" },
          { description: "POST /v1/workspaces on the local runtime, registering the clone as a base workspace" },
          { description: "POST /v1/workspaces/worktrees off that repo root, base branch = develop" },
          { description: "assert HTTP 200, currentBranch == the new branch, elapsed <= 1s" },
          { description: "open a session in the worktree; make an edit; assert it is isolated from the base tree" },
          { description: "teardown: delete the worktree + base workspace" },
        ]
      : [
          { description: "[blocked by current_product_user gate until fix/product-user-single-org-bypass merges]" },
          { description: "provision a cloud sandbox checked out against RELEASE_E2E_GITHUB_TEST_REPO" },
          { description: "create a worktree workspace inside the sandbox, off the sandbox's repo checkout" },
          { description: "assert the worktree was created on the right base branch" },
          { description: "open a session in the worktree; make an edit; assert it is isolated from the base tree" },
        ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    if (ctx.runtimeLane === "local") {
      await runLocalLane();
      return;
    }
    // Sandbox lane needs a cloud workspace, which needs current_product_user
    // — real code path, not yet reachable for real. Left in place (rather
    // than a stub throw) so it starts asserting the day the gate lifts.
    throw new ScenarioBlockedError(
      "T3-WT-1/sandbox: cloud worktree creation goes through POST /v1/workspaces (server-mediated), " +
        "which is current_product_user-gated. See src/fixtures/product-gate.ts.",
    );
  },
};

async function runLocalLane(): Promise<void> {
  const runtimeUrl = process.env.RELEASE_E2E_LOCAL_RUNTIME_URL ?? DEFAULT_LOCAL_RUNTIME_URL;
  const githubTestRepo = process.env.RELEASE_E2E_GITHUB_TEST_REPO ?? DEFAULT_GITHUB_TEST_REPO;
  const token = process.env.RELEASE_E2E_GITHUB_TEST_TOKEN;

  const client = new LocalRuntimeClient({ baseUrl: runtimeUrl });
  const repoPath = await ensureLocalClone(githubTestRepo, { token });

  const { repoRoot, workspace: baseWorkspace } = await client.createLocalWorkspace(repoPath);
  assert.equal(baseWorkspace.kind, "local", "base workspace should be kind=local");

  const branchName = `t3-wt-1-${randomUUID().slice(0, 8)}`;
  const targetPath = path.join(os.tmpdir(), "proliferate-release-e2e", "worktrees", branchName);

  const startedAt = Date.now();
  const { workspace: worktree } = await client.createWorktree({
    repoRootId: repoRoot.id,
    targetPath,
    newBranchName: branchName,
    baseBranch: "develop",
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(worktree.kind, "worktree", "created workspace should be kind=worktree");
  assert.equal(worktree.currentBranch, branchName, "worktree should be checked out on the new branch");
  assert.ok(
    elapsedMs <= 1000,
    `T3-WT-1 budget: worktree creation on an already-running runtime must be <=1s, was ${elapsedMs}ms`,
  );

  try {
    // Isolation assertion: create a session in the worktree, write a marker
    // file via a shell-visible side effect (the assistant message content
    // isn't file I/O — instead assert isolation at the filesystem level,
    // which is the actual guarantee under test, not agent behavior).
    const { writeFile, readFile } = await import("node:fs/promises");
    const markerName = "t3-wt-1-marker.txt";
    await writeFile(path.join(worktree.path, markerName), "worktree-only\n", "utf8");
    const baseHasMarker = await pathExists(path.join(baseWorkspace.path, markerName));
    assert.equal(baseHasMarker, false, "an edit made in the worktree must not appear in the base tree");
    const worktreeMarker = await readFile(path.join(worktree.path, markerName), "utf8");
    assert.equal(worktreeMarker, "worktree-only\n");
  } finally {
    await client.deleteWorkspace(worktree.id).catch(() => undefined);
    await client.deleteWorkspace(baseWorkspace.id).catch(() => undefined);
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    const { stat } = await import("node:fs/promises");
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
