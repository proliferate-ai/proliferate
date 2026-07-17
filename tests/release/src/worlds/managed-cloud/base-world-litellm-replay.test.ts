import assert from "node:assert/strict";
import { test } from "node:test";

import type { FetchLike } from "../../services/qualification-litellm.js";
import type { RecoveredActorEnrollmentV1 } from "./actor-enrollment-custody.js";
import {
  deleteActorEnrollmentSubjects,
  resolveActorEnrollmentProviderBinding,
} from "./base-world-litellm-replay.js";

const INPUTS = { litellmBaseUrl: "https://litellm.example", litellmMasterKey: "master" };
const RECOVERED: RecoveredActorEnrollmentV1 = {
  state: "recovered", runId: "run-1", shardId: "shard-1",
  email: "qual-owner-run-1-shard-1@example.com", userId: "u1", organizationIds: [],
  keyAliases: ["vk-user-u1-enroll01"], litellmUserId: "user-u1", teamIds: [],
  teamAliases: ["user-u1"],
};

function response(status: number, payload: unknown = {}): Awaited<ReturnType<FetchLike>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
    async text() { return JSON.stringify(payload); },
  };
}

function partialProvider(options: { key: boolean; user: boolean; team: boolean }): {
  fetch: FetchLike;
  deleted: string[];
} {
  let key = options.key;
  let user = options.user;
  let team = options.team;
  const deleted: string[] = [];
  return {
    deleted,
    fetch: async (url) => {
      if (url.includes("/team/list")) {
        return response(200, team ? [{ team_alias: "user-u1", team_id: "team-1" }] : []);
      }
      if (url.includes("/key/list")) {
        const keys = key ? [{
          key_alias: RECOVERED.keyAliases[0], token: "tok-1", team_id: "team-1",
          user_id: "user-u1", metadata: { proliferate_user_id: "u1" },
        }] : [];
        return response(200, {
          keys,
          current_page: 1,
          total_pages: keys.length === 0 ? 0 : 1,
          total_count: keys.length,
        });
      }
      if (url.endsWith("/key/delete")) { key = false; deleted.push("key"); return response(200); }
      if (url.includes("/user/info")) return response(user ? 200 : 404, { user_id: "user-u1" });
      if (url.endsWith("/user/delete")) { user = false; deleted.push("user"); return response(200); }
      if (url.endsWith("/team/delete")) { team = false; deleted.push("team"); return response(200); }
      return response(500);
    },
  };
}

for (const sample of [
  { name: "team only", key: false, user: false, team: true, expected: ["user", "team"] },
  { name: "team and user without key", key: false, user: true, team: true, expected: ["user", "team"] },
  { name: "key exists before DB mark", key: true, user: true, team: true, expected: ["key", "user", "team"] },
] as const) {
  test(`partial enrollment cleanup handles ${sample.name}`, async () => {
    const provider = partialProvider(sample);
    const bound = await resolveActorEnrollmentProviderBinding(RECOVERED, INPUTS, provider.fetch);
    assert.deepEqual(bound.teamIds, ["team-1"]);
    await deleteActorEnrollmentSubjects(bound, INPUTS, provider.fetch, async () => undefined);
    assert.deepEqual(provider.deleted, sample.expected);
  });
}

test("all positively owned retry-orphan keys are captured and deleted", async () => {
  let aliases = ["vk-user-u1-orphan01", "vk-user-u1-enroll01"];
  let team = true;
  const deleted: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    if (url.includes("/team/list")) {
      return response(200, team ? [{ team_alias: "user-u1", team_id: "team-1" }] : []);
    }
    if (url.includes("/key/list")) {
      const requested = new URL(url).searchParams.get("key_alias");
      const rows = aliases.filter((alias) => requested === null || requested === alias).map((alias) => ({
        key_alias: alias, token: `tok-${alias}`, team_id: "team-1",
        user_id: "user-u1", metadata: { proliferate_user_id: "u1" },
      }));
      return response(200, { keys: rows });
    }
    if (url.endsWith("/key/delete")) {
      const tokens = JSON.parse(String(init?.body)).keys as string[];
      const removed = aliases.filter((alias) => tokens.includes(`tok-${alias}`));
      deleted.push(...removed);
      aliases = aliases.filter((alias) => !removed.includes(alias));
      return response(200);
    }
    if (url.endsWith("/user/delete")) return response(200);
    if (url.endsWith("/team/delete")) { team = false; return response(200); }
    if (url.includes("/user/info")) return response(404);
    return response(500);
  };
  const bound = await resolveActorEnrollmentProviderBinding(RECOVERED, INPUTS, fetch);
  assert.deepEqual(bound.keyAliases, ["vk-user-u1-enroll01", "vk-user-u1-orphan01"]);
  await deleteActorEnrollmentSubjects(bound, INPUTS, fetch, async () => undefined);
  assert.deepEqual(deleted.sort(), ["vk-user-u1-enroll01", "vk-user-u1-orphan01"]);
});

