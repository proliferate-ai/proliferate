# Local Skills

Status: authoritative for the local Skills surface and local-first skills.sh
integration.

## Purpose

Local Skills lets a desktop user install agent skills into the local
Proliferate/AnyHarness runtime and enable them per workspace. It is separate
from cloud Plugins/Integrations. Cloud plugins can contribute runtime skills
through runtime config, but this feature is the local skill manager for
machine-owned skills.

## Product Contract

- The desktop sidebar exposes a top-level `Skills` section.
- The section has `Installed` and `Marketplace` views.
- Installed skills are global to the local machine and stored under the local
  AnyHarness/Proliferate runtime home.
- Workspace enablement is local durable state. Installed skills are disabled
  for a workspace until explicitly enabled, except install can enable the
  selected workspace in the same operation.
- Skill changes apply at the next session launch boundary. Existing live
  sessions do not hot-update their skills in v1.
- The existing cloud-backed Plugins/Integrations surface remains separate and
  unchanged.

## Marketplace Behavior

- Marketplace search uses skills.sh discovery endpoints.
- Install snapshots the full `SKILL.md` plus supporting files into the local
  skill library.
- Proliferate does not use `npx skills add` as the primary installer because
  that command writes to agent-specific native skill folders.
- Failed audits block install.
- Warning or missing audits require an explicit confirmation.
- Installed skills remain usable offline after the snapshot is written.
- V1 skills provide instructions and resources only. They do not automatically
  install MCP servers, credentials, CLIs, or tools.

## Runtime Behavior

- AnyHarness owns local skill APIs under `/v1/skills` and
  `/v1/workspaces/{workspace_id}/skills`.
- Session launch compiles only enabled workspace local skills into the bound
  runtime config context.
- Local skills use runtime skill source kind `skills_sh`.
- Agents receive local skills through the existing `proliferate_skills` MCP
  bridge. Codex, Claude, and other agents do not need separate manual installs
  into their native skill folders.
- Runtime config may combine cloud-configured skills and local `skills_sh`
  skills for the same session context.

## Acceptance

- Searching the marketplace shows skill name, source, description, install
  count, files, audit status, and source link when available.
- Installing a passing-audit skill writes it to the local library and can
  enable it for the selected workspace.
- Installing warning or unaudited skills requires confirmation.
- Failed-audit skills cannot be installed through the UI.
- Enabling or disabling an installed skill changes only the selected
  workspace.
- Starting a new session in that workspace exposes only enabled local skills
  through `proliferate_skills`.
