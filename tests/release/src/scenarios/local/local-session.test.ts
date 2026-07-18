import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolveLocalWorkspaceIdOnce,
  resolveLocalWorkspaceSessionAfter,
  resolveLocalWorkspaceSessionId,
  snapshotLocalWorkspaceSessionIds,
} from "./local-session.js";
import type { ReadyLocalWorld } from "../../worlds/local-workspace/world.js";

/**
 * Offline unit coverage for the fix-round-2 session resolver. The seam joins on
 * the runtime's `kind:"local"` workspace at the repo clone path (NOT the DOM's
 * logical `data-workspace-ui-key`) and then that workspace's latest session — so
 * it must ignore the logical id entirely and key off `path` + the raw workspace
 * id. A tiny fake runtime client stands in for `world.runtime.client`; no world,
 * container, or browser is booted.
 */

interface FakeWorkspace {
  id: string;
  kind: string;
  path: string;
}
interface FakeSession {
  id: string;
  workspaceId: string;
}

function fakeWorld(workspaces: FakeWorkspace[], sessions: FakeSession[]): ReadyLocalWorld {
  return {
    runtime: {
      client: {
        listWorkspaces: async () => workspaces,
        listSessions: async () => sessions,
      },
    },
  } as unknown as ReadyLocalWorld;
}

// The logical ui-key the DOM would carry — deliberately NOT any runtime id, to
// prove the resolver never depends on it.
const REPO_PATH = "/runs/repro/repositories/repro-local-abc123";
const RAW_WORKSPACE_ID = "f0a58f50-f054-48cf-9643-26df35f88651";

test("resolveLocalWorkspaceIdOnce returns the kind=local workspace at the clone path", async () => {
  const world = fakeWorld(
    [
      { id: "other", kind: "worktree", path: "/somewhere/else" },
      { id: RAW_WORKSPACE_ID, kind: "local", path: REPO_PATH },
    ],
    [],
  );
  assert.equal(await resolveLocalWorkspaceIdOnce(world, REPO_PATH), RAW_WORKSPACE_ID);
});

test("resolveLocalWorkspaceIdOnce returns null when no local workspace matches the path yet", async () => {
  const world = fakeWorld([{ id: "x", kind: "local", path: "/other/path" }], []);
  assert.equal(await resolveLocalWorkspaceIdOnce(world, REPO_PATH), null);
});

test("resolveLocalWorkspaceSessionId joins the local workspace (by path) to its latest session", async () => {
  const world = fakeWorld(
    [{ id: RAW_WORKSPACE_ID, kind: "local", path: REPO_PATH }],
    // Ordered as the real `GET /v1/sessions` returns them —
    // `SessionStore::list_visible_all()` sorts `updated_at DESC`, so the
    // most-recently-active session comes FIRST. The resolver must pick index 0
    // of the workspace-filtered slice, not the last element (the stalest).
    [
      { id: "session-new", workspaceId: RAW_WORKSPACE_ID },
      { id: "session-elsewhere", workspaceId: "some-other-workspace" },
      { id: "session-old", workspaceId: RAW_WORKSPACE_ID },
    ],
  );
  // The DOM logical ui-key never appears as a session.workspaceId; matching on it
  // (the fix-round-2 bug) would time out. Matching on the raw id returns the
  // latest of this workspace's sessions.
  assert.equal(await resolveLocalWorkspaceSessionId(world, REPO_PATH, 2_000), "session-new");
});

test("resolveLocalWorkspaceSessionId times out with a bounded, path-scoped reason", async () => {
  const world = fakeWorld([{ id: RAW_WORKSPACE_ID, kind: "local", path: REPO_PATH }], []);
  await assert.rejects(
    () => resolveLocalWorkspaceSessionId(world, REPO_PATH, 50),
    /no AnyHarness session for the local workspace at ".*repro-local-abc123"/,
  );
});

test("post-send resolution excludes the pre-send route session and binds the one new exact session", async () => {
  const world = fakeWorld(
    [{ id: RAW_WORKSPACE_ID, kind: "local", path: REPO_PATH }],
    [
      { id: "session-user-key", workspaceId: RAW_WORKSPACE_ID },
      { id: "session-gateway", workspaceId: RAW_WORKSPACE_ID },
    ],
  );

  assert.equal(
    await resolveLocalWorkspaceSessionAfter(world, REPO_PATH, 2_000, {
      existingSessionIds: new Set(["session-user-key"]),
      activeSessionAlias: "client-session:claude:route-change",
    }),
    "session-gateway",
  );
});

test("post-send resolution never returns the stale last session when no new runtime session exists", async () => {
  const world = fakeWorld(
    [{ id: RAW_WORKSPACE_ID, kind: "local", path: REPO_PATH }],
    [{ id: "session-user-key", workspaceId: RAW_WORKSPACE_ID }],
  );

  await assert.rejects(
    () =>
      resolveLocalWorkspaceSessionAfter(world, REPO_PATH, 1, {
        existingSessionIds: new Set(["session-user-key"]),
        activeSessionAlias: "session-user-key",
      }),
    /no unambiguous new AnyHarness session/,
  );
});

test("post-send resolution uses an exact active id to disambiguate multiple new runtime sessions", async () => {
  const world = fakeWorld(
    [{ id: RAW_WORKSPACE_ID, kind: "local", path: REPO_PATH }],
    [
      { id: "session-old", workspaceId: RAW_WORKSPACE_ID },
      { id: "session-new-a", workspaceId: RAW_WORKSPACE_ID },
      { id: "session-new-b", workspaceId: RAW_WORKSPACE_ID },
    ],
  );

  assert.equal(
    await resolveLocalWorkspaceSessionAfter(world, REPO_PATH, 2_000, {
      existingSessionIds: new Set(["session-old"]),
      activeSessionAlias: "session-new-b",
    }),
    "session-new-b",
  );
});

