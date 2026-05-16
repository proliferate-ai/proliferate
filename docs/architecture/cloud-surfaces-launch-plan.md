# Cloud Surfaces Launch Plan

Status: implementation plan for the cloud target, automation, Slack, web, and
mobile push.

Date: 2026-05-15

## Purpose

This document turns the current architecture decisions into an implementation
order that can be executed without re-litigating the model on every PR.

The near-term goal is to make cloud-mediated Proliferate useful from Desktop,
web/mobile-shaped surfaces, Slack, and automations without waiting for the
long-term centralized agent credential gateway.

The urgent launch bar is:

- Desktop can create and run automations against managed cloud, SSH, and local
  targets through the target/worker model.
- Users can target cloud-addressable work from a clean target selector instead
  of a local-vs-cloud special case.
- Team automation runs can be listed, opened, claimed, and continued.
- A mobile/TestFlight build is possible if the repo/local environment has a
  working Tauri iOS project and signing setup. If it does not, the immediate
  deliverable is a mobile-responsive cloud surface plus a clear native iOS
  bootstrap task.
- Slack can be brought up as a thread adapter over the same cloud command/run
  objects, not as a separate execution path.

## Current Repo Facts

These facts matter for the launch plan:

- The workspace has `cloud/sdk` and `cloud/sdk-react` packages.
- The workspace does not currently have a separate committed `mobile/` package.
- The desktop app is a Tauri app and has iOS icon assets, but a committed Tauri
  iOS project was not found during the planning pass.
- Desktop already has an Automations surface and editor under
  `desktop/src/components/automations/**`.
- Server automations already expose `targetId` / target kind fields in the API
  models, but the Desktop automation UI still primarily thinks in
  local-vs-cloud execution target terms.
- Slack currently has message/webhook helpers, but not a full Slack thread link
  product backend.

## Non-Goals For This Push

Do not block the launch on these:

- Full centralized agent credential gateway.
- Full team/service credential model for every provider.
- Full web IDE features.
- Mobile file editing, terminal streaming, browser streaming, or computer-use
  streaming.
- Slack-native full configuration/admin UI.
- Cloud durable storage of token-level deltas or raw tool bodies.

## Core Mental Model

The system remains:

```text
commands down
events up
AnyHarness orders
Cloud projects
Worker transports
Desktop can direct-attach
```

The object model is:

```text
Target
  compute that can run AnyHarness work

Workspace / Worktree
  repo-root and unit of work on a target

Session
  execution inside a workspace

Automation
  reusable definition that creates runs

AutomationRun
  concrete run with target, workspace, session, prompt, and outputs

SlackThreadLink
  Slack thread mapped to a session/run

Claim
  user takes ownership of next action; it does not transfer credentials or move
  the sandbox
```

## Target Selection Model

All entry points should converge on a single target-first selection model.

This applies to:

- New chat / new workspace.
- Automation creation.
- Automation run-now.
- Slack start-session flow.
- Mobile/web start-session flow.

The stable shape should be:

```text
TargetLaunchSelection
  target_id
  target_kind
  execution_route
  repo_identity
  workspace_policy
  base_branch
  credential_source_ref
  mcp_bundle_ref
  skill_bundle_refs
  env_materialization_ref
  default_agent
  default_model
  default_mode
```

`target_kind` values:

```text
managed_cloud
ssh
desktop_dispatch
local_direct
self_hosted_cloud
```

`execution_route` values:

```text
cloud_worker
desktop_direct
local_executor
```

`workspace_policy` values:

```text
existing_workspace
existing_repo_root
new_worktree
fresh_repo_checkout
```

Rules:

- Cloud-mediated clients only submit CloudCommands.
- Desktop may direct-attach when it has access, but mutations still go through
  AnyHarness command APIs.
- A target may be visible but not directly openable from Desktop. In that case
  Desktop should show it as cloud-dispatchable and route open/claim actions to
  web or require direct access setup.
- Target selection is target-id first. Local-vs-cloud is only an execution route
  detail.

## Workspace/Run Config vs Session Config

The durable launch configuration belongs primarily to the workspace/run, not to
the individual chat row.

Workspace or automation-run launch config owns:

- target
- repo identity and checkout path policy
- workspace/worktree policy
- base branch
- MCP bundle
- skill bundle
- env/materialization config
- credential source reference
- default agent/model/mode

Session config owns:

- current agent/model/mode/config snapshot
- transcript
- pending interactions
- turn state
- session status

Sessions consume the workspace/run config. They should not be the only place
where target, repo, MCP, credential, and materialization decisions live.

## Credentials V1

Long term, credentials should come from Cloud-resolved provider/team/service
grants and an agent/provider gateway.

V1 bridge:

- Personal cloud work uses the user's synced/local credential material where
  needed.
