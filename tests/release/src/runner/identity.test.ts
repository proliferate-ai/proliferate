import assert from "node:assert/strict";
import { test } from "node:test";

import { IdentityError, isSafeId, resolveRunIdentity } from "./identity.js";

const FULL_SHA = "a".repeat(40);

function githubEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_RUN_ID: "123456",
    GITHUB_JOB: "release-e2e-local",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_SHA: FULL_SHA,
    ...overrides,
  };
}

const gitHead = async () => `${"b".repeat(40)}\n`;

test("derives GitHub identity: run id excludes GITHUB_RUN_ATTEMPT", async () => {
  const identity = await resolveRunIdentity({ env: githubEnv() });
  assert.equal(identity.run_id, "123456");
  assert.equal(identity.shard_id, "release-e2e-local");
  assert.equal(identity.attempt, 2);
  assert.equal(identity.source_sha, FULL_SHA);
  assert.deepEqual(identity.origin, {
    kind: "github_actions",
    github_run_id: "123456",
    github_job: "release-e2e-local",
  });
});

test("GitHub origin applies only when GITHUB_ACTIONS === \"true\"", async () => {
  const identity = await resolveRunIdentity({
    env: { GITHUB_ACTIONS: "false", GITHUB_RUN_ID: "999" },
    resolveGitHead: gitHead,
  });
  assert.equal(identity.origin.kind, "local");

  const alsoLocal = await resolveRunIdentity({
    env: { GITHUB_RUN_ID: "999" },
    resolveGitHead: gitHead,
  });
  assert.equal(alsoLocal.origin.kind, "local");
});

test("rejects incomplete GitHub context", async () => {
  for (const missing of ["GITHUB_RUN_ID", "GITHUB_JOB", "GITHUB_RUN_ATTEMPT", "GITHUB_SHA"]) {
    const env = githubEnv();
    delete env[missing];
    await assert.rejects(resolveRunIdentity({ env }), IdentityError);
  }
});

test("rejects a malformed GITHUB_SHA and GITHUB_RUN_ATTEMPT", async () => {
  await assert.rejects(resolveRunIdentity({ env: githubEnv({ GITHUB_SHA: "abc123" }) }), IdentityError);
  await assert.rejects(
    resolveRunIdentity({ env: githubEnv({ GITHUB_RUN_ATTEMPT: "zero" }) }),
    IdentityError,
  );
});

test("derives local defaults: generated run id, local-0, attempt 1, git HEAD", async () => {
  const identity = await resolveRunIdentity({
    env: {},
    resolveGitHead: gitHead,
    now: () => new Date("2026-07-13T01:02:03Z"),
  });
  assert.match(identity.run_id, /^local-20260713T010203Z-[0-9a-f]{6}$/);
  assert.equal(identity.shard_id, "local-0");
  assert.equal(identity.attempt, 1);
  assert.equal(identity.source_sha, "b".repeat(40));
  assert.deepEqual(identity.origin, { kind: "local", github_run_id: null, github_job: null });
});

test("failure to resolve a local source SHA is an identity error", async () => {
  await assert.rejects(
    resolveRunIdentity({ env: {}, resolveGitHead: async () => { throw new Error("not a git repo"); } }),
    IdentityError,
  );
  await assert.rejects(
    resolveRunIdentity({ env: {}, resolveGitHead: async () => "short-sha" }),
    IdentityError,
  );
});

test("explicit overrides win without changing the recorded origin", async () => {
  const identity = await resolveRunIdentity({
    env: githubEnv(),
    overrides: { runId: "release-42", shardId: "shard-3", attempt: 5 },
  });
  assert.equal(identity.run_id, "release-42");
  assert.equal(identity.shard_id, "shard-3");
  assert.equal(identity.attempt, 5);
  assert.equal(identity.origin.kind, "github_actions");
  assert.equal(identity.origin.github_run_id, "123456");
  assert.equal(identity.source_sha, FULL_SHA);
});

test("two shards can share one run id, and a retry preserves the logical run", async () => {
  const shardA = await resolveRunIdentity({
    env: {},
    resolveGitHead: gitHead,
    overrides: { runId: "release-42", shardId: "shard-a" },
  });
  const shardB = await resolveRunIdentity({
    env: {},
    resolveGitHead: gitHead,
    overrides: { runId: "release-42", shardId: "shard-b", attempt: 2 },
  });
  assert.equal(shardA.run_id, shardB.run_id);
  assert.notEqual(shardA.shard_id, shardB.shard_id);
  assert.equal(shardB.attempt, 2);
});

test("rejects invalid override ids and attempts", async () => {
  await assert.rejects(
    resolveRunIdentity({ env: {}, resolveGitHead: gitHead, overrides: { runId: "-bad" } }),
    IdentityError,
  );
  await assert.rejects(
    resolveRunIdentity({ env: {}, resolveGitHead: gitHead, overrides: { shardId: "has space" } }),
    IdentityError,
  );
  await assert.rejects(
    resolveRunIdentity({ env: {}, resolveGitHead: gitHead, overrides: { attempt: 0 } }),
    IdentityError,
  );
});

test("isSafeId enforces the documented pattern", () => {
  assert.ok(isSafeId("a"));
  assert.ok(isSafeId("release-42.b_1"));
  assert.ok(!isSafeId(""));
  assert.ok(!isSafeId(".leading-dot"));
  assert.ok(!isSafeId("x".repeat(129)));
  assert.ok(isSafeId("x".repeat(128)));
});
