import assert from "node:assert/strict";
import { test } from "node:test";

import type { FetchLike } from "../../services/qualification-litellm.js";
import { cleanupQualificationLiteLlmRun, hardCancelFetchInit } from "./hard-cancel-litellm.js";

const RUN_ID = "qlc-ci-123-1";
const SHARD_ID = "1";
const OWNED = {
  proliferate_qualification_run_id: RUN_ID,
  proliferate_qualification_shard_id: SHARD_ID,
};

function response(status: number, payload: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
    async text() { return JSON.stringify(payload); },
  };
}

interface ProviderState {
  keys: Array<Record<string, unknown>>;
  users: Array<Record<string, unknown>>;
  teams: Array<Record<string, unknown>>;
}

function provider(initial: ProviderState, options: { retainAfterDelete?: boolean } = {}) {
  const state = structuredClone(initial);
  const calls: Array<{ path: string; body: Record<string, string[]> | null }> = [];
  const fetch: FetchLike = async (url, init) => {
    const parsed = new URL(url);
    const body = init?.body ? JSON.parse(init.body) as Record<string, string[]> : null;
    calls.push({ path: parsed.pathname, body });
    if (parsed.pathname.endsWith("/key/list")) {
      return response(200, {
        keys: state.keys,
        current_page: 1,
        total_pages: state.keys.length === 0 ? 0 : 1,
        total_count: state.keys.length,
      });
    }
    if (parsed.pathname.endsWith("/user/list")) {
      return response(200, {
        users: state.users,
        total: state.users.length,
        page: 1,
        page_size: 100,
        total_pages: state.users.length === 0 ? 0 : 1,
      });
    }
    if (parsed.pathname.endsWith("/team/list")) return response(200, state.teams);
    if (parsed.pathname.endsWith("/key/delete")) {
      if (!options.retainAfterDelete) {
        state.keys = state.keys.filter((row) => !body?.keys.includes(String(row.token)));
      }
      return response(200);
    }
    if (parsed.pathname.endsWith("/user/delete")) {
      if (!options.retainAfterDelete) {
        state.users = state.users.filter((row) => !body?.user_ids.includes(String(row.user_id)));
      }
      return response(200);
    }
    if (parsed.pathname.endsWith("/team/delete")) {
      if (!options.retainAfterDelete) {
        state.teams = state.teams.filter((row) => !body?.team_ids.includes(String(row.team_id)));
      }
      return response(200);
    }
    return response(500);
  };
  return { fetch, calls, state };
}

function mixedState(): ProviderState {
  return {
    keys: [
      { token: "tok-owned", user_id: "user-owned", team_id: "team-owned", metadata: OWNED },
      { token: "tok-foreign", user_id: "user-foreign", team_id: "team-foreign", metadata: {} },
    ],
    users: [
      { user_id: "user-owned", metadata: OWNED },
      { user_id: "user-foreign", metadata: {} },
    ],
    teams: [
      { team_id: "team-owned", metadata: OWNED },
      { team_id: "team-foreign", metadata: {} },
    ],
  };
}

test("the real LiteLLM transport always carries a bounded abort signal", async () => {
  const init = hardCancelFetchInit({ method: "GET" }, 1);
  assert.equal(init.method, "GET");
  assert.ok(init.signal instanceof AbortSignal);
  await new Promise<void>((resolve, reject) => {
    const guard = setTimeout(() => reject(new Error("timeout signal did not abort")), 100);
    init.signal!.addEventListener("abort", () => {
      clearTimeout(guard);
      resolve();
    }, { once: true });
  });
  assert.equal(init.signal!.aborted, true);
});

test("deletes only the exact run+shard LiteLLM graph and proves absence", async () => {
  const fake = provider(mixedState());
  const result = await cleanupQualificationLiteLlmRun({
    baseUrl: "https://litellm.example",
    masterKey: "master",
    runId: RUN_ID,
    shardId: SHARD_ID,
  }, { fetch: fake.fetch, sleep: async () => undefined });

  assert.deepEqual(result, { deletedKeys: 1, deletedUsers: 1, deletedTeams: 1 });
  assert.deepEqual(fake.state.keys.map((row) => row.token), ["tok-foreign"]);
  assert.deepEqual(fake.state.users.map((row) => row.user_id), ["user-foreign"]);
  assert.deepEqual(fake.state.teams.map((row) => row.team_id), ["team-foreign"]);
  assert.deepEqual(
    fake.calls.filter((call) => call.path.endsWith("/delete")).map((call) => call.path),
    ["/key/delete", "/user/delete", "/team/delete"],
  );
});

