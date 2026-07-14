# Product Systems

Status: authoritative index for user-facing product systems.

Product system specs own complete user workflows, UI surface behavior,
acceptance matrices, copy-level product semantics, and end-to-end smoke
expectations. They reference structure and platform specs rather than
restating folder rules or low-level reusable contracts.

## System Map

| System area | Owns | Read |
| --- | --- | --- |
| Onboarding | Signed-out to product-ready account handoff, provider readiness, billing/credit readiness, agent auth setup, and first workspace transition. | [onboarding/README.md](onboarding/README.md) |
| Product auth | Account sign-in, linked providers, email/password, product-readiness gates, reviewer accounts, and auth surface UX. | [auth/README.md](auth/README.md) |
| Organization invitations | Organization invite links, pending invitation grants, desktop join behavior, and admin member/invite UX. | [organizations/invitations.md](organizations/invitations.md) |
| Pending workspace shell | Pending workspace entry, projected session shell, optimistic prompts, and workspace/session materialization handoff. | [workspaces/pending-shell.md](workspaces/pending-shell.md) |
| Cloud access / dispatch | Web/Mobile/Desktop cloud workspace access, dispatch UX, direct/open-in-desktop flows, commandability, and cloud/local parity. | [workspaces/cloud-dispatch.md](workspaces/cloud-dispatch.md), [clients/cloud-local-parity.md](clients/cloud-local-parity.md) |
| Chat | Composer and transcript behavior. | [chat/README.md](chat/README.md) |
| Workspace files, migration, and terminals | User-facing workspace file, migration, shell, dispatch, and terminal behavior. | [workspaces/README.md](workspaces/README.md) |
| Mobile cloud client | Mobile auth, cloud chat, sessions, automations, settings, device/mobile-web smoke, and mobile acceptance matrix. | [clients/mobile-cloud.md](clients/mobile-cloud.md) |
| Workflows | User-owned workflow definitions, ordered stages and prompt steps, catalog-backed harness validation, revisioning, optional default repository configuration, and definition-authoring UX. | [workflows/definitions.md](workflows/definitions.md) |
| Automations | Scheduled/manual automations and the parked Slack bot contract. | [automations/README.md](automations/README.md) |
| Delegated work and artifacts | Delegated-work UX and cowork artifact lifecycle. | [agents/README.md](agents/README.md) |
| Settings and admin IA | Settings/admin information architecture, billing/account/team/config surfaces, filtering, origins, and admin-facing state. | [settings/information-architecture.md](settings/information-architecture.md) |
| Support reporting | Currently shipped private support capture. | [support/README.md](support/README.md) |
| Web/Desktop client unification | Shared client ownership, thin Desktop/Web hosts, capability policy, and migration governance. | [clients/web-desktop-unification/README.md](clients/web-desktop-unification/README.md) |

## Outline Coverage

Some feature names in planning docs are broader than the current file names.
Use this map before creating a new spec:

| Planning topic | Current owner |
| --- | --- |
| Onboarding | [onboarding/README.md](onboarding/README.md), with lower-level slices in [auth/README.md](auth/README.md), [../../platforms/product/agent-auth-bifrost-byok.md](../../platforms/product/agent-auth-bifrost-byok.md), [../../platforms/product/billing.md](../../platforms/product/billing.md), [../../platforms/product/workspace-provisioning.md](../../platforms/product/workspace-provisioning.md), and [settings/information-architecture.md](settings/information-architecture.md). |
| Browsers | No dedicated browser system spec yet. Product MCP ownership is in [Product Agent Features](../../platforms/product/agent-features/README.md); runtime/domain ownership remains under [AnyHarness](../../structures/anyharness/README.md). Create a browser system spec before adding user-visible browser workflows. |
| Terminals | [workspaces/terminals.md](workspaces/terminals.md) owns terminal pane UX and the creation grid contract. Runtime ownership remains under [AnyHarness](../../structures/anyharness/README.md). |
| Computer Use | No dedicated computer-use system spec yet. Product MCP ownership is in [Product Agent Features](../../platforms/product/agent-features/README.md); create a system spec before adding user-visible Computer Use workflow, permissions, or QA behavior. |
| Plugins | Runtime/config ownership lives in [MCP, Skills, and Plugins](../../platforms/product/mcp-skills.md). Create a plugins system spec only for user-facing catalog/install/manage workflows that exceed the platform contract. |
| Product MCP Structure | Covered by [Product MCP Servers](../../platforms/product/agent-features/servers.md) and [Product MCP Definitions](../../platforms/product/agent-features/definitions/README.md). |

## Agent Feature Coverage

Use this map for the nested "Agent Features" planning bucket before adding a
new system spec or Product MCP definition:

| Agent feature | Current owner |
| --- | --- |
| Browser | No concrete system spec or Product MCP definition yet; create one before user-visible browser workflow or permission changes. |
| Artifacts | [agents/cowork-artifacts.md](agents/cowork-artifacts.md) and [Artifacts MCP](../../platforms/product/agent-features/definitions/artifacts.md). |
| Sub Agents | [agents/delegated-work.md](agents/delegated-work.md) and [Subagents MCP](../../platforms/product/agent-features/definitions/subagents.md). |
| Computer Use | No concrete system spec or Product MCP definition yet; create one before user-visible Computer Use workflow, permission, or QA changes. |
| Plugins | [MCP, Skills, and Plugins](../../platforms/product/mcp-skills.md) owns runtime/config expansion; create a system spec only for catalog/install/manage UX. |

## Adding A Product System Spec

Add a system spec when a workflow becomes durable enough that contributors
need one place to learn:

- user-visible entrypoints and states
- platform contracts consumed by the system
- frontend, server, runtime, SDK, or worker surfaces involved
- acceptance criteria and manual smoke
- analytics, support, billing, or release-note implications
- migration exceptions and current implementation anchors

Do not create a placeholder spec that only says a system should exist. If the
system is not authoritative yet, keep design notes under `specs/tbd/` until
the owner and contract are clear.
