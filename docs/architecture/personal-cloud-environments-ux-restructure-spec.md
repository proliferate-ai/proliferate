# Personal Cloud Environments UX Restructure Spec

Status: implemented implementation spec

Date: 2026-05-24

Branch: `codex/cloud-web-repo-add-spec`

## Purpose

Proliferate has two related but distinct repository concepts:

- A local checkout is a folder or repo root present on the current Desktop
  computer.
- A Cloud environment is durable personal cloud configuration for
  `github:owner/repo`, usable by web, mobile, and Desktop even when no local
  checkout exists.

This slice makes `Settings > Environments` the canonical surface for Cloud
environment configuration and keeps Desktop's local checkout flow separate.
Web Home keeps a shortcut, but it opens the same Cloud environment add flow.

The implementation is personal-scope only. Organization/shared environment
authoring, public repo search, Desktop GitHub-to-local clone, and cloud tracked
file editing are intentionally deferred.

## Docs Read

This implementation follows:

- `docs/README.md`
- `docs/frontend/README.md`
- `docs/frontend/guides/access.md`
- `docs/frontend/guides/components.md`
- `docs/frontend/guides/config.md`
- `docs/frontend/guides/copy.md`
- `docs/frontend/guides/hooks.md`
- `docs/frontend/guides/lib.md`
- `docs/frontend/guides/state.md`
- `docs/frontend/guides/styling.md`
- `docs/server/README.md`
- `docs/sdk/README.md`
- `docs/architecture/cloud-surfaces-launch-plan.md`
- `docs/architecture/cloud-work-launch-model-spec.md`
- `docs/architecture/web-desktop-parity-spec.md`

## Current Model

`CloudRepoConfig` is the durable cloud record keyed by owner scope plus
GitHub identity:

```text
owner_scope        personal | organization
user_id            required for personal
organization_id    required for organization
git_owner
git_repo_name
```

For this pass, only personal configs are surfaced by the new UI. Existing
organization config APIs remain in place.

The core editable fields are:

```text
configured
default_branch
setup_script
run_command
env_vars
```

Tracked files remain supported for local checkout flows, but cloud-only core
edits do not send `files`. This preserves any existing tracked files while
avoiding a cloud/web UI that pretends it can edit local file material.

## UX Contract

### Desktop Settings > Environments

The Desktop pane has two sections:

```text
Local checkouts
  Local repo roots and folders present on this computer.
  Selecting one opens the existing local detail flow.

Cloud environments
  Personal GitHub repo configs returned by useCloudRepoConfigs().
  Selecting one opens cloud detail by owner/repo and does not require a local
  checkout.
```

If a local checkout has GitHub identity and a matching Cloud environment, the
local row labels its cloud state. Selecting the local checkout still opens the
existing local detail page and includes the local checkout's Cloud section,
including tracked-file sync.

If a Cloud environment has no matching local checkout, selecting it opens a
cloud-only detail page keyed by `cloudRepoOwner/cloudRepoName`. The page shows
default branch, setup script, run command, and env vars. It supports Save,
Revert, and Disable. It hides local tracked-file sync controls. If tracked files
already exist, it shows a read-only count and save omits `files`.

`buildCloudRepoSettingsHref(owner, repo)` resolves to:

```text
/settings?section=environments&cloudRepoOwner=<owner>&cloudRepoName=<repo>
```

That route must open the cloud-only detail instead of falling back to the local
repo list. Legacy `section=cloudRepo` links still try to resolve a local repo
for backwards compatibility.

### Web Settings > Environments

Web now has `Settings > Environments`. The Web page shows only Cloud
environments. It uses the shared list/editor components and the same add dialog
controller pattern as Desktop. There is no local checkout section in Web.

### Web Home Shortcut

Web Home retains a shortcut action labeled `Add cloud environment`. It opens
the same Cloud environment add dialog/controller. After the selected repo is
created, enabled, or reused, Home selects that repo in the target picker and
existing workspace creation proceeds through `createCloudWorkspace`.

## Add Dialog Contract

The dialog is framed as `Add cloud environment`, not ambiguous repository
addition. It supports:

- GitHub catalog rows from `GET /v1/cloud/repos`.
- Manual `owner/repo` or GitHub URL entry.
- Existing configured rows as `Use`.
- Existing disabled rows as `Enable`.
- Missing rows as `Add`.

Public search is not a V1 tab. The catalog is based on the connected GitHub
grant, and manual entry still requires GitHub access plus write-capable
permission.

Blocked rows and manual validation use shared product-domain helpers:

```text
archived repo      -> blocked
disabled repo      -> blocked
empty repo         -> blocked
missing default    -> blocked
read-only access   -> blocked
```

## Persistence Contract

Core cloud-only saves use:

```http
PUT /v1/cloud/repos/{git_owner}/{git_repo_name}/config
```

with:

```json
{
  "configured": true,
  "defaultBranch": "main",
  "envVars": {},
  "setupScript": "",
  "runCommand": ""
}
```

`files` is omitted. The server preserves existing tracked files when `files` is
absent.

Local checkout tracked-file sync may still call the same save path with
`files`. That is the only UI path that should send tracked file material in
this pass.

Re-enable flows load existing config when needed and preserve default branch,
env vars, setup script, run command, and tracked files.

## Shared Packages

`@proliferate/product-domain` owns pure planning and projection:

- `repos/repo-id`
- `environments/cloud-environments`

`@proliferate/product-ui` owns reusable presentation:

- `environments/AddCloudEnvironmentDialog`
- `environments/CloudEnvironmentList`
- `environments/CloudEnvironmentEditor`

App-specific controllers stay in Web/Desktop because they own React Query,
navigation, refetch, and route selection.

## Backend And SDK Contract

The backend/SDK slice keeps:

- `GET /v1/cloud/repos`
- branch metadata on `GET /v1/cloud/repos/{owner}/{repo}/branches`
- optional `files` in personal config save
- repo access validation when enabling a repo
- SDK and React hooks for catalog, branches, config load/save

The GitHub catalog endpoint is admission/discovery only. It does not clone.
Cloud workspaces still clone/materialize during workspace creation.

## Verification Plan

Targeted checks:

- Product-model tests for parsing, list projection, blocked repo reasons, and
  save planning.
- Product-ui tests for add dialog copy, two-section list rendering, cloud-only
  editor behavior, and Save/Revert/Disable state.
- Desktop settings navigation tests for cloud-only owner/repo routes and local
  repo routes.
- Web build and manual smoke for Settings > Environments and Home shortcut.
- Server tests for catalog/config save behavior and optional `files`.