test("an exact-user key with an unexpected alias keeps cleanup non-green", async () => {
  const fetch: FetchLike = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/key/list")) {
      return response(200, { keys: [{
        key_alias: "unexpected-u1-key", token: "tok-unexpected", team_id: "team-1",
        user_id: "user-u1", metadata: { proliferate_user_id: "u1" },
      }] });
    }
    if (parsed.pathname.endsWith("/team/list")) {
      return response(200, [{ team_alias: "user-u1", team_id: "team-1" }]);
    }
    return response(500);
  };
  await assert.rejects(
    () => resolveActorEnrollmentProviderBinding(RECOVERED, INPUTS, fetch),
    /exact-user key has an unexpected alias/,
  );
});

test("a personal team retained by an unexpected exact-user key cannot report cleanup success", async () => {
  let expectedKeyPresent = true;
  const fetch: FetchLike = async (url, init) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/key/list")) {
      const alias = parsed.searchParams.get("key_alias");
      const teamId = parsed.searchParams.get("team_id");
      const rows = [
        ...(expectedKeyPresent ? [{
          key_alias: RECOVERED.keyAliases[0], token: "tok-expected", team_id: "team-1",
          user_id: "user-u1", metadata: { proliferate_user_id: "u1" },
        }] : []),
        {
          key_alias: "unexpected-u1-key", token: "tok-unexpected", team_id: "team-1",
          user_id: "user-u1", metadata: { proliferate_user_id: "u1" },
        },
      ].filter((row) =>
        (alias === null || row.key_alias === alias) &&
        (teamId === null || row.team_id === teamId));
      return response(200, { keys: rows });
    }
    if (parsed.pathname.endsWith("/key/delete")) {
      const tokens = JSON.parse(String(init?.body)).keys as string[];
      if (tokens.includes("tok-expected")) expectedKeyPresent = false;
      return response(200);
    }
    if (parsed.pathname.endsWith("/user/delete")) return response(200);
    if (parsed.pathname.endsWith("/user/info")) return response(404);
    if (parsed.pathname.endsWith("/team/list")) {
      return response(200, [{ team_alias: "user-u1", team_id: "team-1" }]);
    }
    return response(500);
  };
  await assert.rejects(
    () => deleteActorEnrollmentSubjects(
      { ...RECOVERED, teamIds: ["team-1"] }, INPUTS, fetch, async () => undefined,
    ),
    /personal or unknown actor team remains visible with keys/,
  );
});

