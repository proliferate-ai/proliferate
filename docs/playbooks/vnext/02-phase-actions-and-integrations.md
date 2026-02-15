# Phase 2: Actions & Integrations (The Execution Plane)

**Branch:** `vnext/phase-2-actions-integrations`
**Base:** `main` (after Phase 1 is merged)
**PR Title:** `feat: vNext Phase 2 — actions & integrations execution plane`

**Role:** You are a Staff Principal Engineer working on Proliferate.

**Context:** You are executing Phase 2. We are replacing the old CAS grant system with a Three-Mode Permissioning Cascade and unifying our integrations behind the `ActionSource` interface.

## Instructions

1. Create branch `vnext/phase-2-actions-integrations` from `main`.
2. Read the old and vNext specs for `actions.md` and `integrations.md`.
3. Delete the old CAS grant system in `packages/services/src/actions/grants.ts` entirely.
4. Implement the new mode resolution cascade (`allow | deny | require_approval`) in `packages/services/src/actions/modes.ts`.
5. Update `getToken()` in `packages/services/src/integrations/tokens.ts` to support optional user-scoped tokens.
6. Port Linear, Sentry, and Slack into `packages/providers/src/providers/<name>/actions.ts` and wrap them in the `ProviderActionSource` adapter.
7. Run `pnpm typecheck` and `pnpm lint` to verify everything compiles.
8. Commit, push, and open a PR against `main`.

## Critical Trap Patches (MUST IMPLEMENT)

- **Privilege Escalation on Drift:** Implement MCP tool drift hashing using a deterministic JSON stringifier. Explicitly strip `enum`, `default`, and `description` from the schema before hashing. If drift is detected, downgrade `allow` to `require_approval`, but KEEP `deny` as `deny`. Do not accidentally escalate privileges.
- **JSON-Destructive Truncation:** Implement JSON-aware truncation for action results (max 10KB). Do not blindly string-slice objects/arrays. Prune them structurally so they remain valid JSON with a `_truncated: true` flag.
- **Provider Code is Stateless:** Treat provider-declared connection requirements as declarative inputs only. Provider modules must never directly call Nango or Arctic.
