# Sandbox Provisioning

Status: Stack 1 implementation contract.

Date: 2026-06-24.

This spec describes the managed cloud sandbox foundation after the Stack 1
cutover. The control plane provisions a single E2B-backed sandbox for a user,
starts AnyHarness inside that sandbox, records the minimal runtime access
material needed by the server, and treats AnyHarness SQLite inside the sandbox
as the source of truth for runtime workspaces and sessions.

Daytona support has been removed. The managed sandbox provider is E2B.

## Goals

- Keep the sandbox primitive small enough to reason about.
- Provision one active personal cloud sandbox per user for now.
- Keep cloud repo configuration in the control plane, but materialize configured
  repos into the sandbox when a sandbox exists.
- Preserve runtime truth inside AnyHarness rather than projecting every runtime
  workspace into Cloud DB.
- Store enough encrypted access metadata for the upcoming gateway to authenticate
  a user once and proxy through to the sandbox-local AnyHarness instance.

## Data Model

### `managed_sandbox`

One row represents one provider sandbox owned by a personal user or
organization. The product currently uses the personal path; organization fields
exist so the model does not need another migration when shared sandboxes are
enabled.

Important columns:

- `owner_scope`: `personal` or `organization`.
- `owner_user_id` / `organization_id`: exactly one is set, matching
  `owner_scope`.
- `created_by_user_id`: the user who first requested the sandbox.
- `billing_subject_id`: billing subject used for provisioning and future
  wake/start gating.
- `status`: `creating`, `starting`, `ready`, `paused`, `error`, or `destroyed`.
- `last_error`: last provisioning or lifecycle error surfaced to the UI.
- `e2b_sandbox_id`: provider sandbox id.
- `e2b_template_ref`: E2B template ref used for this sandbox.
- `anyharness_base_url`: private/public E2B host URL for the sandbox
  AnyHarness server.
- `anyharness_bearer_token_ciphertext`: encrypted runtime bearer token accepted
  by sandbox AnyHarness.
- `anyharness_data_key_ciphertext`: encrypted AnyHarness data key used by the
  runtime.
- `runtime_generation`: increments when the provider sandbox or AnyHarness
  access tuple changes.
- `ready_at`, `last_health_at`, `destroyed_at`: lifecycle timestamps.

Active uniqueness is enforced with partial indexes:

- one non-destroyed personal sandbox per `owner_user_id`;
- one non-destroyed organization sandbox per `organization_id`.

Destroyed rows remain as audit history. A later ensure creates a fresh row.

### `managed_sandbox_repo_materialization`

One row tracks the application of a configured `cloud_repo_config` into a
managed sandbox.

Important columns:

- `managed_sandbox_id`
- `cloud_repo_config_id`
- `sandbox_generation`: generation of the sandbox runtime this attempt applies
  to.
- `status`: `pending`, `running`, `ready`, `error`, or `disabled`.
- `repo_path`: canonical path inside the sandbox, currently
  `/home/user/workspace/repos/{owner}/{repo}`.
- `anyharness_repo_root_id`
- `anyharness_workspace_id`
- `applied_files_version`
- `applied_setup_script_version`
- `applied_env_vars_version`
- `last_error`, `last_attempted_at`, `materialized_at`

The unique key is `(managed_sandbox_id, cloud_repo_config_id)`.

## Provisioning Flow

### 1. Template

The E2B template is built out of band and referenced by `E2B_TEMPLATE_NAME`.
The template should include:

- AnyHarness runtime binary;
- proliferate worker/supervisor binaries when required by later stacks;
- agent installations and seed assets that are safe to pre-bake;
- a blank writable workspace area.

Self-hosted deployments use the same `E2B_TEMPLATE_NAME` config shape. There is
no `SANDBOX_PROVIDER` switch.

### 2. Ensure Sandbox

The user-facing ensure endpoint is:

```text
POST /v1/cloud/managed-sandbox/ensure
```

The server:

1. authenticates the user with the normal product JWT;
2. ensures the user's personal billing subject;
3. acquires an owner advisory lock;
4. reuses the non-destroyed `managed_sandbox` row if one exists, otherwise
   inserts a `creating` row;
5. reuses a healthy recorded AnyHarness runtime when possible;
6. otherwise creates or resumes an E2B sandbox from `E2B_TEMPLATE_NAME`;
7. uploads/executes the AnyHarness launch script;
8. waits for AnyHarness health and auth to pass;
9. encrypts and stores runtime access metadata;
10. marks the row `ready` and increments `runtime_generation` when the runtime
    tuple changed;
11. best-effort reconciles configured GitHub repos into the sandbox.

Long-running provisioning is currently request-driven. Service code commits at
phase boundaries so provider work is not held inside one database transaction.
If/when this moves to a background job, keep the same state transitions and
owner lock semantics.

### 3. Wake

The wake endpoint is:

```text
POST /v1/cloud/managed-sandbox/wake
```

It shares the ensure flow, but callers should treat it as "make the existing
sandbox usable again" rather than "create a product workspace." Wake may resume
the E2B sandbox, relaunch AnyHarness, update runtime access, and reconcile repos.

### 4. Destroy

The destroy endpoint is:

```text
DELETE /v1/cloud/managed-sandbox
```

