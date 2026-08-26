# Runs

Status: target. Nothing in this document exists on `main`; the body is
written in the ideal state and [Current gaps](#current-gaps) is the whole
build. Source: the settled architecture (Core Architecture §6 triggers &
automations, the primitives index, the canonical lane) and the two-tier
orchestration ruling.

## 1. Purpose

A **run** is the control plane's durable record of one governed execution:
who it runs as, what it was asked to do, what it may spend, where it is
executing, what it produced. It is the object humans triage, agents wait on,
budgets attach to, and cancellation walks. Compute is a lazily-bound resource
of a run (Law 8), never the other way around; a run exists before any
environment does (Law 2).

Two tiers of orchestration, never conflated:

| Tier | Mechanism | Owner |
| --- | --- | --- |
| **Subagents** | in-environment sessions via the runtime product MCP, per-subagent auth | runtime `subagents` |
| **Spawned runs** | a *new* invocation → a *new* run in its own task environment, created through the public API | this system + [api.md](../api/README.md) |

An agent that needs another machine hits the Proliferate API like any other
client and gets a child run with `parent_run_id`; there is no privileged
internal channel (Law 4).

## 2. Owned state

| Table | Rows mean | Key fields |
| --- | --- | --- |
| `run` | one governed execution | `id`, `organization_id`, `subject` (user \| service subject), `definition_id`+`revision` or ad-hoc prompt ref, `invocation_id`, `parent_run_id`, `depth`, `status`, `budget_envelope` (spend cap, token/time caps, grant scope ref), `environment_binding` (class + provider id, nullable until placed), `session_id` (registry row), `idempotency_key`, `created_at`, `started_at`, `terminal_at` |
| `run_result` | the immutable structured output of a terminal run | `run_id`, `kind` (`completed \| failed \| cancelled`), `summary` (short text), `payload` (typed JSON: PRs, evidence refs, artifacts), `produced_at` |
| `run_event` (or projection) | the triage-facing timeline: status transitions, spawn edges, budget checkpoints | `run_id`, `seq`, `kind`, `payload`, `ts` |

Status vocabulary: `queued | placing | running | awaiting_human | completed | failed | cancelled`.
A run is terminal exactly when `run_result` exists.

> [!decision] PABLO DECIDES: is the gen-2 runtime run the *same object* as the
> CP run? Recommended: yes, 1:1 — the CP run is the governing record and the
> runtime run is its execution; they share one id (client-minted today,
> CP-minted for task-class runs), so a multi-node gen-2 run is *one* run with
> nodes, not many. Alternative: every node is a run (rejected: nodes are not
> independently billable or triageable).

## 3. Public surface

Internal Python surface (consumed by [api.md](../api/README.md), automations intake,
the Slack app): `create_run(invocation, subject, envelope, parent) → Run`,
`get_run`, `list_runs(filters)`, `wait_run(id, timeout)`, `cancel_tree(id)`,
`record_result(id, result)`, `attenuate(envelope, request) → envelope`.
The HTTP verbs are the API's; this system exposes no routes of its own.

Emitted projections: the triage list (per org, filter by subject /
definition / status / parent), the spawn tree, and the result document.

## 4. Consumes

| Dependency | Owner | Used for |
| --- | --- | --- |
| frozen invocation | [automations.md](../automations/README.md) | what a run executes; every trigger source normalizes into one |
| session registry row + queued prompts | sessions (target) | session-before-compute: the run's registry row exists at create |
| placement, task environments, concurrency limiter | environments (target) | binding compute to a run; reap after checkpoint |
| spend / segments / credit | billing ([BILLING.md](../../../../FEATURE_DOCS/BILLING.md)) | the envelope's money side; org is the only billing subject (Law 9) |
| (subject, run) grants | integration gateway (target) | the envelope's capability side |
| per-run gateway keys | model gateway ([MODELS.md](../../../../FEATURE_DOCS/MODELS.md)) | budget enforcement on model traffic |
| subjects (user, service) | accounts / organizations | every run has exactly one subject |

## 5. Laws

**Every run has exactly one subject and one org.** Headless runs execute as
the org's service subject and never hold human credentials (Law 6).

**Session before compute.** `create_run` writes the run row and its session
registry row in one transaction and returns; placement is asynchronous and
may never happen (budget refused, limiter full) without the run being lost.

**Budget envelopes only attenuate.** A child's envelope is `min(parent
remaining, requested)` on every axis; `attenuate` is the single function
that computes it, and it is applied at spawn, enforced at the billing gate
and both gateways. A spawn tree can never spend more than its root.

**Depth is bounded.** `depth = parent.depth + 1`; creation beyond the cap is
a typed refusal, so a runaway spawner cannot fork forever.

**Cancel cancels the tree.** `cancel_tree` marks every non-terminal
descendant cancelled in one pass before any environment is signalled; a
child cannot outlive a cancelled parent.

**A result is written once and never updated.** `record_result` is
insert-only; a second write is a conflict. Wake-on-completion delivers the
result *into the parent's session* as a message through the courier — the
parent does not poll.

**Idempotent creation.** Same idempotency key + same canonical request →
the existing run; different request → conflict. (The invocation layer's RFC
8785 identity is reused.)

**Terminal means checkpointed.** A run does not become terminal until the
session's terminal checkpoint has been ingested; the record survives the
VM.

## 6. Emits

`run.created`, `run.placed`, `run.status_changed`, `run.spawned_child`,
`run.result_recorded`, `run.cancelled_tree` — the ship-now class for
binding fan-out (Slack thread posts, mobile push, registry projections).
Named telemetry mirrors the same events.

## 7. Fences

| Not owned here | Owner |
| --- | --- |
| The HTTP verbs, tokens, delegation, `wait` semantics on the wire | [api.md](../api/README.md) |
| Definitions, triggers, invocation freeze/dedup | [automations.md](../automations/README.md) |
| Node-level execution inside one environment; in-environment subagents | runtime automations engine / `subagents` |
| Environment lifecycle, placement queue, reaping | environments (target) |
| Money math, segments, credit grants | billing |
| The triage *surface* (layout, inbox, animation) | client `runs-triage` composition surface |

## 8. Code map

Target locations (※ new — nothing exists today):

```text
server/proliferate/server/runs/          ※ MANIFEST · api-free service · domain/envelope.py
                                            (attenuate) · domain/tree.py (cancel walk) · store.py
