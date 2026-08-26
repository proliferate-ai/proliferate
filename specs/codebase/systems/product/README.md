# Product Systems

Product system specs own complete user workflows, UI surface behavior,
acceptance matrices, copy-level product semantics, and end-to-end smoke
expectations. They reference structure and platform specs rather than
restating folder rules or low-level reusable contracts.

## System Map

| System area | Owns | Read |
| --- | --- | --- |
| Onboarding | Signed-out to product-ready account handoff, provider readiness, billing/credit readiness, agent auth setup, and first workspace transition. | [onboarding/README.md](onboarding/README.md) |
| Accounts | The `accounts` system: users, sign-in methods, linked identities and grants, sessions/tokens, readiness gates, account-entry side effects. Surface rules in its `auth/README.md` section. | [accounts/README.md](accounts/README.md), [auth/README.md](auth/README.md) |
| Organizations | The `organizations` system: tenant, membership and roles, invitations and join flow, single-org instance + ADMIN_EMAILS floor, self-registration, team-checkout intents, org-admin usage/limits routes. | [organizations/README.md](organizations/README.md), [organizations/invitations.md](organizations/invitations.md) |
| Billing | The `billing` system: payer subjects, grants and holds, compute/LLM meters, Stripe money-in, seats, overage exports, enforcement gates, truth surfaces; the 2026-08-25 three-way ruling. | [billing/README.md](billing/README.md) |
| Pending workspace shell | Pending workspace entry, projected session shell, optimistic prompts, and workspace/session materialization handoff. | [workspaces/pending-shell.md](workspaces/pending-shell.md) |
| Cloud access / dispatch | Web/Mobile/Desktop cloud workspace access and dispatch UX. | No current system spec; the previous dispatch spec was built on a reverted substrate and removed — a rewrite is planned. |
| Chat | The chat surface's contract (purpose, owned UI state, public surface, consumed runtime/Cloud contracts, laws, fences, code map, proof), with lifecycle, composer, and transcript as its sections. | [chat/README.md](chat/README.md) |
| Workspace surface | The shell (sidebar, header tabs, right panel), files, terminals, git review/publish, repo setup, and session selection — the surface's contract, with files/terminals/selection/pending-shell/cloud/migration as its sections. | [workspaces/README.md](workspaces/README.md) |
| Runs triage | Target: the inbox for delegated work (subagents, goals/loops, workflow and triggered runs, results); today's ancestors are the activity chrome, Background pane, Agents pane, and workflows views. | [runs-triage/README.md](runs-triage/README.md) |
| Mobile client | Mobile auth, cloud chat, sessions, and settings on the mobile surface. | No current system spec. Mobile ships from `apps/mobile`; architecture boundary owned by [specs/frontend/README.md](../../../frontend/README.md), local/QA lanes by [guides/local/mobile.md](../../../../guides/local/mobile.md). |
| Automations (Workflows) | The gen-2 engine on every plane: definitions and frozen invocations on the control plane, the client trigger courier, runtime placement and node execution; trigger intake and org-shared definitions as recorded gaps. Grade B. | [automations/README.md](automations/README.md) (narrative reference: [specs/FEATURE_DOCS/WORKFLOWS.md](../../../FEATURE_DOCS/WORKFLOWS.md)) |
| Agent auth | Which credentials a harness launches with: selections, the vault, `state.json` rendering and delivery, launch-time application, org policy. Grade B. | [agent_auth/README.md](agent_auth/README.md) (detail reference: [specs/FEATURE_DOCS/AGENT_AUTH.md](../../../FEATURE_DOCS/AGENT_AUTH.md)) |
| Runs | Target: the control-plane run record — subject, budget envelope, spawn tree, results, cancel-tree. Grade C. | [runs/README.md](runs/README.md) |
| API | Target: the agent-first `/v1` front door — tokens and delegation, the eight verbs, `GET /v1/agent`, typed errors, idempotency. Grade C. | [api/README.md](api/README.md) |
| Seam | The CP ↔ runtime contract: worker enrollment, identity, heartbeat (current); courier and event shipping (target). Grade B/C. | [seam/README.md](seam/README.md) |
| Sessions | The session as a product object: the runtime event log and its five invariants (current); the control-plane registry row, external bindings, checkpointed record (target). Grade B/C. | [sessions/README.md](sessions/README.md) |
| Environments | The container: provisioning engine, lifecycle states and causes, usage fencing, template pipeline; personal and task classes (target). Grade C. | [environments/README.md](environments/README.md) |
| Agents | The agent-systems overview map (distribution, auth, gateway, target-observed launch options), plus delegated-work UX and cowork artifact lifecycle. | [agents/README.md](agents/README.md) |
| Settings | The settings surface's contract (section registry, navigation, drafts, consumed account/org/billing/agent-auth/integration contracts, laws, fences), with information architecture and Appearance scaling as its sections. | [settings/README.md](settings/README.md) |
| Support reporting | Currently shipped private support capture. | [support/README.md](support/README.md) |
| UX Latency + Transitions | Loading-treatment state machine and tokens, the chat pane's hero loading mark, sidebar row activation transition, and held-key workspace switching. | [ux-latency-transitions.md](ux-latency-transitions.md) |
| Web/Desktop client unification | Shared client ownership, thin Desktop/Web hosts, capability policy, and migration governance. | [clients/web-desktop-unification/README.md](clients/web-desktop-unification/README.md) |

