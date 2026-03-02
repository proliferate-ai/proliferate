# Code Quality Critique (Validated) for Rewrite Pass

## Purpose
- Provide a high-signal, implementation-usable critique list for the rewrite pass.
- Keep urgency and quality bar high without carrying forward outdated or incorrect assumptions.
- Support the rewrite pass where architecture and code-quality cleanup happen together.

## Scope
- This document evaluates what is valid in current code today.
- It prioritizes fixes that improve correctness, maintainability, and velocity.
- It includes concrete evidence and concrete rewrite actions.

## P0: Valid Critiques To Fix First

1. **Service/DB boundary is inconsistent in some domains.**
- Evidence: direct DB writes and SQL inside `service.ts` files, for example:
`/Users/pablo/proliferate/packages/services/src/outbox/service.ts:21`,
`/Users/pablo/proliferate/packages/services/src/runs/service.ts:52`,
`/Users/pablo/proliferate/packages/services/src/runs/service.ts:228`.
- Why this matters: it breaks the project’s own layering rule (`db.ts` as persistence owner), making tests and refactors harder.
- Rewrite action: move direct query blocks into `db.ts` and keep `service.ts` as orchestration + policy only.

2. **Billing budget enforcement has a risky hard-coded cap path.**
- Evidence: LLM virtual key budget uses `shadowBalance * 0.01` in
`/Users/pablo/proliferate/packages/services/src/sessions/sandbox-env.ts:233`.
- Why this matters: an arbitrary per-session cap can conflict with org policy and cause work interruption behavior that feels random.
- Rewrite action: derive runtime budget from centralized billing policy and org overage settings, not a fixed formula.

3. **Some routers are too large and carry too much orchestration logic.**
- Evidence: router sizes are large, especially:
`/Users/pablo/proliferate/apps/web/src/server/routers/integrations.ts` (901 lines),
`/Users/pablo/proliferate/apps/web/src/server/routers/billing.ts` (457 lines).
- Why this matters: harder reviews, weaker ownership boundaries, and more bugs from mixed concerns.
- Rewrite action: split by subdomain and route intent; keep routers as transport adapters calling services.

4. **Nango dependency and integration provider surface is spread across multiple layers.**
- Evidence: Nango usage appears in web hooks, web libs, hooks, and services:
`/Users/pablo/proliferate/apps/web/src/app/api/webhooks/nango/route.ts`,
`/Users/pablo/proliferate/apps/web/src/lib/nango.ts`,
`/Users/pablo/proliferate/packages/services/src/lib/nango.ts`.
- Why this matters: migration off brokered OAuth is harder when runtime paths are scattered.
- Rewrite action: centralize provider token lifecycle behind one integration provider boundary and keep web/router layer provider-agnostic.

5. **Sandbox provider modules are too large and hard to reason about.**
- Evidence:
`/Users/pablo/proliferate/packages/shared/src/providers/e2b.ts` (1277 lines),
`/Users/pablo/proliferate/packages/shared/src/providers/modal-libmodal.ts` (2091 lines).
- Why this matters: regressions in lifecycle logic (create, pause, resume, snapshot) are easy to introduce and hard to test.
- Rewrite action: split each provider into lifecycle modules (`create`, `restore`, `snapshot`, `network`, `env`, `git`) plus shared contract tests.

6. **Webhook signature utilities are duplicated across trigger providers.**
- Evidence: repeated `hmacSha256` implementations:
`/Users/pablo/proliferate/packages/triggers/src/github.ts:23`,
`/Users/pablo/proliferate/packages/triggers/src/linear.ts:22`,
`/Users/pablo/proliferate/packages/triggers/src/posthog.ts:19`,
`/Users/pablo/proliferate/packages/triggers/src/sentry.ts:22`.
- Why this matters: duplicate crypto logic increases drift and subtle security bugs.
- Rewrite action: extract one shared signature utility with provider-specific wrappers.

7. **Trigger schema/runtime alignment has at least one dead or unclear table path.**
- Evidence: `trigger_event_actions` exists in schema/migrations but has no active usage in services/workers.
- Why this matters: dead tables create confusion in data model and maintenance overhead.
- Rewrite action: either wire it into the runtime pipeline or remove/deprecate it explicitly.

