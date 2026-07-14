import assert from "node:assert/strict";
import { test } from "node:test";

import { preparedRepository, type PreparedRepositoryTransport } from "./prepared-repository.js";
import type { ReadyLocalWorld } from "../worlds/local-workspace/world.js";
import type { AuthenticatedActor } from "./authenticated-actor.js";

function fakeWorld(): ReadyLocalWorld {
  return {
    kind: "local-workspace",
    run: {
      run_id: "local-run-1",
      shard_id: "local-0",
      attempt: 1,
      source_sha: "a".repeat(40),
      origin: { kind: "local", github_run_id: null, github_job: null },
    },
    artifacts: undefined as never,
    api: undefined as never,
    runtime: { baseUrl: "http://127.0.0.1:9002", client: undefined as never },
    renderer: undefined as never,
    gateway: undefined as never,
    paths: {
      runDir: "/tmp/run-1",
      runtimeHome: "/tmp/run-1/runtime-home",
      repositoriesDir: "/tmp/run-1/repositories",
    },
    close: async () => {
      throw new Error("not used in this test");
    },
  };
}

function fakeActor(): AuthenticatedActor {
  return {
    role: "owner",
    userId: "user-1",
    organizationId: "org-1",
    enrollmentId: "enrollment-1",
    api: undefined as never,
    session: undefined as never,
    gatewayKey: undefined as never,
  };
}

function fakeTransport(): { transport: PreparedRepositoryTransport; calls: string[] } {
  const calls: string[] = [];
  const transport: PreparedRepositoryTransport = {
    ensureCleanDir: async (dirPath) => {
      calls.push(`ensureCleanDir:${dirPath}`);
    },
    cloneAndCheckout: async (repoUrl, commit, destDir) => {
      calls.push(`cloneAndCheckout:${repoUrl}:${commit}:${destDir}`);
    },
    resolveRepoRoot: async (runtimeBaseUrl, repoPath) => {
      calls.push(`resolveRepoRoot:${runtimeBaseUrl}:${repoPath}`);
      return { id: "repo-root-1" };
    },
  };
  return { transport, calls };
}

test("preparedRepository clones into a cell-scoped subdirectory of the world's repositoriesDir, checks out the pinned commit, and resolves the repo root", async () => {
  const world = fakeWorld();
  const { transport, calls } = fakeTransport();

  const repo = await preparedRepository(
    world,
    fakeActor(),
    { repoUrl: "https://github.com/example/fixture.git", commit: "deadbeef", cellId: "harness=claude" },
    transport,
  );

  assert.equal(repo.repoUrl, "https://github.com/example/fixture.git");
  assert.equal(repo.commit, "deadbeef");
  assert.equal(repo.repoRootId, "repo-root-1");
  assert.equal(repo.path, "/tmp/run-1/repositories/harness%3Dclaude");

  assert.deepEqual(calls, [
    "ensureCleanDir:/tmp/run-1/repositories/harness%3Dclaude",
    "cloneAndCheckout:https://github.com/example/fixture.git:deadbeef:/tmp/run-1/repositories/harness%3Dclaude",
    "resolveRepoRoot:http://127.0.0.1:9002:/tmp/run-1/repositories/harness%3Dclaude",
  ]);
});

test("preparedRepository defaults cellId so two calls without one collide on the same directory (caller must pass distinct cellIds for concurrency)", async () => {
  const world = fakeWorld();
  const { transport } = fakeTransport();
  const repo = await preparedRepository(world, fakeActor(), undefined, transport);
  assert.equal(repo.path, "/tmp/run-1/repositories/default");
});

test("preparedRepository propagates a clone failure without masking it", async () => {
  const world = fakeWorld();
  const { transport } = fakeTransport();
  transport.cloneAndCheckout = async () => {
    throw new Error("git clone ... failed (128): Repository not found.");
  };
  await assert.rejects(() => preparedRepository(world, fakeActor(), {}, transport), /Repository not found/);
});

test("preparedRepository propagates a repo-root resolution failure without masking it", async () => {
  const world = fakeWorld();
  const { transport } = fakeTransport();
  transport.resolveRepoRoot = async () => {
    throw new Error("POST /v1/repo-roots/resolve -> 400: REPO_ROOT_NOT_GIT_REPO");
  };
  await assert.rejects(() => preparedRepository(world, fakeActor(), {}, transport), /REPO_ROOT_NOT_GIT_REPO/);
});