test("drains every key and user page before deleting child to parent", async () => {
  let deleted = false;
  const mutations: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    const parsed = new URL(url);
    const page = Number(parsed.searchParams.get("page") ?? "1");
    if (parsed.pathname.endsWith("/key/list")) {
      const keys = deleted ? [] : [{
        token: `tok-${page}`,
        user_id: `user-${page}`,
        team_id: `team-${page}`,
        metadata: OWNED,
      }];
      return response(200, {
        keys,
        current_page: deleted ? 1 : page,
        total_pages: deleted ? 0 : 2,
        total_count: deleted ? 0 : 2,
      });
    }
    if (parsed.pathname.endsWith("/user/list")) {
      const users = deleted ? [] : [{ user_id: `user-${page}`, metadata: OWNED }];
      return response(200, {
        users,
        page: deleted ? 1 : page,
        page_size: 100,
        total: deleted ? 0 : 2,
        total_pages: deleted ? 0 : 2,
      });
    }
    if (parsed.pathname.endsWith("/team/list")) {
      return response(200, deleted ? [] : [
        { team_id: "team-1", metadata: OWNED },
        { team_id: "team-2", metadata: OWNED },
      ]);
    }
    if (parsed.pathname.endsWith("/key/delete")) {
      mutations.push("key");
      return response(200);
    }
    if (parsed.pathname.endsWith("/user/delete")) {
      mutations.push("user");
      return response(200);
    }
    if (parsed.pathname.endsWith("/team/delete")) {
      mutations.push("team");
      deleted = true;
      return response(200);
    }
    return response(500);
  };

  assert.deepEqual(await cleanupQualificationLiteLlmRun({
    baseUrl: "https://litellm.example",
    masterKey: "master",
    runId: RUN_ID,
    shardId: SHARD_ID,
  }, { fetch, sleep: async () => undefined }), {
    deletedKeys: 2,
    deletedUsers: 2,
    deletedTeams: 2,
  });
  assert.deepEqual(mutations, ["key", "user", "team"]);
});

test("partial or conflicting ownership metadata fails before mutation", async () => {
  const state = mixedState();
  state.teams[0]!.metadata = { proliferate_qualification_run_id: RUN_ID };
  const fake = provider(state);
  await assert.rejects(
    () => cleanupQualificationLiteLlmRun({
      baseUrl: "https://litellm.example", masterKey: "master", runId: RUN_ID, shardId: SHARD_ID,
    }, { fetch: fake.fetch }),
    /partial or conflicting qualification ownership metadata/,
  );
  assert.equal(fake.calls.some((call) => call.path.endsWith("/delete")), false);
});

test("a foreign key attached to an owned subject blocks every delete", async () => {
  const state = mixedState();
  state.keys.push({ token: "tok-ambiguous", user_id: "user-owned", team_id: "team-owned", metadata: {} });
  const fake = provider(state);
  await assert.rejects(
    () => cleanupQualificationLiteLlmRun({
      baseUrl: "https://litellm.example", masterKey: "master", runId: RUN_ID, shardId: SHARD_ID,
    }, { fetch: fake.fetch }),
    /non-owned LiteLLM key points at an exact run-owned subject/,
  );
  assert.equal(fake.calls.some((call) => call.path.endsWith("/delete")), false);
});

test("an owned key whose subjects lack the exact tag is never deleted", async () => {
  const state = mixedState();
  state.users[0]!.metadata = {};
  const fake = provider(state);
  await assert.rejects(
    () => cleanupQualificationLiteLlmRun({
      baseUrl: "https://litellm.example", masterKey: "master", runId: RUN_ID, shardId: SHARD_ID,
    }, { fetch: fake.fetch }),
    /key points at a subject without exact run ownership/,
  );
  assert.equal(fake.calls.some((call) => call.path.endsWith("/delete")), false);
});

test("accepted deletes cannot report green while an owned row remains", async () => {
  const fake = provider(mixedState(), { retainAfterDelete: true });
  await assert.rejects(
    () => cleanupQualificationLiteLlmRun({
      baseUrl: "https://litellm.example", masterKey: "master", runId: RUN_ID, shardId: SHARD_ID,
    }, { fetch: fake.fetch, sleep: async () => undefined }),
    /still reports exact run-owned resources/,
  );
});

test("an authoritative empty inventory is idempotently clean", async () => {
  const fake = provider({ keys: [], users: [], teams: [] });
  assert.deepEqual(await cleanupQualificationLiteLlmRun({
    baseUrl: "https://litellm.example", masterKey: "master", runId: RUN_ID, shardId: SHARD_ID,
  }, { fetch: fake.fetch }), { deletedKeys: 0, deletedUsers: 0, deletedTeams: 0 });
});
