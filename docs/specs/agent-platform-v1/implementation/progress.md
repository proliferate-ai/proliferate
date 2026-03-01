# Agent Platform V1 Progress Log

## PR 1
- branch name: `v1/01-schema-data-contracts`
- PR URL/number: `https://github.com/proliferate-ai/proliferate/pull/251`
- scope: Phase 1 contract and schema lock (`workers`, `wake_events`, `worker_runs`, `session_*`, `repo_baseline*`, `resume_intents`, minimal DB service modules and contract tests)
- check results:
  - `pnpm typecheck` ✅
  - `pnpm lint` ✅
  - `pnpm test` ✅
- open comments:
  - CodeRabbit review bundle (resolved with follow-up changes).
  - Human review pending.
- fixes applied:
  - Enforced `workers.managerSessionId` required + unique.
  - Added manager/task session shape constraints.
  - Added per-user archive timestamp to `session_user_state` and DB helper support.
  - Added guard test for worker creation invariant.
  - Added `session_messages` dedupe partial unique index.
  - Added wake-event self-FK for coalescing references.
  - Added missing setup-session FK and baseline-target lookup index.
  - Tightened sessions FK delete semantics for required manager/task linkage.
  - Switched new service DB helpers to canonical `@proliferate/services/db/client` imports.
  - Hardened worker/session DB helper validation/update semantics.
- merge SHA: `TBD`
- carry-over TODOs:
  - Process CI/human/Greptile feedback.
  - After PR1 merge, rebase/retarget `v1/02-*` onward.
