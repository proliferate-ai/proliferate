import type { ReadyLocalWorld } from "../../worlds/local-workspace/world.js";

/**
 * Resolves the AnyHarness session id for a just-materialized local workspace by
 * the workspace's clone PATH — the runtime's own ground truth — rather than by
 * the Desktop shell's `data-workspace-ui-key`.
 *
 * ── Why not the DOM ui-key (fix round 2 root cause) ──────────────────────────
 * The workspace shell's `data-workspace-ui-key` is the LOGICAL workspace id
 * (`remote:<provider>:<owner>:<repo>:<branch>` for a repo with a git remote —
 * e.g. `remote:github:proliferate-e2e:e2e-fixture:HEAD`), which groups a repo +
 * branch across runtime kinds. AnyHarness `listSessions()` reports each session's
 * `workspaceId` as the CONCRETE runtime workspace UUID (e.g.
 * `f0a58f50-…`). The two identities never compare equal, so matching
 * `session.workspaceId === <ui-key>` timed out even though the "Work locally"
 * workspace HAD materialized locally with exactly one session (proven with live
 * DOM + `GET /v1/workspaces` / `/v1/sessions` against a booted world). The repo
 * clone path is the stable join key: the runtime's `kind:"local"` workspace at
 * that path is unambiguous (each cell prepares its own clone dir), and the
 * session it created keys off that workspace's raw id.
 */
export async function resolveLocalWorkspaceSessionId(
  world: ReadyLocalWorld,
  repoPath: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastWorkspaces = "";
  while (Date.now() < deadline) {
    const workspaceId = await resolveLocalWorkspaceIdOnce(world, repoPath).catch(() => null);
    if (workspaceId) {
      const sessions = await world.runtime.client.listSessions().catch(() => []);
      const forWorkspace = sessions.filter((session) => session.workspaceId === workspaceId);
      if (forWorkspace.length > 0) {
        // `GET /v1/sessions` is served by `SessionStore::list_visible_all()`,
        // which orders `ORDER BY updated_at DESC` (anyharness-lib
        // domains/sessions/store/sessions.rs) — the most-recently-active session
        // FIRST, not last. Filtering by workspace preserves that order, so index
        // 0 is the session this call is trying to resolve (the one whose turn was
        // just sent). Taking `[length - 1]` returned the STALEST session in the
        // workspace, which surfaced once LOCAL-6 opened a second in-workspace
        // session (the gateway tab): the untouched user-key session sorted last,
        // so the gateway leg's reopen resolve returned the user-key session id
        // and the session-equality check spuriously fired even though the
        // product genuinely created two sessions (two distinct ids in the
        // network log, Actions run 29602686092, T3-AUTHROUTE-1/route=change).
        return forWorkspace[0]!.id;
      }
    } else {
      lastWorkspaces = JSON.stringify(
        (await world.runtime.client.listWorkspaces().catch(() => []))
          .map((workspace) => ({ kind: workspace.kind, path: workspace.path })),
      );
    }
    await sleep(1_000);
  }
  throw new Error(
    `resolveLocalWorkspaceSessionId: no AnyHarness session for the local workspace at "${repoPath}" ` +
      `within ${timeoutMs}ms${lastWorkspaces ? ` (runtime workspaces: ${lastWorkspaces})` : ""}.`,
  );
}

/**
 * Snapshots the exact runtime session ids already owned by the concrete local
 * workspace at `repoPath`. A UI send that is required to create a fresh
 * process/session must take this snapshot *before* clicking Send; otherwise a
 * later "latest session" lookup can bind the turn to the previous route's
 * already-completed session.
 */
export async function snapshotLocalWorkspaceSessionIds(
  world: ReadyLocalWorld,
  repoPath: string,
): Promise<ReadonlySet<string>> {
  // This is a one-time correctness boundary, not a poll. A query failure must
  // abort the send path; treating it like a legitimately empty snapshot would
  // let the next poll misclassify a pre-existing session as newly created.
  const workspaceId = await resolveLocalWorkspaceIdOnce(world, repoPath);
  if (!workspaceId) {
    return new Set<string>();
  }
  const sessions = await world.runtime.client.listSessions();
  return new Set(sessions.filter((session) => session.workspaceId === workspaceId).map((session) => session.id));
}

/**
 * Resolves only a session created after a pre-send snapshot. The product shell
 * may temporarily expose a client-side session alias while AnyHarness
 * reconciles the concrete id, so a single new runtime candidate is accepted as
 * that alias's exact materialization. Multiple new candidates are accepted only
 * when the shell already names one of their exact ids. A stale pre-send session
 * is never returned.
 */
export async function resolveLocalWorkspaceSessionAfter(
  world: ReadyLocalWorld,
  repoPath: string,
  timeoutMs: number,
  options: {
    existingSessionIds: ReadonlySet<string>;
    activeSessionAlias: string | null;
  },
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastWorkspaces = "";
  let lastCandidates: string[] = [];
  while (Date.now() < deadline) {
    const workspaceId = await resolveLocalWorkspaceIdOnce(world, repoPath).catch(() => null);
    if (workspaceId) {
      const sessions = await world.runtime.client.listSessions().catch(() => []);
      const candidates = sessions
        .filter(
          (session) =>
            session.workspaceId === workspaceId && !options.existingSessionIds.has(session.id),
        )
        .map((session) => session.id);
      lastCandidates = candidates;
      if (options.activeSessionAlias && candidates.includes(options.activeSessionAlias)) {
        return options.activeSessionAlias;
      }
      if (candidates.length === 1) {
        // The active shell can still carry a `client-session:*` alias here. A
        // single new exact runtime id is its unambiguous reconciliation target.
        return candidates[0]!;
      }
    } else {
      lastWorkspaces = JSON.stringify(
        (await world.runtime.client.listWorkspaces().catch(() => []))
          .map((workspace) => ({ kind: workspace.kind, path: workspace.path })),
      );
    }
    await sleep(1_000);
  }
  throw new Error(
    `resolveLocalWorkspaceSessionAfter: no unambiguous new AnyHarness session for the local workspace at ` +
      `"${repoPath}" within ${timeoutMs}ms (pre-send sessions=${options.existingSessionIds.size}, ` +
      `new candidates=${lastCandidates.length}, active alias present=${Boolean(options.activeSessionAlias)})` +
      `${lastWorkspaces ? ` (runtime workspaces: ${lastWorkspaces})` : ""}.`,
  );
}

/**
 * Resolves the raw runtime workspace id of the `kind:"local"` workspace cloned at
 * `repoPath`. Returns null until it appears (the caller polls). Exported so a
 * driver that needs only the workspace identity (not a session) can reuse it.
 */
export async function resolveLocalWorkspaceIdOnce(
  world: ReadyLocalWorld,
  repoPath: string,
): Promise<string | null> {
  const workspaces = await world.runtime.client.listWorkspaces();
  const local = workspaces.find((workspace) => workspace.kind === "local" && workspace.path === repoPath);
  return local?.id ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
