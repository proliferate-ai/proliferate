# Structure-Alignment Sweep — 2026-06

Status: **non-authoritative draft (tbd)**. A point-in-time snapshot of the
actual repo measured against the best-practice structure specs under
`specs/codebase/structures/**`, with draft migration notes. This is "draft
notions of good migrations," not operating law — promote individual items into
the owning structure spec or a dedicated migration tracker before treating them
as required work.

Swept against `main` on 2026-06-06. Each structure section lists the code root,
the divergences from its spec's Target Shape / Hard Rules, and prioritized draft
migrations (P0 = correctness or a live hard-rule violation; P1 = structural
debt; P2 = naming/cosmetic). Where a live tracker already owns a migration, this
doc points at it rather than restating it.

## Scorecard

| Structure | Code root | Verdict | Sharpest gap |
| --- | --- | --- | --- |
| proliferate-worker | `anyharness/crates/proliferate-worker/src` | **Drifted** | No `contract/` module; two banned legacy polls still live; `reconcile/manager` dead-coded |
| anyharness | `anyharness/crates/anyharness*` | _sweep in progress_ | — |
| server | `cloud/**` (Python control plane) | _sweep in progress_ | — |
| frontend | `apps/{desktop,web,mobile}/src` | **Minor drift** | Store purity: persistence in stores, a store read inside a pure workflow |
| proliferate-supervisor | `anyharness/crates/proliferate-supervisor/src` | **Aligned** | none |
| sdk | `anyharness/sdk`, `anyharness/sdk-react` | **Aligned** | spec baseline list trails new resource families |
| desktop-native | `apps/desktop/src-tauri` | **Aligned** | none |

The Rust shells (supervisor, desktop-native) and the SDK are tight. Real drift is
concentrated in the **worker** crate and, more mildly, the **frontend** — and
both already have spec authority to migrate toward.

---

## proliferate-worker — Drifted

Spec: `specs/codebase/structures/proliferate-worker/**` (the `contract/` module
and its hard rules were just tightened on `structure/worker`; the code has not
caught up). Code: `anyharness/crates/proliferate-worker/src` (modules declared
in `main.rs`, no top-level `lib.rs`).

### Divergences

| Spec target | Actual | Severity |
| --- | --- | --- |
| `contract/` module (`mod.rs` + `generated.rs`), single generated source for Cloud↔Worker wire types | Module absent. Wire DTOs hand-defined inline across `cloud_client/*` — `WorkerControlWait{Request,Response}` (`cloud_client/control.rs:10-30`), `WorkerExposureSnapshot` (`cloud_client/exposures.rs:7-25`), `WorkerRevokedJtisResponse` (`cloud_client/revoked_jti.rs`) | **P0** |
| `control/commands/handlers/` — per-kind local work (git_identity, repo_checkout, environment, agent_auth, pruning, backfill) | No `handlers/` folder; all per-kind logic inlined in `control/commands/executor.rs` (`:22-44`) | **P0** |
| `control/reconcile/` driven by a generic `manager.rs` via `note_desired`/`decision`, with 4 sibling domain handlers | `ReconcileManager` exists but is **not wired into `control/loop.rs`** and is `#[allow(dead_code)]` (`reconcile/manager.rs:15,40`); only 2 of 4 handlers present (`exposures.rs`, `revoked_jti.rs`; no `runtime_config.rs`/`agent_auth.rs`) | **P0** |
| `materialization/paths.rs` (allowed-root + symlink defense) and `materialization/manifest.rs` (`.proliferate/**`) | Both absent; path-safety helpers (`safe_join`, `expand_home`) live in `materialization/files.rs` | **P1** |
| `store/` up-cursor named per the new vocabulary (`up_cursor`) | Table still named `worker_projection_cursor` across `store/migrations.rs`, `up_cursor.rs`, `exposure_cache.rs` | **P2** |
| Unlisted extras | `lifecycle/status.rs`, `store/tail_mappings.rs` not in the Target Shape | **P2** |

### Hard-rule violations