- Team work can use creator/user-synced credentials as a launch bridge, but the
  UI must label the run as `runs as <user>` or equivalent.
- GitHub auth is required for the current product path.
- Git identity is target/workspace materialization data, not the same thing as
  claim ownership.
- Claiming a run does not switch Git identity, provider credentials, sandbox
  ownership, or workspace ownership.

Do not add hidden broad secret sharing for team targets. If a credential is
used as a V1 bridge, make it explicit in the launch config and run metadata.

## MCP / Skill Bundles V1

The launch config must have fields for MCP and skill bundles now, even if V1
uses a narrow/default implementation.

V1 behavior:

- Desktop exposes bundle selection where the data already exists.
- Team automation launch records the selected MCP/skill bundle refs.
- Worker materialization installs or configures what it can through the existing
  materialization path.
- Missing target readiness should show as a target setup problem, not as a
  mysterious session failure.

Long term:

- Catalog -> configuration -> target readiness -> session authorization.
- Team work only uses admin-approved bundles.
- Personal MCPs are not silently inherited into team work.

## Phase 0: Mobile/TestFlight Feasibility Check

Before promising TestFlight, verify the native mobile path.

Check:

- Is there a committed or local `desktop/src-tauri/gen/apple` project?
- Does `pnpm tauri ios init` succeed from `desktop` without restructuring?
- Does the local machine have valid Apple signing identities/profiles?
- Can the app reach the correct Cloud API base URL in an iOS build?
- Is GitHub auth/deep linking configured for iOS?

If the answer is no, the fallback launch artifact is:

- mobile-responsive cloud UI in the existing app/web shell;
- a documented iOS bootstrap task;
- no claim that TestFlight is ready until the native project signs and uploads.

Relevant files/directories:

- `desktop/package.json`
- `desktop/src-tauri/`
- `desktop/src/config/app-routes.ts`
- `cloud/sdk/**`
- `cloud/sdk-react/**`

Acceptance:

- We can state clearly whether native TestFlight is buildable tonight.
- If buildable, produce the exact command sequence for local build/upload.
- If not buildable, document the smallest missing setup.

## Phase 1: Clean Targeting

Goal: replace local-vs-cloud special cases with a target-id-first model in the
Desktop automation/new-work launch path.

Implementation shape:

- Extend frontend automation/run records to preserve `targetId` and target kind.
- Update target selection domain logic to select `TargetLaunchSelection`.
- Build target picker UI from the Cloud target list plus local/direct target.
- Ensure create/update automation requests pass `targetId`.
- Ensure run detail displays target name/kind/status and whether it is directly
  openable.
- Keep server API shape aligned with existing `targetId` fields.

Likely files:

- `server/proliferate/server/automations/models.py`
- `server/proliferate/server/automations/api.py`
- `cloud/sdk/src/client/automations.ts`
- `cloud/sdk/src/generated/openapi.ts`
- `desktop/src/lib/domain/automations/run/ui-records.ts`
- `desktop/src/lib/domain/automations/target/records.ts`
- `desktop/src/lib/domain/automations/target/selection.ts`
- `desktop/src/hooks/automations/derived/use-automation-target-selection.ts`
- `desktop/src/components/automations/controls/AutomationTargetPicker.tsx`
- `desktop/src/components/automations/editor/AutomationEditorModal.tsx`
- `desktop/src/components/automations/list/AutomationDetailContent.tsx`

Acceptance:

- A user can choose managed cloud, SSH, or local/direct where available.
- The selected target is visible on automation details and run details.
- The request payload contains target identity rather than only
  `executionTarget: cloud | local`.
- Existing local automations still work.

## Phase 2: Desktop Team Automations MVP

Goal: team automation workflows are useful before full web/mobile surfaces.

Desktop should support:

- List team and personal automations.
- Create automation with target, repo, prompt, schedule, MCP/skill refs where
  available, and explicit `runs as` credential source.
- Trigger run now.
- View run timeline/status/result.
- Claim a run.
- Continue/open the session when direct access is available.
- Show “open in web” or “configure direct access” when the target is not
  directly reachable from Desktop.

Likely files:

- `desktop/src/components/automations/**`
- `desktop/src/hooks/automations/**`
- `desktop/src/lib/domain/automations/**`
- `cloud/sdk/src/client/automations.ts`
- `server/proliferate/server/automations/**`

Acceptance:

- Automation create/edit/run-now works with target-id-first selection.
- Run detail explains the credential/target state.
- Claiming does not imply sandbox or credential transfer.

## Phase 3: Slack Backend MVP

Goal: Slack becomes a cloud-mediated thread adapter over automation/session
objects.

Core object:

```text
SlackThreadLink
  slack_workspace_id
  channel_id
  thread_ts
  org_id
  workspace_id
  session_id
  automation_run_id
  created_by_user_id
```

V1 flows:

