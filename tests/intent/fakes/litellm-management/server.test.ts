// Offline unit test for the management-plane LiteLLM fake (PR 4, BRIEF §5).
// Deterministic, no server/DB/network — just the fake's own HTTP surface.
// Run: `pnpm --filter @proliferate/tests-intent exec tsx --test "fakes/**/*.test.ts"`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { startLitellmManagementFake } from "./server.ts";

async function postJson(baseUrl: string, path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function getJson(baseUrl: string, path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json() };
}

test("never serves an inference route", async () => {
  const fake = await startLitellmManagementFake();
  try {
    const chat = await postJson(fake.baseUrl, "/chat/completions", { model: "gpt-4", messages: [] });
    assert.equal(chat.status, 404);
    const messages = await postJson(fake.baseUrl, "/v1/messages", { model: "claude", messages: [] });
    assert.equal(messages.status, 404);
  } finally {
    await fake.close();
  }
});

test("team/user/key admin lifecycle mirrors the pinned LiteLLM image's quirks", async () => {
  const fake = await startLitellmManagementFake();
  try {
    // /team/new does not dedupe by alias.
    const team1 = await postJson(fake.baseUrl, "/team/new", { team_alias: "org-acme" });
    const team2 = await postJson(fake.baseUrl, "/team/new", { team_alias: "org-acme" });
    assert.notEqual(team1.body.team_id, team2.body.team_id);
    const listed = await getJson(fake.baseUrl, "/team/list?team_alias=org-acme");
    assert.equal(listed.body.length, 2);

    // /user/new 409s on a duplicate user_id.
    const user1 = await postJson(fake.baseUrl, "/user/new", { user_id: "user-1" });
    assert.equal(user1.status, 200);
    const user1Again = await postJson(fake.baseUrl, "/user/new", { user_id: "user-1" });
    assert.equal(user1Again.status, 409);

    // /key/generate enforces a unique key_alias among live keys.
    const key1 = await postJson(fake.baseUrl, "/key/generate", {
      user_id: "user-1",
      team_id: team1.body.team_id,
      key_alias: "vk-user-1",
      max_budget: 5,
    });
    assert.equal(key1.status, 200);
    assert.ok(key1.body.token_id);
    const dup = await postJson(fake.baseUrl, "/key/generate", { user_id: "user-1", key_alias: "vk-user-1" });
    assert.equal(dup.status, 400);
    assert.match(dup.body.error.message, /alias/i);

    // Deleting frees the alias for reuse (mirrors delete-then-mint rotation).
    await postJson(fake.baseUrl, "/key/delete", { keys: [key1.body.token_id] });
    const reminted = await postJson(fake.baseUrl, "/key/generate", { user_id: "user-1", key_alias: "vk-user-1" });
    assert.equal(reminted.status, 200);

    // Blocked keys are tracked by token id and reported via blockedKeys().
    await postJson(fake.baseUrl, "/key/block", { key: reminted.body.token_id });
    assert.deepEqual(fake.blockedKeys(), [reminted.body.token_id]);
    await postJson(fake.baseUrl, "/key/unblock", { key: reminted.body.token_id });
    assert.deepEqual(fake.blockedKeys(), []);
  } finally {
    await fake.close();
  }
});

test("/spend/logs filters rows to the [start_date, end_date] UTC midnight window", async () => {
  const fake = await startLitellmManagementFake();
  try {
    fake.seedSpendRows([
      { request_id: "req-jan-1", api_key: "tok-a", spend: 1, startTime: "2026-01-01T12:00:00Z" },
      { request_id: "req-jan-3", api_key: "tok-a", spend: 2, startTime: "2026-01-03T00:00:00Z" },
      { request_id: "req-jan-5", api_key: "tok-a", spend: 3, startTime: "2026-01-05T23:59:59Z" },
    ]);
    // LiteLLM bounds end_date at midnight (`startTime <= end_date 00:00:00`),
    // which is exactly why the real importer pushes end_date to `at + 1 day` to
    // capture same-day spend. So to include the jan-5 23:59:59 row, end_date is
    // 2026-01-06 (mirroring the importer's windowing); jan-1 stays excluded by
    // the lower bound.
    const page = await getJson(
      fake.baseUrl,
      "/spend/logs?summarize=false&start_date=2026-01-02&end_date=2026-01-06",
    );
    const ids = (page.body as Array<{ request_id: string }>).map((r) => r.request_id).sort();
    assert.deepEqual(ids, ["req-jan-3", "req-jan-5"]);
  } finally {
    await fake.close();
  }
});

test("mintedKeys() reflects generate/block state for test introspection", async () => {
  const fake = await startLitellmManagementFake();
  try {
    const minted = await postJson(fake.baseUrl, "/key/generate", { user_id: "user-2", key_alias: "vk-user-2" });
    await postJson(fake.baseUrl, "/key/block", { key: minted.body.token_id });
    const keys = fake.mintedKeys();
    assert.equal(keys.length, 1);
    assert.equal(keys[0].tokenId, minted.body.token_id);
    assert.equal(keys[0].blocked, true);
    assert.equal(keys[0].deleted, false);
  } finally {
    await fake.close();
  }
});
