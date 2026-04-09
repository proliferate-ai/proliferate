# Cloud Repository Configuration and Workspace Setup PRD

## Summary

This document organizes the proposed cloud configuration work around the
current repo architecture.

Problem:

- local repository setup is machine-local today
- cloud credential sync is global and agent-scoped today
- cloud workspace provisioning does not have a repo-scoped setup layer today

Resulting gap:

- cloud workspaces can start with agent credentials and a checked-out repo
- they cannot reliably reproduce the repo-specific setup that users already
  maintain locally
- there is no durable server-backed model for syncing repo secret files,
  applying them to cloud workspaces, or rerunning repo setup later

Desired outcome:

- cloud setup should feel like the cloud equivalent of local repo setup
- repo-specific secret files and setup commands should be stored once,
  updated intentionally, and applied repeatedly
- users should be able to configure this per repo, create cloud workspaces
  against it, and re-apply it later from inside the workspace

## Current State In Repo

### Local repo setup

Current local repo setup is desktop-only and stored per repo in local
preferences.

Relevant code:

- `desktop/src/components/settings/panes/RepositoryPane.tsx`
- `desktop/src/components/workspace/repo-setup/RepoSetupModal.tsx`
- `desktop/src/components/workspace/repo-setup/SetupCommandEditor.tsx`
- `desktop/src/hooks/settings/use-repository-settings.ts`
- `desktop/src/stores/preferences/repo-preferences-store.ts`
- `anyharness/crates/anyharness-lib/src/workspaces/detector.rs`
- `anyharness/crates/anyharness-lib/src/workspaces/service.rs`

Notes:

- setup commands are persisted locally under `repo_preferences`
- setup hints already distinguish `build_tool` and `secret_sync`
- secret-sync hints currently become literal copy commands such as
  `cp "$PROLIFERATE_REPO_DIR/.env.local" "$PROLIFERATE_WORKTREE_DIR/.env.local"`
- worktree setup execution is local runtime behavior, not cloud control-plane
  behavior

### Cloud credentials

Current cloud sync is global per user and agent provider, not repo-scoped.

Relevant code:

- `desktop/src/components/settings/panes/CloudPane.tsx`
- `desktop/src/platform/tauri/credentials.ts`
- `desktop/src/lib/integrations/cloud/credentials.ts`
- `server/proliferate/server/cloud/credentials/service.py`
- `server/proliferate/server/cloud/runtime/credentials.py`
- `server/proliferate/db/models/cloud.py`
- `server/proliferate/db/store/cloud_credentials.py`

Notes:

- server stores encrypted cloud credential payloads in `cloud_credential`
- supported providers are currently `claude` and `codex`
- cloud provisioning knows how to materialize agent credentials into the
  sandbox runtime home
- there is no equivalent server-backed storage for repo secret files such as
  `.env.local`

### Cloud workspace creation and provisioning

Current cloud workspace creation only asks for repo, base branch, and new
branch. Provisioning performs baseline sandbox and runtime setup only.

Relevant code:

- `desktop/src/components/workspace/cloud/NewCloudWorkspaceModal.tsx`
- `desktop/src/hooks/cloud/use-new-cloud-workspace-modal-state.ts`
- `desktop/src/hooks/cloud/use-cloud-workspace-actions.ts`
- `server/proliferate/server/cloud/workspaces/service.py`
- `server/proliferate/server/cloud/runtime/provision.py`
- `server/proliferate/server/cloud/runtime/bootstrap.py`
- `server/proliferate/server/cloud/runtime/service.py`

Provisioning order today:

1. Allocate sandbox
2. Use template fast path when available, otherwise install runtime pieces
3. Sync agent credentials
4. Clone repo
5. Checkout cloud branch
6. Configure git identity
7. Start AnyHarness
8. Mark workspace ready

Notes:

- this baseline flow already matches the requested "initial base template"
  versus "install what is necessary if not using a template" split
- there is currently no repo-specific file sync stage
- there is currently no repo-specific setup script stage
- there is a backend endpoint to sync credentials into a running workspace,
  but the desktop does not expose it yet

### Workspace UI

Current workspace UI exposes files, changes, and terminals. It does not expose
cloud repo configuration or re-apply controls.

Relevant code:

- `desktop/src/components/workspace/shell/right-panel/RightPanel.tsx`
- `desktop/src/components/workspace/chat/surface/CloudRuntimeAttachedPanel.tsx`
- `desktop/src/components/settings/SettingsScreen.tsx`
- `desktop/src/components/settings/SettingsSidebar.tsx`

Current gap:

- no repo-configured state in cloud settings
- no per-repo cloud settings screen
- no workspace Settings pane for cloud re-sync or rerun
- new cloud workspace creation does not gate on repo cloud configuration

## Goals

- Make cloud workspace setup repo-scoped, repeatable, and easy to update.
- Preserve the current baseline provisioning flow and extend it with a
  separate repo-setup layer.
- Keep global agent credentials distinct from repo-specific secret files.
- Let users re-apply repo setup from an existing cloud workspace without
  recreating the workspace.
