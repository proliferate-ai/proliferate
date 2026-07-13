# Codebase Features

Status: authoritative index for user-facing workflow and product-surface specs.

Feature specs own user workflows, UI surface behavior, acceptance matrices,
copy-level product semantics, and end-to-end smoke expectations. They should
reference structure and primitive specs rather than restating folder rules or
low-level runtime contracts.

## Feature Map

| Feature area | Owns | Read |
| --- | --- | --- |
| Onboarding | Signed-out to product-ready account handoff, provider readiness, billing/credit readiness, agent auth setup, and first workspace transition. | [onboarding.md](onboarding.md) |
| Product auth | Account sign-in, linked providers, email/password, product-readiness gates, reviewer accounts, and auth surface UX. | [product-auth.md](product-auth.md) |
| Organization invitations | Organization invite links, pending invitation grants, desktop join behavior, and admin member/invite UX. | [organization-invitations.md](organization-invitations.md) |
| Pending workspace shell | Pending workspace entry, projected session shell, optimistic prompts, and workspace/session materialization handoff. | [pending-workspace-shell.md](pending-workspace-shell.md) |
| Cloud access / dispatch | Web/Mobile/Desktop cloud workspace access, dispatch UX, direct/open-in-desktop flows, commandability, and cloud/local parity. | [cloud-dispatch.md](cloud-dispatch.md), [web-cloud-local-parity.md](web-cloud-local-parity.md) |
| Chat composer | Composer controls, model/config selection, dock slots, review/plan/subagent composer states, and dev playground scenarios. | [chat-composer.md](chat-composer.md) |
| Chat transcript | Transcript streaming, replay, transcript row models, long-history behavior, optimistic/waiting rows, and reconnect semantics. | [chat-transcript.md](chat-transcript.md) |
| Workspace files | Workspace file browsing, file viewing, diff viewing, Changes, and all-changes review. | [workspace-files.md](workspace-files.md) |
| Mobile cloud client | Mobile auth, cloud chat, sessions, automations, settings, device/mobile-web smoke, and mobile acceptance matrix. | [mobile-cloud-client.md](mobile-cloud-client.md) |
| Automations | Scheduled/manual automations, runs, trigger behavior, ownership, permissions, snapshots, and smoke coverage. | [automations.md](automations.md) |
| Slack bot | Slack connection, bot config, event handling, commands, claim flows, and Slack-origin workspace behavior. | [slack-bot.md](slack-bot.md) |
| Delegated work / subagents | Delegated work lifecycle, parent/subagent coordination, review agents, queued wakes, and transcript/composer integration. | [delegated-work.md](delegated-work.md), [agent-features/definitions/subagents.md](agent-features/definitions/subagents.md) |
| Artifacts | Cowork artifacts, artifact MCP definition, artifact product behavior, and artifact transcript/workflow surfaces. | [cowork-artifacts.md](cowork-artifacts.md), [agent-features/definitions/artifacts.md](agent-features/definitions/artifacts.md) |
| Agent features / product MCPs | Product MCP server pattern and concrete agent-feature MCP definitions for reviews, subagents, artifacts, cowork, and prompt/skill policy. | [agent-features/servers.md](agent-features/servers.md), [agent-features/definitions/README.md](agent-features/definitions/README.md) |
| Settings and admin IA | Settings/admin information architecture, billing/account/team/config surfaces, filtering, origins, and admin-facing state. | [settings-admin-ia.md](settings-admin-ia.md) |
| Support reporting and resolution | Private support capture, source ingestion, issue lifecycle, reporter attribution, release linkage, and generated public changelog output. | [support-reporting.md](support-reporting.md), [support-system.md](support-system.md) |
| Terminals | Workspace terminal pane UX, terminal record actions, and the creation grid contract for new terminals. | [terminals.md](terminals.md) |
| Workspace migration | Workspace migration flows, user attestation, durability, queue state, and completion/error semantics. | [workspace-migration.md](workspace-migration.md) |
| Desktop updates | Packaged updater metadata, version-aware sidebar release notices, acknowledgment, and post-install behavior. | [desktop-updates.md](desktop-updates.md) |

## Outline Coverage

Some feature names in planning docs are broader than the current file names.
Use this map before creating a new spec:

| Planning topic | Current owner |
| --- | --- |
| Onboarding | [onboarding.md](onboarding.md), with lower-level slices in [product-auth.md](product-auth.md), [../primitives/agent-auth-bifrost-byok.md](../primitives/agent-auth-bifrost-byok.md), [../primitives/billing.md](../primitives/billing.md), [../primitives/workspace-provisioning.md](../primitives/workspace-provisioning.md), and [settings-admin-ia.md](settings-admin-ia.md). |
| Browsers | No dedicated browser feature spec yet. Product MCP ownership is in [agent-features/servers.md](agent-features/servers.md); runtime/domain ownership remains under [../structures/anyharness/README.md](../structures/anyharness/README.md). Create a browser feature spec before adding user-visible browser workflows. |
| Terminals | [terminals.md](terminals.md) owns terminal pane UX and the creation grid contract. Runtime ownership remains under [../structures/anyharness/README.md](../structures/anyharness/README.md). |
| Computer Use | No dedicated computer-use feature spec yet. Product MCP ownership is in [agent-features/servers.md](agent-features/servers.md); create a feature spec before adding user-visible Computer Use workflow, permissions, or QA behavior. |
| Plugins | Runtime/config ownership lives in [../primitives/mcp-skills.md](../primitives/mcp-skills.md). Create a plugins feature spec only for user-facing catalog/install/manage workflows that exceed the primitive contract. |
| Product MCP Structure | Covered by [agent-features/servers.md](agent-features/servers.md) and concrete definitions under [agent-features/definitions/](agent-features/definitions/). |

## Agent Feature Coverage

Use this map for the nested "Agent Features" planning bucket before adding a
new feature spec or Product MCP definition:

| Agent feature | Current owner |
| --- | --- |
| Browser | No concrete feature spec or Product MCP definition yet; create one before user-visible browser workflow or permission changes. |
| Artifacts | [cowork-artifacts.md](cowork-artifacts.md) and [agent-features/definitions/artifacts.md](agent-features/definitions/artifacts.md). |
| Sub Agents | [delegated-work.md](delegated-work.md) and [agent-features/definitions/subagents.md](agent-features/definitions/subagents.md). |
| Computer Use | No concrete feature spec or Product MCP definition yet; create one before user-visible Computer Use workflow, permission, or QA changes. |
| Plugins | [../primitives/mcp-skills.md](../primitives/mcp-skills.md) owns runtime/config expansion; create a feature spec only for catalog/install/manage UX. |

## Adding A Feature Spec

Add a feature spec when a workflow becomes durable enough that contributors
need one place to learn:

- user-visible entrypoints and states
- data/primitive contracts consumed by the feature
- frontend, server, runtime, SDK, or worker surfaces involved
- acceptance criteria and manual smoke
- analytics, support, billing, or release-note implications
- migration exceptions and current implementation anchors

Do not create a placeholder spec that only says a feature should exist. If the
feature is not authoritative yet, keep design notes under `specs/tbd/` until
the owner and contract are clear.