test("pre-send snapshot is scoped to the concrete local workspace", async () => {
  const world = fakeWorld(
    [{ id: RAW_WORKSPACE_ID, kind: "local", path: REPO_PATH }],
    [
      { id: "session-local", workspaceId: RAW_WORKSPACE_ID },
      { id: "session-other", workspaceId: "other-workspace" },
    ],
  );

  assert.deepEqual(await snapshotLocalWorkspaceSessionIds(world, REPO_PATH), new Set(["session-local"]));
});

test("pre-send snapshot preserves a successful empty workspace state", async () => {
  const world = fakeWorld(
    [{ id: RAW_WORKSPACE_ID, kind: "local", path: REPO_PATH }],
    [],
  );

  assert.deepEqual(await snapshotLocalWorkspaceSessionIds(world, REPO_PATH), new Set());
});

test("pre-send snapshot failure cannot expose the stale session as new", async () => {
  let listSessionsCalls = 0;
  let resolvedSession: string | undefined;
  const world = {
    runtime: {
      client: {
        listWorkspaces: async () => [
          { id: RAW_WORKSPACE_ID, kind: "local", path: REPO_PATH },
        ],
        listSessions: async () => {
          listSessionsCalls += 1;
          if (listSessionsCalls === 1) {
            throw new Error("snapshot query failed");
          }
          return [{ id: "stale-session", workspaceId: RAW_WORKSPACE_ID }];
        },
      },
    },
  } as unknown as ReadyLocalWorld;

  await assert.rejects(
    async () => {
      const existingSessionIds = await snapshotLocalWorkspaceSessionIds(world, REPO_PATH);
      resolvedSession = await resolveLocalWorkspaceSessionAfter(world, REPO_PATH, 2_000, {
        existingSessionIds,
        activeSessionAlias: null,
      });
    },
    /snapshot query failed/,
  );
  assert.equal(resolvedSession, undefined);
  assert.equal(listSessionsCalls, 1, "post-send resolution must not run after a failed snapshot");
});

test("pre-send snapshot propagates a workspace query failure", async () => {
  const world = {
    runtime: {
      client: {
        listWorkspaces: async () => {
          throw new Error("workspace snapshot failed");
        },
      },
    },
  } as unknown as ReadyLocalWorld;

  await assert.rejects(
    () => snapshotLocalWorkspaceSessionIds(world, REPO_PATH),
    /workspace snapshot failed/,
  );
});

// ── Ordering contract (fix round: LOCAL-6 route-change, run 29628880856) ─────
//
// `openNewChat`/`switchSelectedRouteToGateway` materializes a new AnyHarness
// session as a SIDE EFFECT of the navigation itself, before any prompt is
// sent. `snapshotLocalWorkspaceSessionIds` must be called BEFORE that
// navigation; calling it after (i.e. treating the just-created session as
// pre-existing) makes `resolveLocalWorkspaceSessionAfter` unable to find any
// "new" candidate and it times out, which is exactly the observed failure
// (`pre-send sessions=2, new candidates=0`).

test("ordering contract: a snapshot taken BEFORE session creation lets resolution find the new session", async () => {
  // Snapshot taken while only the pre-existing (user-key) session exists.
  const preNavigationWorld = fakeWorld(
    [{ id: RAW_WORKSPACE_ID, kind: "local", path: REPO_PATH }],
    [{ id: "session-user-key", workspaceId: RAW_WORKSPACE_ID }],
  );
  const existingSessionIds = await snapshotLocalWorkspaceSessionIds(preNavigationWorld, REPO_PATH);
  assert.deepEqual(existingSessionIds, new Set(["session-user-key"]));

  // The navigation (openNewChat) has since materialized the gateway session.
  const postNavigationWorld = fakeWorld(
    [{ id: RAW_WORKSPACE_ID, kind: "local", path: REPO_PATH }],
    [
      { id: "session-user-key", workspaceId: RAW_WORKSPACE_ID },
      { id: "session-gateway", workspaceId: RAW_WORKSPACE_ID },
    ],
  );

  assert.equal(
    await resolveLocalWorkspaceSessionAfter(postNavigationWorld, REPO_PATH, 2_000, {
      existingSessionIds,
      activeSessionAlias: null,
    }),
    "session-gateway",
  );
});

test("ordering contract: a snapshot taken AFTER session creation makes the new session invisible (the reported bug)", async () => {
  // The navigation has ALREADY materialized the gateway session by the time
  // the snapshot is taken (the bug: snapshotting after `openNewChat`).
  const postNavigationWorld = fakeWorld(
    [{ id: RAW_WORKSPACE_ID, kind: "local", path: REPO_PATH }],
    [
      { id: "session-user-key", workspaceId: RAW_WORKSPACE_ID },
      { id: "session-gateway", workspaceId: RAW_WORKSPACE_ID },
    ],
  );
  const existingSessionIds = await snapshotLocalWorkspaceSessionIds(postNavigationWorld, REPO_PATH);
  // Both sessions are now (wrongly) captured as "pre-existing".
  assert.deepEqual(existingSessionIds, new Set(["session-user-key", "session-gateway"]));

  await assert.rejects(
    () =>
      resolveLocalWorkspaceSessionAfter(postNavigationWorld, REPO_PATH, 1, {
        existingSessionIds,
        activeSessionAlias: null,
      }),
    /no unambiguous new AnyHarness session/,
  );
});
