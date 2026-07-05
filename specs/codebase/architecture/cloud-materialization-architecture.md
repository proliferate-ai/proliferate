# Cloud workspaces — materialization + lifecycle (current on `main`)

> **Changelog:** first cut 2026-07-03 — maps the cloud sandbox materialization +
> workspace-lifecycle stack after the #823/#809 refactors collapsed the old
> managed/profile/target domains and #907/#925 reshaped the agent-auth + worker
> planes.
> **Status:** current-state map, verified file-by-file against `origin/main`
> (through #925 `2803dfbb4`) on 2026-07-03. This branch (`mig/pr-d-desktop-back`)
> carries the in-flight `workspace_moves` stack on top; every path below was
> read at `origin/main` and the core files are byte-identical between the two.
> **Self-hosting:** 🏠 marks deployment knobs; §12 is the checklist + §13 the gaps.
> **Links** are relative from this file (`codex/`); line anchors in prose are ≈.

**Premise:** a cloud workspace is a thin product row; the weight lives one layer
down in **materialization**, the server subsystem that reconciles a per-user E2B
microVM so the AnyHarness runtime inside it finds what it needs on disk — GitHub
credentials, secret env/files, git checkouts, and the agent-auth `state.json`.
Nothing is baked into a durable image. A "materialization operation" is an
in-process async task that (1) takes a Redis lock keyed on the sandbox, (2)
connects to (creating / resuming / health-checking and, if needed, launching the
runtime + worker sidecar inside) it, and (3) pushes files to deterministic paths
over the provider's `write_file` + bash-exec transport. Idempotency is
content-based: DB tracking rows plus per-file manifests written beside each file,
diffed on sha256/fingerprint. Everything is fired **after DB commit** from
neighbouring domains and is **fail-soft** — exceptions are logged and swallowed
at the task boundary; tracking rows record `status=error`.

```
 CONTROL PLANE (server + Postgres)             DATA PLANE (E2B microVM)         RENDER PLANE
 neighbour domains ─ schedule_*() after commit                                 (AnyHarness, Rust)
   github_app / repositories / secrets ─┐      /home/user/
   agent_gateway / workspaces           │        .proliferate/                  reads on launch:
                                        ▼          git/github.com/{token,meta}    - github creds → clone
   runner.run_after_commit ─► asyncio.create_task (fresh DB session)             - secrets/global.env
        │                                          secrets/global.env(+manifest)  - agent-auth state.json
        ▼                                          agent-auth/state.manifest.json  (empty/absent→native)
   run_cloud_sandbox_operation                    bin/git-credential-helper
     ├─ redis lock cloud-sandbox:{id} ◄── serialize ALL ops on one sandbox
     ├─ connect_ready_sandbox ──► E2B create/resume ─► launch AnyHarness+worker
     └─ run(MaterializationContext)                  workspace/repos/{o}/{r}/…     ◄── git checkout
          ├ github_credentials                       workspace/worktrees/{o}/{r}/… ◄── worktree (product)
          ├ secret_set (global/workspace)              .proliferate/anyharness/    ◄── state.json v2
          ├ repo_environment (checkout)
          └ agent_auth (LAST, fail-closed)     E2B webhooks ─► billing usage segments + status sync
   tracking rows: cloud_repo_environment_materialization, cloud_sandbox_secret_materialization
```

Four families of materializer, one rule each: **sandbox** = full bootstrap
(github creds → global secrets → every repo → agent-auth last); **repo_environment**
= clone/checkout + workspace secrets; **secret_set** = global/personal/org/workspace
env+file reconcile; **agent_auth** = the `state.json` v2 auth contract. All four
serialize behind one per-sandbox lock and write through one symlink-hardened
atomic helper.

---

## 1. Package scope — [`cloud/materialization/`](../../../server/proliferate/server/cloud/materialization/)

~2500 LOC. Top-level modules: `service.py` (the only public entrypoint),
`runner.py`, `operation.py`, `locks.py`, `manifests.py`, `paths.py`; plus
subpackages `materialize/` (per-target materializers) and `sandbox_io/`
(the transport to the microVM). The neighbouring product surface is
[`cloud/workspaces/`](../../../server/proliferate/server/cloud/workspaces/) (§9) and the
sandbox-object facade [`cloud/cloud_sandboxes/`](../../../server/proliferate/server/cloud/cloud_sandboxes/) (§10).

[`service.py`](../../../server/proliferate/server/cloud/materialization/service.py)
exposes **four `schedule_*` coroutines** — `schedule_materialize_sandbox`,
`_repo_environment`, `_secret_set`, `_agent_auth` — that fire after commit, and
**four inline `materialize_*` coroutines** that run now. The `schedule_*` wrap
`runner.run_after_commit` + `_spawn`; the inline ones delegate straight into the
`materialize/` submodules. Note `materialize_agent_auth` (inline) actually calls
`agent_auth_materializer.materialize_agent_auth_for_user` — the "for_user" wrapper
that early-returns on never-booted sandboxes (§8.6).

---

## 2. Trigger → run — [`runner.py`](../../../server/proliferate/server/cloud/materialization/runner.py)

Two functions, both deliberately decoupling the HTTP request from the sandbox work.

- **`run_after_commit(db, label, task)`** (≈L18) registers a
  `db_run_after_commit` callback. On the request's commit it does
  `asyncio.create_task(_run)`, where `_run` awaits `task()` and **swallows +
  logs** any exception (tagged with `label`). It never blocks the request and
  never propagates a materialization failure back to the caller.
- **`spawn_materialization_task(fn, **kwargs)` → `_run_with_fresh_session`** (≈L43)
  opens a **brand-new `AsyncSession`** via `async_session_factory()`, runs the
  materializer, commits on success, rolls back + logs on exception. Each spawned
  materialization owns its own DB session independent of the scheduling request —
  which is why a materializer re-loads every row it touches rather than trusting
  objects from the request session.

**Flow (after-commit path):** neighbour mutates config + calls
`schedule_materialize_*` *before* its request commits → `run_after_commit`
registers the callback → on commit, `create_task(_run)` → `_run` awaits
`_spawn(fn)` → `spawn_materialization_task` → `create_task(_run_with_fresh_session)`
→ fresh session runs `fn`.

---

## 3. Operation skeleton + the per-sandbox lock

[`operation.py`](../../../server/proliferate/server/cloud/materialization/operation.py)::
**`run_cloud_sandbox_operation`** (L24) is the shared body every materializer
runs inside:

```python
async def run_cloud_sandbox_operation(db, *, sandbox, operation_key,
        lock_ttl_seconds=600, wait_timeout_seconds=300, run):
    del operation_key                                     # ← intentionally discarded
    async with locks.redis_materialization_lock(f"cloud-sandbox:{sandbox.id}", …):
        target = await sandbox_io.connect_ready_sandbox(db, sandbox=sandbox)
        await run(MaterializationContext(sandbox=sandbox, target=target))
```

The `operation_key` argument is accepted and immediately `del`'d — **the lock is
per-sandbox, not per-operation**. Repo-env, secret-set, agent-auth, and full-sandbox
materialization on the same sandbox all serialize behind one lock. If you add a
materializer, do not expect concurrency with other families on the same sandbox;
design for serialization.

`MaterializationContext` is a frozen dataclass `{sandbox: CloudSandboxValue,
target: SandboxIOTarget}` (L18). `CloudMaterializationError(RuntimeError)` (L14)
is the domain error — e.g. raised when the personal sandbox is missing.

**Lock internals —**
[`locks.py`](../../../server/proliferate/server/cloud/materialization/locks.py)::
`redis_materialization_lock` (≈L55) is a Redis `SET NX EX` lock. Key =
`f"{settings.redbeat_key_prefix}cloud-materialization:{key}"`; token = `uuid4().hex`.
Acquisition polls every 0.5s until `wait_timeout` then raises
`CloudMaterializationLockTimeout`. A background `_renew_lock` task re-`EXPIRE`s
(compare-token Lua) every `max(1, min(60, ttl/3))`s; release is a compare-and-del
Lua script so a stale holder can't release someone else's lock. 🏠 backed by
`settings.redbeat_redis_url` + `redbeat_key_prefix`.

---

## 4. `connect_ready_sandbox` — the boot / wake / launch state machine

[`sandbox_io/connect.py`](../../../server/proliferate/server/cloud/materialization/sandbox_io/connect.py)::
`connect_ready_sandbox` (L55) is the single path that turns a DB `CloudSandbox`
row into a live `SandboxIOTarget`. It is called on **every** operation, so it must
be idempotent and cheap on the warm path.

1. **Reject** if `sandbox.destroyed_at` or `status == 'destroyed'`.
2. `provider = get_sandbox_provider(e2b_template_ref)` — the E2B provider (§10).
3. **Create-if-absent**: if `e2b_sandbox_id is None`, `provider.create_sandbox`
   (tagging metadata `proliferate_cloud_sandbox_id` + owner), persist via
   `record_cloud_sandbox_provider_sandbox` **and commit immediately** (≈L81) — a
   separate small transaction so the E2B id is durable before anything else.
4. `provider.resume_sandbox` (E2B auto-resumes on connect) →
   `resolve_runtime_endpoint` → `resolve_runtime_context`.
5. Decrypt the runtime bearer token + AnyHarness data key from the row.
6. **Warm path**: if both `runtime_token` and `data_key` already exist, verify
   liveness — `wait_for_runtime_health(total_attempts=4)` (L98) +
   `verify_runtime_auth_enforced` — and **only on exception** fall back to
   `_launch_anyharness_runtime`.
7. **Cold path**: if either secret is missing, mint a fresh token
   (`secrets.token_urlsafe(32)`) + data key (`generate_anyharness_data_key`) and
   **always launch**.

**`_launch_anyharness_runtime`** (≈L153) writes the launcher script
(`build_runtime_launch_script` / `build_runtime_env`), `chmod 700`, runs a
detached launch command, waits for health (`total_attempts=30` × 0.5s, ≈L201),
verifies auth enforced, launches the worker sidecar (§5), then
`mark_cloud_sandbox_ready` + commit. Back in `connect_ready_sandbox`, if
`anyharness_base_url` changed it re-`mark_cloud_sandbox_ready` keeping existing
ciphertexts (encrypt only when null). Returns
`SandboxIOTarget{provider, sandbox(provider handle), endpoint, runtime_context}`.

The launch script always passes `--require-bearer-auth`, adds `--disable-cors`
when the provider's runtime endpoint already handles CORS, and
`--host 0.0.0.0 --port <runtime_port>` (8457). `build_runtime_env` injects
`ANYHARNESS_BEARER_TOKEN` + `ANYHARNESS_DATA_KEY`, and always `ANYHARNESS_DEV_CORS=1`
and `ANYHARNESS_DEFER_STARTUP_RETENTION=1` (so the ephemeral sandbox
doesn't run a worktree-retention pass at boot), plus optional `ANYHARNESS_SENTRY_*`
gated on `is_vendor_telemetry_enabled()`. (`ANYHARNESS_RUNTIME_TARGET_ID` is set
only when a `target_id` is passed — the cloud connect path passes none, so it is
absent here.)

---

## 5. The worker sidecar — [`sandbox_io/worker_sidecar.py`](../../../server/proliferate/server/cloud/materialization/sandbox_io/worker_sidecar.py)

`launch_worker_sidecar` (L44) boots the Proliferate worker binary next to
AnyHarness. It is **best-effort**: any exception is caught, logged as a WARNING
cloud event, and swallowed — the sandbox is fully usable over the direct
AnyHarness bearer token without a worker.

The subtle ordering: it mints a cloud-sandbox enrollment in its **own fresh
transaction** (`run_with_fresh_session` + `create_cloud_sandbox_enrollment`, TTL
3600s) and commits it **before** the separate worker OS process can try to consume
it — otherwise the nohup'd worker could race ahead of the un-committed token. Then
it writes `build_worker_config` to `worker_config_path` and `nohup`-launches
`worker_binary_path` if `test -x`.

🏠 If `settings.cloud_worker_base_url` is empty **and** `api_base_url` is empty,
`launch_worker_sidecar` returns early — no worker, sandbox still works. The
generated config sets `self_update_enabled=true` for sandbox sidecars (they have
no supervisor, so they self-swap onto the heartbeat's `desiredVersions`); desktop
workers never set this. Worker enroll/heartbeat/self-update mechanics are the
runtime-worker plane — out of scope here except that #925 changed what the worker
*does* after boot, not how the sidecar is launched.

---

## 6. `sandbox_io` transport + paths

The transport is the file-push (`provider.write_file`) + exec halves.

- **Exec** —
  [`commands.py`](../../../server/proliferate/server/cloud/materialization/sandbox_io/commands.py)::
  `run_materialization_script` (L19) runs `bash -lc <shlex-quoted>` via
  `run_sandbox_command_logged(...)`. Non-zero exit →
  `CloudMaterializationCommandError` with label + code + truncated stderr/stdout.
- **Atomic write** —
  [`files.py`](../../../server/proliferate/server/cloud/materialization/sandbox_io/files.py)::
  `write_private_file_atomic` (L16) writes to a per-op temp dir
  `~/.proliferate/materialization/tmp/{operation_id}/{random}`, then a second
  script `chmod`s and `mv -f`s into place. **Both** scripts run
  `path_safety` preflight (`safety.py`): `ensure_safe_target_parent` rejects a
  non-absolute path, **any symlink path component**, and (if `allowed_root`
  given) any parent whose `realpath -m` escapes the jail — all via **exit 47**.
  It also refuses to overwrite/`mv` if the target or temp is itself a symlink.
  Default mode `600`.
- **Cleanup** — `remove_owned_files` (L85) `rm -f`s a set of paths, each guarded
  by the same preflight. Used to delete files a materializer previously owned but
  no longer wants (secret-file reconcile, agent-auth teardown).

**Deterministic paths —**
[`paths.py`](../../../server/proliferate/server/cloud/materialization/paths.py):

| Constant / helper | Value |
|---|---|
| `SANDBOX_HOME` | `/home/user` |
| `SANDBOX_WORKSPACE_ROOT` | `/home/user/workspace` |
| `SANDBOX_REPOS_ROOT` | `…/workspace/repos` |
| `PROLIFERATE_HOME` | `/home/user/.proliferate` |
| `ANYHARNESS_HOME` | `…/.proliferate/anyharness` |
| `repo_path(env)` | `…/repos/{owner}/{repo}` |
| github token / meta | `…/.proliferate/git/github.com/{token,meta.json}` |
| credential helper | `…/.proliferate/bin/proliferate-git-credential-helper` |
| agent-auth **contract** | `$ANYHARNESS_HOME/agent-auth/state.json` |
| agent-auth **manifest** | `$PROLIFERATE_HOME/agent-auth/state.manifest.json` |
| global secrets | `$PROLIFERATE_HOME/secrets/{global.env,global.manifest.json}` |
| workspace secrets | `{repo}/.proliferate/env/{workspace.env,workspace.manifest.json}` |

The split between the **contract** file (what the runtime reads, under
`ANYHARNESS_HOME`) and the server-owned **manifest** (change-detection sidecar,
under `PROLIFERATE_HOME`) is deliberate — the runtime never sees the manifest.
🏠 These are hardcoded constants, not per-deployment configurable.

---

## 7. The materializers — [`materialize/`](../../../server/proliferate/server/cloud/materialization/materialize/)

### 7.1 `sandbox.py` — full bootstrap (L22)

`materialize_sandbox` loads the personal sandbox (raises
`CloudMaterializationError('cloud_sandbox_missing')` if absent) and, under **one**
operation lock, runs in order: **github_credentials → global secrets → each cloud
`repo_environment`** (loop over `list_cloud_repo_environments`, calling
`materialize_repo_environment_in_context`) **→ agent_auth LAST**. Agent-auth is
deliberately last and fail-closed so an unsatisfiable selection (e.g. an
enrollment still syncing) doesn't block the rest of bootstrap; the
enrollment-sync trigger re-materializes it later.

### 7.2 `repo_environment.py` — clone/checkout + workspace secrets (L21)

`materialize_repo_environment` loads the repo env, **early-returns if `None` or
`environment_kind != 'cloud'`**, ensures the personal sandbox exists, then
`begin_repo_environment_materialization` (status → `running`, capture
`attempt_updated_at`) + **commit before any sandbox I/O**, then runs the op. The
`attempt_updated_at` is an optimistic-concurrency token: every terminal write
passes `expected_updated_at=attempt_updated_at`, so a newer scheduled attempt
that bumped the row wins and a stale attempt no-ops instead of clobbering.

The in-context body (`materialize_repo_environment_in_context`, ≈L67) re-loads
the repo env, asserts `require_github_cloud_repo_authority`, materializes github
creds (§7.3), runs the git checkout script (§7.4), materializes workspace secrets
(§7.5), builds a `repo_manifest` (+`githubCredential` block), and
`mark_repo_environment_materialization_ready` (CAS-guarded) + commit. On **any**
exception it marks `status=error` (truncated 2000 chars, CAS-guarded) and
re-raises — caught+logged at the task boundary. No automatic retry inside.

### 7.3 `github_credentials.py` — clone creds (L29)

`materialize_github_credentials` **always** mints from
`ensure_fresh_github_app_authorization(user_id)` — the user's own GitHub App
**user-to-server** OAuth token, **never** a GitHub App *installation* token
(installation tokens are used only for the Issues integration). Writes `token`
(mode 600) + `meta.json` (`tokenKind='github_app_user_to_server'`, actorLogin,
actorId, leaseId, issuedAt/expiresAt/refreshAfter — expiry default +8h,
refreshAfter = expiry−30min), then `_ensure_git_credential_helper_configured`
asserts the helper is executable, returns `username=x-access-token`, and sets git
`credential.helper` + `url.insteadOf` rewrites for `git@github.com:` and
`ssh://git@github.com/`. Returns a `GitHubCredentialMaterializationResult` used in
the repo manifest.

### 7.4 `_materialize_git_checkout` — the defensive clone (≈L138)

A `set -eu` bash script (600s timeout) that clones
`https://github.com/{owner}/{repo}.git` into `repo_path` if missing (else
fetches). **Refuse-to-destroy exit codes:**

| exit | condition |
|---|---|
| 42 | path exists but is **not** a git repo |
| 43 | working tree **dirty** (`git status --porcelain` non-empty) |
| 44 | branch has **local commits ahead** of origin |

It resolves the default branch via `git ls-remote --symref … HEAD` when unset
(fallback `main`), ends with `git reset --hard origin/$default_branch`, and prints
the resolved branch. This is why a user's uncommitted work in a cloud checkout is
never silently reset.

### 7.5 `secret_set.py` — env/file reconcile (L19)

`materialize_secret_set` dispatches on `scope_kind`:
- `personal` → `_materialize_global_for_user(user)`.
- `organization` → `_materialize_global_for_user` for **every** org member.
- `workspace` → ensure sandbox + `materialize_workspace_secrets_for_repo_environment`
  (skipped if the repo env is not cloud).

Global merges org payloads + the personal payload; workspace merges only the one
workspace payload. Both global and workspace paths (≈L130):
`begin_*_secret_materialization` (row → `running`) + commit → merge payloads into
`env/env_sha256/files/files_sha256/versions` → `write_private_file_atomic` the
`.env` (mode 600, workspace **jailed to `allowed_root=repo_root`**) →
`_reconcile_secret_files` writes every desired file and `remove_owned_files` for
previous-manifest-owned files no longer desired → write the manifest
(`secret_manifest{env, files, versions}`) → `mark_secret_materialization_ready`
(`applied_version=max(versions)`, `applied_versions`, `applied_manifest`). On
exception mark error + commit + re-raise.

Unlike repo materializations, **secret ready/error has no `expected_updated_at`
CAS** — the per-sandbox lock is what serializes concurrent secret writers.

### 7.6 `agent_auth.py` — `state.json` v2 (L287)

`materialize_agent_auth` reconciles the **auth-only** contract for AnyHarness.
`build_agent_auth_state` loads enabled auth-selection rows for `surface='cloud'`,
resolves decrypted `api_key` values + the gateway virtual key **only if**
enrollment `sync_status=='synced'` **and** a public base URL is configured, and
renders `{version, revision, user_id, harnesses:[{harness_kind,
sources:[gateway|api_key]}]}`. A harness with zero resolvable sources is omitted;
a single unsatisfiable source is **dropped and logged, never raised**.

Change-detection is a **sha256 fingerprint** of the canonical JSON stored in the
server-owned manifest (§6):

- `harnesses` empty → `remove_owned_files` deletes **both** `state.json` and its
  manifest (reader finds none → native; cloud launch fail-closes in the Rust
  launcher, not here). — L298
- else previous manifest `fingerprint == current` → return, no write. — L310
- else write `state.json` (600) + manifest `{fingerprint, path, revision}`.

`revision = max(updated_at ms)` across **all** surface rows (enabled or not), so
disabling a source still advances the revision — satisfying the runtime's
stale-push protection.

`materialize_agent_auth_for_user` (L334, the `schedule_*` path) **only refreshes
already-booted sandboxes**: it returns early if the personal sandbox is `None`,
destroyed, or `e2b_sandbox_id is None` — a never-booted sandbox picks up state
during full `materialize_sandbox` bootstrap instead.

---

## 8. Data model — the control-plane tables

- **`cloud_sandbox`** —
  [`db/models/cloud/sandboxes.py`](../../../server/proliferate/db/models/cloud/sandboxes.py)
  (L28). One active personal sandbox per user via **partial unique index**
  `ux_cloud_sandbox_personal_active(owner_user_id) WHERE destroyed_at IS NULL`.
  Columns: `owner_user_id` (FK user CASCADE), `sandbox_type` (only `'e2b'`),
  `provider_sandbox_id` (nullable, unique-when-set), `status`
  ∈ {creating, ready, paused, error, destroyed}, `anyharness_base_url`,
  `runtime_token_ciphertext`, `anyharness_data_key_ciphertext`, `ready_at`,
  `last_health_at`, `destroyed_at`. The store's **`CloudSandboxValue`** renames
  `provider_sandbox_id → e2b_sandbox_id`, `sandbox_type → e2b_template_ref`,
  `runtime_token_ciphertext → anyharness_bearer_token_ciphertext`, and synthesizes
  vestige fields (`organization_id=None`, `billing_subject_id=None`,
  `last_error=None`, `runtime_generation=0`) kept for API-shape stability (§13).
- **`cloud_repo_environment_materialization`** —
  [`repositories.py`](../../../server/proliferate/db/models/cloud/repositories.py) (L129).
  One row per `(cloud_sandbox_id, repo_environment_id)` (unique). `status`
  ∈ {pending, running, ready, error}; `applied_repo_environment_updated_at` (the
  `repo_environment.updated_at` successfully applied = staleness marker);
  `applied_manifest_json` (the repo_manifest incl. githubCredential actor/expiry);
  `last_error`; `materialized_at`. The resume/idempotency ledger for checkouts.
- **`cloud_sandbox_secret_materialization`** —
  [`secrets.py`](../../../server/proliferate/db/models/cloud/secrets.py) (L166).
  `materialization_kind` ∈ {global, workspace}; one global row per sandbox and one
  workspace row per `(sandbox, repo_environment)` via partial unique indexes.
  `sandbox_generation`, `applied_version`, `applied_versions_json`,
  `applied_manifest_json` (sha256s → drives the file-reconcile diff), `status`,
  `last_error`, `materialized_at`.
- **`cloud_secret_set`** (L51) — `scope_kind` ∈ {personal, organization,
  workspace} with a CHECK enforcing exactly one of
  `user_id/organization_id/repo_environment_id` set, plus partial unique indexes
  for one set per scope-owner. `version` (int, bumped on edit) is the monotonic
  counter materialization compares. Child tables `cloud_secret_env_var` /
  `cloud_secret_file` store `value/content_ciphertext` + `*_sha256` + `byte_size`.
- **`repo_environment`** (L77) — `environment_kind` ∈ {local, cloud}; a cloud env
  has `local_path`/`desktop_install_id` NULL and is unique per repo_config
  (`ux_repo_environment_cloud`). Materialization reads `git_owner`/`git_repo_name`
  (via repo_config join), `default_branch`, `setup_script`, `run_command`,
  `user_id`, `updated_at`. **Only `environment_kind=='cloud'` rows are ever
  materialized.**

**Store CAS/upsert** — `begin_repo_environment_materialization` uses
`pg_insert … ON CONFLICT DO UPDATE` to set `status=running`;
`mark_repo_environment_materialization_ready/_error` take `expected_updated_at`
and no-op if `row.updated_at` changed
([`cloud_repo_environment_materializations.py`](../../../server/proliferate/db/store/cloud_repo_environment_materializations.py) L157).
`begin_global/workspace_secret_materialization` similarly upsert on the partial
unique index, but `mark_secret_materialization_ready` has **no CAS**
([`cloud_sandbox_secrets.py`](../../../server/proliferate/db/store/cloud_sandbox_secrets.py) L210).

---

## 9. Cloud workspaces — the thin product row

[`cloud/workspaces/`](../../../server/proliferate/server/cloud/workspaces/) is a flat
`api.py` / `service.py` / `models.py` trio on `main` (the `domain/`,
`provisioning/`, `lifecycle/`, `target_launch/`, `remote_access/` subdirs a reader
might expect **do not exist** here — see §13). Real provisioning lives in
`cloud_sandboxes` + `materialization` + the AnyHarness integration client.

**`cloud_workspace`** —
[`db/models/cloud/workspaces.py`](../../../server/proliferate/db/models/cloud/workspaces.py)
(L13) records only identity + a pointer: `id`, `owner_user_id` (FK user CASCADE),
`repo_environment_id` (FK **RESTRICT**), `display_name`, `git_branch`,
`git_base_branch`, `anyharness_workspace_id` (nullable until the worktree exists),
`created_at`, `updated_at`, `archived_at`. **There is no persisted status/error
column.** Three indexes (L15): active-branch uniqueness
`ux_cloud_workspace_active_repo_environment_branch(owner, repo_env, branch) WHERE
archived_at IS NULL`; active anyharness-id uniqueness; and a non-unique repo-env
index.

**Status is derived, never stored** —
[`service.py`](../../../server/proliferate/server/cloud/workspaces/service.py)::
`_workspace_status` (L515): `archived` if `archived_at`, else `materializing` if
`anyharness_workspace_id` falsy, else `ready`. `_runtime_status` (L523) maps
`sandbox.status` → {running, pending, paused, error, disabled}. The wire enum
`CloudWorkspaceStatus` includes `pending|error` but workspaces only ever emit
`materializing|ready|archived`. Many `WorkspaceSummary` fields are hardcoded
constants (`allowed_agent_kinds=['claude','codex','opencode','grok']`,
`sandbox_type='managed_personal'`, `post_ready_phase='idle'`, `ready_at=created_at`,
`execution_target`/`cloud_access` inert placeholders) — the only surviving trace
of the `target_launch`/`remote_access` concepts.

**Create (synchronous, blocking)** — `create_cloud_workspace_for_user` (L82):
1. trim/validate owner+repo+branch → load cloud repo_environment (404 if missing);
2. `require_github_cloud_repo_authority` + `get_repo_branches_for_credentials`
   (GitHub API); resolve base_branch (body | env.default_branch | GitHub default);
3. compute taken names (GitHub branches + active workspace branches); resolve the
   final branch — explicit names 409-pre-check (`github_branch_already_exists` /
   `cloud_branch_already_exists`), generated names made unique via
   `resolve_generated_branch_name`; validate display name (≤160 chars, L47);
4. **`materialize_repo_environment` INLINE** (L182) — not the after-commit variant
   — so the sandbox exists and the repo is checked out before the worktree POST;
5. `_create_workspace_row_with_branch_retry` (L385): INSERT inside
   `db.begin_nested()`, `IntegrityError → None`, up to 5 attempts (generated names
   recompute a fresh name; explicit names 409 immediately; exhaustion →
   `cloud_branch_generation_failed`);
6. `_load_ready_runtime_access` (decrypt runtime url/token/data_key; 409 if sandbox
   missing/not ready) → `_resolve_repo_root` (POST runtime `/v1/workspaces/resolve`)
   → `_create_anyharness_worktree` (POST `/v1/workspaces/worktrees`) →
   `update_workspace_anyharness_workspace_id` stores the returned id — the row now
   derives status `ready`.

The worktree target path (`_worktree_path`, L537) is deterministic:
`{SANDBOX_WORKSPACE_ROOT}/worktrees/{owner}/{repo}/{sanitized-branch[:96]}-{workspace_id[:8]}`.
`create_remote_worktree_workspace`
([`integrations/anyharness/workspaces.py`](../../../server/proliferate/integrations/anyharness/workspaces.py) L157)
POSTs `checkoutMode:'new_branch', nameConflictPolicy:'fail'` with a 180s timeout;
on HTTP 409 it falls back to `resolve_runtime_workspace(targetPath)` to recover the
existing id (idempotency). Runtime failures → `CloudRuntimeReconnectError` →
`CloudApiError` 502.

**Lifecycle (pure DB, runtime untouched)** — archive sets `archived_at`; restore
clears it inside a savepoint (IntegrityError → 409 `cloud_branch_already_exists`);
delete hard-deletes the row. **None of these tear down the AnyHarness worktree.**

**API** — router mounted at `{api_prefix}/v1/cloud`: `GET/POST /workspaces`,
`GET /workspaces/{id}`, `…/runtime-status`, `PATCH …/display-name`,
`POST …/archive|restore`, `DELETE …` (204). The sibling `worktree_policy` router
(`GET/PUT /worktree-retention-policy`) persists an account-scoped retention
setting (max materialized worktrees per repo, 10–100, default 20) that **has no
wired runtime consumer** on `main` (§13).

---

## 10. Sandbox object + E2B provider + webhooks

[`cloud/cloud_sandboxes/service.py`](../../../server/proliferate/server/cloud/cloud_sandboxes/service.py)
is a deliberately-small facade (its docstring says so — the old profile/target
stack is parked). **`ensure_personal_cloud_sandbox_exists`** takes a **Postgres
advisory xact lock** (`pg_advisory_xact_lock(hashtextextended('cloud-sandbox:personal:{user_id}',0))`)
before the get-or-create, links a billing subject, and inserts a `status='creating'`
row **without any E2B call** — the first materialization does the real E2B create.
This is a **distinct lock mechanism** from the Redis materialization lock: advisory
lock guards DB-row creation, Redis lock guards sandbox_io. **`destroy_cloud_sandbox`**
row-locks the sandbox, **revokes active runtime workers first**
(`revoke_active_workers_for_identity`), then marks the row destroyed — ordering
guarantees a destroyed sandbox's worker/gateway token can never re-authenticate.
Organization-scoped sandboxes are explicitly unsupported (raise / return None).

The **provider abstraction** lives outside materialization, in
[`integrations/sandbox/`](../../../server/proliferate/integrations/sandbox/): a
`SandboxProvider` Protocol (`create/connect/resume/get_state/pause/destroy/
run_command/write_file`, + `resolve_runtime_endpoint/context`) with a single
`E2BSandboxProvider`; `factory.get_sandbox_provider` raises for any non-`e2b` kind.
🏠 E2B constants (`constants/sandbox/e2b.py`): template `'base'` (override
`e2b_template_name`), `E2B_TIMEOUT_SECONDS=2700`, runtime port 8457, workdir
`/home/user/workspace`. `create_sandbox` sets
`lifecycle={'on_timeout':'pause','auto_resume':True}` — E2B auto-pauses on idle
rather than killing. `resume_sandbox` and `connect_running_sandbox` are the same
`Sandbox.connect` call.

**E2B webhooks** (`cloud/webhooks/service.py`) drive a parallel state-sync +
billing path independent of the request flow. `handle_e2b_webhook` verifies the
HMAC signature, dedupes by provider event id, resolves the row by
`provider_sandbox_id` (or metadata `cloud_sandbox_id`), drops post-destroy and
stale (`event_timestamp <= sandbox.updated_at`) events, then: **created/resumed**
→ if billing is in enforce mode with an active spend hold it pauses synchronously +
closes the usage segment (`closed_by=quota-enforcement`) + `status=paused`, else
opens a usage segment + `status=ready`; **paused/timeout** → close segment +
`status=paused`; **killed** → close segment + `status=destroyed`.

---

## 11. Trigger map — who calls what, and when

| Caller | Trigger | Schedules |
|---|---|---|
| `github_app/service.py` L301 | after GitHub App OAuth callback | `ensure_personal_cloud_sandbox_exists` + `schedule_materialize_sandbox(user)` |
| `github_app/service.py` L417 | after installation (re)bind | `schedule_materialize_repo_environment` for every cloud repo env of that owner |
| `repositories/service.py` L176 | repo env created/updated | `schedule_materialize_repo_environment` |
| `secrets/service.py` (~15 sites) | env-var/file create/update/delete | `schedule_materialize_secret_set` |
| `agent_gateway/service.py` L237, `enrollment.py` L292 | auth selection change / enrollment synced | `schedule_materialize_agent_auth` |
| **`cloud/workspaces/service.py` L182** | workspace creation | **inline `materialize_repo_environment`** (blocking, not scheduled) |

All except workspace-create fire after commit. Workspace-create is the one
synchronous caller because the repo must be checked out before the worktree POST.

---

## 12. 🏠 Self-hosting checklist + knobs

Everything is in [`config.py`](../../../server/proliferate/config.py) unless noted.

- **Redis lock** — `redbeat_redis_url` (default `redis://127.0.0.1:6379/0`) +
  `redbeat_key_prefix` (`'redbeat:proliferate:'`). Required; the materialization
  lock lives here.
- **E2B** — `e2b_api_key` (required for any real sandbox; unset →
  `E2BRuntimeError` pointing at `server/.env`), `e2b_template_name`,
  `e2b_webhook_signature_secret` (missing → 503 on the webhook).
- **Agent-auth gateway** — `agent_gateway_litellm_public_base_url` (default `''`);
  **empty drops gateway sources loudly** (api_key sources still work).
- **Worker sidecar** — `cloud_worker_base_url` (falls back to `api_base_url`; both
  empty → no worker boots, sandbox still usable). `cloud_runtime_source_binary_path`
  / `cloud_worker_source_binary_path` / `cloud_supervisor_source_binary_path` are
  local-dev overrides for the binaries pushed into sandboxes.
- **Encryption** — `cloud_secret_key` (Fernet) encrypts the runtime token + data
  key + all secret ciphertexts.
- **Runtime auth** — `cloud_jwt_*` (issuer, `audience_anyharness='anyharness'`,
  `direct_attach_ttl_seconds=1200`, signing keys).
- **Lifecycle bounds** — `cloud_concurrent_sandbox_limit` (200),
  `cloud_free_sandbox_hours` (2000.0), `cloud_free_repo_limit`/`cloud_paid_repo_limit`
  (2/4), `cloud_billing_mode` (`'off'`).
- **Code constants** (not env): `run_cloud_sandbox_operation` `lock_ttl_seconds=600`
  / `wait_timeout_seconds=300`; git checkout script 600s; worktree POST 180s,
  resolve 15s; health attempts 4 (warm) / 30×0.5s (cold); display-name cap 160;
  worktree retention 10–100/default 20. All hardcoded sandbox paths in `paths.py`.

---

## 13. Open gaps + vestiges

Several things a reader will trip over exist only as inert shells or dead code on
`main`, and one in-flight stack will soon extend this model:

**Dead / stubbed on `main`.** The `worktree_policy` retention setting is settable
and persisted but `load_worktree_retention_policy_for_runtime`
([`worktree_policy/service.py`](../../../server/proliferate/server/cloud/worktree_policy/service.py) L93)
has **no callers** — no runtime cleanup enforces it yet (the actual pruning lives
in the anyharness runtime's own retention pass, gated off at boot by
`ANYHARNESS_DEFER_STARTUP_RETENTION`). The plain-OAuth repo-credential path in
[`repos/service.py`](../../../server/proliferate/server/cloud/repos/service.py)
(`CloudRepoUserLike`, `get_linked_github_account`,
`build_cloud_repo_credentials_for_user`, `get_repo_branches_for_user`) has no live
callers — all real request paths route through the GitHub App user-authorization
token. `CloudSandboxValue` synthesizes `organization_id`/`billing_subject_id`/
`last_error`/`runtime_generation` that no column backs, and org-scoped sandboxes
raise everywhere. `WorkspaceSummary.execution_target`/`cloud_access` and the
proliferate-**supervisor** launch plumbing in `runtime/bootstrap.py` are present
but unwired (only the plain-nohup worker path is live). The `cloud/workflows/` dir
the brief expected **does not exist** on `main`; the `domain/`/`provisioning/`/
`lifecycle/`/`target_launch/`/`remote_access/` workspace subdirs likewise don't
exist — the module was collapsed by #823/#809.

**The anyharness mobility engine has zero callers on `main`.** The AnyHarness
integration client exposes `prepare_runtime_mobility_destination` /
`destroy_runtime_mobility_source`, and the anyharness-side worktree domain retains
a full mobility/re-adopt engine (`create_worktree_at_ref`, park-local, preserve-
native), but nothing in the server's workspace CRUD invokes it — it's the
substrate a workspace-move flow would sit on, not wired into materialization or
workspaces today.

**In flight (`#913`–`#916`, the `workspace_moves` stack).** This branch
(`mig/pr-d-desktop-back`) already carries `cloud/workspace_moves/`, `cloud/mobility/`,
and re-materialized `workspaces/{domain,provisioning,lifecycle,target_launch,
remote_access}/` subdirs that will extend the model above: moving a workspace's
materialized checkout between the cloud sandbox and an independent local workspace,
re-using the mobility engine and the retention policy this doc lists as currently
dead. When that lands, §9's "lifecycle is pure DB, runtime untouched" and §13's
"mobility engine has zero callers" will both need revisiting.
