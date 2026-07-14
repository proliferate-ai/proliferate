import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  deriveActorKeyAlias,
  QualificationLiteLlmController,
  QualificationLiteLlmError,
  selectCheapestEligibleClaudeModel,
  type ActorKeyIdentity,
  type FetchLike,
  type HttpResponseLike,
} from "./qualification-litellm.js";

const CONFIG = { adminBaseUrl: "http://admin", publicBaseUrl: "http://public", masterKey: "sk-master" };

function response(status: number, body: unknown): HttpResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

/** A routing fake: match on `${method} ${pathWithQuery}` prefix. */
function fakeFetch(routes: Record<string, () => HttpResponseLike>): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    const pathWithQuery = url.replace(CONFIG.adminBaseUrl, "");
    const key = `${method} ${pathWithQuery}`;
    calls.push(key);
    for (const [prefix, make] of Object.entries(routes)) {
      if (key.startsWith(prefix)) {
        return make();
      }
    }
    return response(404, { error: { message: "not found" } });
  };
  return { fetch, calls };
}

test("selectCheapestEligibleClaudeModel intersects, excludes fable, and picks the cheapest tier", () => {
  const allow = ["claude-opus-4-5", "claude-haiku-4-5", "claude-sonnet-4-5", "claude-fable-5", "gpt-4"];
  const probe = ["claude-opus-4-5", "claude-haiku-4-5", "claude-sonnet-4-5", "claude-fable-5"];
  assert.equal(selectCheapestEligibleClaudeModel(allow, probe), "claude-haiku-4-5");
});

test("selectCheapestEligibleClaudeModel returns null when the intersection is empty or all-fable", () => {
  assert.equal(selectCheapestEligibleClaudeModel(["claude-haiku-4-5"], ["gpt-4"]), null);
  assert.equal(selectCheapestEligibleClaudeModel(["claude-fable-5"], ["claude-fable-5"]), null);
});

test("deriveActorKeyAlias is the frozen vk-user-<user>-<enrollment[:8]> contract", () => {
  assert.equal(deriveActorKeyAlias("u123", "abcdef0123456789"), "vk-user-u123-abcdef01");
});

test("preflight requires non-empty inputs", async () => {
  const controller = new QualificationLiteLlmController(
    { ...CONFIG, masterKey: "  " },
    { fetch: fakeFetch({}).fetch },
  );
  await assert.rejects(controller.preflight(), QualificationLiteLlmError);
});

test("preflight verifies liveness + an eligible non-Fable Claude model", async () => {
  const { fetch } = fakeFetch({
    "GET /health/liveliness": () => response(200, { status: "connected" }),
    "GET /v1/models": () =>
      response(200, { data: [{ id: "claude-haiku-4-5" }, { id: "claude-fable-5" }, { id: "gpt-4" }] }),
  });
  const result = await new QualificationLiteLlmController(CONFIG, { fetch }).preflight();
  assert.deepEqual(result.eligibleClaudeModels, ["claude-haiku-4-5"]);
  assert.equal(result.adminReachable, true);
});

test("preflight throws when the allowlist has no eligible Claude model", async () => {
  const { fetch } = fakeFetch({
    "GET /health/liveliness": () => response(200, { status: "connected" }),
    "GET /v1/models": () => response(200, { data: [{ id: "claude-fable-5" }, { id: "gpt-4" }] }),
  });
  await assert.rejects(new QualificationLiteLlmController(CONFIG, { fetch }).preflight(), /no eligible/i);
});

const ALIAS = deriveActorKeyAlias("u1", "enroll-9999-aaaa");
const TOKEN = "tok_hash_abc";

function actor(): ActorKeyIdentity {
  return {
    userId: "u1",
    enrollmentId: "enroll-9999-aaaa",
    teamId: "team_1",
    litellmUserId: "user-u1",
    keyAlias: ALIAS,
    tokenId: TOKEN,
    tokenIdHash: createHash("sha256").update(TOKEN).digest("hex"),
  };
}

test("resolveActorKey reads token/team/user from /key/list by alias", async () => {
  const { fetch } = fakeFetch({
    "GET /key/list": () =>
      response(200, { keys: [{ key_alias: ALIAS, token: TOKEN, team_id: "team_1", user_id: "user-u1" }] }),
  });
  const resolved = await new QualificationLiteLlmController(CONFIG, { fetch }).resolveActorKey({
    userId: "u1",
    enrollmentId: "enroll-9999-aaaa",
  });
  assert.equal(resolved.keyAlias, ALIAS);
  assert.equal(resolved.tokenId, TOKEN);
  assert.equal(resolved.teamId, "team_1");
  assert.equal(resolved.litellmUserId, "user-u1");
  assert.equal(resolved.tokenIdHash, actor().tokenIdHash);
});

