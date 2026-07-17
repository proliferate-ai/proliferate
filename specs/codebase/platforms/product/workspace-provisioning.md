# Cloud Workspace Provisioning

This platform is the current read path for configuring a cloud repository and
creating a Cloud product workspace backed by an AnyHarness worktree. Cloud
owns the product row; AnyHarness owns runtime workspace and session truth.

Workflow runs do not use this Cloud provisioning flow. Deterministic,
idempotent placement of an isolated AnyHarness workspace for a Workflow run UUID
is a separate purpose-built API — see
[`../../systems/product/workflows/workspace-placement.md`](../../systems/product/workflows/workspace-placement.md).

## Mental Model

```text
save cloud repository environment
  -> ensure personal cloud_sandbox row
  -> queue one cloud_repo_environment_materialization row
  -> schedule best-effort materialization after commit

create cloud workspace
  -> validate GitHub repository and branch authority
  -> synchronously materialize the repository environment
  -> insert cloud_workspace
  -> call AnyHarness directly to create a worktree
  -> atomically store the legacy anyharness_workspace_id and managed materialization

open an existing Cloud workspace on Desktop
  -> create/replay one local materialization intent for the Desktop install
  -> AnyHarness clones/adopts the repository and materializes the exact ref
  -> report the same generation with local runtime id, path, branch, and HEAD

add a Cloud copy from Desktop
  -> validate the owned Desktop install and local source descriptor
  -> independently verify the authorized GitHub branch HEAD
  -> reserve the local association before remote work
  -> materialize the managed checkout at the exact ref
  -> return one Cloud workspace with managed and local materializations
```

There is no durable delivery queue between Cloud and AnyHarness in this
current flow. Workspace creation waits for repository materialization and the
AnyHarness call.

## Persisted Owners

### Repository configuration

[`repositories.py`](../../../../server/proliferate/db/models/cloud/repositories.py)
defines:

- `repo_config`: one user's GitHub repository identity;
- `repo_environment`: its local or cloud settings, including default branch,
  setup script, and run command; and
- `cloud_repo_environment_materialization`: one sandbox/environment attempt,
  with `pending`, `running`, `ready`, or `error` status, applied manifest,
  `last_error`, and timestamps.

The cloud materialization row is unique by `(cloud_sandbox_id,
repo_environment_id)`. It is the first persisted place to inspect for a
repository preparation failure.

### Product workspace

[`workspaces.py`](../../../../server/proliferate/db/models/cloud/workspaces.py)
defines `cloud_workspace`. It owns:

- the product workspace id and owner;
- a placement-neutral `workspace_kind` (`repository_worktree | scratch`);
- a nullable `repo_environment_id`;
- display name, Git branch, and optional base branch;
- the optional `anyharness_workspace_id`; and
- archive timestamps.

`cloud_workspace_materialization` records each target-scoped checkout. A
managed row identifies the sandbox and runtime workspace; a local row identifies
the Desktop installation and its local runtime workspace/path. Active unique
indexes prevent one install/runtime pair from being linked to two Cloud
workspaces. `unlinked_at` makes unlink non-destructive while generation checks
prevent stale reports from resurrecting an old association.

The Cloud workspace still does not own runtime session state or events. Every
AnyHarness workspace id is a reference to runtime truth, not a copy of it.

### Placement-neutral identity

The row is placement-neutral so it can back either a repository worktree or a
repository-less scratch workspace, without inventing repository metadata for
scratch:

- `repository_worktree` (the backfilled default for every pre-existing row)
  requires a real `repo_environment_id` and preserves the existing
  repository/branch behavior; its API response carries `workspaceKind =
  repositoryWorktree` with a populated `repo` and `repoEnvironmentId`.
- `scratch` (managed Workflow runs) forbids a `repo_environment_id`, uses the
  `main` branch with no base branch, and serializes `repo`/`repoEnvironmentId`
  and `runtime.environmentId` as `null` — never fabricated. Repository branch
  uniqueness (the active partial index) applies only to repository worktrees, so
  scratch rows freely share `main`.

Two check constraints enforce this: `workspace_kind` is restricted to the two
values, and a repo-environment presence constraint ties a non-null
`repo_environment_id` to `repository_worktree` and forbids one for `scratch`.
The migration is `c3a7b8d9e0f1_cloud_workspace_backing_kind`.

Current servers always emit `workspaceKind`, `repo`, and `repoEnvironmentId`
(the latter two nullable for scratch, never omitted); the shared client type
keeps them optional only so responses from older servers that predate the
migration are read as `repositoryWorktree`.

Scope note: the mounted human `POST /workspaces` flow below remains
repository-only — it always creates a `repository_worktree` bound to a resolved
cloud repo environment. There is no current mounted route that creates a
`scratch` workspace; managed scratch creation and execution are downstream in
Managed Cloud Execution (5b), not current behavior. This slice (5a) delivers
only the placement-neutral identity, its migration, the serialized fields, and
the shared display derivation.

