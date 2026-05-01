import { describe, expect, it } from "vitest";

import type { WorkspaceRetirePreflightResponse, WorkspaceRetireResponse } from "../types/workspaces.js";
import type { AnyHarnessTransport } from "./core.js";
import { WorkspacesClient } from "./workspaces.js";

const preflightResponse: WorkspaceRetirePreflightResponse = {
  workspaceId: "workspace/1",
  workspaceKind: "worktree",
  lifecycleState: "active",
  cleanupState: "none",
  canRetire: true,
  mergedIntoBase: true,
  baseRef: "origin/main",
  headOid: "head",
  materialized: true,
  blockers: [],
  readinessFingerprint: "fingerprint",
};

const retireResponse: WorkspaceRetireResponse = {
  workspace: {
    id: "workspace/1",
    kind: "worktree",
    repoRootId: "repo-root-1",
    path: "/tmp/workspace",
    surface: "standard",
    sourceRepoRootPath: "/tmp/repo",
    sourceWorkspaceId: null,
    gitProvider: "github",
    gitOwner: "proliferate-ai",
    gitRepoName: "proliferate",
    originalBranch: "main",
    currentBranch: "feature",
    lifecycleState: "retired",
    cleanupState: "complete",
    createdAt: "2026-04-29T00:00:00Z",
    updatedAt: "2026-04-29T00:00:00Z",
  },
  outcome: "retired",
  preflight: preflightResponse,
  cleanupAttempted: true,
  cleanupSucceeded: true,
  cleanupMessage: null,
};

describe("WorkspacesClient retire URLs", () => {
  it("encodes retire preflight workspace ids", async () => {
    const calls: string[] = [];
    const transport = {
      get: async (path: string) => {
        calls.push(path);
        return preflightResponse;
      },
    } as unknown as AnyHarnessTransport;
    const client = new WorkspacesClient(transport);

    await client.retirePreflight("workspace/1");

    expect(calls).toEqual([
      "/v1/workspaces/workspace%2F1/retire/preflight",
    ]);
  });

  it("encodes retire workspace ids", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const transport = {
      post: async (path: string, body: unknown) => {
        calls.push({ path, body });
        return retireResponse;
      },
    } as unknown as AnyHarnessTransport;
    const client = new WorkspacesClient(transport);

    await client.retire("workspace/1");
    await client.retryRetireCleanup("workspace/1");

    expect(calls).toEqual([
      { path: "/v1/workspaces/workspace%2F1/retire", body: {} },
      { path: "/v1/workspaces/workspace%2F1/retire/cleanup-retry", body: {} },
    ]);
  });
});
