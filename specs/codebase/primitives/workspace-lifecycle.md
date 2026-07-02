# Workspace Lifecycle

> Rewritten 2026-07-02 to replace a description of the pre-cutover architecture (PR #809, commit 4b54c9f2b) with the current `cloud_workspace` model.

Status: Describes shipped, current behavior.

Date: 2026-07-02.

Depends on: [`sandbox-provisioning.md`](sandbox-provisioning.md).

This spec describes `CloudWorkspace`: the lightweight product row that
represents one repo+branch pair inside a user's `cloud_sandbox`, and its
live create/read/archive/restore/delete surface. It intentionally does not
describe `server/proliferate/server/cloud/workspaces/lifecycle/` — that
package was deleted by PR #823 and is not part of the live system (see the
"Superseded / dead code" note in `sandbox-provisioning.md`).

## Data Model

### `cloud_workspace`

Model: `CloudWorkspace`
(`server/proliferate/db/models/cloud/workspaces.py:12`). Verified directly
in this worktree — the model is minimal:

- `id` (`workspaces.py:36`)
- `owner_user_id` — FK to `user.id`, `ondelete="CASCADE"` (`workspaces.py:37-40`)
- `repo_environment_id` — FK to `repo_environment.id`, `ondelete="RESTRICT"`
  (`workspaces.py:41-43`)
- `display_name` (`workspaces.py:44`)
- `git_branch` (`workspaces.py:45`)
- `git_base_branch`, nullable (`workspaces.py:46`)
- `anyharness_workspace_id` — nullable pointer into AnyHarness, indexed
  (`workspaces.py:47-51`)
- `created_at`, `updated_at` (`workspaces.py:52-57`)
- `archived_at` — nullable; presence means archived (`workspaces.py:58`)

It does **not** carry `worktree_path`, `active_sandbox_id`, or
`cleanup_state` — I read the current file and none of those fields exist.
Those existed in the pre-cutover model and are gone; AnyHarness (running
inside the sandbox) owns that filesystem/worktree state internally now.
Cloud DB just holds `anyharness_workspace_id` as an opaque pointer into it.

Indexes / constraints (`workspaces.py:14-33`):

- `ux_cloud_workspace_anyharness_workspace`: unique partial index on
  `(owner_user_id, anyharness_workspace_id)` where
  `archived_at IS NULL AND anyharness_workspace_id IS NOT NULL`.
- `ix_cloud_workspace_repo_environment_id`: lookup index.
- `ux_cloud_workspace_active_repo_environment_branch`: unique partial index
  on `(owner_user_id, repo_environment_id, git_branch)` where
  `archived_at IS NULL` — this is what makes "one active workspace per
  branch per repo per owner" an enforced DB invariant, not just an
  application-level check.

## Relationship To The Owning Sandbox

A `CloudWorkspace` has no foreign key to `cloud_sandbox` at all — it is
scoped to `owner_user_id`, and the owner's single `cloud_sandbox` (see
`sandbox-provisioning.md`) is looked up separately wherever runtime state
is needed. E.g. `_workspace_payload`
(`server/proliferate/server/cloud/workspaces/service.py:473-512`) loads
`workspace.owner_user_id`'s sandbox via
`cloud_sandbox_store.load_personal_cloud_sandbox` to compute a
`runtime_status` for the response, and `get_cloud_workspace_runtime_status`
(`workspaces/service.py:302-315`) does the same to build
`CloudWorkspaceRuntimeStatusResponse`.

`_runtime_status` (`workspaces/service.py:523-534`) maps sandbox status to
a workspace-facing runtime status: `sandbox is None -> "disabled"`,
`"ready" -> "running"`, `{"creating","provisioning"} -> "pending"`,
`{"paused","stopped"} -> "paused"`, `{"error","destroyed"} -> "error"`,
default `"pending"`. Note this function checks for the strings
`"provisioning"` and `"stopped"`, which are not in the current
`CloudSandboxStatus` enum (`creating|ready|paused|error|destroyed` — see
`sandbox-provisioning.md`); those branches currently appear unreachable
given the sandbox model's actual status values, but I'm reporting the code
as written rather than guessing at intent.

`_workspace_status` (`workspaces/service.py:515-520`, independent of
sandbox state) is: `archived_at is not None -> "archived"`, else
`not anyharness_workspace_id -> "materializing"`, else `"ready"`.

## Live Workspace CRUD

Router: `server/proliferate/server/cloud/workspaces/api.py`, mounted as
`workspaces_router` in `server/proliferate/server/cloud/api.py:22,32`
(prefixed with `/cloud` and the global `/v1` prefix from
`server/proliferate/main.py:230`). This is the only live workspace CRUD
surface — verified by grepping `cloud/api.py`'s `include_router` calls,
which do not reference the deleted `workspaces/lifecycle/` package.

Routes (`workspaces/api.py`):

- `GET /workspaces?lifecycle=active|archived|all` — list
  (`workspaces/api.py:36-49`, default `lifecycle="active"`)
- `POST /workspaces` — create (`workspaces/api.py:52-61`)
- `GET /workspaces/{workspace_id}` — detail (`workspaces/api.py:64-73`)
- `GET /workspaces/{workspace_id}/runtime-status` — runtime status
  (`workspaces/api.py:76-89`)
- `PATCH /workspaces/{workspace_id}/display-name` — rename
  (`workspaces/api.py:92-108`)
- `POST /workspaces/{workspace_id}/archive` — archive
  (`workspaces/api.py:111-120`)
