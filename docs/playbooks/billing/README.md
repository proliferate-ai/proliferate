# Billing & Metering Refactor Playbook

4 prompts that execute **simultaneously** on separate branches with strictly non-overlapping file boundaries. After all 4 PRs are reviewed, they merge into `main` with zero Git conflicts.

## Prompt Mapping

| Prompt | File | Branch | Focus |
|--------|------|--------|-------|
| 1 | `prompt-01-domain-gating.md` | `feat/billing-iron-door-and-snapshots` | Iron Door gate, gateway enforcement, snapshot quotas, dead code |
| 2 | `prompt-02-llm-lifecycle.md` | `feat/llm-key-lifecycle` | Dynamic `max_budget` injection, synchronous LiteLLM key revocation |
| 3 | `prompt-03-data-layer.md` | `feat/billing-data-layer-rest-bulk` | Partitioned cursors, LiteLLM REST API client, bulk ledger dedup |
| 4 | `prompt-04-bullmq-topology.md` | `feat/billing-bullmq-workers` | BullMQ repeatable jobs replacing `setInterval` + Redis locks |

## Prerequisites

- `main` must have the updated `docs/specs/billing-metering.md` and `docs/specs/llm-proxy.md`.

## File Boundary Guarantees (Zero-Conflict)

- **Prompt 1:** `billing/gate.ts`, `billing.ts`, `sessions-create.ts`, gateway sessions, `snapshot-limits.ts`, `sessions-pause.ts`, `sessions-snapshot.ts`, `org-pause.ts`, `billing-token.ts`
- **Prompt 2:** `sandbox-env.ts`, `llm-proxy.ts`, session termination logic
- **Prompt 3:** `schema/billing.ts`, `billing/db.ts`, `billing/litellm-api.ts`, `shadow-balance.ts`
- **Prompt 4:** `distributed-lock.ts`, `billing/worker.ts`, `jobs/billing/*.ts`, `queue/src/index.ts`

Prompt 4 mocks data-layer functions from Prompt 3 so it can typecheck independently.
