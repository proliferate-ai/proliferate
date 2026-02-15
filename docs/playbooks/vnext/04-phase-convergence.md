# Phase 4: Convergence & Cleanup

**Branch:** `vnext/phase-4-convergence`
**Base:** `main` (after Phase 3 is merged)
**PR Title:** `feat: vNext Phase 4 — convergence & cleanup`

**Role:** You are a Staff Principal Engineer working on Proliferate. We have just finished migrating our backend to the vNext architecture across several PRs.

**Context:** You are executing Phase 4. This is the final backend integration step. You are ensuring all subsystems wire together correctly and there are no dangling legacy imports.

## Instructions

1. Create branch `vnext/phase-4-convergence` from `main`.
2. Run `pnpm typecheck` and `pnpm lint`.
3. Find any wiring gaps between the subsystems and fix them. Specifically:
   - Ensure the Gateway accurately merges code-defined providers (`ProviderRegistry`) and MCP connectors into the `/actions/available` route.
   - Verify the Trigger Service Outbox handoff is compiling correctly against the Automations run pipeline.
   - Verify `SessionService.create()` is correctly invoked by the web oRPC routes.
4. Delete any remaining legacy files (e.g., old webhook adapters, the old `TriggerProvider` interface if unused).
5. Ensure the backend app boots successfully.
6. Systematically resolve all TypeScript compiler errors.
7. Run `pnpm typecheck` and `pnpm lint` one final time to confirm a clean build.
8. Commit, push, and open a PR against `main`.