- **Two banned polls are live.** Spec: the control poll is the *single* down
  channel — no separate exposures or revoked-jti poll.
  - Legacy revoked-jti poll: `reconcile/handlers/revoked_jti.rs:16`
    (`LEGACY_REVOKED_JTI_POLL_INTERVAL = 60s`, `poll_legacy_if_due` `:51`),
    invoked from `control/loop.rs:186`.
  - Tail-local exposures poll: `tail/loop.rs:91` calls
    `cloud.list_worker_exposures(...)` (endpoint `cloud_client/exposures.rs:51`),
    gated by a `legacy_exposure_polling_enabled` fallback flag. Tail must source
    exposures only from the `exposures` reconcile cache.
- **Loops are not boring.** `control/loop.rs` inlines a legacy command-lease
  fallback (`:201-228`), exposure reconciliation (`:111-129`), revoked-jti bundle
  apply (`:130-146`), and a cursor-parsing helper (`:265-280`); `tail/loop.rs`
  owns exposure-refresh policy and retryable-error classification (`:109-119`).
  Spec: the loop holds the poll and routes; it never executes a command or
  applies a bundle.
- **Clean** on the identity hard rule (no slot/fence/`slot_generation` anywhere)
  and on the catch-all rule (no `utils.rs`/`helpers.rs`/`misc.rs`).

### Draft migrations

- **P0-1 Create `contract/`.** Add `contract/{mod.rs,generated.rs}`; move every
  inline Cloud wire DTO out of `cloud_client/*` into generated types the client
  imports. (Direct realization of the just-landed contract.md / clients.md hard
  rule.)
- **P0-2 Delete the legacy revoked-jti poll** — remove the interval const,
  `LegacyRevokedJtiPoll`, `poll_legacy_if_due`, and the `control/loop.rs:186`
  call site.
- **P0-3 Delete the tail-local exposures poll** — drop
  `cloud.list_worker_exposures` from `tail/loop.rs`, the `cloud_client/exposures.rs`
  endpoint, and the `legacy_exposure_polling_enabled` flag machinery.
- **P0-4 Create `control/commands/handlers/`** — split `executor.rs`'s per-kind
  blocks into `git_identity.rs`, `repo_checkout.rs`, `environment.rs`,
  `agent_auth.rs`, `pruning.rs`, `backfill.rs`; leave the generic
  map→dispatch→report pipeline in `executor.rs`.
- **P0-5 Wire `reconcile/manager.rs` into `control/loop.rs`** as the generic
  engine; add `reconcile/handlers/{runtime_config,agent_auth}.rs`; route via
  `note_desired`/`decision` and drop the `#[allow(dead_code)]`.
- **P1-6 Make `control/loop.rs` boring** once 2–5 land (the fallbacks and
  bundle-apply blocks leave the loop).
- **P1-7 Add `materialization/paths.rs`** (extract path-safety from `files.rs`)
  and **`materialization/manifest.rs`** for `.proliferate/**`.
- **P2-8 Rename `worker_projection_cursor` → `up_cursor`** (migration-gated,
  behavior-preserving) per store.md vocabulary.
- **P2-9 Reconcile extras** — justify or fold `lifecycle/status.rs` and
  `store/tail_mappings.rs` into the Target Shape.

### Tracker note

No existing tracker owns the worker-crate restructure.
`specs/tbd/worker-tier-migration-catalog.md` is entirely server-side (Cloud
Celery/Beat background work); its only adjacency is item #13 ("Cloud command
worker control", `cloud/worker/**`), which is the *Cloud* side of the control
poll, not this crate. The structure spec is currently the sole authority for the
items above.

---

## anyharness — sweep in progress

_The deep sweep for the AnyHarness crate(s), reconciled against
`specs/tbd/anyharness-structure-alignment-swarms.md`, is running and will be
appended here._

---

## server — sweep in progress

_The structure sweep for the Python control plane (`cloud/**`), separate from the
background-work migration already tracked in
`specs/tbd/worker-tier-migration-catalog.md`, is running and will be appended
here._

---

## frontend — Minor drift

Spec: `specs/codebase/structures/frontend/**`. Code: `apps/{desktop,web,mobile}/src`
plus shared `apps/packages/*`. Reconciles against the existing
`specs/tbd/frontend-structure-alignment-migration.md`.

