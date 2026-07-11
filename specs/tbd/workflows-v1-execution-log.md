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
| 4b | WS0B-U desktop screens ownership split | `e01bc8be5` (merged `0d57e8a9e`) | WS0B-S in base `3a2336720` | agent: tsc clean, boundaries pass, host/home vitest 17/17, 16 pre-existing unrelated vitest failures verified identical on base; captain post-merge: tsc clean, boundaries pass, host/home 17/17 | ACCEPTED — HomeScreen 619→367, EditorScreen 1212→366, TriggersCard 1064→131; inspector/canvas/trigger components + draft/create/trigger hooks; raw-access violation fixed; 2 max-lines + 3 structure allowlist entries removed |
| 6 | WS2a persistence skeleton | `3ac1abe46` (rebased `b72e468c4`, merged `ea4f5de5f`) | WS1+WS0B-S via rebase onto `0b25ffcc0` | agent: 77 unit + 39 gateway + 6 migration-integration + heads + populated-DB upgrade test; captain post-rebase: 77 passed + single head d9578c0275f3; post-merge heads verified | ACCEPTED — 7 new tables + run state-axis columns (NULL legacy), workflow_ledger store package, migration c3f8b1d6a4e2→d9578c0275f3. 10 downstream shape decisions recorded in agent handoff (capability_key = WS3a-defined; NULL revision ≡ 0; no fence secret in rows; acquire_session_leases needs caller rollback; workflow_trigger_item/step_action retirement → WS4b/c) |
| 7 | WS5a runtime acceptance + observation outbox | `bf7055e57` (rebased `b7f4358cc`, merged `3619df135`) | WS1+WS0B-R; rebased onto `bb0eac10c` | agent: full crate 1128/0 (+12 new), workflows 143/0, max-lines byte-identical to base; captain post-rebase: full crate 1128/0 | ACCEPTED — SQLite 0056/0057; gapless same-tx whole-snapshot revisions; lowest_unacked/ack/replay + service seam; optional delivery-identity conflict rejection (HTTP 409), legacy unchanged. DECISION: runtime reuses plan-carried step keys (node.lane.step) — v2 root::uuid grammar activates when WS2b compiles v2 plans; WS2c owns boundary translation if needed |
| 9 | WS3a exact capability grants | `8f8bec721` (rebased `ea5934e25`, merged `a76e07367`) | WS2a+WS1+WS0B-S; rebased onto `28fa29a2e` | agent: 121 focused tests, heads, ruff, boundaries; captain post-rebase: 60 tests + single head b3d1f5a9c7e2; post-merge heads verified | ACCEPTED — capability_key codec, semantic_revision migration (d9578c0275f3→b3d1f5a9c7e2), StartRun lease freezing, authorize_capability live narrowing beside legacy namespace layer. LEGACY-PARALLEL: namespace token still mints/consumed until WS3b/5c; cold tool cache defers to namespace layer until WS3c; product_mcp arm → WS8. NOTE: future migrations must move _CHAIN_HEAD pin in test_workflow_ledger_skeleton.py |
| 8 | WS9a product-domain strict model | `4db884977` (rebased `18bf4905e`, merged `28fa29a2e`) | WS1+WS0B-U; rebased onto `96b4befa9` | agent: build + 665/665 (18 new), desktop tsc clean, structure ratchet shrank; captain post-rebase: build + 665/665 | ACCEPTED — identity.ts (UUIDv7/v5 via WS1 module, canonical serialize, §5.1 step keys), read-only unknown versions (type-narrowed serializer), §6.1 slot lineage (replaced 2 wrong duplicate_slot tests), strict emit-schema profile + branch grammar. New exports: workflows/identity, /read-only, /strict-rules |
| 5 | WS10a strict release runner/policy | `abffe516845b036d511a449bc4c4daba0e296396` (merged `50cdfef80`) | WS1 `ac7044316` | agent: 85/85 tests/release tests, typecheck, live CLI proof both modes; captain: typecheck + 85/85 re-run in worktree | ACCEPTED — signal/release modes; required-workflows.json seeded (content ownership → WS10b); summary artifact + validateSummary for WS10c; SUMMARY_ENV interface recorded; correlation/deadline/no-retry guards. NOTE: focused command is `pnpm -C tests/release exec tsx --test src/runner/workflow-policy.test.ts` (plan's `test -- workflow-policy` does not filter) |
| 4 | WS0B-S service ownership split | `f11870c4e` (merged `72338fe4b`) | WS0 `68661e27e` | agent: 303 workflow unit tests, ruff, boundaries, AST byte-verification of moves; captain post-merge: test_workflow_service+delivery green | ACCEPTED — service.py 1898→327 + compiler.py/triggers.py/worker/service.py; service.py allowlist entry removed. CAVEATS: triggers.py (943) added to allowlist as carved-out debt (further split owned by WS4a/b); api.py and test_workflow_run_gateway.py allowlist +1 each (import-line necessity, inline-documented). Net violations decreased. |

## Integration HEAD

`a76e07367` (10 packets merged: + WS3a). Server chain next: WS2b

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
| Workflow ORM + Alembic chain | head b3d1f5a9c7e2; next slot WS2b on request | captain |
| `server/cloud/workflows/**` service split | RELEASED by WS0B-S; compiler/ledger next to WS2b | — |
| `anyharness-lib/**/workflows/**` module split | RELEASED by WS0B-R; domain semantics next to WS5a | — |
| Desktop workflow screens/hooks split | RELEASED by WS0B-U; editor behavior next to WS9b | — |
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

- Alembic chain: c3f8b1d6a4e2 → d9578c0275f3 (WS2a) → b3d1f5a9c7e2 (WS3a). Next slot: WS2b if needed.

## In-flight packets

| Packet | Agent | Worktree | Base SHA | Status |
| --- | --- | --- | --- | --- |
| WS5b sequential effects | agent (opus) | ~/proliferate-wt/wsc-ws5b | 96b4befa9 | running |
| WS2b compiler/ledger | agent (opus) | ~/proliferate-wt/wsc-ws2b | a76e07367 | launching |

## Blockers

- None recorded.

## Next runnable packets

1. WS0B-U (desktop split) — slot now free; launch next.
2. WS3a exact grants — after WS2a accepted.
3. WS2b compiler/ledger — after WS2a + WS3a resolver interface.
4. WS5b sequential effects — after WS5a accepted.
NOTE: WS0B-S merge means in-flight WS2a/WS5a (based on b74cba675, pre-WS0B-S)
must rebase onto the post-WS0B-S integration tip at handoff; captain reruns
their checks post-rebase per plan §4.3.

## Environment notes

- Primary checkout `/Users/pablohansen/proliferate` hosts the user's live
  `main` dev profile (uvicorn --reload :8000, vite :1420, runtime :8457) and
  now sits on `workflows/v1-completion`. Do not run destructive git here.
- Server pytest: agents run FOCUSED files only; the captain runs full suites
  serially at gates (concurrent full runs have shown DB/truncation contention).
- User-owned untracked files that must never be staged:
  `specs/developing/testing/self-hosting.md`, `specs/tbd/issues-service-v1.md`,
  `specs/tbd/prod-config-fix-prompts.md`.
