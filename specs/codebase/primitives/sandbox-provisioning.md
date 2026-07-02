# Sandbox Provisioning

> Rewritten 2026-07-02 to replace a description of the pre-cutover architecture (PR #809, commit 4b54c9f2b) with the current `cloud_sandbox` model.

Status: Describes shipped, current behavior.

Date: 2026-07-02.

Depends on: none.

This spec describes the current managed cloud sandbox: one E2B microVM per
owner, a `cloud_sandbox` Postgres row per sandbox, lazy two-step
provisioning, E2B webhook reconciliation, and the destroy path.

## Data Model

### `cloud_sandbox`

Model: `CloudSandbox`
(`server/proliferate/db/models/cloud/sandboxes.py:29`).

Columns:

- `id` (`sandboxes.py:54`)
- `owner_user_id` — FK to `user.id`, `ondelete="CASCADE"` (`sandboxes.py:55-58`)
- `sandbox_type` — enum, currently constrained to exactly one value, `'e2b'`,
  by both a Python `CloudSandboxType` enum
  (`server/proliferate/constants/cloud.py:355-356`) and a DB check
  constraint `ck_cloud_sandbox_type` (`sandboxes.py:35-38`)
- `provider_sandbox_id` — the E2B sandbox id, nullable (`sandboxes.py:63-66`)
- `status` — enum with exactly five values, enforced by both the Python
  `CloudSandboxStatus` enum (`constants/cloud.py:359-364`) and a DB check
  constraint `ck_cloud_sandbox_status` (`sandboxes.py:31-34`): `creating`,
  `ready`, `paused`, `error`, `destroyed`
- `anyharness_base_url` (`sandboxes.py:68`)
- `runtime_token_ciphertext` (`sandboxes.py:69`)
- `anyharness_data_key_ciphertext` (`sandboxes.py:70`)
- `ready_at`, `last_health_at`, `destroyed_at` (`sandboxes.py:71-76`)
- `created_at`, `updated_at` (`sandboxes.py:77-82`)

There is no `organization_id` column on the ORM model — I read the full
model and it is not there. The store-layer value type
`CloudSandboxValue` (`server/proliferate/db/store/cloud_sandboxes.py:23-44`)
does carry an `organization_id` field, but `cloud_sandbox_value()`
(`cloud_sandboxes.py:47-70`) always sets it to the literal `None`
(`cloud_sandboxes.py:56`) rather than reading it from a column — it is a
leftover shape from an older value type, not live schema.

Indexes (`sandboxes.py:39-51`):

- `ux_cloud_sandbox_personal_active`: unique partial index on
  `owner_user_id` where `destroyed_at IS NULL` — enforces at most one
  non-destroyed sandbox per owner.
- `ux_cloud_sandbox_provider_sandbox_id`: unique partial index on
  `provider_sandbox_id` where it is not null.
- `ix_cloud_sandbox_owner_user_status`: lookup index.

## Ownership / Isolation Unit

**Implemented today:** exactly one E2B microVM per user (`owner_user_id`).
There is no shared/org-level sandbox mode in this codebase.

- `ensure_organization_cloud_sandbox` unconditionally raises
  `ValueError("Organization cloud sandboxes are not supported.")`
  (`server/proliferate/db/store/cloud_sandboxes.py:177-183`).
- `load_organization_cloud_sandbox` is a stub that discards its arguments
  and always returns `None` (`cloud_sandboxes.py:109-116`).
- `acquire_cloud_sandbox_owner_lock` raises unless
  `owner_scope == "personal"` (`cloud_sandboxes.py:74-88`).
- The only creation path, `ensure_personal_cloud_sandbox`
  (`cloud_sandboxes.py:146-172`), takes `user_id` and always writes
  `owner_user_id`.

**Designed-for invariant** (reserved, not built): the schema is shaped so
that "owner" could later mean an organization instead of a user, with the
same guarantee — exactly one non-destroyed sandbox per owner, never many
sandboxes per owner, never a sandbox shared across owners. The
`organization_id` field surviving in `CloudSandboxValue` and the
`owner_scope: "personal" | ...` branching in the store functions are the
visible seams for that future mode; they are not wired to anything today.

Why one-VM-per-owner: it keeps credential/secret isolation simple — the
isolation boundary is the process/VM boundary, so there's no need for a
second, in-VM multi-tenancy scheme to keep one user's secrets or agent
session state away from another's. It also maps 1:1 to E2B's own billing
unit (a microVM), and it avoids noisy-neighbor problems between unrelated
users' agent sessions sharing one VM's CPU/RAM.

## Provisioning Is Lazy, In Two Distinct Steps

### Step A — DB row creation (cheap, no cloud cost)

`POST /v1/cloud-sandbox/ensure`
(`server/proliferate/server/cloud/cloud_sandboxes/api.py:34-38`) calls
`ensure_cloud_sandbox_ready`, which calls
`ensure_personal_cloud_sandbox_exists`
(`server/proliferate/server/cloud/cloud_sandboxes/service.py:45-62`), which:

1. takes a Postgres advisory lock keyed by owner via
   `acquire_cloud_sandbox_owner_lock`
   (`db/store/cloud_sandboxes.py:74-88`, lock key
   `f"cloud-sandbox:personal:{owner_user_id}"`);
2. ensures a personal billing subject exists;
3. calls `sandbox_store.ensure_personal_cloud_sandbox`
   (`db/store/cloud_sandboxes.py:146-172`): reuses the existing
   non-destroyed row if one is found (`load_personal_cloud_sandbox`,
   `lock_row=True`), otherwise inserts a new row with
   `status="creating"`, `provider_sandbox_id=None`.

No E2B API call happens in this path. `POST .../wake` shares the same code
path (`cloud_sandboxes/service.py:65-66`: `wake_cloud_sandbox` just calls
`ensure_cloud_sandbox_ready`).

### Step B — actual E2B provisioning (real cloud cost)

This happens on first real use of the sandbox, not on `ensure`. The
function is `connect_ready_sandbox`
(`server/proliferate/server/cloud/materialization/sandbox_io/connect.py:56-141`):

1. If `sandbox.destroyed_at` is set or `status == "destroyed"`, raises
   `CloudMaterializationCommandError` (`connect.py:61-62`).
2. If `provider_sandbox_id` is `None`, calls `provider.create_sandbox()`
   — the real E2B call — then persists the id via
   `record_cloud_sandbox_provider_sandbox` and commits (`connect.py:66-79`).
3. Calls `provider.resume_sandbox()` and resolves the runtime endpoint/context
   (`connect.py:81-83`).
4. If a runtime token/data key are already recorded, tries a health check
   plus an auth-enforcement check against the existing `anyharness_base_url`
   (`connect.py:87-97`); on any exception (e.g. a stale/dead process after
   an E2B pause/resume) it falls through to relaunching AnyHarness. If no
   token/data key exist yet, it generates fresh ones and launches directly
   (`connect.py:115-127`).
5. `_launch_anyharness_runtime` (`connect.py:153-227`) writes the launch
   script, `chmod 700`s it, starts AnyHarness detached, waits for health,
   verifies auth is enforced, then also boots a "worker sidecar" process in
   the VM (`launch_worker_sidecar`, see note below), and finally calls
   `mark_cloud_sandbox_ready` and commits.
6. Back in `connect_ready_sandbox`, if the resolved `anyharness_base_url`
   changed, `mark_cloud_sandbox_ready` is called again and committed
   (`connect.py:129-141`).

`mark_cloud_sandbox_ready` (`db/store/cloud_sandboxes.py:222-246`) sets
`status="ready"`, stores `provider_sandbox_id`, `anyharness_base_url`,
the encrypted token/data-key ciphertexts, and `ready_at`/`last_health_at`.

This is invoked from `run_cloud_sandbox_operation`
(`server/proliferate/server/cloud/materialization/operation.py:24-38`),
the shared entrypoint for every materialization operation: it acquires a
Redis lock scoped to `cloud-sandbox:{sandbox.id}`, then calls
`connect_ready_sandbox`, then runs the caller's callback. See
`cloud-commands.md` for the materialization/command-execution side of this.

Note on the "worker sidecar": this is a separate in-VM process
(`server/proliferate/server/cloud/materialization/sandbox_io/worker_sidecar.py:1-9`)
that enrolls back to Cloud, heartbeats, and writes an integration-gateway
dotfile AnyHarness reads at session launch. Its own docstring says booting
is best-effort — "the sandbox is fully usable over its direct AnyHarness
bearer token even if the worker never comes up." Do not confuse this
"worker" with a command queue worker; there is no queue (see
`cloud-commands.md`).

## E2B Webhook Reconciliation

`handle_e2b_webhook`
(`server/proliferate/server/cloud/webhooks/service.py:156-249`) is the only
path in this codebase that reacts to E2B-side state changes Cloud didn't
itself initiate (E2B auto-pausing an idle VM, E2B confirming a kill, etc).

- Verifies the webhook signature (`webhooks/service.py:158`,
  `_verify_e2b_signature`).
- Dedupes by event id via `remember_sandbox_event_receipt` ->
  `remember_cloud_sandbox_event_receipt` (`webhooks/service.py:164-170`);
  a duplicate delivery returns an empty receipt and does nothing else.
- Resolves the `cloud_sandbox` row by provider sandbox id, falling back to
  a `cloud_sandbox_id` in the event's metadata (`webhooks/service.py:175-183`).
- Applies `_should_ignore_sandbox_event` guard logic (`webhooks/service.py:75-89`)
  — e.g. ignores non-`killed` events for an already-destroyed sandbox, and
  ignores stale `created`/`resumed` events that predate a more recent
  `paused` transition.
- Updates `CloudSandbox.status` via `mark_cloud_sandbox_provider_state`
  (`db/store/cloud_sandboxes.py:249-271`).
- Opens/closes billing usage segments
  (`record_cloud_sandbox_usage_started` / `record_cloud_sandbox_usage_stopped`,
  imported at `webhooks/service.py:32-35`) for `created`/`resumed` (open) and
  `paused`/`timeout`/`killed` (close) events (`webhooks/service.py:200-249`).
- **Billing enforcement in the webhook itself:** on `created`/`resumed`, if
  the owner has an active spend hold (checked via
  `get_billing_snapshot_for_subject`), the handler calls
  `provider.pause_sandbox()` directly, closes the usage segment with
  `USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT`, and marks the sandbox
  `paused` — rather than letting the resumed/created VM keep running
  (`webhooks/service.py:203-220`).

## Destroy Path

`DELETE /v1/cloud-sandbox`
(`server/proliferate/server/cloud/cloud_sandboxes/api.py:52-60`) calls
`destroy_cloud_sandbox`
(`server/proliferate/server/cloud/cloud_sandboxes/service.py:73-92`). As of
this worktree it:

1. Loads the sandbox row with `lock_row=True`; returns `None` (204, no-op)
   if there is none (`service.py:76-78`).
2. Revokes active workers/gateway tokens for the sandbox identity via
   `runtime_workers_store.revoke_active_workers_for_identity(db,
   cloud_sandbox_id=sandbox.id)` (`service.py:82`) — this revokes every
   non-`revoked` `CloudRuntimeWorker` row (and its gateway token) scoped to
   the sandbox
   (`server/proliferate/db/store/runtime_workers.py:189-209`), so a
   destroyed sandbox can never re-authenticate to Cloud.
3. If the sandbox actually reached E2B (`sandbox.e2b_sandbox_id` is set),
   calls `provider.destroy_sandbox()` to kill the real microVM. Failure is
   caught and logged as a warning (`logger.warning(...,
   exc_info=True)`), not raised (`service.py:84-91`).
4. Marks the DB row `destroyed` via `mark_cloud_sandbox_destroyed`
   (`db/store/cloud_sandboxes.py:287-302`), which sets `status="destroyed"`
   and `destroyed_at`.

This is the fixed/current behavior: an earlier version of this path was
missing step 3 entirely, so a "destroyed" DB row could leave the real E2B
VM running (and billing) until E2B's own idle timeout — that gap is closed
in this worktree. One known soft spot remains: the failure-handling choice
in step 3 is log-and-continue with no retry and no reconciler behind it —
if `provider.destroy_sandbox()` fails, nothing currently re-attempts it.
The next `ensure` for that user will create a brand-new DB row (the unique
partial index only excludes destroyed rows), so a leaked E2B VM from a
failed destroy would become orphaned from any DB row rather than blocking
the user.

## Superseded / Dead Code

Two modules that a stale prior audit pass mis-identified as live
alternate paths were fully **deleted** by PR #823 ("delete parked cloud
domains and dead consumers") — they do not exist in this worktree at all:

- `server/proliferate/server/cloud/workspaces/lifecycle/api.py` — verified
  gone (`git log --all -- <path>` shows it last touched by the PR #823
  deletion commits; `find` for `lifecycle/api.py` under
  `server/proliferate/server/cloud/workspaces/` returns nothing).
- `server/proliferate/server/cloud/runtime/provision.py`
  (`create_and_connect_sandbox`) — same: deleted by PR #823, not present.

If you are reading an older spec or an old audit note that references
either path, treat it as historical — the current live workspace CRUD
router is `server/proliferate/server/cloud/workspaces/api.py`, mounted as
`workspaces_router` in `server/proliferate/server/cloud/api.py:22,32`
(see `workspace-lifecycle.md`), and the current provisioning entrypoint is
`connect_ready_sandbox` documented above.

## Live Runtime Access (Gateway)

Once a sandbox is `ready`, `/v1/gateway/cloud-sandbox/anyharness/{path}`
(HTTP and WebSocket, mounted at `server/proliferate/main.py:57,231` with
prefix `{api_prefix}/v1/gateway`) authenticates the product user, resolves
`ensure_cloud_sandbox_gateway_access`
(`server/proliferate/server/cloud/gateway/service.py:75-99` — this itself
calls `ensure_cloud_sandbox_ready` then decrypts the runtime token via
`load_cloud_sandbox_runtime_access`), and proxies the request/websocket
directly to `anyharness_base_url` (`server/proliferate/server/cloud/gateway/proxy.py`)
without reinterpreting AnyHarness's command payloads. Gateway access is
cached in-process per user for 60 seconds
(`gateway/service.py:38,75-83`). See `cloud-commands.md` for how this
differs from the materialization command path.

## Code Map

```text
server/proliferate/db/models/cloud/sandboxes.py
server/proliferate/db/store/cloud_sandboxes.py
server/proliferate/server/cloud/cloud_sandboxes/api.py
server/proliferate/server/cloud/cloud_sandboxes/service.py
server/proliferate/server/cloud/materialization/sandbox_io/connect.py
server/proliferate/server/cloud/materialization/sandbox_io/worker_sidecar.py
server/proliferate/server/cloud/materialization/operation.py
server/proliferate/server/cloud/materialization/locks.py
server/proliferate/server/cloud/webhooks/service.py
server/proliferate/server/cloud/webhooks/api.py
server/proliferate/server/cloud/gateway/api.py
server/proliferate/server/cloud/gateway/service.py
server/proliferate/server/cloud/gateway/proxy.py
server/proliferate/integrations/sandbox/e2b.py
server/proliferate/integrations/sandbox/base.py
```
