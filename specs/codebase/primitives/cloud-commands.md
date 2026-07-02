# Cloud Commands

> Rewritten 2026-07-02 to replace a description of the pre-cutover architecture (PR #809, commit 4b54c9f2b) with the current `cloud_sandbox` model.

Status: Describes shipped, current behavior. The materialization section is
fully verified; the live-session forwarding section is also verified but
scoped narrowly (see caveats).

Date: 2026-07-02.

Depends on: [`sandbox-provisioning.md`](sandbox-provisioning.md),
[`workspace-lifecycle.md`](workspace-lifecycle.md).

## There Is No Async Command Queue

This corrects a previously mis-stated fact. There is no `cloud_commands`
table and no `CloudCommand` model:

```text
$ grep -rn "class CloudCommand" server/proliferate/db/models/
(no matches)
```

The old architecture (described in a stale prior version of this file) had
a queue + worker-lease model with command rows, leasing, delivery, and
result ingest. That is gone from this worktree. What actually executes
commands inside a sandbox today is synchronous and RPC-style, driven
directly by the requesting HTTP handler's call stack.

## Materialization: The Synchronous, Redis-Locked RPC Model

### Entry points

Callers that trigger sandbox materialization work call one of the
`schedule_materialize_*` functions in
`server/proliferate/server/cloud/materialization/service.py:22-58`
(`schedule_materialize_sandbox`, `schedule_materialize_repo_environment`,
`schedule_materialize_secret_set`). Each schedules its work via
`runner.run_after_commit`
(`server/proliferate/server/cloud/materialization/runner.py:19-33`), which:

- registers a callback that fires only after the current DB transaction
  commits (`db_run_after_commit`, from `proliferate.db.engine`);
- on commit, spawns the actual work with `asyncio.create_task(_run())` —
  this is in-process, best-effort scheduling. Exceptions are caught and
  logged (`logger.exception(...)`), not retried. **There is no durable,
  persisted queue row backing this** — if the process crashes between
  commit and task completion, the scheduled materialization is simply
  lost; nothing re-drives it. This is consistent with "no async command
  queue," but worth calling out explicitly since it means materialization
  scheduling itself is not crash-safe today.

One caller — `create_cloud_workspace_for_user`
(`server/proliferate/server/cloud/workspaces/service.py:182-185`) — instead
calls `materialization_service.materialize_repo_environment(...)` directly
and `await`s it inline (not via `schedule_*`/`run_after_commit`), so
workspace creation synchronously blocks on materialization completing
before returning to the caller.

### The shared operation skeleton

`run_cloud_sandbox_operation`
(`server/proliferate/server/cloud/materialization/operation.py:24-38`) is
the single shared entrypoint used by every materialization operation:

```python
async def run_cloud_sandbox_operation(db, *, sandbox, operation_key, ..., run):
    async with locks.redis_materialization_lock(f"cloud-sandbox:{sandbox.id}", ...):
        target = await sandbox_io.connect_ready_sandbox(db, sandbox=sandbox)
        await run(MaterializationContext(sandbox=sandbox, target=target))
```

- **Synchronization is a Redis lock, not a queue.** `redis_materialization_lock`
  (`server/proliferate/server/cloud/materialization/locks.py:56-98`) does a
  `SET NX EX` on a key derived from `cloud-sandbox:{sandbox.id}`
  (namespaced further by `settings.redbeat_key_prefix`,
  `locks.py:22-23`), busy-waits up to `wait_timeout_seconds` (default 300s,
  polling every 0.5s) if already held, and raises
  `CloudMaterializationLockTimeout` on timeout. While held, a background
  task renews the TTL periodically (`_renew_lock`, `locks.py:24-46`). This
  guarantees at most one materialization operation runs against a given
  sandbox at a time; it does not queue or order pending callers beyond
  simple first-to-acquire-wins polling.
- Note `operation_key` is accepted by `run_cloud_sandbox_operation` but
  immediately discarded (`del operation_key`, `operation.py:32`) — it is
  not currently used for anything (not part of the lock key, not logged
  here). Callers still pass distinct-looking values
  (e.g. `f"secrets:workspace:{repo_environment.id}"` in
  `materialize/secret_set.py:47`), but as of this file those values have no
  effect I could find.
- Inside the lock, `connect_ready_sandbox` (see `sandbox-provisioning.md`)
  ensures the E2B sandbox exists and AnyHarness is healthy, lazily
  provisioning if needed, then the caller's `run(ctx)` callback executes
  with a `MaterializationContext(sandbox, target)`.

### Callers of `run_cloud_sandbox_operation` (verified by grep)

```text
server/proliferate/server/cloud/materialization/materialize/sandbox.py
server/proliferate/server/cloud/materialization/materialize/repo_environment.py
server/proliferate/server/cloud/materialization/materialize/secret_set.py
```

I grepped the whole `server/proliferate/server/cloud/` tree for
`run_cloud_sandbox_operation` and these three (plus `operation.py` itself)
are the only matches. There is no `materialize/agent_auth.py` in this
worktree, but that is not because agent-auth materialization work hasn't
started — a large agent-auth command/materialization layer already exists
at `server/proliferate/server/cloud/agent_auth/` (`worker_materialization.py`,
`reconciler.py`, `sharing.py`, `grant_freshness.py`, and 40+ other modules,
using `CloudCommandKind`/`CloudCommandStatus`/lease vocabulary). It is
parked, not deleted: commit `073cea282` ("fix(server): align test suite +
finish deletion sweep after #803/#809 cutover", PR #846) removed store
modules it depends on (`db/store/cloud_agent_auth/mappers.py` and friends,
plus all of `db/store/cloud_sync/`), and its reconciler import is
commented out in `main.py:52` under an "AGENT AUTH PARKED" note —
importing `worker_materialization.py` fails with `ModuleNotFoundError`
against this worktree's dependencies. So the module is dead/unreachable
code, not evidence that no async command queue work has begun; it just
isn't wired into `run_cloud_sandbox_operation` or mounted anywhere live.

- `materialize_sandbox` (`materialize/sandbox.py:21-28`) — the
  personal-sandbox bootstrap: inside one locked operation it materializes
  GitHub credentials, global secrets, and every configured repo
  environment for the user (`materialize/sandbox.py:31-51`).
- `materialize_repo_environment` (`materialize/repo_environment.py`, not
  fully read in this pass beyond its call site) — clones/checks out one
  repo into the sandbox.
- `materialize_secret_set` (`materialize/secret_set.py:20-51`) — resolves
  personal/organization/workspace-scoped secrets and writes them as env
  files + individual secret files inside the sandbox
  (`materialize_global_secrets_for_user`,
  `materialize_workspace_secrets_for_repo_environment`), tracking an
  applied-manifest row via `sandbox_secret_store` so unused files from a
  previous version get removed (`_reconcile_secret_files`,
  `secret_set.py:266-289`) rather than left behind.

### How commands actually run inside the sandbox

Two layers, both ultimately calling the sandbox provider's `run_command`:

- `run_sandbox_command_logged`
  (`server/proliferate/server/cloud/runtime/sandbox_exec.py:161-201+`) —
  the low-level wrapper: logs a structured "command started"/"failed"
  event via `log_cloud_event`, times the call, and calls
  `provider.run_command(sandbox, command, user=, cwd=, envs=, background=,
  timeout_seconds=)`. This is what `connect_ready_sandbox` uses directly to
  chmod and launch the AnyHarness binary itself
  (`materialization/sandbox_io/connect.py:172-197`).
- `run_materialization_script`
  (`server/proliferate/server/cloud/materialization/sandbox_io/commands.py:19-46`)
  — a higher-level helper used by materializers: wraps an arbitrary script
  as `bash -lc <script>`, calls `run_sandbox_command_logged` with it, and
  raises `CloudMaterializationCommandError` if the exit code is non-zero.

Both are direct provider calls against the E2B sandbox (i.e. `provider` is
the `SandboxProvider` for `e2b`,
`server/proliferate/integrations/sandbox/e2b.py`) — there is no
intermediate lease/result-ingest round trip; the calling coroutine awaits
the command and gets the result back in the same call stack.

## Live-Session Command Forwarding (Verified, Separate Path)

This is a distinct path from materialization, used once a sandbox is
`ready` and a client (Desktop/Web/etc.) wants to talk to AnyHarness
directly for a live chat/agent session, terminal, etc.

Router: `server/proliferate/server/cloud/gateway/api.py`, mounted as
`gateway_router` at prefix `{api_prefix}/v1/gateway`
(`server/proliferate/main.py:57,231`) — so the effective paths are under
`/v1/gateway/cloud-sandbox/anyharness/...`.

- `proxy_cloud_sandbox_anyharness_http`
  (`gateway/api.py:26-40`) — catch-all HTTP route
  `/cloud-sandbox/anyharness/{path:path}` for `GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS`.
- `proxy_cloud_sandbox_anyharness_websocket`
  (`gateway/api.py:43-63`) — the same path as a WebSocket route, with its
  own auth (`authenticate_product_user_for_gateway_websocket`, since
  WebSocket upgrade requests can't carry a normal `Authorization` header).

Both resolve `ensure_cloud_sandbox_gateway_access`
(`server/proliferate/server/cloud/gateway/service.py:75-89`), which:

1. checks a 60-second in-process cache keyed by `user_id`
   (`_GATEWAY_ACCESS_CACHE_TTL_SECONDS = 60.0`, `gateway/service.py:38`);
2. on a miss, calls `ensure_cloud_sandbox_ready` (the Step-A DB-row-only
   path from `sandbox-provisioning.md` — this does **not** itself
   provision the E2B VM) and decrypts the runtime token via
   `load_cloud_sandbox_runtime_access`.

Then `proxy_http_to_anyharness` / `proxy_websocket_to_anyharness`
(`server/proliferate/server/cloud/gateway/proxy.py`) forward the request or
WebSocket byte-for-byte to `anyharness_base_url`, injecting the decrypted
bearer token and stripping hop-by-hop/auth headers
(`_STRIP_REQUEST_HEADERS`/`_STRIP_RESPONSE_HEADERS`, `proxy.py:23-40`).
Gateway code here does not parse or reinterpret AnyHarness's command
payloads — it is a byte-level reverse proxy.

### What is confirmed vs. not

**Confirmed by direct read:** the route exists, is mounted, resolves
sandbox access, and reverse-proxies to `anyharness_base_url` for both HTTP
and WebSocket.

**Not verified in this pass / caveats:**
- I did not verify what happens if the gateway proxies a request while
  `connect_ready_sandbox` has not yet been run for this sandbox in this
  process lifetime (i.e. whether `ensure_cloud_sandbox_gateway_access`'s
  call to `ensure_cloud_sandbox_ready` is sufficient to guarantee AnyHarness
  is actually up, given that function only does the cheap DB-row-ensure
  step, not the E2B-provisioning step). If a sandbox row exists with a
  stale `anyharness_base_url` from a previous VM lifetime (e.g. after an
  E2B pause/resume cycle where the process died), I did not trace whether
  the gateway proxy would successfully reach a live AnyHarness or fail —
  that reconciliation (`connect_ready_sandbox`'s health-check-then-relaunch
  logic) is only invoked from the materialization path, not from the
  gateway path, as far as I traced.
- I did not verify client-side (Desktop/Web) code that decides when to use
  this gateway path vs. a local Tauri/AnyHarness runtime — out of scope for
  this pass.
- The 60-second access cache means a sandbox recycled (e.g. destroyed and
  a new row created) could serve stale `upstream_base_url`/token to a
  client for up to 60s after the change; I did not find any cache
  invalidation hook tied to sandbox destroy/recreate.

## Code Map

```text
server/proliferate/server/cloud/materialization/service.py
server/proliferate/server/cloud/materialization/runner.py
server/proliferate/server/cloud/materialization/operation.py
server/proliferate/server/cloud/materialization/locks.py
server/proliferate/server/cloud/materialization/sandbox_io/connect.py
server/proliferate/server/cloud/materialization/sandbox_io/commands.py
server/proliferate/server/cloud/materialization/materialize/sandbox.py
server/proliferate/server/cloud/materialization/materialize/repo_environment.py
server/proliferate/server/cloud/materialization/materialize/secret_set.py
server/proliferate/server/cloud/runtime/sandbox_exec.py
server/proliferate/server/cloud/gateway/api.py
server/proliferate/server/cloud/gateway/service.py
server/proliferate/server/cloud/gateway/proxy.py
server/proliferate/server/cloud/gateway/access.py
```