## Outline Coverage

Some feature names in planning docs are broader than the current file names.
Use this map before creating a new spec:

| Planning topic | Current owner |
| --- | --- |
| Onboarding | [onboarding/README.md](onboarding/README.md), with lower-level slices in [auth/README.md](auth/README.md), [specs/FEATURE_DOCS/BILLING.md](../../../FEATURE_DOCS/BILLING.md), [../../platforms/product/workspace-provisioning.md](../../platforms/product/workspace-provisioning.md), and [settings/information-architecture.md](settings/information-architecture.md). The managed model gateway is owned by [specs/FEATURE_DOCS/MODELS.md](../../../FEATURE_DOCS/MODELS.md). |
| Browsers | No dedicated browser system spec yet. Product MCP ownership is in [Product Agent Features](../../platforms/product/agent-features/README.md); runtime/domain ownership remains under [AnyHarness](../../../anyharness/README.md). Create a browser system spec before adding user-visible browser workflows. |
| Terminals | [workspaces/terminals.md](workspaces/terminals.md) owns terminal pane UX and the creation grid contract. Runtime ownership remains under [AnyHarness](../../../anyharness/README.md). |
| Computer Use | No dedicated computer-use system spec yet. Product MCP ownership is in [Product Agent Features](../../platforms/product/agent-features/README.md); create a system spec before adding user-visible Computer Use workflow, permissions, or QA behavior. |
| Plugins | No current platform document. Create a plugins system spec only for user-facing catalog/install/manage workflows that exceed today's implicit plugin-expansion behavior. |
| Product MCP Structure | Covered by [Product MCP Servers](../../platforms/product/agent-features/servers.md) and [Product MCP Definitions](../../platforms/product/agent-features/definitions/README.md). |

## Agent Feature Coverage

Use this map for the nested "Agent Features" planning bucket before adding a
new system spec or Product MCP definition:

| Agent feature | Current owner |
| --- | --- |
| Browser | No concrete system spec or Product MCP definition yet; create one before user-visible browser workflow or permission changes. |
| Artifacts | [agents/cowork-artifacts.md](agents/cowork-artifacts.md). |
| Sub Agents | [agents/delegated-work.md](agents/delegated-work.md) and [Workspace MCP](../../platforms/product/agent-features/definitions/workspace.md). |
| Computer Use | No concrete system spec or Product MCP definition yet; create one before user-visible Computer Use workflow, permission, or QA changes. |
| Plugins | No current platform document owns runtime/config expansion; create a system spec only for catalog/install/manage UX. |

## Adding A Product System Spec

System specs written after 2026-08-25 follow the nine-section anatomy (Purpose,
Owned state, Public surface, Consumes, Laws, Emits, Fences, Code map, Proof) with
a `Known gaps` list and inline `PABLO DECIDES` callouts for founder rulings; see
[seam/README.md](seam/README.md) for the form.

Add a system spec when a workflow becomes durable enough that contributors
need one place to learn:

- user-visible entrypoints and states
- platform contracts consumed by the system
- frontend, server, runtime, SDK, or worker surfaces involved
- acceptance criteria and manual smoke
- analytics, support, billing, or release-note implications
- migration exceptions and current implementation anchors

Do not create a placeholder spec that only says a system should exist. If the
system is not authoritative yet, keep design notes outside the permanent
repository documentation path until the owner and contract are clear.