- Match the local mental model where possible, while acknowledging that cloud
  file sync must come from server-backed encrypted storage rather than direct
  local file copy at runtime.

## Non-Goals

- Replacing the existing global cloud credential system.
- Conflating local repo settings with cloud repo settings.
- Editing secret file contents directly in the control plane UI in v1.
- Reworking the full cloud provisioning lifecycle beyond adding the repo-setup
  layer.
- Supporting arbitrary unrestricted host file access from the desktop in v1.

## Product Model

The cleanest model is to separate cloud configuration into three scopes.

### 1. Global cloud agent credentials

This already exists.

Examples:

- Claude auth
- Codex auth

Ownership:

- desktop detects and exports local credential material
- backend stores encrypted payloads
- cloud runtime materializes them into the sandbox

### 2. Repo-scoped cloud configuration

This is new.

Examples:

- synced secret/config files such as `.env.local`
- repo-specific cloud setup commands
- explicit "this repo has been configured for cloud" state

Ownership:

- desktop discovers syncable local repo files and sends approved files upward
- backend stores encrypted repo file blobs plus repo setup metadata
- cloud workspaces consume the latest saved repo config

### 3. Workspace-scoped apply/re-apply state

This is new.

Examples:

- apply saved repo files to this workspace
- rerun cloud repo setup in this workspace
- show whether repo setup is queued, running, succeeded, or failed

Ownership:

- backend applies saved repo config into the workspace sandbox
- desktop renders state and exposes re-sync/rerun actions

## Proposed User Flows

### First-time cloud workspace creation

1. User clicks `New cloud workspace` for a repo.
2. If the repo has not completed cloud configuration, desktop shows
   `Configure cloud` instead of continuing directly to branch creation.
3. User lands on the repo-specific cloud settings screen.
4. User syncs any repo files they want available in cloud and saves the cloud
   setup script.
5. User returns to create the cloud workspace.

### Configuring cloud for a repo

The cloud settings experience should have:

- a repo list showing configured or not configured
- a repo detail screen for the selected repo
- a file sync section
- a setup commands section

File sync behavior:

- show candidate local files discovered from the repo
- each file has a `Sync from local` action
- the UI shows whether the server already has a stored version
- if the local file differs from the stored version, show that it needs re-sync

Setup command behavior:

- reuse the same editor model as local setup where possible
- allow build-tool commands and env-var-aware commands
- save a cloud-specific setup script, not the local worktree script

### Cloud workspace creation after configuration

1. User opens `New cloud workspace`.
2. User chooses base branch and new cloud branch.
3. Baseline provisioning runs as it does today.
4. After baseline provisioning reaches `ready`, the repo-setup apply process
   runs in the background for that workspace:
   - write synced repo files into the checked-out repo
   - run the saved cloud setup script
5. Workspace remains usable, but repo-setup status is visible until complete.

### Managing an existing cloud workspace

Cloud workspaces should expose a new `Settings` pane alongside `Files` and
`Changes`.

That pane should include:

- synced repo files and their apply status
- saved cloud setup script
- `Re-sync` to re-apply the latest saved server-backed repo files
- `Run setup again` to rerun the saved cloud setup script
- `Configure in settings` to jump to the repo cloud settings screen

If local files have changed and the backend-stored version is stale, the
workspace should point users to settings to sync a new version rather than
silently uploading local files from the workspace surface.

## Functional Requirements

### Repo configuration state

The product must differentiate:

- not configured
- configured but empty
- configured with saved files and or setup commands

This requires explicit configured state rather than inferring configuration
from whether files or commands exist.

### File sync

Repo file sync must:

- store encrypted file contents on the backend
- store repo-relative destination paths
- track a content hash and update time
- support replacing an existing file payload
- support deleting a file from saved repo config
- support applying saved files to a running cloud workspace

### Setup commands

Cloud repo setup commands must:

- be saved per repo
- run after files are written into the cloud workspace
- run with cloud-appropriate env vars and repo paths
- expose queued, running, succeeded, and failed states
- support rerun on demand

### Provisioning behavior

Baseline provisioning should stay intact.

Recommended lifecycle:

1. Existing provisioning path reaches `ready`
2. Backend enqueues repo-setup apply for that workspace
3. Repo-setup apply writes synced files
4. Repo-setup apply runs the repo cloud setup script
5. Workspace detail/settings surface reflects the latest repo-setup result

This keeps `ready` tied to runtime availability and mirrors the existing local
"setup runs in the background" behavior.

### Navigation and gating

- `New cloud workspace` should become `Configure cloud` when repo cloud config
  is required and missing.
- Cloud settings should show repos with configuration state and deep links.
- Workspace settings should deep-link back to the same repo cloud settings.

## Architecture Proposal

### Backend

Recommended new server domain:

- `server/proliferate/server/cloud/repo_config/`

Recommended persistence:

- `db/store/cloud_repo_configs.py`
- `db/store/cloud_repo_files.py`
- `db/store/cloud_workspace_repo_setup.py`

Recommended new models:

- `CloudRepoConfig`
  - user-scoped repo identity
  - explicit `configured_at`
  - saved setup script
