# Product Platforms

Status: authoritative index for reusable product platforms.

Product platform specs own capabilities that multiple systems or structures
depend on:
provisioning, auth materialization, billing gates, MCP/skills runtime
configuration, claiming, and shared catalogs. A platform may include UI/API
expectations, but it is not the owner of a full user workflow.

## Platform Map

| Platform | Owns | Read |
| --- | --- | --- |
| Cloud sandbox provisioning | One active personal sandbox row, just-in-time E2B create/resume, direct AnyHarness launch and gateway access, and the optional Worker sidecar. | [sandbox-provisioning.md](sandbox-provisioning.md) |
| Cloud workspace provisioning | Repository-environment materialization, synchronous Cloud workspace creation, direct AnyHarness worktree creation, and Cloud/runtime truth boundaries. | [workspace-provisioning.md](workspace-provisioning.md), then [sandbox-provisioning.md](sandbox-provisioning.md) and [workspace-lifecycle.md](workspace-lifecycle.md) |
| MCP runtime | AnyHarness MCP concepts, user bindings, session extensions, product MCP serving, and elicitation boundaries. | [mcp-runtime.md](mcp-runtime.md) |
| MCP + skills + plugins flow | Cloud configured items for MCPs, skills, plugins, runtime manifests, worker materialization, and plugin-to-runtime expansion rules. | [mcp-skills.md](mcp-skills.md) |
| Product MCP structure | Product-owned MCP server pattern, static definitions, binding summaries, and concrete agent-feature MCP definitions. | [agent-features/servers.md](agent-features/servers.md), [agent-features/definitions/README.md](agent-features/definitions/README.md) |
| Agent auth platform | Harness auth source selection, synced files, gateway env materialization, capability APIs, and fail-closed launch behavior. | [agent-auth.md](agent-auth.md) |
| Integrations + runtime worker auth | Integration definitions/accounts/policies, OAuth flows, the cloud integration MCP gateway and its virtual tools, and the runtime worker enrollment/heartbeat/token model. | [integrations.md](integrations.md) |
| Sandbox GitHub auth | GitHub App authorization, sandbox Git credential leases, worker refresh, Git credential helper behavior, and cloud repo Git access boundaries. | [sandbox-github-auth.md](sandbox-github-auth.md) |
| Agent gateway / BYOK | Bifrost-backed managed credits, BYOK onboarding, virtual keys, usage import, free credit allocation, and local gateway QA. | [agent-auth-bifrost-byok.md](agent-auth-bifrost-byok.md) |
| Claiming | One-way shared workspace claim, claim audit state, direct-attach tokens, and per-token revocation. | [claiming.md](claiming.md) |
| Billing | Credit authorization, Stripe subscription/refill behavior, budget reconciliation, billing state in product responses, and billing QA. | [billing.md](billing.md) |
| Model catalog | Model catalog source of truth, projection, availability, and selector-facing catalog behavior. | [model-catalog.md](model-catalog.md) |
| Agent catalog readiness | Agent descriptor catalog, readiness projection, install topology, seed artifacts, and launch resolution. | [agent-catalog-readiness.md](agent-catalog-readiness.md) |
| Harness-specific agent platforms | Claude and Codex harness-specific behavior that does not belong in the generic runtime guide. | [agents/README.md](agents/README.md) |

## Naming Notes

- "Product MCP structure" is documented as a reusable product platform because
  Product MCP definitions describe capabilities consumed by multiple systems,
  while
  [mcp-runtime.md](mcp-runtime.md) owns the generic AnyHarness runtime.
- "Plugins" are not a runtime platform inside AnyHarness. Plugins expand into
  configured MCP and skill items before launch; [mcp-skills.md](mcp-skills.md)
  is the owning platform.

## Adding A Product Platform Spec

Add a product platform spec when a durable capability is reused by multiple
systems or structures and needs one shared contract. Keep system-specific
screens, copy, entrypoints, and acceptance flows in
[../../systems/product/](../../systems/product/).

Every platform spec should name:

- the durable state or contract it owns
- the structures that implement it
- the systems that consume it
- the API/SDK/runtime shape when applicable
- common failure modes and typed error states
- targeted tests and any required manual smoke