- Start/link work from a Slack command or message action.
- Reply in a linked thread to send a prompt.
- Post compact run/session progress.
- Post pending interaction buttons when available.
- Post completion/failure summaries with web/Desktop links.

Likely files:

- `server/proliferate/integrations/slack/messages.py`
- `server/proliferate/integrations/slack/webhooks.py`
- `server/proliferate/server/**/slack*.py` or a new server-owned Slack module
  following `docs/server/README.md`.
- Cloud command and automation services used by Slack handlers.

Acceptance:

- Slack never sees target credentials or AnyHarness URLs.
- Slack actions become normal CloudCommands or automation operations.
- Complex actions route to web/Desktop links.

## Phase 4: Mobile/TestFlight V1

Goal: mobile is supervision and lightweight action, not a mobile IDE.

V1 screens:

- Sign in / GitHub auth.
- Active sessions and automation runs.
- Needs-attention queue.
- Run/session detail with transcript/result summary where cloud-visible.
- Claim/continue/open links.
- Approve/deny or answer pending interactions if the cloud projection supports
  them.

V1 excludes:

- file editing
- terminal
- browser/computer-use stream
- full target admin
- complex automation builder

Implementation options:

1. Native Tauri iOS shell if Phase 0 passes.
2. Mobile-responsive web shell if native iOS is not ready.

Likely files:

- `desktop/src/App.tsx`
- `desktop/src/pages/MainPage.tsx`
- `desktop/src/config/app-routes.ts`
- `desktop/src/components/automations/**`
- `desktop/src/components/cloud/**` where present
- `cloud/sdk-react/**`
- `cloud/sdk/**`
- `desktop/src-tauri/**` only if native iOS is enabled.

Acceptance:

- A first-time tester can sign in and see useful cloud-visible work without
  installing Desktop.
- If native iOS is built, the build is signed and uploadable.
- If native iOS is not buildable, the blocker is explicit and the responsive web
  fallback works.

## Phase 5: Web V1

Goal: web is the team control room.

V1 pages:

- Workspaces / runs list.
- Automation list and run detail.
- Session transcript/result view where projected.
- Target status.
- Claim/continue/open links.

V1 excludes:

- full file review
- interactive terminal
- browser/computer-use streaming
- full target admin

Implementation should reuse the same Cloud SDK and product/domain logic as
Desktop/mobile where ownership rules allow it.

Acceptance:

- Web and mobile render the same core cloud objects.
- Surface-specific UI differs, but commands and snapshots do not.

## Implementation Order

The order for the next implementation passes should be:

1. Phase 0: decide if TestFlight is actually buildable from the current repo and
   local machine.
2. Phase 1: clean target selection in Desktop and SDK models.
3. Phase 2: Desktop team automations MVP.
4. Phase 3: Slack backend MVP if credentials/app configuration are available.
5. Phase 4: mobile/TestFlight V1 or responsive mobile fallback.
6. Phase 5: web V1.

Do not build web/mobile before the target/run model is clean. They should render
the shared model, not invent another one.

## Testing Plan

Unit tests:

- target selection maps managed cloud, SSH, and local targets correctly.
- automation create/update requests include target identity.
- run UI records preserve target kind/id and claim/open state.
- Slack thread link mapping creates the expected command/run operation.

Integration/manual smoke:

- managed cloud automation run creates workspace, session, and accepted prompt.
- SSH automation run creates/uses repo checkout, worktree, session, and accepted
  prompt.
- Desktop can open or correctly explain why it cannot directly open the target.
- Mobile viewport renders active runs and needs-attention cards without desktop
  layout overflow.

Visual checks:

- Playwright/browser screenshots for automation editor, target picker, run
  detail, and mobile viewport.
- No giant raw event/tool payload UI in run/session views.

Release checks:

- `pnpm`/frontend tests for changed Desktop/SDK code.
- Server tests for changed automation/Slack APIs.
- Native iOS build/upload check only if Phase 0 passes.

## Hard Decisions

- No centralized agent gateway for this launch.
- User-synced credentials are the V1 bridge, but must be visible in UI and run
  metadata.
- Target selection is target-id first everywhere.
- Workspace/run launch config owns target/repo/MCP/skills/credential refs.
- Sessions execute inside the selected workspace/run config.
- Slack, mobile, and web are Cloud surfaces. They do not talk directly to
  AnyHarness or target credentials.
- Claiming a run means ownership of the next action, not transferring
  credentials or moving compute.

## Open Questions To Resolve Before Coding Each Phase

- Is native TestFlight possible from the current repo tonight?
- What exact Apple signing/App Store Connect credentials are available?
- What Slack app credentials/event URL are available for local/prod testing?
- Which target access states should show “open in Desktop” vs “open in web” vs
  “configure direct SSH access”?
- Which MCP/skill bundle picker data is already available in Desktop, and which
  fields should be saved but hidden for V1?
