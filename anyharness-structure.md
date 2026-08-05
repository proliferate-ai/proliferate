# AnyHarness Structure

Working draft, styled after `specs/codebase/structures/frontend/README.md`.
Candidate replacement/companion for
`specs/codebase/structures/anyharness/README.md`. Enforcement grades and
baselines were measured 2026-08-05 against `anyharness-lib` (~172k lines).

## Scope

These standards apply to the Rust runtime workspace:

- `anyharness/crates/anyharness-lib/**` — the runtime library (the subject of
  this doc)
- `anyharness/crates/anyharness-contract/**` — wire types (separate crate)
- `anyharness/crates/anyharness/**` — the binary shell
- `anyharness/crates/anyharness-credential-discovery/**` — credential probing

`proliferate-supervisor`, `proliferate-worker`, and the update protocol crate
are separate programs with their own shapes and are out of scope here.

## Goal

The runtime is organized so that a path tells you what a file may do before
you open it, and so that each endpoint's logic concentrates in exactly one
readable file instead of smearing across layers.

The explicit goals are:

- make it predictable where translation, orchestration, decisions, effects,
  state, and wiring live
- make every use case read as one pipeline in one file: preconditions →
  idempotency → repairs → resolve → decide → execute → compensate
- make the hardest logic (launch strategies, fork recovery) pure and cheaply
  testable with hand-built facts, no DB, no actors
- make live state unreachable except by message — no locks, no shared mutable
  state, one owner per session

The three generative rules (see `guides/mental-model.md` for the full model):
every function does exactly one of eight jobs; a path states its license; and
exactly one layer per use case may see across concerns.

## Target Shape

```text
anyharness-lib/src/
  api/
    http/
      <resource>.rs            # handlers: auth → parse → ONE facade call → map error
      <resource>_contract.rs   # wire <-> domain mappers (dep-less, sync)
      <resource>_errors.rs     # one From<DomainError> for ApiError per domain
      access.rs                # named auth assertions (the only auth layer)
      error.rs                 # the single ApiError

  domains/
    <domain>/
      mod.rs                   # exports only — a table of contents
      model.rs                 # the domain vocabulary; everyone may import
      service.rs | service/    # durable-only use cases (one file per use case)
      runtime.rs | runtime/    # live/cross-domain use cases — earned, not default
        <usecase>.rs           #   split impl blocks on one struct
        <usecase>_policy.rs    #   pure decisions: no store, no clock, no uuid, no &self
      store.rs | store/        # SQL + row structs; rows never escape
      <concern>/               # named reusable sub-steps (prompt/, mcp_bindings/, ...)
      live_ports.rs            # impls of live capability traits (when the domain feeds actors)

  live/
    <area>/                    # sessions, terminals
      model.rs                 # doorstep vocabulary: SessionLaunch, commands, capability traits
      handle.rs                # the phone: send_request (mpsc command + oneshot reply)
      manager/                 # registry: start, dedupe, look up, inject
      actor/                   # one task per session; select loop; sole owner of live state
      sink/                    # event persistence + subscriber fan-out

  adapters/                    # machine skills, product-blind — one grammar per skill:
    <skill>/                   #   git, files, processes, hosting
      service.rs               #   the entry struct
      types.rs                 #   typed inputs/outputs + typed errors
      operations/<verb>.rs     #   one file per verb (clone.rs, diff.rs, create_pr.rs, ...)
  integrations/                # foreign-vocabulary protocol code, product-blind
    acp/                       #   ACP doorstep (target home; on disk still src/acp/)
    mcp/                       #   JSON-RPC framing, capability tokens, product MCP server
    agent_cli/                 #   find/launch harness executables, model discovery
  persistence/                 # sqlite pool + pragmas, ordered migrations, custom data migrations
  app/                         # the wiring floor: every ::new(), in dependency order;
                               #   per-knot wiring families (sessions.rs, product_mcp.rs)
  observability/               # tracing spine: FlowHeaders→spans, resource gauges, phase markers
```