test("duplicate deterministic team aliases inventory and delete every empty owned team", async () => {
  let keys = [{
    key_alias: RECOVERED.keyAliases[0], token: "tok-1", team_id: "team-2",
    user_id: "user-u1", metadata: { proliferate_user_id: "u1" },
  }];
  const teams = new Map([
    ["team-1", "user-u1"],
    ["team-2", "user-u1"],
  ]);
  const deletedTeams: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/key/list")) {
      const alias = parsed.searchParams.get("key_alias");
      const userId = parsed.searchParams.get("user_id");
      const teamId = parsed.searchParams.get("team_id");
      const rows = keys.filter((key) =>
        (alias === null || key.key_alias === alias) &&
        (userId === null || key.user_id === userId) &&
        (teamId === null || key.team_id === teamId));
      return response(200, {
        keys: rows, current_page: 1, total_pages: rows.length === 0 ? 0 : 1,
        total_count: rows.length,
      });
    }
    if (parsed.pathname.endsWith("/key/delete")) {
      const tokens = JSON.parse(String(init?.body)).keys as string[];
      keys = keys.filter((key) => !tokens.includes(key.token));
      return response(200);
    }
    if (parsed.pathname.endsWith("/team/list")) {
      const alias = parsed.searchParams.get("team_alias");
      const id = parsed.searchParams.get("team_id");
      return response(200, [...teams].filter(([teamId, teamAlias]) =>
        (alias === null || alias === teamAlias) && (id === null || id === teamId))
        .map(([team_id, team_alias]) => ({ team_id, team_alias })));
    }
    if (parsed.pathname.endsWith("/team/delete")) {
      const ids = JSON.parse(String(init?.body)).team_ids as string[];
      for (const id of ids) {
        if (teams.delete(id)) deletedTeams.push(id);
      }
      return response(200);
    }
    if (parsed.pathname.endsWith("/user/delete")) return response(200);
    if (parsed.pathname.endsWith("/user/info")) return response(404);
    return response(500);
  };

  const resolved = await resolveActorEnrollmentProviderBinding(RECOVERED, INPUTS, fetch);
  assert.deepEqual(resolved.teamIds, ["team-1", "team-2"]);
  await deleteActorEnrollmentSubjects(resolved, INPUTS, fetch, async () => undefined);
  assert.deepEqual(deletedTeams.sort(), ["team-1", "team-2"]);
  assert.equal(teams.size, 0);
});

test("shared organization team is retained until the other run actor key is removed", async () => {
  const actor: RecoveredActorEnrollmentV1 = {
    ...RECOVERED,
    organizationIds: ["org-1"],
    keyAliases: ["vk-user-u1-enroll01", "vk-org-org-1-user-u1-member01"],
    teamIds: ["team-personal", "team-org"],
    teamAliases: ["user-u1", "org-org-1"],
  };
  let keys = [
    { key_alias: actor.keyAliases[0], token: "tok-personal", team_id: "team-personal", user_id: "user-u1", metadata: { proliferate_user_id: "u1" } },
    { key_alias: actor.keyAliases[1], token: "tok-org-u1", team_id: "team-org", user_id: "user-u1", metadata: { proliferate_user_id: "u1", proliferate_organization_id: "org-1" } },
    { key_alias: "vk-org-org-1-user-u2-member02", token: "tok-org-u2", team_id: "team-org", user_id: "user-u2", metadata: { proliferate_user_id: "u2", proliferate_organization_id: "org-1" } },
  ];
  const teams = new Map([["user-u1", "team-personal"], ["org-org-1", "team-org"]]);
  const deletedTeams: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/key/list")) {
      const alias = parsed.searchParams.get("key_alias");
      const teamId = parsed.searchParams.get("team_id");
      const userId = parsed.searchParams.get("user_id");
      return response(200, { keys: keys.filter((key) =>
        (alias === null || key.key_alias === alias) &&
        (teamId === null || key.team_id === teamId) &&
        (userId === null || key.user_id === userId)) });
    }
    if (parsed.pathname.endsWith("/key/delete")) {
      const tokens = JSON.parse(String(init?.body)).keys as string[];
      keys = keys.filter((key) => !tokens.includes(key.token));
      return response(200);
    }
    if (parsed.pathname.endsWith("/team/list")) {
      const alias = parsed.searchParams.get("team_alias");
      const id = parsed.searchParams.get("team_id");
      return response(200, [...teams].filter(([teamAlias, teamId]) =>
        (alias === null || alias === teamAlias) && (id === null || id === teamId))
        .map(([team_alias, team_id]) => ({ team_alias, team_id })));
    }
    if (parsed.pathname.endsWith("/team/delete")) {
      const ids = JSON.parse(String(init?.body)).team_ids as string[];
      for (const [alias, id] of teams) if (ids.includes(id)) { teams.delete(alias); deletedTeams.push(id); }
      return response(200);
    }
    if (parsed.pathname.endsWith("/user/delete")) return response(200);
    if (parsed.pathname.endsWith("/user/info")) return response(404);
    return response(500);
  };
  const resolved = await resolveActorEnrollmentProviderBinding(actor, INPUTS, fetch);
  await deleteActorEnrollmentSubjects(resolved, INPUTS, fetch, async () => undefined);
  assert.deepEqual(deletedTeams, ["team-personal"]);
  assert.equal(teams.get("org-org-1"), "team-org");
  assert.deepEqual(keys.map((key) => key.user_id), ["user-u2"]);
});

