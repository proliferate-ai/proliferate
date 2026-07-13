import { test } from "node:test";
import assert from "node:assert/strict";

import {
  detectOrigin,
  createRunIdentity,
  createShardIdentity,
  parseShardFlag,
} from "./identity.js";

const HASH = "a".repeat(64);

test("local origin detection uses the hostname", () => {
  const origin = detectOrigin({}, "laptop-1");
  assert.equal(origin.executionHost, "local");
  assert.equal(origin.origin, "local:laptop-1");
});

test("GitHub Actions origin detection builds the traceable run URL", () => {
  const origin = detectOrigin(
    {
      GITHUB_ACTIONS: "true",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "proliferate/proliferate",
      GITHUB_RUN_ID: "12345",
      GITHUB_RUN_ATTEMPT: "2",
    },
    "runner-x",
  );
  assert.equal(origin.executionHost, "github-actions");
  assert.equal(origin.origin, "https://github.com/proliferate/proliferate/actions/runs/12345/attempts/2");
});

test("local run identity is unique per nonce; GitHub run identity derives deterministically from env", () => {
  const now = () => new Date("2026-07-13T12:00:00.000Z");
  const local = createRunIdentity({
    sourceSha: "0123456789abcdefdeadbeef",
    candidateManifestHash: HASH,
    retainedManifestHash: null,
    env: {},
    hostname: "laptop-1",
    now,
    localNonce: "nonce1",
  });
  assert.equal(local.executionHost, "local");
  assert.equal(local.runId, "local-0123456789ab-nonce1");
  assert.equal(local.createdAt, "2026-07-13T12:00:00.000Z");
  assert.equal(local.origin, "local:laptop-1");

  const gh = createRunIdentity({
    sourceSha: "0123456789abcdefdeadbeef",
    candidateManifestHash: HASH,
    retainedManifestHash: null,
    env: { GITHUB_ACTIONS: "true", GITHUB_RUN_ID: "777", GITHUB_RUN_ATTEMPT: "1" },
    hostname: "runner",
    now,
  });
  assert.equal(gh.executionHost, "github-actions");
  assert.equal(gh.runId, "gh-777-1");
  // Deterministic: same env yields the same runId.
  const gh2 = createRunIdentity({
    sourceSha: "different-sha",
    candidateManifestHash: HASH,
    retainedManifestHash: null,
    env: { GITHUB_ACTIONS: "true", GITHUB_RUN_ID: "777", GITHUB_RUN_ATTEMPT: "1" },
    now,
  });
  assert.equal(gh2.runId, "gh-777-1");
});

test("a one-shard run still carries an explicit shard-1-of-1 identity", () => {
  const shard = createShardIdentity({ runId: "r", shardIndex: 1, shardCount: 1 });
  assert.equal(shard.shardId, "shard-1-of-1");
  assert.equal(shard.shardIndex, 1);
  assert.equal(shard.shardCount, 1);
});

test("createShardIdentity rejects out-of-range shards", () => {
  assert.throws(() => createShardIdentity({ runId: "r", shardIndex: 0, shardCount: 4 }), /shardIndex/);
  assert.throws(() => createShardIdentity({ runId: "r", shardIndex: 5, shardCount: 4 }), /shardIndex/);
  assert.throws(() => createShardIdentity({ runId: "r", shardIndex: 1, shardCount: 0 }), /shardCount/);
});

test("parseShardFlag parses i/n and rejects malformed input", () => {
  assert.deepEqual(parseShardFlag("2/4"), { shardIndex: 2, shardCount: 4 });
  assert.throws(() => parseShardFlag("2-4"), /i\/n/);
  assert.throws(() => parseShardFlag("5/4"), /1 <= i <= n/);
});