- `CloudRepoSyncedFile`
  - repo-relative path
  - encrypted content blob
  - content hash
  - updated timestamps
- `CloudWorkspaceRepoSetupExecution`
  - workspace-scoped apply status
  - command
  - stdout and stderr
  - exit code
  - duration
  - last applied file revision or hash

Recommended APIs:

- `GET /v1/cloud/repos/configs`
  - list repos and whether cloud config exists
- `GET /v1/cloud/repos/{provider}/{owner}/{repo}/config`
  - fetch repo config summary, saved files, and setup script
- `PUT /v1/cloud/repos/{provider}/{owner}/{repo}/config`
  - save repo cloud setup metadata
- `PUT /v1/cloud/repos/{provider}/{owner}/{repo}/files/{path...}`
  - sync one repo file from local
- `DELETE /v1/cloud/repos/{provider}/{owner}/{repo}/files/{path...}`
  - remove a synced repo file
- `POST /v1/cloud/workspaces/{workspace_id}/apply-repo-config`
  - re-apply saved repo files to the workspace
- `POST /v1/cloud/workspaces/{workspace_id}/rerun-repo-setup`
  - rerun the saved setup script in the workspace
- `GET /v1/cloud/workspaces/{workspace_id}/repo-setup`
  - read repo apply/setup status for the workspace

Provisioning integration:

- keep `server/cloud/runtime/provision.py` baseline stages intact
- after workspace reaches `ready`, enqueue a repo-setup apply task
- use existing sandbox file-write and command-exec helpers to:
  - write repo files into the checked-out workspace path
  - run the saved setup command in the workspace cwd

Security and telemetry:

- encrypt repo file contents at rest, same class of handling as cloud
  credentials
- never emit file contents, absolute local paths, repo names, or raw setup
  output into analytics payloads
- keep logs and response payloads to path metadata, hashes, timestamps, and
  summarized status

### Desktop

Recommended desktop layers:

- `lib/integrations/cloud/repo-config.ts`
  - named request helpers only
- `hooks/cloud/use-cloud-repo-config.ts`
  - queries and mutation orchestration
- `hooks/cloud/use-cloud-repo-config-actions.ts`
  - sync, delete, apply, rerun workflows
- `platform/tauri/repo-config.ts`
  - local file detection and export wrappers

Recommended Tauri additions:

- list syncable repo files for a repo root
- export one approved repo file as base64
- compute a stable hash for local-vs-remote drift display

Recommended repo inventory source:

- reuse the local repo inventory already derived in
  `desktop/src/hooks/settings/use-settings-repositories.ts`
- treat that as the v1 list for cloud repo configuration screens
- avoid adding a separate remote repo browser in the first pass

Important separation:

- keep `useRepoPreferencesStore` for local-only repo defaults
- do not turn the existing local repo settings store into the source of truth
  for cloud repo configuration

UI reuse:

- reuse `SetupCommandEditor` where possible
- adjust copy so local repo setup and cloud repo setup are clearly distinct

Recommended settings navigation:

- keep `Cloud` as the top-level settings landing page
- add a repo detail state under cloud settings rather than reusing the local
  `repo` settings pane
- represent this in routing as either:
  - `section=cloud&repo=<sourceRoot>`
  - or a dedicated `cloud-repo` settings section
- do not collapse cloud repo config into the existing local repo settings page

### Workspace UI

Recommended right-panel change:

- extend `RightPanelMode` from `files | changes` to
  `files | changes | settings`
- show `Settings` only for cloud workspaces in v1

Recommended cloud workspace settings content:

- repo file list with applied/not applied state
- setup script preview
- apply status summary
- `Re-sync`
- `Run setup again`
- `Configure in settings`

Optional supporting UI:

- extend `CloudRuntimeAttachedPanel` to show repo-setup progress or failure
  when a workspace is otherwise ready but still applying repo config

## Suggested Delivery Plan

### Phase 1

- backend repo-config data model and APIs
- desktop cloud settings repo list and repo detail screen
- local file detection and explicit `Sync from local`

### Phase 2

- workspace repo-setup execution model
- apply saved repo config after workspace reaches ready
- workspace Settings pane with `Re-sync` and `Run setup again`

### Phase 3

- creation-time `Configure cloud` gating
- local-vs-remote drift indicators
- polish around deep links and status messaging

## Open Questions

- What exact condition should require `Configure cloud` before cloud workspace
  creation: "never configured", "missing required files", or "missing required
  files or script"?
- Should repo cloud setup commands be stored as plain text or encrypted text?
- Should v1 allow only detector-discovered files, or also manual path entry?
- Should repo-setup apply happen strictly after `ready`, or should file write
  happen before `ready` and only the setup script remain async?
- Should workspace detail include repo-setup state inline, or should that live
  behind a dedicated workspace-settings endpoint?

## Recommended Direction

Implement this as a new repo-scoped cloud configuration layer, not as an
extension of global cloud credentials and not as a mirror of local repo
preferences.

That keeps the architecture clean:

- global agent credentials remain global
- repo files and repo setup become repo-scoped server-backed configuration
- workspace `Re-sync` becomes a re-apply of saved cloud config, not an
  implicit pull from the local machine