## Mounted API

Repository routes:

```text
GET /v1/cloud/repositories/catalog
GET /v1/cloud/repositories
GET /v1/cloud/repositories/{owner}/{repo}/branches
PUT /v1/cloud/repositories/{owner}/{repo}/environment
DELETE /v1/cloud/repositories/{owner}/{repo}/environment
```

Workspace routes:

```text
GET    /v1/cloud/workspaces
POST   /v1/cloud/workspaces
GET    /v1/cloud/workspaces/{id}
GET    /v1/cloud/workspaces/{id}/runtime-status
PATCH  /v1/cloud/workspaces/{id}/display-name
POST   /v1/cloud/workspaces/{id}/archive
POST   /v1/cloud/workspaces/{id}/restore
DELETE /v1/cloud/workspaces/{id}
POST   /v1/cloud/workspaces/{id}/materializations
PUT    /v1/cloud/workspaces/{id}/materializations/{materialization_id}
DELETE /v1/cloud/workspaces/{id}/materializations/{materialization_id}
```

There is no mounted workspace `connection` endpoint. Clients reach AnyHarness
through the authenticated cloud-sandbox gateway documented in
[Cloud sandbox provisioning](sandbox-provisioning.md).

## Save A Cloud Repository Environment

[`repositories/service.py`](../../../../server/proliferate/server/cloud/repositories/service.py)
validates GitHub authority and any requested default branch, upserts the cloud
`repo_environment`, ensures the personal `cloud_sandbox` row without invoking
the provider, and queues its materialization row. The actual task is scheduled
after the request transaction commits.

That scheduled task is best-effort process-local work. Its persisted status
and `last_error` are evidence; saving the environment successfully is not by
itself evidence that the repository exists in E2B.

## Remove A Cloud Repository Environment

The repository environment `DELETE` route is user-scoped and idempotent. It
soft-deletes only the active Cloud `repo_environment`; local environments,
repository preferences, local files, and workspaces are not deleted. Removal
is rejected with `cloud_repository_in_use` while any active or archived Cloud
workspace, automation, or automation-run snapshot still references the
environment, because hiding an environment that those records need would make
the removal state untruthful. Workspace creation holds a key-share lock on the
environment while removal holds an update lock, so a concurrent create cannot
race the dependency check. Clients
must keep removal pending until the request succeeds and invalidate repository,
catalog, GitHub-authority, and workspace-secret queries after it settles so all
surfaces converge on server truth.

## Create A Workspace

[`workspaces/service.py`](../../../../server/proliferate/server/cloud/workspaces/service.py)
performs the current synchronous flow:

1. require cloud provisioning configuration;
2. load the user's cloud `repo_environment`;
3. verify GitHub App authority and fetch the repository's branches;
4. validate or generate the new branch name;
5. synchronously rematerialize the repository environment, which creates or
   resumes E2B and launches or reconnects AnyHarness as needed;
6. insert and flush `cloud_workspace` with no AnyHarness workspace id inside
   the request transaction;
7. load ready runtime access from `cloud_sandbox`;
8. resolve the repository root through AnyHarness;
9. call AnyHarness directly to create the worktree; and
10. write the returned `anyharness_workspace_id` and managed materialization;
11. when this is an exact-ref Desktop source flow, require the local descriptor
    to match the independently verified HEAD and record the owned local
    association (a conflict fails the request rather than reporting success);
12. commit the request transaction after the handler returns successfully.

Desktop clone and open-on-Mac use caller-supplied idempotency ledgers in
AnyHarness. Clone operation ids are scoped to the chosen destination and reused
only for that retry. A Cloud local intent returns `{rowId}:{generation}`; an
in-flight retry returns the same generation and exact source ref, so a crash
after local success but before the Cloud report replays rather than creating a
second worktree.

The Cloud transaction and AnyHarness worktree creation are not atomic. A
propagated failure rolls back the Cloud insert and id update. The inverse
failure remains possible: AnyHarness can create or resolve the worktree before
a later Cloud write or commit fails, leaving a runtime worktree with no
committed Cloud row. There is no automatic cleanup or routine retry for that
orphaned runtime state; escalate it.

Pre-existing or legacy Cloud rows with `anyharness_workspace_id = NULL` still
render as `materializing`, then `error` after 900 seconds. After fixing the
root cause, delete and recreate that Cloud row through the product; there is no
background retry that completes it.

Generated names use `catalogs/workspace-names/v1/animals.json`. The generator
is `node scripts/generate-workspace-name-catalog.mjs`. Explicit branch
conflicts fail. Generated names may be suffixed, and the server retries a
bounded number of branch-uniqueness races.

## Read And Lifecycle Semantics

- `ready` means `anyharness_workspace_id` is present on an active Cloud row.
- Workspace list/detail responses include every active materialization. Desktop
  supplies its install id so the server can prefer that install's healthy local
  row; paths and runtime ids for other installs are redacted.