test("actor replay stays idempotent after its personal team was already deleted", async () => {
  const actor: RecoveredActorEnrollmentV1 = {
    ...RECOVERED,
    organizationIds: ["org-1"],
    keyAliases: ["vk-user-u1-enroll01", "vk-org-org-1-user-u1-member01"],
    teamIds: ["team-personal", "team-org"],
    teamAliases: ["user-u1", "org-org-1"],
  };
  const keys = [{
    key_alias: "vk-org-org-1-user-u2-member02", token: "tok-org-u2", team_id: "team-org",
    user_id: "user-u2", metadata: { proliferate_user_id: "u2", proliferate_organization_id: "org-1" },
  }];
  const teams = new Map([["org-org-1", "team-org"]]);
  const deletedTeams: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/key/list")) {
      const alias = parsed.searchParams.get("key_alias");
      const teamId = parsed.searchParams.get("team_id");
      const userId = parsed.searchParams.get("user_id");
      const rows = keys.filter((key) =>
        (alias === null || alias === key.key_alias) &&
        (teamId === null || teamId === key.team_id) &&
        (userId === null || userId === key.user_id));
      return response(200, {
        keys: rows, current_page: 1, total_pages: rows.length === 0 ? 0 : 1,
        total_count: rows.length,
      });
    }
    if (parsed.pathname.endsWith("/key/delete")) return response(200);
    if (parsed.pathname.endsWith("/team/list")) {
      const alias = parsed.searchParams.get("team_alias");
      const id = parsed.searchParams.get("team_id");
      return response(200, [...teams].filter(([teamAlias, teamId]) =>
        (alias === null || alias === teamAlias) && (id === null || id === teamId))
        .map(([team_alias, team_id]) => ({ team_alias, team_id })));
    }
    if (parsed.pathname.endsWith("/team/delete")) {
      const ids = JSON.parse(String(init?.body)).team_ids as string[];
      for (const [alias, id] of teams) {
        if (ids.includes(id)) { teams.delete(alias); deletedTeams.push(id); }
      }
      return response(200);
    }
    if (parsed.pathname.endsWith("/user/delete")) return response(200);
    if (parsed.pathname.endsWith("/user/info")) return response(404);
    return response(500);
  };
  const resolved = await resolveActorEnrollmentProviderBinding(actor, INPUTS, fetch);
  assert.deepEqual(resolved.teamIds, ["team-org", "team-personal"]);
  await deleteActorEnrollmentSubjects(resolved, INPUTS, fetch, async () => undefined);
  assert.deepEqual(deletedTeams, []);
  assert.equal(teams.get("org-org-1"), "team-org");
});

test("actor key inventory paginates to exhaustion before deriving cleanup custody", async () => {
  const fetch: FetchLike = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/key/list")) {
      const page = Number(parsed.searchParams.get("page"));
      if (page === 1) {
        return response(200, {
          keys: Array.from({ length: 100 }, (_, index) => ({
            key_alias: `vk-user-u1-page-${index}`, token: `tok-page-${index}`, team_id: "team-1",
            user_id: "user-u1", metadata: { proliferate_user_id: "u1" },
          })),
          current_page: 1, total_pages: 2,
        });
      }
      return response(200, { keys: [{
        key_alias: "vk-user-u1-orphan02", token: "tok-late", team_id: "team-1",
        user_id: "user-u1", metadata: { proliferate_user_id: "u1" },
      }], current_page: 2, total_pages: 2 });
    }
    return response(200, [{ team_alias: "user-u1", team_id: "team-1" }]);
  };
  const resolved = await resolveActorEnrollmentProviderBinding(RECOVERED, INPUTS, fetch);
  assert.ok(resolved.keyAliases.includes("vk-user-u1-orphan02"));
});