The server asks E2B to kill the sandbox when an E2B id is present, then marks
the row `destroyed`. The next ensure creates a new row because active uniqueness
excludes destroyed rows.

## Repo Configuration And Materialization

`cloud_repo_config` remains the control-plane object for "this GitHub repo is
enabled for cloud use." The same DB object supports:

- local only: repo exists on disk, no configured cloud repo row;
- local + cloud: local repo root matches a configured cloud repo row;
- cloud only: configured cloud repo row exists with no local checkout.

Desktop settings builds repository entries from both local repo roots and cloud
repo configs. A configured cloud repo with no local checkout is represented as a
cloud-only repository entry and does not expose local file-picking controls.

When a repo config is saved, bootstrapped, or a tracked file changes, the server
schedules a post-commit best-effort materialization if the user has a ready
managed sandbox and a ready GitHub grant.

Materialization currently:

1. clones or fetches the GitHub repo inside the sandbox;
2. uses a temporary `GIT_ASKPASS` script and never persists the token in the
   remote URL;
3. checks out the configured default branch when available;
4. writes tracked file contents from `cloud_repo_config`;
5. resolves a runtime workspace in AnyHarness for the repo path;
6. optionally starts setup through AnyHarness when setup is configured;
7. records applied file/setup/env versions in
   `managed_sandbox_repo_materialization`.

Manual git setup is acceptable during this Stack 1 transition, but the DB rows
must still be able to reconcile later when a sandbox is created after repo
configuration already exists.

## Runtime Truth

Cloud DB does not own runtime workspace/session truth for managed sandboxes.
AnyHarness SQLite in the sandbox is the source of truth for:

- runtime workspaces;
- sessions;
- transcript/event streams;
- terminal and command execution state.

Cloud DB owns product/account configuration, authentication, billing gates, and
the minimal runtime access pointer needed to reach AnyHarness.

This is why the managed sandbox API does not create `cloud_workspace` rows.
Gateway routes should authenticate the user in the control plane, authorize
access to the user's sandbox, then proxy the AnyHarness request without
reinterpreting AnyHarness commands.

## Gateway Handoff

The future gateway should use `managed_sandbox` as its routing source:

```text
user JWT
  -> load active managed_sandbox for user/org
  -> decrypt runtime token
  -> proxy to anyharness_base_url with sandbox runtime auth
```

Gateway code should not parse AnyHarness command payloads. The client should be
able to use the same AnyHarness SDK shape locally and in cloud, with only the
base URL/auth resolver differing.

The current managed sandbox API is intentionally small:

```text
GET    /v1/cloud/managed-sandbox
POST   /v1/cloud/managed-sandbox/ensure
POST   /v1/cloud/managed-sandbox/wake
DELETE /v1/cloud/managed-sandbox
```

## Deleted Paths

The Stack 1 cutover removes active Daytona support and unmounts the old
cloud-workspace creation route from the control plane API. Legacy TypeScript
workspace client functions may exist temporarily as compatibility shims for
older UI surfaces, but they are not part of the generated OpenAPI contract for
managed sandbox provisioning.

Deleted/obsolete concepts:

- `SANDBOX_PROVIDER`;
- `DAYTONA_API_KEY`, `DAYTONA_SERVER_URL`, `DAYTONA_TARGET`;
- provider-polymorphic sandbox selection for managed cloud;
- active workspace repo-config status/resync/setup routes scoped by
  `/v1/cloud/workspaces/{workspace_id}`.

## Code Map

Server:

```text
server/proliferate/db/models/cloud/managed_sandboxes.py
server/proliferate/db/store/managed_sandboxes.py
server/proliferate/db/store/managed_sandbox_repo_materializations.py
server/proliferate/server/cloud/managed_sandboxes/api.py
server/proliferate/server/cloud/managed_sandboxes/models.py
server/proliferate/server/cloud/managed_sandboxes/service.py
server/proliferate/server/cloud/managed_sandboxes/repo_materialization.py
server/proliferate/server/cloud/repo_config/service.py
```

SDK:

```text
cloud/sdk/src/client/managed-sandboxes.ts
cloud/sdk-react/src/hooks/managed-sandboxes.ts
```

Desktop repository projection:

```text
apps/desktop/src/lib/domain/settings/repositories.ts
apps/desktop/src/hooks/settings/derived/use-settings-repositories.ts
apps/desktop/src/hooks/home/derived/use-home-next-repository-selection.ts
apps/desktop/src/hooks/cloud/workflows/use-save-cloud-repo-config.ts
```

## Verification

Targeted server checks:

```bash
cd server
uv run --extra dev pytest -q \
  tests/integration/test_managed_sandbox_store.py \
  tests/integration/test_desktop_auth_gate.py \
  tests/integration/test_cloud_startup.py
```

Generated cloud SDK:

```bash
make cloud-client-generate
pnpm --filter @proliferate/cloud-sdk build
pnpm --filter @proliferate/cloud-sdk-react build
```

Desktop checks:

```bash
pnpm --dir apps/desktop exec tsc --noEmit
pnpm --dir apps/desktop exec vitest run \
  src/lib/domain/settings/repositories.test.ts \
  src/components/settings/panes/EnvironmentsPane.test.tsx \
  src/hooks/cloud/workflows/use-save-cloud-repo-config.test.ts
```
