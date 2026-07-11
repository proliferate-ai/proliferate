# Workflows v1 completion — execution log

Status: durable coordination log owned by the merge captain. Append-only per
accepted packet. Canonical behavior: `specs/codebase/features/workflows.md`.
Sequencing: `specs/tbd/workflows-v1-completion-plan.md`.

Recovery rule: after compaction or restart, reconstruct state from this log,
the plan, `git log workflows/v1-completion`, and test artifacts — never from
conversation memory.

## Integration branch

- Branch: `workflows/v1-completion`
- Baseline: `workflows/gate-c-main-rebase` @ `8be1c7706fa12626a1a7bbc325b9d2c891760417`
- Merge captain: single writer for this file, the traceability manifest,
  Alembic sequence allocation, generated-output regeneration approvals, and
  `.github/workflows/**`.

## Accepted packets

| # | Packet | Commit | Deps (SHAs) | Tests run | Result |
| --- | --- | --- | --- | --- | --- |
| 1 | WS0 Gate A0 architecture/contract freeze (docs) | `68661e27e8897a4fd8c73cd9bc58caddb58e7376` | baseline `8be1c7706` | doc link check (all feature-spec dependency paths exist); diff review of 12 cross-doc alignment edits | ACCEPTED — architecture commit; no code touched |
| 2 | WS1 contract spine + golden fixtures | `ac704431616d4eccaf99a7d7042c097b641be8ff` (merged `1f9c73666`) | WS0 `68661e27e` | `python3 scripts/check_workflow_contract_fixtures.py` (py+rust 6/6+ts 10/10); `cargo test -p anyharness-contract` 37; product-domain build+647 tests; captain re-ran checker post-merge | ACCEPTED — T1-WF-CONTRACT-01 GREEN; OpenAPI/SDK regen deferred (models unwired); traceability.yaml now captain-owned |
| 3 | WS0B-R executor ownership split | `c220bef741b7d9868531e7db0a52cf0b47b2140f` (merged `0c4e4284f`) | WS0 `68661e27e` | `cargo test -p anyharness-lib --lib` 1116/0 in worktree; captain: post-merge build green, max-lines violations 3 (unchanged, all server-test debt owned by WS2b/WS4) | ACCEPTED — executor.rs 2982→307; agent_turn/turn/goal/emit/effects/observation/receipts/parallel/merge modules; allowlist entry removed |

## Integration HEAD

`0c4e4284f` (WS1 + WS0B-R merged; WS0B-S in flight)

## Gate status

- Gate A0: PARTIAL — spec + plan committed and frozen. Formal reviewer
  sign-off rows (server/runtime/security/desktop/release) are recorded as the
  merge captain's acceptance in this program; WS11 adversarial review is the
  independent check.
- Gate A1/B/C/D: not started.
- Gate E: HARD STOP — requires explicit human production approval.

## Writer locks

| Lock | State | Holder |
| --- | --- | --- |
| Feature spec + completion plan | FROZEN (arch-review to change) | merge captain |
| `tests/contracts/workflows/**` + contract versions | RELEASED by WS1; future edits need captain | — |
| `anyharness-contract/src/v1/workflows*.rs` + API mapping | RELEASED by WS1 | — |
| Server contract request/response models + OpenAPI/SDK regen | captain (regen pending, models unwired) | captain |
| `traceability.yaml` | CAPTAIN-OWNED (append-only) | captain |
| Workflow ORM + Alembic chain | UNASSIGNED (next: WS2a) | — |
| `server/cloud/workflows/**` service split | ASSIGNED (ownership-only) | WS0B-S |
| `anyharness-lib/**/workflows/**` module split | RELEASED by WS0B-R; domain semantics next to WS5a | — |
| Desktop workflow screens/hooks split | UNASSIGNED (next: WS0B-U) | — |
| `tests/intent/specs/workflows*.spec.ts` | RESERVED | WS10b |
| `tests/release/**` + T3 registry + promotion | RESERVED | WS10a→b→c |
| `.github/workflows/**` + release manifests | RESERVED | WS10c/captain |

## Contract/fixture versions

- resolved-plan: v2 (fixtures to be created by WS1)
- execution-envelope / execution-binding / materialization-offer /
  checkpoint-manifest / gateway-call-receipt / workflow-control-command: v1
- observed-run: v2
- workflow-schema-profile: v1
- UUIDv5 legacy-upgrade namespace: `2b5e907a-2cd8-5b8f-b5ab-5c891bb93263`

## Migrations

- Alembic head at baseline: `c3f8b1d6a4e2` (single head, verified pre-program)
- Workflow chain allocations: none yet (WS2a will request the first slot)

## In-flight packets

| Packet | Agent | Worktree | Base SHA | Status |
| --- | --- | --- | --- | --- |
| WS0B-S server split | agent | ~/proliferate-wt/wsc-ws0bs | 68661e27e | running |

## Blockers

- None recorded.

## Next runnable packets

1. WS0B-U (desktop split) — when an agent slot frees.
2. WS2a persistence skeleton — after WS1 accepted.
3. WS5a — after WS0B-R + WS1 accepted.
4. WS3a — after WS2a + WS1 accepted.

## Environment notes

- Primary checkout `/Users/pablohansen/proliferate` hosts the user's live
  `main` dev profile (uvicorn --reload :8000, vite :1420, runtime :8457) and
  now sits on `workflows/v1-completion`. Do not run destructive git here.
- Server pytest: agents run FOCUSED files only; the captain runs full suites
  serially at gates (concurrent full runs have shown DB/truncation contention).
- User-owned untracked files that must never be staged:
  `specs/developing/testing/self-hosting.md`, `specs/tbd/issues-service-v1.md`,
  `specs/tbd/prod-config-fix-prompts.md`.