## P1: Valid Critiques To Fix In This Pass If Capacity Allows

1. **Base URL helper duplication in API routes.**
- Evidence:
`/Users/pablo/proliferate/apps/web/src/app/api/integrations/github/oauth/route.ts:8`,
`/Users/pablo/proliferate/apps/web/src/app/api/integrations/github/callback/route.ts:26`.
- Rewrite action: centralize into one server utility.

2. **Auth/server-client clarity can still improve even after recent cleanup.**
- Evidence: split exists (`auth/server`, `auth/client`) but cross-cutting session/org helpers still spread into middleware/routes.
- Rewrite action: document and enforce one import boundary for server auth helpers vs client hooks.

3. **Constants and error taxonomy should be more centralized.**
- Evidence: some constants are centralized already (for example `IMPERSONATION_COOKIE` lives in one file), but error strings and route-local enums remain scattered.
- Rewrite action: introduce shared typed error codes and constants module by domain.

4. **Onboarding flow still mixes status concerns that should be product-policy driven.**
- Evidence: onboarding service and router still reference GitHub/Nango status checks.
- Rewrite action: make onboarding completion criteria explicitly policy-based (for example billing-ready first) and keep optional integrations optional.

## Critiques To Drop Or Reframe (Not Valid As Stated)

1. **“NO `api/route.ts` files.”**
- Not valid for this Next.js app. Route handlers are required for auth, webhooks, health, CLI, and RPC transport.

2. **“Services layer should have no write ops.”**
- Not valid. Services should orchestrate writes. The correct rule is: persistence mechanics belong in `db.ts`.

3. **“Move `adminProcedure` to middleware.”**
- Already done:
`/Users/pablo/proliferate/apps/web/src/server/routers/middleware.ts:247`.

4. **“Org middleware does not check org membership.”**
- Already handled:
`/Users/pablo/proliferate/apps/web/src/server/routers/middleware.ts:190`.

5. **“No longer use `useFinalizeOnboarding`.”**
- Likely already resolved; no current reference found in `apps/web/src`.

6. **“Intercepted tool call race is core behavior.”**
- Outdated for current tool path. Current OpenCode tools call gateway synchronously via callback helper:
`/Users/pablo/proliferate/packages/shared/src/opencode-tools/index.ts:20`.

## Additional High-Value Critiques

1. **Architecture rules are documented but not enforced in CI.**
- Add lint/import-boundary checks to prevent router -> DB direct imports and enforce service layering.

2. **Router size and complexity should have guardrails.**
- Add file-size and handler-complexity thresholds with refactor warnings in CI.

3. **Provider/runtime lifecycle contracts need dedicated invariants tests.**
- Add golden-path and failure-path tests for snapshot, pause, resume, and restore semantics across providers.

4. **Trigger runtime split between API ingress and dedicated trigger-service needs a single authoritative contract.**
- Keep separation for reliability, but remove duplicate ingestion logic and duplicate utilities.

## Recommended Rewrite Sequence (Quality + Architecture Together)

1. **Boundary Enforcement First**
- Add lint/import constraints and CI checks for layering.

2. **Billing and Session Safety**
- Replace hard-coded LLM max-budget formula with policy-driven budgeting.
- Keep pause-first enforcement and standardize fallback behavior.

3. **Router and Service Refactor**
- Split `integrations.ts` and `billing.ts` routers by subdomain.
- Move remaining query logic into domain `db.ts`.

4. **Integrations and Triggers Hardening**
- Centralize provider token/signature utilities.
- Remove or implement dead trigger tables/paths.

5. **Provider Module Decomposition**
- Break large provider files into lifecycle modules with contract tests.

## Success Criteria For This Pass
- Router/service/db boundaries are mechanically enforced.
- Billing/session enforcement behavior is deterministic and policy-driven.
- Integration/trigger internals are deduplicated and easier to migrate.
- Provider lifecycle code is modular and testable.
- Outdated critique items are explicitly closed so the team focuses on real risk.