server/proliferate/db/models/runs.py     ※ run · run_result · run_event
apps/packages/product-client/src/systems/runs/   ※ triage view, spawn tree, inbox (client plane)
```

Adjacent code the build reuses: the invocation freeze in
[service_v2.py](../../../../../server/proliferate/server/workflows/service_v2.py)
and canonical identity in
[domain/invocation.py](../../../../../server/proliferate/server/workflows/domain/invocation.py);
budget limits in [billing/budget_limits.py](../../../../../server/proliferate/server/billing/budget_limits.py)
(to be replaced by the envelope primitive per the billing three-way
ruling); the runtime run/nodes model in
[domains/workflows/model.rs](../../../../../anyharness/crates/anyharness-lib/src/domains/workflows/model.rs).

## 9. Proof

Pinning tests to write with the system: envelope attenuation is monotonic
on every axis (property test); cancel-tree marks all descendants before any
signal; result is insert-only; create is idempotent under concurrent
identical requests (advisory lock, as invocations); depth cap refuses;
create returns before placement (no environment provider call inside the
transaction).

## Current gaps

The entire system is a gap. Build order per Core Architecture: seam contract
→ task environment class → trigger→invocation → **API tokens + spawn + run
result + wait** (this system with [api.md](../api/README.md)) → checkpoints and
registry projections → per-(subject, run) grants.

> [!decision] PABLO DECIDES: result payload shape — free-form JSON with a
> required `summary` string (recommended for launch week: agents already
> produce prose; typed `artifacts[]` can be additive later) vs a strict typed
> schema from day one.

> [!decision] PABLO DECIDES: `wait` semantics — long-poll with a server-side
> timeout ≤ 60 s returning the current status (recommended; works through
> every proxy and the GH Action) vs server-sent events.

> [!decision] PABLO DECIDES: depth cap and default attenuation (recommended:
> depth ≤ 4; a child defaults to 25% of the parent's remaining spend unless
> the parent requests less).

> [!decision] PABLO DECIDES: does the triage projection live here (recommended:
> yes — it is a read model over owned state; the client surface only composes
> it) or in the `runs-triage` client surface spec.
