# Product Platforms

Product platform specs own capabilities that multiple systems or structures
depend on:
provisioning, auth materialization, billing gates, MCP runtime
configuration, claiming, and shared catalogs. A platform may include UI/API
expectations, but it is not the owner of a full user workflow.

## Platform Map

| Platform | Owns | Read |
| --- | --- | --- |
| Sandbox lifecycle | E2B template arc, sandbox states and wake/pause/destroy causes, chain-completion provisioning, the provisioning engine, usage-fencing billing primitives, runtime topology, health telemetry. Fully absorbed the retired sandbox-provisioning document. | [lifecycle.md](../../../FEATURE_DOCS/SANDBOX/lifecycle.md) (Status: target) |
| Sandbox content | Shared repo clones (create/refresh/reclaim), workspace worktrees (materialize/retire/retention), git identity, disk budget observability. | [content.md](../../../FEATURE_DOCS/SANDBOX/content.md) (Status: target) |
| Sandbox gateway | The wire between product clients and a cloud sandbox's runtime: the AnyHarness proxy route, bearer swap, streaming laws, and the proxied-vs-direct channel map. | [gateway.md](../../../FEATURE_DOCS/SANDBOX/gateway.md) (Status: target) |
| Sandbox access | The caller contract: three gating layers (deployment capability, billing subject, sandbox readiness), the ensure→resolve→gateway choreography, the `/meta` capability contract. | [access.md](../../../FEATURE_DOCS/SANDBOX/access.md) (Status: target) |
| Design system | The whole visual system in one document: the closed type ramp and control weight, the color role model, elevation, spacing/containers, radii, motion, icon tiers and layering, plus the token-authority and gate model, change control for moving a value, and the component library (tier model, governance rules, sanctioned index, how a component enters it). | [specs/DESIGN_SYSTEM.md](../../../DESIGN_SYSTEM.md) |
| MCP runtime | AnyHarness MCP concepts, user bindings, session extensions, product MCP serving, and elicitation boundaries. | [mcp-runtime.md](mcp-runtime.md) |
| Product MCP structure | Product-owned MCP server pattern, static definitions, binding summaries, and concrete agent-feature MCP definitions. | [agent-features/servers.md](agent-features/servers.md), [agent-features/definitions/README.md](agent-features/definitions/README.md) |
| Agent auth platform | Harness auth source selection (`gateway`/`api_key` selections, native = no selection), key vault and typed provider configs, `state.json` delivery, per-harness application recipes, and fail-closed launch behavior. | [AGENT_AUTH.md](../../../FEATURE_DOCS/AGENT_AUTH.md) (Status: target) |
| Integrations + runtime worker auth | Integration definitions/accounts/policies, OAuth flows, the cloud integration MCP gateway and its virtual tools, and the runtime worker enrollment/heartbeat/token model. | [integrations.md](integrations.md) |
| Deployment capabilities | `/meta` capability contract versioning, independent GitHub repository access and managed-Cloud readiness, GitHub App completeness predicate, and repairable repo-authority statuses. | No current document; the frozen v2 delivery slice was removed as superseded (code ships contract v3) and a rewrite is planned inside the sandbox access spec. Owning code: `server/proliferate/server/meta.py`, `server/proliferate/constants/deployment.py`. |
| Sandbox GitHub auth | GitHub App authorization, the sandbox credential lease (server-push at materialization), and the git credential helper. | [github-auth.md](../../../FEATURE_DOCS/SANDBOX/github-auth.md) (Status: target) |
| Model gateway | LiteLLM proxy artifact and deployment, enrollment/teams/virtual keys, budgets, access-group model gating, usage import. | [MODELS.md](../../../FEATURE_DOCS/MODELS.md) (Status: target) |
| Billing | Credit authorization, Stripe subscription/refill behavior, budget reconciliation, billing state in product responses, and billing QA. | [BILLING.md](../../../FEATURE_DOCS/BILLING.md) |
| Harness launch options | Target-observed executable models and generic controls before launch, exact launch intent, copied cloud target state, and session-local live configuration after launch. | [MODELS.md](../../../FEATURE_DOCS/MODELS.md) (Status: current) |
| Agent distribution | Registry/catalog document contract, pinned auto-install and seed topology, binary-carried catalog convergence, supervisor-owned runtime binary convergence, the probe pipeline, and readiness projection. | [agent-distribution.md](agent-distribution.md) (Status: target) |
| Agent systems overview | No contract — the narrative map of how agent distribution, agent auth, the model gateway, and target-observed launch options compose; read first when orienting. | [../../systems/product/agents/README.md](../../systems/product/agents/README.md) |

## Naming Notes

- "Product MCP structure" is documented as a reusable product platform because
  Product MCP definitions describe capabilities consumed by multiple systems,
  while
  [mcp-runtime.md](mcp-runtime.md) owns the generic AnyHarness runtime.

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
