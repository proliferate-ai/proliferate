# Phase 0: Database & Core Interfaces

**Branch:** `vnext/phase-0-database-types`
**Base:** `main`
**PR Title:** `feat: vNext Phase 0 — database schemas & core interfaces`

**Role:** You are a Staff Principal Engineer working on Proliferate, an enterprise AI coding agent platform. You write pristine, production-grade TypeScript. We are executing a massive architectural refactor to harden our Gateway, unify our integrations, and rethink our Information Architecture.

**Context:** You are executing Phase 0. Before we write any application logic, we must establish the database tables and shared types. This acts as the strict API contract for all subsequent implementation phases.

## Instructions

1. Create branch `vnext/phase-0-database-types` from `main`.
2. Read the `Data Models & Schemas` sections across all the vNext specs in `docs/specs/vnext/`.
3. Update our Drizzle schemas in `packages/db/src/schema/` to exactly match the vNext tables:
   - Rename `prebuilds` to `configurations` and update all related FKs (e.g., `prebuild_id` -> `configuration_id`).
   - Add `webhook_inbox` and `trigger_poll_groups`.
   - Add `session_tool_invocations` and `user_connections`.
   - Update `sessions`: Add `idempotency_key` and `pause_reason`.
   - Update `organizations` and `automations`: Add JSONB `action_modes` column.
   - Update `org_connectors`: Add JSONB `tool_risk_overrides` column.
   - Add `secret_files` and `configuration_secrets`, and drop `secret_bundles`.
   - **CRITICAL:** Drop the `action_grants` table entirely.
4. Scaffold `packages/providers/src/types.ts` and `packages/providers/src/action-source.ts`. Define the `IntegrationProvider`, `ActionSource`, `NormalizedTriggerEvent`, and related interfaces exactly as specified in the vNext architecture.
5. Update `packages/shared/src/sandbox-provider.ts` and `packages/shared/src/sandbox/errors.ts` to include `memorySnapshot`, `restoreFromMemorySnapshot`, and `supportsMemorySnapshot`.
6. Run `pnpm db:generate` to create the SQL migrations.
7. Run `pnpm typecheck` and `pnpm lint` to verify everything compiles.
8. Commit, push, and open a PR against `main`.

## Critical Guardrails

- Do NOT implement any application logic (Express routes, Gateway hubs, or BullMQ workers) yet.
- This phase is strictly database schemas and TypeScript interfaces. No runtime behavior changes.
