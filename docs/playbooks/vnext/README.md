# vNext Architecture Refactor Playbook

6 phases executed **sequentially** — each phase creates a branch, opens a PR, merges to `main`, and the next phase branches from the updated `main`.

Prompts constrain each agent to a single bounded domain per phase to eliminate circular dependency hallucinations.

## Phase Sequence

| Phase | File | Branch | Focus |
|-------|------|--------|-------|
| 0 | `00-phase-database-and-types.md` | `vnext/phase-0-database-types` | DB schemas & core interfaces |
| 1 | `01-phase-triggers-ingestion.md` | `vnext/phase-1-triggers` | Webhook inbox, polling groups, ingestion |
| 2 | `02-phase-actions-and-integrations.md` | `vnext/phase-2-actions-integrations` | Three-mode permissions, ActionSource, token resolution |
| 3 | `03-phase-gateway-and-agent.md` | `vnext/phase-3-gateway-agent` | Gateway hardening, HTTP callbacks, leases, idle snapshotting |
| 4 | `04-phase-convergence.md` | `vnext/phase-4-convergence` | Wire everything together, delete legacy code |
| 5 | `05-phase-frontend-ui.md` | `vnext/phase-5-frontend-ui` | Frontend IA redesign, unified integrations, inbox, automations wizard |

## Prerequisites

- `main` must have the updated vNext specs in `docs/specs/vnext/`.
- Each phase merges before the next one begins.