- `POST /workspaces/{workspace_id}/restore` — restore
  (`workspaces/api.py:123-132`)
- `DELETE /workspaces/{workspace_id}` — hard delete, 204
  (`workspaces/api.py:135-143`)

All routes are scoped to the authenticated user
(`current_product_user`) and load via
`get_cloud_workspace_for_user(db, user_id, workspace_id)`
(`db/store/cloud_workspaces.py:93-105`), which filters by
`owner_user_id`, so a user cannot address another user's workspace by id.

### Create

`create_cloud_workspace_for_user`
(`server/proliferate/server/cloud/workspaces/service.py:82-224`):

1. Validates `git_owner`/`git_repo_name`/`branch_name` are non-empty.
2. Looks up the `repo_environment` row for that owner+repo; 404s
   (`cloud_repo_environment_not_found`) if the repo hasn't been configured
   as a cloud environment.
3. Requires GitHub App repo authority (`require_github_cloud_repo_authority`)
   and fetches live branches from GitHub via
   `get_repo_branches_for_credentials`.
4. Resolves the base branch (explicit `base_branch`, else the repo
   environment's default, else GitHub's default) and 400s if it doesn't
   exist on GitHub.
5. Computes the set of branch names already in use (GitHub branches +
   active `cloud_workspace` rows for that repo environment via
   `list_active_workspace_branches_for_repo_environment`); if
   `generated_name` is set, auto-generates a free branch name
   (`resolve_generated_branch_name`), else 409s on collision
   (`github_branch_already_exists` / `cloud_branch_already_exists`).
6. Calls `materialization_service.materialize_repo_environment(db,
   repo_environment_id=...)` — this is what actually ensures the sandbox
   exists/is ready and the repo is checked out inside it (see
   `cloud-commands.md`); this is a synchronous await, not fire-and-forget,
   so workspace creation blocks on sandbox+repo materialization.
7. Inserts the `cloud_workspace` row with retry-on-branch-collision via
   `_create_workspace_row_with_branch_retry`
   (`workspaces/service.py:385-431`), which relies on
   `create_cloud_workspace` returning `None` on an `IntegrityError` from the
   unique partial index rather than raising, and regenerates a branch name
   up to 5 times if `generated_name` was requested.
8. Loads ready runtime access for the owner's sandbox
   (`_load_ready_runtime_access`, `workspaces/service.py:318-330` — 409s
   `cloud_sandbox_missing` if there is no sandbox row at all), resolves the
   repo root inside AnyHarness (`resolve_runtime_workspace`), then calls
   `create_remote_worktree_workspace` directly against AnyHarness over
   HTTP (via `runtime_url`/`runtime_token`, not through the gateway proxy)
   to create the actual worktree and get back an
   `anyharness_workspace_id`.
9. Stores that id on the `cloud_workspace` row via
   `update_workspace_anyharness_workspace_id`.

The worktree path handed to AnyHarness is computed client-side
(`_worktree_path`, `workspaces/service.py:537-547`):
`{SANDBOX_WORKSPACE_ROOT}/worktrees/{owner}/{repo}/{branch-segment}-{workspace_id[:8]}`.

### Archive / Restore / Delete — what "lifecycle" means here

This is a product-record lifecycle, distinct from sandbox lifecycle
(`sandbox-provisioning.md`) — archiving or deleting a workspace does not
touch the owner's `cloud_sandbox` row or the E2B VM at all; it only
changes the `cloud_workspace` row.

- **Archive** (`archive_cloud_workspace_for_user`,
  `workspaces/service.py:255-262`): sets `archived_at = now()` via
  `archive_cloud_workspace` (`db/store/cloud_workspaces.py:168-176`). This
  frees the `(owner_user_id, repo_environment_id, git_branch)` unique slot
  (the partial index excludes archived rows), so a new workspace can be
  created on the same branch. I found **no code path that tells AnyHarness
  to clean up or dehydrate the underlying worktree on archive** — archive
  here is purely a Cloud DB state change. If AnyHarness independently prunes
  worktrees for archived workspaces, I did not find that wiring in this
  pass; treat that as **unverified**.
- **Restore** (`restore_cloud_workspace_for_user`,
  `workspaces/service.py:265-290`): checks the branch isn't already taken
  by another active workspace for the same repo environment (409
  `cloud_branch_already_exists` if so), then clears `archived_at` via
  `restore_cloud_workspace` (`db/store/cloud_workspaces.py:178-190`), which
  itself also guards against the unique-index collision with a nested
  transaction and returns `None` on `IntegrityError` (translated back to
  the same 409).
- **Delete** (`delete_cloud_workspace_for_user`,
  `workspaces/service.py:293-299`): hard-deletes the row via
  `delete_cloud_workspace` (`db/store/cloud_workspaces.py:193-198`,
  `await db.delete(row)`). No archived-only guard is enforced in the
  service function I read — delete is callable on an active workspace too.
  As with archive, I found no code here that reaches into AnyHarness to
  clean up the worktree/session state before deleting the pointer row;
  **unverified** whether anything reconciles that server-side.

## Code Map

```text
server/proliferate/db/models/cloud/workspaces.py
server/proliferate/db/store/cloud_workspaces.py
server/proliferate/server/cloud/workspaces/api.py
server/proliferate/server/cloud/workspaces/service.py
server/proliferate/server/cloud/workspaces/models.py
server/proliferate/server/cloud/api.py
```