## What Goes Where

Use the lowest layer that can own the use case.

| Area | Path | Owns | Must Not Own |
| --- | --- | --- | --- |
| Wire shapes | `anyharness-contract/src/v1/**` | Request/response types, serde only. | Anything from the lib (compiler-enforced: separate crate, no path back). |
| Handlers | `api/http/<resource>.rs` | Auth assertion, admission permits, wire parsing, one facade call, error mapping, wire response. | Business logic, store access, live internals, try-catch-everything. |
| Edge mapping | `api/http/<resource>_contract.rs` | Dep-less, sync, decisionless wire↔domain mappers. | Fetches, clocks, `&state` — a mapper that fetches means the use case returned too little. |
| Edge errors | `api/http/<resource>_errors.rs` | One `From<SurfaceError> for ApiError` per domain — the only place HTTP learns failures. | A second error mechanism (the retired ProblemResponse pattern; folded into `ApiError` by #640, wire shape preserved — see `agents_errors.rs:1`). |
| Domain vocabulary | `domains/<d>/model.rs` | Records, inputs, views, plans — domain models with role names. | Wire types, row types, 1:1 internal mirrors. |
| Durable use cases | `domains/<d>/service*` | Orchestration over durable truth: own store, foreign stores (reads), adapters, pure concerns. | `live/**` (the named deviants: mobility, materialization), `api/**`, foreign-store writes. |
| Live/cross-domain use cases | `domains/<d>/runtime*` | The facade. The pipeline per use case. The ONLY domain code importing `live/` (the valve). Other domains' facades. Wraps its own service. | Inline policy (extract `*_policy.rs`), contract types, duplicated service bodies (named debt: WorkspaceService/WorkspaceRuntime). |
| Pure decisions | `*_policy.rs`, pure fns in concerns | Data-in/data-out rules; the Context and Plan pattern; the cheap tests. | IO, `&self`, `Utc::now()`, `Uuid::new_v4()`, store handles. |
| Named concerns | `domains/<d>/<concern>/` | Reusable sub-steps two or more use cases need (prompt assembly, MCP bindings, route auth). | Loose junk-drawer files; a helper that serves one path stays inline. |
| Durable state | `domains/<d>/store*` | SQL, row structs, two-tier composition (row fns take `&Connection`; surface fns own the tx). Returns domain models. | Row types escaping; business decisions. |
| Live state | `live/<area>/**` | Managers, handles, actors, sinks. Actor state is task-local — reached only via typed commands. | Fetching. Domain services/stores (measured: zero non-test imports). If live needs a fact: add a launch-bundle field. If it needs a durable power: add a capability trait, wire in `app/`. |
| Machine skills | `adapters/**` | How to run git, spawn processes, call `gh` — with typed errors. | What-for. Product knowledge (named debt: scratch.rs identity string, pr_status_cache policy engine). |
| Foreign vocabulary | `integrations/**`, `acp/**` | Code judged against an external spec; protocol mechanics; foreign-wire↔our-shapes translation. | Product knowledge (measured: zero domain imports). |
| Wiring | `app/**` | Every `::new()` on layer structs, in dependency order; capability-trait knots (store → ActorCapabilities); AppState. | Behavior. "Composition only" is the law and currently holds. |
| Observability | one span per use-case entry | `#[tracing::instrument]` at the entry; phase timings as events. | Context threading through signatures; repeated field blocks. |

## Entry Rules

- **Per use case, not per domain.** A domain with a runtime still serves
  durable-only endpoints straight from its service (sessions history and
  launch options enter at `SessionService`; prompt and fork enter at
  `SessionRuntime`).
- **Runtime is earned** when a use case needs live truth or a second domain;
  otherwise the service is the entry (textbook: `domains/repo_roots` has no
  runtime at all).
- **One use case, one entry.** Never half in runtime, half in the handler.
  The failure mode is on record: WorkspaceService/WorkspaceRuntime duplicated
  bodies (migration debt, target: one entry surface).
- **The runtime wraps the service** (`SessionRuntime` holds
  `Arc<SessionService>`); requests enter at the highest layer the use case
  needs and delegate down.

## Hard Rules

- A layer is a struct; its field list is its access license, granted exactly
  once in `app/`. No service locators, no globals, no construction outside
  `app/`.
- Anything pure is reachable by `use`; anything live (stores, gates, handles,
  ciphers, clocks) is handed in as a dependency.
- Live is reached only via handle mail (`send_request`: mpsc command +
  oneshot reply). Nobody holds actor internals. The actor is the sole writer
  of its state (busy, queue, pending interactions).
- Live never fetches. Its whole world arrives at birth (`SessionLaunch`) and
  its durable powers are the fields of `ActorCapabilities`, wired in `app/`.
- Contexts are private: `pub(super)` at most, never exported, never stored.
  Two use cases with overlapping Contexts keep separate Contexts.
- Plans are data only; capabilities travel beside plans, never inside.
- Policy files take facts, return decisions: no store, no clock, no uuid, no
  `&self`. Minting (ids, timestamps) happens in execute, not decide.
- Errors: one enum per surface, absorbed via `#[from]`; one `From` impl at
  the edge; never typed → `anyhow`/string; expected outcomes are data
  (`Option`, structured variants, empty plans), never strings.
- Authorization at the edge (`api/http/access.rs` named assertions);
  preconditions in the domain (gates, closed-state checks) — two questions,
  never conflated.
- Effects that change facts force a re-resolve (fork re-fetches the parent
  after `ensure_live_session_handle`); never decide on stale data.
- Compensation lives inline in the use-case body next to the success path,
  never buried in `map_err`.
- Roots hold ~5–9 entries; shrink by naming a concern folder, never by
  merging files, never `helpers.rs`/`util.rs`.
- Ceremony is earned (input struct >3 args; Context >2 truths; policy file >1
  nontrivial rule; runtime layer only when crossing concerns). The four
  invariants never disappear: auth assertion, no contract types past the
  edge, errors via `From`, rows inside the store.

## Dependency Direction

Rows are "code living in X"; grades: **law** (compiler-enforced, unwritable),
**holds** (convention, measured ~zero violations), **leaks** (convention with
named debt).

```text
contract  -> (nothing in lib)                                LAW (crate edge)
api       -> domain facades + models, contract, edge siblings HOLDS  (leak: 4× state.session_service.store(), WorkspaceStore::new in hosting.rs)
runtime   -> own service/store, other facades, live/<area>    HOLDS  (valve rule: crate::live POWER imports in domains/** only from runtime.rs / runtime/** / live_ports.rs; importing live model SHAPES to implement observer traits is the sanctioned inversion and legal anywhere)
service   -> own store, foreign stores (READS), adapters      LEAKS  (9 files import live powers outside the valve — see backlog #1/#2/#13; foreign-store writes unguarded — pub methods, convention only)
concerns  -> model.rs, other pure concerns                    HOLDS
store     -> persistence                                      HOLDS  (drift: SQL embedded outside store modules in 8 files across 5 domains — see backlog #8)
live/sessions -> domain SHAPES only (model.rs, prompt types)  HOLDS AT ZERO (non-test; one probe.rs exception — backlog #14)
live/terminals -> domains/terminals service+store             LEAKS BY DESIGN (older doctrine, deliberately retained)
adapters  -> std, vendor libs                                 HOLDS AT ZERO (semantic leaks only)
integrations -> the foreign spec                              HOLDS AT ZERO
core domains -> product domains (cowork/reviews/goals/...)    HOLDS  (5 test-only imports; inverted via SessionExtension/observer traits)
app       -> everything (wiring only)                         HOLDS
nothing   -> api (upward)                                     HOLDS AT ZERO
```

Forbidden edges and their remedies:

- `live ↛ stores/services` — add a launch-bundle field (facts) or a
  capability trait wired in `app/` (powers).
- `service ↛ live` — promote the use case to a runtime (the valve).
- `policy ↛ anything effectful` — hand facts in via the Context.
- `adapters/integrations ↛ domains` — invert: pass data or a callback in.
- `core ↛ product domains` — implement a core-defined trait, wire in `app/`.

## Automated Checks (enforced in CI today)

All of these run in the `repo-shape` job of `.github/workflows/ci.yml` and
fail the build. Run locally with `python3 scripts/<name>.py`.

### `scripts/check_anyharness_boundaries.py`

The import/usage checker over `anyharness-lib/src/**` (tests skipped).
Currently **passing** with a 2-entry ratcheted allowlist
(`scripts/anyharness_boundaries_allowlist.txt`, format:
`RULE_ID path count reason`; counts may only go down — stale counts fail).

| Rule ID | What it forbids |
| --- | --- |
| `API_LIVE_RUNTIME_IMPORT` | `api/**` importing `crate::live` or `crate::acp` |
| `DOMAINS_API_IMPORT` | `domains/**` importing `crate::api` (no upward edges) |
| `CORE_DOMAIN_PRODUCT_IMPORT` | core domains (`agents`, `repo_roots`, `sessions`, `workspaces`) importing product-surface domains (`cowork`, `mobility`, `plans`, `plugins`, `reviews`) |
| `ADAPTERS_PRODUCT_DOMAIN_IMPORT` / `ADAPTERS_LIVE_RUNTIME_IMPORT` / `ADAPTERS_API_IMPORT` | `adapters/**` importing domains, live/acp, `crate::api`, or HTTP transport crates (`axum`, `http`, `tower`, `utoipa`, ...) |
| `INTEGRATIONS_PRODUCT_IMPORT` / `INTEGRATIONS_API_IMPORT` | `integrations/**` importing domains, `crate::api`, or HTTP transport crates |
| `PERSISTENCE_PRODUCT_IMPORT` / `PERSISTENCE_RUNTIME_IMPORT` / `PERSISTENCE_API_IMPORT` | `persistence/**` importing domains, live/acp, api, or HTTP transport crates |
| `SESSION_STORE_API_IMPORT` / `SESSION_STORE_LIVE_IMPORT` | `domains/sessions/store/**` importing api or live |
| `EVENT_SINK_API_IMPORT` / `EVENT_SINK_HTTP_TRANSPORT_IMPORT` | `live/sessions/event_sink/**` importing api or HTTP transport crates |
| `LIVE_SESSION_PRIVATE_IMPORT` | importing `live/sessions/{actor,driver,event_sink,interactions,replay,background_work}` from outside `live/sessions/**` |
| `SESSION_COMMAND_IMPORT` / `SESSION_COMMAND_USE` | importing or constructing `SessionCommand` outside `live/sessions/**` — the handle is the only door |
| `LIVE_SESSION_COMMAND_TX_ACCESS` | touching `.command_tx` anywhere but `handle.rs` and `actor/**` |
| `APP_STATE_IMPORT` | `AppState` referenced outside `api/**` and `app/**` |
| `DOMAIN_CONTRACT_REQUEST_RESPONSE` | contract `*Request`/`*Response` types used in `domains/**` (2 allowlisted: goals + loops runtimes drive sidecar ext methods) |

### Other CI checks covering this crate

- `scripts/check_max_lines.py` — file-length ceiling; 38 anyharness paths
  grandfathered in `scripts/max_lines_allowlist.txt` (ratcheted).
- `scripts/check_anyharness_old_paths.py` — bans re-introducing the
  pre-migration flat layout paths.
- `scripts/check_session_mutation_admission.py` — session-mutating api
  handlers must take an admission permit.

### Rules NOT yet automated (checker gaps)

Each fits the existing engine as roughly one function + allowlist seed
(seed counts measured 2026-08-05):

1. **The valve rule** — `crate::live` in `domains/**` legal only from
   `runtime.rs`/`runtime/**`/`live_ports.rs`, **except** imports of live
   model shapes (`crate::live::<area>::model::*`) — the sanctioned
   inversion domains use to implement observer traits. Seeds: 9 power
   importers (backlog #1, #2, #13).
2. **`live ↛ domain stores/services`** — near zero: seeds are 5
   `live/terminals` files (deliberately retained, ratchet only),
   `live/sessions/probe.rs` (#14), and one engine-invisible
   `#[cfg(test)]` import.
3. **The api store-escape ban** — line pattern for `.store()` /
   `*Store::new` / store imports under `api/`; seeds: the 6 sites in #4.
4. **Policy purity** — `Utc::now`/`SystemTime::now`/`Uuid::new_v4`/store
   imports inside `*_policy.rs`. (Not `&self` — measured: it over-fires
   on Display impls and plain data methods; that stays judgment.) Seed:
   `retention_policy.rs` (#15).
5. **Generalize the sessions-store rule** to every domain's `store/`,
   plus a new **SQL-outside-store** rule (`INSERT INTO`/`SELECT…FROM`/
   `ON CONFLICT` in non-store domain files); seeds: the 8 files in #8.
6. **Broaden the contract ban** beyond `*Request`/`*Response` — any
   `anyharness_contract` import in `domains/**`; seeds: 86 import lines
   across 85 files (#3), ratcheted down per-domain.

Beyond the checker: leaves-first **crate splits** (`observability`,
`persistence`, `adapters`, `integrations` are at zero violations, so
extraction is free and upgrades those rows to compiler law — stop before
per-domain crates), and a **visibility ratchet** (`pub(crate)`/`pub(super)`
on Contexts, row types, and store mutation methods; a foreign-store-write
ban becomes law once mutations are scoped to the owning domain).
Judgment-only rules stay prose + review: proportionality, one entry per use
case, Context privacy, no second doctrine.

## Known Violations (the cleanup backlog)

Everything we know breaks the rules above, worst first. "Caught?" says
whether an automated check flags it today.

| # | Violation | Rule broken | Caught? | Target |
| --- | --- | --- | --- | --- |
| 1 | `domains/mobility/service.rs` (~1.5k lines) holds `live::terminals::TerminalService` directly (`:32`); interleaves fetch/effect per item in `destroy_source_workspace`, `preflight_workspace` | service ↛ live (the valve); resolve-then-execute | No (gap 1) | a mobility runtime valve |
| 2 | `domains/materialization/service.rs:33` — live access without a runtime layer | service ↛ live | No (gap 1) | same promotion |
| 3 | 86 `anyharness_contract` import lines + 30 inline uses across 85 files in `domains/**` (worst: `workspaces/retire_preflight.rs` 7, `loops/runtime.rs` 7; `runtime_config` persists wire types as rows; `agents/auth` uses contract structs as its domain model) | no wire types past the edge | Partially — only `*Request`/`*Response` (2 allowlisted) | domain twins at the seams |
| 4 | `.store()` in `api/http/{mobility.rs:330, workspaces_purge.rs:65, sessions_pending.rs:197, workspaces_lifecycle.rs:448}` + `WorkspaceStore::new` in `api/http/hosting.rs:201` | handlers call facades, never stores | No (gap 3) | facade methods |
| 5 | `api/http/workspaces_lifecycle.rs` — retire state machine written in the handler (three copies) | no business logic in handlers | No (judgment) | lifecycle service in `domains/workspaces` |
| 6 | `WorkspaceService`/`WorkspaceRuntime` — duplicated, diverged use-case bodies | one entry per use case | No (judgment) | one entry surface |
| 7 | Foreign-store mutation methods are plain `pub`; cross-domain reads-only holds by review, not law | foreign stores are READS only | No (visibility ratchet) | `pub(crate)` scoping after crate split |
| 8 | SQL embedded outside store modules in 8 non-test files across 5 domains (~29 lines; worst: `sessions/links/completions.rs` 14; also `plans/service.rs`, `workspaces/{retention_policy,access_store,inventory,access_gate}.rs`, `activity/feeds.rs`, `plans/decision_op.rs`) | rows/SQL stay in the store | No (gap 5 + new SQL rule) | fold into each domain's `store/` |
| 9 | `agents/` — 8 subfolders now named and classified below ([Agents Domain — Subfolder Ledger](#agents-domain--subfolder-ledger-pr-11-violation-9)); 3 flagged borderline | ledger truth | No (judgment) | ledger truth-up done (this PR); promotion ruling pending Pablo |
| 10 | Provider branches (`agent_kind` matches) in ~30 shared files (worst: `session_lifecycle.rs` 30, `user_input.rs` 21, `process.rs` 20) | branching begs for a capability trait | No (judgment) | harness-capabilities trait for the worst files only — proportionality, not a blanket rewrite |
| 11 | `acp/` homeless at src root | filing grammar | No | move to `integrations/acp` |
| 12 | ~~`agents_model_registry.rs` ProblemResponse — a second error mechanism at the edge~~ **STALE — already resolved.** The file, type, and its routes were deleted in #640 (2026-06-11); the fold into `ApiError` happened then (`agents_errors.rs:1-3` records it, wire titles/codes/statuses preserved). Kept numbered so references stay stable. | one error doctrine per surface | — | none (recon 2026-08-05 verified nothing remains) |
| 13 | 7 more files import live POWERS outside the valve: `workspaces/{retire_preflight.rs:22, setup_runtime.rs:8, access_gate.rs:8}`, `agents/auth/login_terminal.rs:1`, `agents/model_snapshot/{probe.rs:40, entry.rs:20}`, `sessions/{execution_summary.rs:7, subagents/hooks.rs:13}` | service ↛ live (the valve) | No (gap 1) | per-file: promote to runtime, or re-export the needed type via `live/<area>/model.rs` when it is a shape not a power |
| 14 | `live/sessions/probe.rs:19` imports `domains/agents/readiness/service` — the one non-test break in "live never fetches" | live ↛ domain services | No (gap 2) | capability trait or relocate the probe |
| 15 | `workspaces/retention_policy.rs` — a `*_policy.rs` file with `Utc::now` (:44, :66) and embedded SQL — misnamed: it is a store with a clock | policy purity | No (gap 4) | split into store queries + a pure policy |

Deliberately retained, not debt: `live/terminals` imports
`domains/terminals` service+store (5 files) — the older lock-shared-registry
doctrine rather than actors; proportionality says do not "fix" it. It gets
allowlist entries marked "ratchet only," never a rewrite.

## Agents Domain — Subfolder Ledger (PR 11, violation #9)

`domains/agents/` has 8 subfolders (`auth`, `catalog`, `installer`,
`model_snapshot`, `portability`, `readiness`, `registry`, `route_auth`)
beside its canonical `model.rs`/`runtime.rs` root. None were named or
classified anywhere before this entry. Read against every file, its
importers, and the two platform docs that already partially describe pieces
of this territory (`agent-distribution.md`, `agent-auth.md`,
`model-catalog.md`). **These are proposals awaiting Pablo's ruling — no code
moves land in this PR.**

The promotion question per subfolder: does it have its own durable
model/store/service set, its own lifecycle, or its own external identity
(the "domain" bar) — or is it a reusable sub-step the domain's `runtime.rs`
sequences (the "concern" bar)?

| Subfolder | Role | Shape | Recommendation |
| --- | --- | --- | --- |
| `auth/` | Native credential detection (env/local login state) + pure per-slot auth-context classification + interactive login command resolution. | No store. One live import (`login_terminal.rs` → `live::terminals`, to run the login command). Imports `installer::seed`, `readiness::paths`/`service`. Imported by `catalog`, `readiness`, `sessions::service`, `api/http/agents*`. `guides/domains.md:519` claims this concern "uses contract auth structs end-to-end" as migration debt — a targeted grep today finds no `anyharness_contract` import under `auth/`; worth a recon pass, not re-litigated here. | **Concern.** No independent model/store; sequenced by `runtime.rs`; reached cross-domain only via `sessions::service`. |
| `catalog/` | The ACTIVE agent catalog: bundled document, per-model option-matrix schema, availability + launch validation, gateway model-plan memoization. | Own bundled-JSON schema (`schema.rs`, held by `sync.rs`) — document-shaped, not row-shaped; no SQL, no live import. Cross-imports `registry` (bundled+schema), `auth::context`, `installer::install_policy`, `route_auth` (state+plan). Imported outside `agents/` by `sessions` (4 sites), `app/`, and 4 `api/http/*` files. | **Concern.** Largest by line count (~5.9k) of the eight, but everything funnels through the one read surface, `catalog::service::AgentCatalogService`, itself sequenced by `runtime.rs`. |
| `installer/` | Pin materialization (download/npm/managed-npm/git), install manifests, seed hydration + quarantine, and the reconcile job that converges a machine to the active catalog's pins. | Own file-based manifest (`install-manifest.json`, not SQL). `seed/` is the only `anyharness_contract` import site under `domains/agents`. No live import. Cross-imports `catalog::install_policy`, `readiness` (seed, manifest), feeds `model_snapshot::document` (manifest reads). Imported outside `agents/` by `workspaces/purge`, `app/`, `api/http/agents*`. | **Concern.** Largest by file count (26) of the eight; its own `reconcile/` and `seed/` split already follows the concern-folder grammar one level down — healthy recursion, not a promotion signal. |
| `model_snapshot/` | One composed probe observation per harness; event-driven single-flight refresh, failure backoff, orphan-scratch sweep; serves launch validation and the picker. | Has a document+atomic-file store equivalent (`document.rs`) and its own service (the `mod.rs` engine) — but `probe.rs`/`entry.rs` import `live::sessions::probe` directly, the named valve break in backlog #14 (a concern, not a `runtime.rs`, touching live). Densely cross-imports `route_auth` (state/plan/materialize, 4 files), `installer::manifest`, `catalog::gateway_plan`, `readiness::service`, `registry`. | **Borderline — needs ruling.** Shaped like a small domain (own model + own store-equivalent + a live touch), and backlog #14 already names its live import as a violation needing its own remedy independent of this ledger. Promoting it would legitimize a `runtime.rs` for that touch; but its heaviest coupling is to `route_auth` and `installer` inside `agents/`, not to anything outside it — promotion trades one named violation for one new cross-domain edge. |
| `portability/` | Collects/installs/validates/deletes per-harness (claude/codex) session-transcript artifacts under the user's home directory, for workspace mobility export/import. | No model/store/service split — 2 files. Imports `domains::sessions::model::SessionRecord`, reaching INTO another domain for its input type. Its only importer is `domains::mobility` (`service.rs`, `model.rs`, 2 contract files); `agents::runtime.rs` never references it. | **Borderline — needs ruling, leans "not agents'."** Sole caller is `mobility`; sole non-std input is a sessions model; nothing here is catalog, install, readiness, or auth. Reads as a `mobility`- or `sessions`-owned concern filed under `agents/` because it switches on `agent_kind`. |
| `readiness/` | Resolves per-agent launch usability (artifact presence, compatibility gates, credential state via `auth/`, route-aware upgrade via `route_auth`) into `ResolvedAgent`. | No own model/store; `service.rs` is the single entry (`resolve_agent`/`resolve_agent_unrouted`/`resolve_agent_with_env`). Cross-imports `installer` (seed, manifest, managed_npm), `auth::credentials`, `route_auth`. Second-most externally consumed concern after `runtime.rs` itself: `sessions` (4 sites), `cowork` (2 sites), `workflows/resolution`, `live/sessions/probe.rs` (backlog #14), `api/http/agents_contract`. | **Concern.** Entirely a projection over the other concerns' facts plus the static model — textbook. |
| `registry/` | The hand-written method document (`registry.json`): per-harness install method, auth vocabulary, launch discovery. | Zero cross-imports of any other `agents/` concern, zero live imports, zero contract imports. Only outside dependency is `domains::agents::model`. Zero importers outside `domains/agents` — reached only through `runtime.rs`'s `built_in_registry()`/`descriptor()`. | **Concern.** Cleanest and most self-contained of the eight; the shape every other concern here should be measured against. |
| `route_auth/` | The agent-auth "render plane": reads control-plane-delivered `state.json`, resolves a per-harness auth profile, renders pure env/file deltas, materializes them (incl. probe scratch + orphan sweep). Deliberately separate from `auth/`'s native-login concern (its own `mod.rs` doc comment draws this line explicitly). | Own wire contract (`state.rs`), own pure profile/render pipeline, own effectful `materialize.rs`; own API handler (`api/http/agent_auth.rs`) and own platform doc (`agent-auth.md`) with its own contract fixture. One test-only live import. Densely depended on by `catalog::gateway_plan`, `model_snapshot` (throughout), `readiness::service`, `sessions` (3 sites), `live/sessions/model.rs` (route_auth env-layering fields). | **Borderline — needs ruling, leans "concern."** Strongest independent identity of the eight (own doc, own handler, own contract fixture) — the profile most likely to read as "a domain wearing a subfolder name." But `agent-auth.md`'s own code map already files "runtime `route_auth/`" as one layer of the agent-auth platform living inside `domains/agents/`, and it has no store of its own (`state.json` is a file, not SQL rows) and no `runtime.rs` peer — the "own durable model/store/service set" promotion test (`guides/domains.md`, "Concept Promotion") does not yet clear. |

None of the eight has a SQL `store/` — every one is either pure, file-based
(manifest/document/state.json), or bundled-JSON. That is the strongest single
signal against promoting any of them to a `domains/<name>` peer of
`sessions`/`workspaces`/`agents`/`repo_roots` today: the core-primitive-domain
bar in `guides/domains.md` assumes durable SQL rows, and nothing here clears
it. The three flagged borderline are flagged for different reasons
(`model_snapshot`: an existing valve violation plus store-shaped state;
`portability`: wrong home entirely, not a promotion candidate so much as a
relocation candidate; `route_auth`: the strongest platform identity without
the store to match) — Pablo's ruling on each determines whether PR 12+ in
this train ever touches `domains/agents/` again.

## Change Discipline

- Reviewing existing code is "Building A New Use Case" (mental-model.md) run
  in reverse: any deviation is either a named migration exception or a
  finding — never silent.
- New files are earned by the proportionality table, never speculative. No
  empty folder trees, no one-file concern folders.
- When splitting a file, preserve behavior first; improve behavior
  separately.
- Policy extractions come with policy tests (hand-built facts, no DB).
- Never add a second doctrine where one exists (one error mechanism, one
  entry surface per use case, one mapper per type pair).
- Cite the in-repo exemplars in review: `api/http/sessions_errors.rs`,
  `api/http/git_task.rs`, `acp/**`, `domains/artifacts` plan fns,
  `domains/sessions/store`, `domains/sessions/deletion.rs`,
  `app/product_mcp.rs`, `domains/repo_roots`.
