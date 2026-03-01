# Agent Platform V1 Specs (E2B-Only Compute)

## Why this folder exists
These docs define a concrete, plain-language V1 implementation plan for Proliferate.

This folder is intentionally practical:
- What users can do end to end
- What we are building now (E2B-only compute in V1)
- Where code should live in this repo
- What "done" means for each subsystem
- Which files and DB models each subsystem owns

## V1 product shape
V1 has two main experiences:
1. **Interactive coding runs**: user asks agent to fix/build something now
2. **Persistent background agents**: agent keeps watching a job (for example Sentry), spawns worker runs, and reports progress

Primary IA defaults for V1:
- `/sessions` is the central operational workspace for all org-visible sessions and approval handling.
- `/agents` is supervisor-level state (objective, cadence, timeline, spawned sessions).
- Notifications route users into filtered session views; approval UX is session-centric.

## Out of scope for this spec pack
- Building a custom proprietary compute orchestrator
- Non-engineering workflows (email support automation, generic business agents)
- Deep visual no-code workflow builder

## File tree (this spec pack)
```text
/docs/specs/agent-platform-v1/
  README.md
  00-system-file-tree.md
  01-required-functionality-and-ux.md
  02-e2b-interface-and-usage.md
  03-action-registry-and-org-usage.md
  04-long-running-agents.md
  05-trigger-services.md
  06-gateway-functionality.md
  07-cloud-billing.md
  08-coding-agent-harnesses.md
  09-notifications.md
  10-layering-and-mapping-rules.md
  11-streaming-preview-transport-v2.md
  12-reference-index-files-and-models.md
  13-self-hosting-and-updates.md
  14-boot-snapshot-contract.md
  15-llm-proxy-architecture.md
  16-agent-tool-contract.md
  17-entity-ontology-and-lifecycle.md
  18-repo-onboarding-and-configuration-lifecycle.md
  19-artifacts-and-retention.md
  20-code-quality-contract.md
```

## Spec reading order
1. [17-entity-ontology-and-lifecycle.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/17-entity-ontology-and-lifecycle.md)
2. [00-system-file-tree.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/00-system-file-tree.md)
3. [01-required-functionality-and-ux.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/01-required-functionality-and-ux.md)
4. [18-repo-onboarding-and-configuration-lifecycle.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/18-repo-onboarding-and-configuration-lifecycle.md)
5. [06-gateway-functionality.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/06-gateway-functionality.md)
6. [02-e2b-interface-and-usage.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/02-e2b-interface-and-usage.md)
7. [03-action-registry-and-org-usage.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/03-action-registry-and-org-usage.md)
8. [16-agent-tool-contract.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/16-agent-tool-contract.md)
9. [04-long-running-agents.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/04-long-running-agents.md)
10. [05-trigger-services.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/05-trigger-services.md)
11. [08-coding-agent-harnesses.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/08-coding-agent-harnesses.md)
12. [09-notifications.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/09-notifications.md)
13. [19-artifacts-and-retention.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/19-artifacts-and-retention.md)
14. [07-cloud-billing.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/07-cloud-billing.md)
15. [10-layering-and-mapping-rules.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/10-layering-and-mapping-rules.md)
16. [11-streaming-preview-transport-v2.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/11-streaming-preview-transport-v2.md)
17. [12-reference-index-files-and-models.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/12-reference-index-files-and-models.md)
18. [13-self-hosting-and-updates.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/13-self-hosting-and-updates.md)
19. [14-boot-snapshot-contract.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/14-boot-snapshot-contract.md)
20. [15-llm-proxy-architecture.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/15-llm-proxy-architecture.md)
21. [20-code-quality-contract.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/20-code-quality-contract.md)

## Source references in current repo
These docs align with existing architecture and code:
- [sessions-gateway.md](/Users/pablo/proliferate/docs/specs/sessions-gateway.md)
- [sandbox-providers.md](/Users/pablo/proliferate/docs/specs/sandbox-providers.md)
- [actions.md](/Users/pablo/proliferate/docs/specs/actions.md)
- [triggers.md](/Users/pablo/proliferate/docs/specs/triggers.md)
- [billing-metering.md](/Users/pablo/proliferate/docs/specs/billing-metering.md)
- [agent-entity-design.md](/Users/pablo/proliferate/docs/agent-entity-design.md)

## V1 principles
- Clean-slate rewrite is allowed; no backward-compatibility or user migration constraints
- Gateway is the runtime action bus and policy checkpoint
- E2B is compute provider for V1 only
- DB-first UI for reliability, stream attach for live detail
- No privileged direct provider calls from sandbox
- Sandbox-native git operations use short-lived repo-scoped auth
- PR ownership mode defaults to `sandbox_pr` (future strict mode: `gateway_pr`)
- Integration architecture is brokerless: self-hosted OAuth lifecycle + MCP connectors (no Nango dependency in runtime path)
- Keep harness pluggable (OpenCode default, others possible)
- Manager cognition runs in persistent home sandbox, not control-plane process
- Primary wake path is tick-based outbound polling (no inbound webhook dependency required for core operation)
- Trigger-service remains a separate runtime from main API (ingestion/scheduling isolation)
- Session identity supports ad-hoc + managed flows: ad-hoc sessions can have no coworker link; managed runs bind to coworker identity
- One automation owns one persistent `manager_session`; each wake creates `automation_run` linked to that manager session
- Runtime authorization executes from immutable session core fields + `session_capabilities`; live security revocations still override at execution time
- Session behavior packs (`session_skills`) are separate from permissions (`session_capabilities`)
- Inter-session instructions are durable `session_messages` injected at safe reasoning checkpoints
- Agent tool discovery/invocation uses one frozen manifest and one structured response envelope (`success|failed|pending_approval`)
- Canonical runtime chain is `automation -> automation_run -> session -> action_invocation`
- Approval-triggered resume orchestration is worker-owned and durable (gateway push is best-effort only)
- Approval review surfaces are session-centric; notification inbox is a delivery primitive, not the primary approval workspace
- Manager-to-child delegation is restrictive-only (subset capabilities, no run-as/credential escalation)
- Repo onboarding is baseline-driven for monorepos (remove `configuration*` as primary contract)
- Default idle timeout is `10m` (normal idle + approval-wait idle)
- Control plane deployment support includes cloud, Docker self-host, and Kubernetes self-host
- Sandbox compute remains E2B-only in V1 (all deployment modes require E2B)
- Every subsystem spec should include implementation file tree + core data model section
