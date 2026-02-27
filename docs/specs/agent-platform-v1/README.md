# Agent Platform V1 Specs (E2B-First)

## Why this folder exists
These docs define a concrete, plain-language V1 implementation plan for Proliferate.

This folder is intentionally practical:
- What users can do end to end
- What we are building now (E2B-first)
- Where code should live in this repo
- What "done" means for each subsystem

## V1 product shape
V1 has two main experiences:
1. **Interactive coding runs**: user asks agent to fix/build something now
2. **Persistent background agents**: agent keeps watching a job (for example Sentry), spawns worker runs, and reports progress

## Out of scope for this spec pack
- Full self-host compute runtime (Docker/K8s execution provider)
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
```

## Spec reading order
1. [00-system-file-tree.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/00-system-file-tree.md)
2. [01-required-functionality-and-ux.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/01-required-functionality-and-ux.md)
3. [06-gateway-functionality.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/06-gateway-functionality.md)
4. [02-e2b-interface-and-usage.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/02-e2b-interface-and-usage.md)
5. [03-action-registry-and-org-usage.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/03-action-registry-and-org-usage.md)
6. [04-long-running-agents.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/04-long-running-agents.md)
7. [05-trigger-services.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/05-trigger-services.md)
8. [08-coding-agent-harnesses.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/08-coding-agent-harnesses.md)
9. [07-cloud-billing.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/07-cloud-billing.md)

## Source references in current repo
These docs align with existing architecture and code:
- [sessions-gateway.md](/Users/pablo/proliferate/docs/specs/sessions-gateway.md)
- [sandbox-providers.md](/Users/pablo/proliferate/docs/specs/sandbox-providers.md)
- [actions.md](/Users/pablo/proliferate/docs/specs/actions.md)
- [triggers.md](/Users/pablo/proliferate/docs/specs/triggers.md)
- [billing-metering.md](/Users/pablo/proliferate/docs/specs/billing-metering.md)
- [agent-entity-design.md](/Users/pablo/proliferate/docs/agent-entity-design.md)

## V1 principles
- Gateway is the runtime action bus and policy checkpoint
- E2B is compute provider for V1 only
- DB-first UI for reliability, stream attach for live detail
- No privileged direct provider calls from sandbox
- Keep harness pluggable (OpenCode default, others possible)
