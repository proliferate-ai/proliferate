# Cloud Workspace Provisioning

Status: current

This platform is the current read path for configuring a cloud repository and
creating a Cloud product workspace backed by an AnyHarness worktree. Cloud
owns the product row; AnyHarness owns runtime workspace and session truth.

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
  -> store anyharness_workspace_id
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
- `repo_environment_id`;
- display name, Git branch, and optional base branch;
- the optional `anyharness_workspace_id`; and
- archive timestamps.

It does not own a sandbox id, runtime session state, runtime path, or runtime
events. An AnyHarness workspace id is a reference to runtime truth, not a copy
of that truth in Cloud.

## Mounted API

Repository routes:

```text
GET /v1/cloud/repositories/catalog
GET /v1/cloud/repositories
GET /v1/cloud/repositories/{owner}/{repo}/branches
PUT /v1/cloud/repositories/{owner}/{repo}/environment
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
10. store the returned `anyharness_workspace_id`; and
11. commit the request transaction after the handler returns successfully.

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

## Verification

Use these focused tests as the code-level proof:

- `server/tests/unit/test_sandbox_materialization.py`
- `server/tests/unit/test_cloud_workspace_status.py`
- `server/tests/unit/test_cloud_sandbox_gateway_access.py`

For incident diagnosis, use
[`cloud-provisioning-failure.md`](../../../developing/operating/cloud-provisioning-failure.md).