### Divergences & hard-rule violations

| Issue | Where | Severity |
| --- | --- | --- |
| Pure workflow reads a store directly (workflows must not call hooks/read stores) | `apps/desktop/src/lib/workflows/sessions/hot-session-ingest-manager.ts:3,107,117` (`useSessionIngestStore`) | **P0** |
| Stores perform their own persistence/`localStorage` (stores hold state only; persistence is a lifecycle concern) | `stores/{chat,sessions,preferences}/*.ts` — `chat-diff-preferences-store.ts`, `session-selection-store.ts`, `user-preferences-store.ts`, `workspace-ui-store.ts`, `repo-preferences-store.ts` | **P1** |
| Files at/near the ~400-line god-module threshold | `use-session-intent-actions.ts` (400), `use-workspace-entry-actions.ts` (399), `session-stream-flush-apply.ts` (398), `local-automation-executor.ts` (398) | **P2** |

Already clean: hook responsibility-folders (`derived/workflows/lifecycle/ui/cache/facade`),
no barrel files, components `.tsx`-only.

### Draft migrations

- **P0** Lift the store read out of `hot-session-ingest-manager.ts` — inject
  hydration/persistence deps so the workflow is testable without store side
  effects.
- **P1** Move `localStorage`/`sessionStorage` out of the 5 store files into
  `hooks/<domain>/lifecycle/**`, restoring store purity.
- **P2** Split the 400-line workflow/hook files only where responsibility is
  genuinely mixed.

### Tracker reconciliation

Against `frontend-structure-alignment-migration.md`: hook folders, no-barrels,
and `.tsx`-only are **Done**; the store-lifecycle boundary cleanup (P0/P1 above)
is the main **Pending** workstream; UI-primitive consolidation and page-thinning
are **not yet started**.

---

## proliferate-supervisor — Aligned

Spec: `specs/codebase/structures/proliferate-supervisor/**`. Code:
`anyharness/crates/proliferate-supervisor/src`. The tree matches the Target Shape
exactly — `process/{mod,child,health,restart}.rs`, `install/{mod,layout,service}.rs`,
`update/{mod,manifest,staging,rollback}.rs`, thin `main.rs` (124 lines). No
hard-rule violations: no Cloud client, no session/workspace/agent logic, no
catch-all modules, correct dependency direction. **No migrations.**

---

## sdk — Aligned

Spec: `specs/codebase/structures/sdk/**`. Code: `anyharness/sdk` (core) and
`anyharness/sdk-react`. Boundaries are intact: core SDK is framework-agnostic
TypeScript with zero React/TanStack/Tauri imports; `sdk-react` holds only the
React bindings; generated OpenAPI is checked in and not hand-edited; no
`utils/helpers/misc` buckets.

One non-code note: the spec's baseline file list (≈10 client + 11 type files)
trails the actual surface (≈24 client + 20 type files) — new resource families
(cowork, mobility, plans, reviews, repo-roots, worktrees, replay, runtime-config)
that follow the pattern correctly. **Draft migration: refresh the spec baseline,
not the code.**

---

## desktop-native — Aligned

Spec: `specs/codebase/structures/desktop-native/**`. Code:
`apps/desktop/src-tauri`. Fully aligned: sidecar discovery isolated in
`sidecar.rs`, seed-env resolution in `agent_seed_env.rs` (hydration stays in
AnyHarness), secrets only via `commands/keychain.rs`, dispatch worker
(`commands/cloud_worker.rs`) distinct from the always-on sidecar, binaries staged
via `build.rs` + declared in `tauri.conf.json`. **No migrations.**

---

## How to use this draft

1. The **worker** P0 set is the highest-value, most concrete work and is fully
   backed by the (just-tightened) worker spec — it is the natural first migration.
2. The **frontend** P0/P1 store-purity items fold into the existing frontend
   alignment workstream.
3. Aligned structures (supervisor, sdk, desktop-native) need no code work; the
   only follow-up is refreshing the **sdk** spec baseline.
4. Promote any item out of `tbd/` by moving it into the owning structure spec or
   a dedicated tracker before scheduling it as required work.
