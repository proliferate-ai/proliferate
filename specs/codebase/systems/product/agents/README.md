# Agent Systems

Start here for anything agent-shaped. This document owns no contract: it is
the narrative map of how the agent platform documents fit together, so a
reader knows which one to open. Each claim below is one sentence; the
linked document is the authority.

## The four platform documents

| Document | One-line ownership | Status |
| --- | --- | --- |
| [agent-distribution.md](../../../platforms/product/agent-distribution.md) | What a harness *is* and how it gets onto a machine: the registry/catalog document pair, pinned auto-installs, binary-carried catalog convergence, supervisor-owned runtime swaps, the probe pipeline, readiness projection. | target |
| [agent_auth/README.md](../agent_auth/README.md) | How a harness gets *credentials* at launch: auth source selections, the key vault, `state.json` delivery, per-harness application recipes, fail-closed launch. Detail reference: [AGENT_AUTH.md](../../../../FEATURE_DOCS/AGENT_AUTH.md). | current (system spec) |
| [MODELS.md](../../../../FEATURE_DOCS/MODELS.md) | The managed inference proxy: LiteLLM artifact and deployment, enrollment/teams/virtual keys, access-group model gating, budgets, usage import. | current |
| [MODELS.md](../../../../FEATURE_DOCS/MODELS.md) | Which models and generic controls one execution target currently advertises before launch, plus the session-local live authority after launch. | current |

Two lifecycle documents ride along:

- [agent-catalog-update.md](../../../../../guides/operating/agent-catalog-update.md)
  — the operator runbook for shipping a new agent catalog.
- [catalog-probe.md](../../../../../guides/operating/catalog-probe.md) — the
  scheduled probe's credential lifecycle.

## The journey of a session

Everything composes into one story; each arrow names the document that owns
the step.

```text
registry.json (how to install/run/authenticate a harness)
  └─ probe pipeline pins exact versions ──────────────► agent-distribution
catalog.json (the lockfile), compiled into the runtime binary
  └─ binary ships: app bundle (desktop) or supervisor
     swap on heartbeat divergence (cloud) ─────────────► agent-distribution
runtime startup reconcile installs/updates harnesses ──► agent-distribution
user picks an auth source per harness ─────────────────► agent-auth
  └─ gateway sources use per-(subject, harness) keys
     minted by enrollment ─────────────────────────────► model-gateway
state.json delivers resolved key material ─────────────► agent-auth
readiness projects install + credential state ─────────► agent-distribution
override-free harness probe records target launch options ─► models/launch options
session launch: route_auth builds the harness's world,
  fail-closed; the harness calls the proxy or provider ► agent-auth / model-gateway
```

## Boundary one-liners

The fences that keep one fact in one document:

- **Declare vs apply**: agent-distribution *declares* a harness's auth
  vocabulary (registry slots, env var names, login policy);
  agent-auth *applies* a selected source. A new harness touches both.
- **Key vs models**: agent-auth delivers the gateway key as an opaque
  value; which models that key can see is proxy-side access-group
  enforcement owned by model-gateway.
- **Harness distribution vs executable truth**: agent-distribution's catalog
  pins harness versions and ships in the binary; one target-local
  `HarnessLaunchOptions` state per harness is observed at runtime from that
  installed harness under product-owned auth/route state and never ships in a
  binary.
- **One transport each**: the agent catalog's only transport is the runtime
  binary; auth's only transport is `state.json`; a Worker's cloud copy is
  verbatim target state. None changes a running session, whose
  `SessionLiveConfigSnapshot` is authoritative.

## Agent-experience systems in this folder

- [Cowork Artifacts](cowork-artifacts.md) — current artifact lifecycle and
  product behavior.
- [Delegated Work](delegated-work.md) — target UX for delegated work and
  review agents.

Reusable Product MCP contracts live under
[Product Agent Features](../../../platforms/product/agent-features/README.md).

## Neighboring owners

- Runtime binary *mechanics* (mailbox, swap state machine, rollback):
  [proliferate-supervisor](../../../../supervisor.md)
  and [proliferate-worker](../../../../worker.md)
  structure docs, under agent-distribution's contract.
- The `agents` domain source layout:
  [specs/anyharness/agents.md](../../../../anyharness/agents.md).
- Billing of gateway spend:
  [BILLING.md](../../../../FEATURE_DOCS/BILLING.md), integrated through
  model-gateway's account model.
