# Codebase Primitives

Status: authoritative index for reusable product and runtime primitives.

Primitive specs own concepts that multiple features or structures depend on:
provisioning state machines, command envelopes, auth materialization, billing
gates, MCP/skills runtime configuration, claiming, and shared catalogs. A
primitive may include UI/API expectations, but it is not the owner of a full
user workflow.

## Primitive Map

| Primitive | Owns | Read |
| --- | --- | --- |
| Sandbox provisioning / creation flow | Sandbox profiles, targets, slots, provisioning jobs, lifecycle state, provider handoff, and target materialization inputs. | [sandbox-provisioning.md](sandbox-provisioning.md) |
| Workspace provisioning / creation flow | Managed workspace creation read path, sandbox/target provisioning handoff, commandable session startup, pending-shell handoff, and workspace/worktree lifecycle after creation. | [workspace-provisioning.md](workspace-provisioning.md), then [sandbox-provisioning.md](sandbox-provisioning.md), [cloud-commands.md](cloud-commands.md), and [workspace-lifecycle.md](workspace-lifecycle.md) |
| MCP runtime | AnyHarness MCP concepts, user bindings, session extensions, product MCP serving, and elicitation boundaries. | [mcp-runtime.md](mcp-runtime.md) |
| MCP + skills + plugins flow | Cloud configured items for MCPs, skills, plugins, runtime manifests, worker materialization, and plugin-to-runtime expansion rules. | [mcp-skills.md](mcp-skills.md) |
| Product MCP structure | Product-owned MCP server pattern, static definitions, binding summaries, and concrete agent-feature MCP definitions. | [../features/agent-features/servers.md](../features/agent-features/servers.md), [../features/agent-features/definitions/README.md](../features/agent-features/definitions/README.md) |
| Agent auth primitive | Harness auth source selection, synced files, gateway env materialization, capability APIs, and fail-closed launch behavior. | [agent-auth.md](agent-auth.md) |
| Sandbox GitHub auth | GitHub App authorization, sandbox Git credential leases, worker refresh, Git credential helper behavior, and cloud repo Git access boundaries. | [sandbox-github-auth.md](sandbox-github-auth.md) |
| Agent gateway / BYOK | Bifrost-backed managed credits, BYOK onboarding, virtual keys, usage import, free credit allocation, and local gateway QA. | [agent-auth-bifrost-byok.md](agent-auth-bifrost-byok.md) |
| Cloud commands | Command envelopes, leases, result delivery, runtime config preflight, wake gates, exposure state, and session projection. | [cloud-commands.md](cloud-commands.md) |
| Claiming | One-way shared workspace claim, claim audit state, direct-attach tokens, and per-token revocation. | [claiming.md](claiming.md) |
| Billing | Credit authorization, Stripe subscription/refill behavior, budget reconciliation, billing state in product responses, and billing QA. | [billing.md](billing.md) |
| Model catalog | Model catalog source of truth, projection, availability, and selector-facing catalog behavior. | [model-catalog.md](model-catalog.md) |
| Agent catalog readiness | Agent descriptor catalog, readiness projection, install topology, seed artifacts, and launch resolution. | [agent-catalog-readiness.md](agent-catalog-readiness.md) |
| Harness-specific agent primitives | Claude and Codex harness-specific behavior that does not belong in the generic runtime guide. | [agents/claude.md](agents/claude.md), [agents/codex.md](agents/codex.md) |

## Naming Notes

The attached planning outline uses some broader names than the current files:

- "Workspace provisioning / creation flow" has a single read-path entrypoint in
  [workspace-provisioning.md](workspace-provisioning.md), but implementation
  ownership remains split: [sandbox-provisioning.md](sandbox-provisioning.md)
  owns sandbox profiles, targets, slots, and provider handoff;
  [cloud-commands.md](cloud-commands.md) owns `managed_profile_launch` and
  commandable session startup; and
  [workspace-lifecycle.md](workspace-lifecycle.md) owns workspace/worktree
  lifecycle after creation.
- "Product MCP structure" is intentionally documented with feature-owned agent
  MCPs because product MCP definitions describe user-visible capabilities, while
  [mcp-runtime.md](mcp-runtime.md) owns the generic AnyHarness runtime.
- "Plugins" are not a runtime primitive inside AnyHarness. Plugins expand into
  configured MCP and skill items before launch; [mcp-skills.md](mcp-skills.md)
  is the owning primitive.

## Adding A Primitive Spec

Add a primitive spec when a durable concept is reused by multiple features or
systems and needs one shared contract. Keep feature-specific screens, copy,
entrypoints, and acceptance flows in [../features/](../features/).

Every primitive spec should name:

- the durable state or contract it owns
- the structures that implement it
- the features that consume it
- the API/SDK/runtime shape when applicable
- common failure modes and typed error states
- targeted tests and any required manual smoke