test("resolveActorKey throws when no key matches the alias", async () => {
  const { fetch } = fakeFetch({
    "GET /key/list": () => response(200, { keys: [{ key_alias: "other", token: "x" }] }),
  });
  await assert.rejects(
    new QualificationLiteLlmController(CONFIG, { fetch }).resolveActorKey({ userId: "u1", enrollmentId: "enroll-9999-aaaa" }),
    /No LiteLLM key resolved/,
  );
});

const WINDOW_START = "2026-07-14T12:00:00.000Z";
const WINDOW_END = "2026-07-14T12:05:00.000Z";
const IN_WINDOW = "2026-07-14T12:02:00.000Z";

function spendRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    request_id: "req-1",
    api_key: TOKEN,
    model: "claude-haiku-4-5",
    spend: 0.0004,
    prompt_tokens: 8,
    completion_tokens: 5,
    total_tokens: 13,
    startTime: IN_WINDOW,
    ...overrides,
  };
}

async function correlate(rows: Array<Record<string, unknown>>, before: string[] = []): Promise<unknown> {
  const { fetch } = fakeFetch({ "GET /spend/logs": () => response(200, rows) });
  const controller = new QualificationLiteLlmController(CONFIG, { fetch });
  return controller.correlateTurn({
    actor: actor(),
    before: { tokenIdHash: actor().tokenIdHash, requestIds: before, takenAt: WINDOW_START },
    acceptedModelId: "claude-haiku-4-5",
    windowStartedAt: WINDOW_START,
    windowFinishedAt: WINDOW_END,
  });
}

test("correlateTurn accepts one new in-window row and sums token/spend", async () => {
  const result = (await correlate([spendRow()])) as {
    requestIds: string[];
    totalTokens: number;
    spendUsd: number;
    modelId: string;
  };
  assert.deepEqual(result.requestIds, ["req-1"]);
  assert.equal(result.totalTokens, 13);
  assert.ok(result.spendUsd > 0);
  assert.equal(result.modelId, "claude-haiku-4-5");
});

test("correlateTurn rejects when only a wrong-key row exists", async () => {
  await assert.rejects(correlate([spendRow({ api_key: "other-token" })]), /No new in-window/);
});

test("correlateTurn ignores a pre-existing request id (present before the turn)", async () => {
  await assert.rejects(correlate([spendRow({ request_id: "old" })], ["old"]), /No new in-window/);
});

test("correlateTurn rejects an out-of-window row", async () => {
  await assert.rejects(correlate([spendRow({ startTime: "2026-07-14T13:00:00.000Z" })]), /No new in-window/);
});

test("correlateTurn rejects a wrong-model row", async () => {
  await assert.rejects(correlate([spendRow({ model: "claude-opus-4-5" })]), /expected "claude-haiku-4-5"/);
});

test("correlateTurn rejects zero/inconsistent tokens", async () => {
  await assert.rejects(correlate([spendRow({ completion_tokens: 0, total_tokens: 8 })]), /tokens/);
});

test("correlateTurn rejects zero spend", async () => {
  await assert.rejects(correlate([spendRow({ spend: 0 })]), /spend/);
});

test("correlateTurn rejects an unbounded/ambiguous result set", async () => {
  const rows = Array.from({ length: 17 }, (_, i) => spendRow({ request_id: `req-${i}` }));
  await assert.rejects(correlate(rows), /unbounded\/ambiguous/);
});

test("deleteActorSubjects deletes key + user + team and is idempotent on 404", async () => {
  const deleted: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    const path = url.replace(CONFIG.adminBaseUrl, "");
    deleted.push(path);
    if (path === "/team/delete") {
      return response(404, "not found"); // already gone → still counts as deleted.
    }
    return response(200, {});
  };
  const result = await new QualificationLiteLlmController(CONFIG, { fetch }).deleteActorSubjects(actor());
  assert.equal(result.virtualKeyDeleted, true);
  assert.equal(result.litellmSubjectsDeleted, true);
  assert.deepEqual(deleted.sort(), ["/key/delete", "/team/delete", "/user/delete"]);
});