- Explicit materialization identity wins over repository/branch heuristics.
  Unlinked same-repository/branch copies remain separate until the user chooses
  **Link copies** and the client proves clean, normal, exact-HEAD equality.
- **Unlink this Mac** soft-deletes only the association. It does not delete a
  checkout, repository, Cloud workspace, or session history.
- `materializing` means the id is absent and the row is younger than the
  900-second stale threshold.
- `error` means that missing-id row exceeded the threshold.
- Runtime status is derived separately from the owner's current
  `cloud_sandbox` status.
- Archive, restore, display-name update, and delete mutate only the Cloud row.
  They do not archive, rename, or delete the AnyHarness worktree.
- Deleting the user's sandbox leaves Cloud workspace rows and stored
  AnyHarness workspace ids unchanged, without guaranteeing those ids remain
  reachable.

The broader desired lifecycle remains explicitly labeled as a target in
[Workspace lifecycle](workspace-lifecycle.md). Do not treat its unimplemented
portions as current creation behavior.

## Ownership Map

| Concern | Current owner |
| --- | --- |
| Repository configuration routes | [`server/.../cloud/repositories/`](../../../../server/proliferate/server/cloud/repositories/) |
| Materialization orchestration | [`server/.../cloud/materialization/`](../../../../server/proliferate/server/cloud/materialization/) |
| Workspace routes and product-row orchestration | [`server/.../cloud/workspaces/`](../../../../server/proliferate/server/cloud/workspaces/) |
| Durable target association ledger | [`server/.../cloud/workspaces/materializations/`](../../../../server/proliferate/server/cloud/workspaces/materializations/) and [`db/store/cloud_workspace_materializations.py`](../../../../server/proliferate/db/store/cloud_workspace_materializations.py) |
| Desktop clone/link/open orchestration | [`apps/packages/product-client/src/hooks/workspaces/workflows/`](../../../../apps/packages/product-client/src/hooks/workspaces/workflows/) and [`components/workspace/repo-setup/`](../../../../apps/packages/product-client/src/components/workspace/repo-setup/) |
| Direct AnyHarness adapter | [`server/proliferate/integrations/anyharness/`](../../../../server/proliferate/integrations/anyharness/) |
| Sandbox lifecycle and runtime access | [Cloud sandbox provisioning](sandbox-provisioning.md) |
| GitHub sandbox credentials | [Sandbox GitHub auth](sandbox-github-auth.md) |
| Billing authorization | [Billing](billing.md) |
| Runtime workspace and session truth | [AnyHarness structure](../../structures/anyharness/README.md) |
| Server placement rules | [Server structure](../../structures/server/README.md) |

## Failure Boundaries

| Symptom | First evidence |
| --- | --- |
| Repository cannot be configured | GitHub authority and `repo_environment` validation |
| Repository preparation fails | `cloud_repo_environment_materialization.status` and `last_error` |
| Provider or runtime reconnect fails | `cloud_sandbox` runtime access, materialization logs, E2B, and AnyHarness health |
| Existing workspace remains `materializing` | `cloud_workspace.anyharness_workspace_id` and row age |
| Create failed after runtime worktree creation | Correlate the request, user, repository, and branch with the AnyHarness target path; its suffix carries only the attempted Cloud id's eight-character prefix. Include the AnyHarness workspace id when present and escalate suspected orphan cleanup. |
| Cloud row is ready but runtime is unavailable | AnyHarness health through the sandbox gateway; do not infer health from the Cloud id |
| Local report is stale after unlink/relink | Compare the reported generation with `cloud_workspace_materialization.generation`; never retry with a new operation id for the same in-flight intent |
| Link copies is unavailable | Inspect all active local materializations for the current install, then compare the candidate's canonical repo, case-sensitive branch, clean Git state, and exact HEAD |
| Add Cloud copy reports an association conflict | The local install/runtime pair already belongs to another active Cloud workspace; do not keep a second logical association |

## Verification

Use these focused tests as the code-level proof:

- `server/tests/unit/test_sandbox_materialization.py`
- `server/tests/unit/test_cloud_workspace_status.py`
- `server/tests/unit/test_cloud_sandbox_gateway_access.py`
- `server/tests/integration/test_cloud_workspace_backing_kind.py`
- `server/tests/integration/test_cloud_workspace_backing_kind_migration.py`
- `server/tests/integration/test_cloud_workspace_identity_payload.py`
- `server/tests/integration/test_cloud_workspace_materialization_service.py`
- `apps/packages/product-client/src/lib/domain/workspaces/cloud/open-on-mac-orchestration.test.ts`
- `apps/packages/product-client/src/lib/domain/workspaces/cloud/link-copies-verification.test.ts`
- `apps/packages/product-client/src/lib/domain/workspaces/sidebar/sidebar-link-candidates.test.ts`

For incident diagnosis, use
[`cloud-provisioning-failure.md`](../../../developing/operating/cloud-provisioning-failure.md).
