import assert from "node:assert/strict";
import { test } from "node:test";

import type { ActorKeyIdentity } from "../../services/qualification-litellm.js";
import type { BoxExec } from "./box-exec.js";
import {
  actorEnrollmentIntent,
  bindActorEnrollment,
  decodeActorEnrollmentCustody,
  encodeActorEnrollmentCustody,
  resolveActorEnrollmentOnBox,
} from "./actor-enrollment-custody.js";

const RUN = {
  run_id: "run-1", shard_id: "shard-1", attempt: 1, source_sha: "a".repeat(40),
  origin: { kind: "local" as const, github_run_id: null, github_job: null },
};

function box(stdout: string): BoxExec {
  return {
    exec: async () => ({ stdout: "", stderr: "" }),
    putSecretFile: async () => "/tmp/x",
    readRemoteFile: async () => "",
    removeRemoteFile: async () => undefined,
    serverPython: async (_script, options) => {
      assert.equal(options?.env?.QUAL_ACTOR_EMAIL, "qual-owner-run-1-shard-1@example.com");
      return { stdout, stderr: "" };
    },
  };
}

test("intent is exact-run owned and promotes to the deterministic provider binding", () => {
  const intent = actorEnrollmentIntent(RUN, "qual-owner-run-1-shard-1@example.com");
  assert.deepEqual(decodeActorEnrollmentCustody(encodeActorEnrollmentCustody(intent), {
    runId: "run-1", shardId: "shard-1",
  }), intent);
  assert.throws(() => decodeActorEnrollmentCustody(encodeActorEnrollmentCustody(intent), {
    runId: "other", shardId: "shard-1",
  }), /outside the exact run/);
  const actor: ActorKeyIdentity = {
    userId: "user-1", enrollmentId: "enrollment-1234", teamId: "team-1",
    litellmUserId: "user-user-1", keyAlias: "vk-user-user-1-enrollme",
    tokenId: "token-secret", tokenIdHash: "hash",
  };
  const bound = bindActorEnrollment(intent, actor);
  assert.equal(bound.state, "bound");
  assert.equal(bound.teamAlias, "user-user-1");
  assert.ok(!encodeActorEnrollmentCustody(bound).includes(actor.tokenId));
});

test("candidate lookup preserves the full synced personal + organization actor set", async () => {
  const intent = actorEnrollmentIntent(RUN, "qual-owner-run-1-shard-1@example.com");
  const result = await resolveActorEnrollmentOnBox(box(JSON.stringify({
    status: "recovered", user_id: "user-1", organization_ids: ["org-1"],
    key_aliases: ["vk-user-user-1-personal", "vk-org-org-1-user-user-1-member01"],
    litellm_user_id: "user-user-1", team_ids: ["team-personal", "team-org"],
    team_aliases: ["user-user-1", "org-org-1"],
  })), intent);
  assert.equal(result.status, "recovered");
  if (result.status === "recovered") {
    assert.deepEqual(result.binding.organizationIds, ["org-1"]);
    assert.deepEqual(result.binding.teamAliases, ["org-org-1", "user-user-1"]);
    assert.equal(result.binding.keyAliases.length, 2);
  }
});

test("candidate lookup preserves a run-owned user when the enrollment transaction rolled back", async () => {
  const intent = actorEnrollmentIntent(RUN, "qual-owner-run-1-shard-1@example.com");
  const result = await resolveActorEnrollmentOnBox(box(JSON.stringify({
    status: "user_only", user_id: "user-1",
  })), intent);
  assert.deepEqual(result, { status: "user_only", userId: "user-1" });
});

test("candidate lookup keeps a pending actor enrollment set non-quiescent", async () => {
  const intent = actorEnrollmentIntent(RUN, "qual-owner-run-1-shard-1@example.com");
  const result = await resolveActorEnrollmentOnBox(box(JSON.stringify({
    status: "pending", user_id: "user-1", enrollment_id: "enrollment-1", sync_status: "failed",
  })), intent);
  assert.deepEqual(result, {
    status: "pending", userId: "user-1", enrollmentId: "enrollment-1", syncStatus: "failed",
  });
});

test("candidate lookup rejects a non-deterministic LiteLLM user before destructive cleanup", async () => {
  const intent = actorEnrollmentIntent(RUN, "qual-owner-run-1-shard-1@example.com");
  await assert.rejects(() => resolveActorEnrollmentOnBox(box(JSON.stringify({
    status: "recovered", user_id: "user-1", organization_ids: [],
    key_aliases: ["vk-user-user-1-personal"], litellm_user_id: "unrelated-user",
    team_ids: ["team-personal"], team_aliases: ["user-user-1"],
  })), intent), /non-deterministic LiteLLM user/);
});

test("candidate lookup leaves ambiguous actor/enrollment state non-green", async () => {
  const intent = actorEnrollmentIntent(RUN, "qual-owner-run-1-shard-1@example.com");
  await assert.rejects(
    () => resolveActorEnrollmentOnBox(box(JSON.stringify({ status: "ambiguous", reason: "multiple users" })), intent),
    /ambiguous/,
  );
});
