import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveLocalWorkspaceIdOnce, resolveLocalWorkspaceSessionId } from "./local-session.js";
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
    [
      { id: "session-old", workspaceId: RAW_WORKSPACE_ID },
      { id: "session-elsewhere", workspaceId: "some-other-workspace" },
      { id: "session-new", workspaceId: RAW_WORKSPACE_ID },
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
