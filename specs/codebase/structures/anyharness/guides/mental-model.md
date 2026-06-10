# AnyHarness Mental Model

Status: orientation primer for the AnyHarness runtime structure. The per-layer
guides in this folder are authoritative; this doc is the lens that makes them
cohere. Read [../README.md](../README.md) first, then this, then the focused
guide for the layer you are changing. It is the backend twin of
[frontend mental-model.md](../../frontend/guides/mental-model.md): same
generating rules, adapted to a Rust runtime with durable state and live
processes.

## The Core Idea

Three rules generate the entire structure. Everything else is a consequence.

1. **Every function does exactly one job, and every file holds one job for
   one concern.** The eight jobs are: declare shapes, translate shapes,
   decide, orchestrate, perform effects, hold state, wire, observe. Every
   line in the codebase is classifiable into exactly one — there is no ninth
   category. Slop is one function doing two jobs.
2. **A path tells you what is allowed before you open the file.** The root of
   any module — domain or concern — reads as a table of contents.
3. **Dependency direction is one-way, and exactly one layer per use case may
   see across concerns.** For durable-only use cases that layer is the
   domain's `service.rs`; for live or multi-domain use cases it is the
   domain's `runtime.rs` (its facade). Everything below the composing layer
   is single-concern by construction — which is what makes it readable alone.

The corollary that decides most placements: anything **pure** is reachable by
`use`; anything **live** (stores, gates, handles, ciphers, clocks) must be
**handed in** as a dependency. `&self` on a service or runtime IS the deps
object: its field list is the license of what that layer may touch, set once
at wiring.

## The Eight Jobs

| # | Job | Home |
| --- | --- | --- |
| 1 | Declare shapes | `contract` crate (wire), `model.rs` (domain), `store/rows` (db), `live/<area>/model.rs` (live) |
| 2 | Translate shapes | only at the four doorsteps — see Mapping below |
| 3 | Decide | `*_policy.rs` and pure helper fns — sync, no IO, no clock |
| 4 | Orchestrate | `runtime.rs` (the facade: cross-concern) and `service.rs` (within-concern) use cases |
| 5 | Perform effects | mechanism files (one each), `adapters/`, `integrations/` |
| 6 | Hold state | `store/` (durable), live actors/managers (live) |
| 7 | Wire | `app/` only, via per-domain constructors |
| 8 | Observe | one span at each use-case entry |

The jobs compose; they do not embody. Orchestration **causes** effects by
calling their owners — `store.insert(record)?`, `handle.send(command).await?`
are orchestration lines, one effect-owner call each. **Performing** an effect
is the owner's job: effects on owned state belong to the custodian (the store
executes the SQL, the actor mutates live state when commanded); effects on the
un-owned world (filesystem, processes, network, protocol IO) belong to
mechanism files, `adapters/`, and `integrations/`. The violation is never
that a use case caused an effect — it is an orchestration body that contains
the mechanics inline: SQL strings, `std::fs` calls, process spawning,
encryption loops. One function embodying two jobs is the leak.

## Truths: Static, Dynamic, Derived

The state axis is "who owns the truth and does it change":

- **Static truth** — bundled data (registry/catalog JSON). Load, validate,
  project. Same answer every call. Pure for policy purposes.
- **Durable truth** — survives restart. Owned by stores; reached only through
  store surfaces.
- **Live truth** — exists only in this process: actors, handles, PTYs, leases.
  Owned by `live/**`.
- **Derived views** — own nothing, never write: readiness resolution, launch
  options, preflight results. Recomputed from the truths above. Because they
  are write-free, anyone may call them anywhere, concurrently.

A use case is classified by the truths it needs: durable-only -> `service.rs`
owns it; live or multi-domain -> `runtime.rs` owns it.

## The Use-Case Pipeline

Complex use cases always read in this order. The pipeline is a shape, not a
layer — it belongs to whichever layer owns the use case.

```text
preconditions -> idempotency -> pre-flight repairs -> resolve -> decide -> execute/record -> (compensate)
```

- **Preconditions**: "does the world permit this?" — gates, closed-state
  checks. Structured error variants, never stringified. Distinct from
  authorization (see Access below).
- **Idempotency**: the cheap "already done?" exit, before any effect or fetch
  fan-out. The authoritative check lives under the owning layer's lock.
- **Pre-flight repairs**: named best-effort effects that make the world
  startable (crash recovery sweeps). Named functions, never inline blocks.
- **Resolve**: every fetch, one truth per line, `?` handles existence. May
  branch on *what* to fetch, never on what is *allowed*. Gathers into a
  **Context**.
- **Decide (policy)**: pure — no `&self`, no IO, no clock, no UUIDs. Reads the
  Context and the input, applies every rule, emits a **Plan**: the complete
  description of what shall happen, executing nothing.
- **Execute/Record**: the effects policy cannot perform — identity and clock
  minting, encryption, inserts, process spawns. Plan plus stamps becomes the
  record.
- **Compensate**: failure-path effects (mark-errored) live in the use-case
  body next to the success path, never buried in `map_err`.

The Context is **not a model**. It is named local variables: private to one
use-case module, never exported, never stored, never serialized. The moment
another file imports a Context, it has become a god object. Contexts are
per-use-case; overlap between them is correct, deduplicating them is not.

The Plan is **data only**: debuggable, comparable, constructible in tests.
Capabilities (closures, sinks, hooks) travel beside plans, never inside them.
In-repo exemplar: `domains/artifacts` (`plan_create`/`plan_update` return typed
plans; the runtime owns all effects).

## Models

| Kind | Home | Law |
| --- | --- | --- |
| Wire | `anyharness-contract/src/v1/**` | never imported below `api/` (documented event-payload exception only) |
| Domain | `domains/<d>/model.rs` | the lingua franca; everyone may import |
| Row | inside `store/**` | never escapes the store |
| Live | `live/<area>/model.rs` | live's doorstep vocabulary (launch bundles, commands, events) |

Inputs, views, and plans are **domain models with role names**, not new kinds.
A representation must earn its existence: wire and row copies always qualify
(stability, layout); internal 1:1 mirrors are banned — pick one owner.

## Mapping

Translation happens at exactly **four doorsteps** and nowhere else:

```text
wire <-> domain     api/http/<resource>_contract.rs
row  <-> domain     inside the store
domain -> live      the launch/command bundle the runtime builds
live <-> protocol   inside the actor/driver (ACP)
```

- **Between domains there is no mapping.** Domains exchange domain models
  as-is. Cross-domain composition is passing, never translating. If complexity
  grows, contexts and deps grow — the mapping count stays fixed.
- **Mappers are dep-less, sync, and decisionless.** No `&state`, no store
  reads, no clock. If a mapper needs to fetch, the use case returned too
  little: fix its return type (a view model), not the mapper.
- Each type pair has exactly one mapper.
- The live layer may import domain **shapes**, never domain **services or
  stores**. Durable powers cross the live boundary as narrow capability traits
  (event sinks, hooks), wired in `app/`. If live needs a fact it does not
  have, add a field to the launch bundle — live never fetches.

## Errors

- **One error enum per public surface.** Each layer adds only the variants it
  introduces and absorbs lower errors via `#[from]` / `#[error(transparent)]`.
  Twin enums with hand-copied variant mappers are banned.
- **One `From<SurfaceError> for ApiError` per domain at the edge**
  (`api/http/<resource>_errors.rs`) — the only place HTTP learns failures.
  In-repo exemplar: `api/http/sessions_errors.rs`.
- **Expected outcomes are data, not errors**: not-found is `Option`,
  needs-selection is a variant with structure, "already installed" is an empty
  plan. Never a string.
- **Errors carry their context from birth** (the resolution error includes the
  agent kind) so `From` stays sufficient. A `map_err` that adds context means
  the source error is underspecified.
- **Never map typed -> `anyhow`/string.** Structure destruction upstream forces
  substring-sniffing downstream, which is a behavior change waiting on a
  reworded message. `anyhow` is blessed only at the store surface, for
  infrastructure failure, with expected conditions modeled in `Ok` types.
- Log where the error is handled, not at every hop.

## Dependencies And Parameters

The parameter test — for each thing a function needs, ask two questions:

```text
Does it vary per call?      Data or power?
NO                ->  constructor dep (wired once)
YES + data        ->  field on the input struct
YES + power       ->  separate capability parameter
observability ctx ->  never a parameter; it is a span
```

- More than 3 parameters earns an input struct. Adjacent identically-typed
  parameters are a compiler-invisible swap hazard — name them in a struct.
- Call sites passing bare `None, Vec::new(), true` positionally are the
  symptom; the struct is the cure.

## Access

Two different questions, two layers, never conflated:

- **Authorization** — "who is asking" — edge only, one named assertion from
  `api/http/access.rs`, before translation. Domains never see auth tokens.
- **Preconditions** — "does the world permit it" — domain only: gates and
  policy with structured variants. The edge never makes these calls.

A use case legitimately checks both; they are different questions.

## Observability

One `#[tracing::instrument]` span per use-case entry, fields declared once;
everything inside inherits them. Phase timings are events. Hand-repeated field
clusters and latency/flow context threaded through signatures are banned —
that context propagates through spans.

## Proportionality: Ceremony Is Earned

| Artifact | Earned when | Below that |
| --- | --- | --- |
| Input struct + `*_input()` | >3 args, or defaults/grouping | plain args at the call site |
| Context + resolve fn | >2 truths fetched | inline `let`s |
| `*_policy.rs` | >1 nontrivial rule, or rules worth lone tests | inline check |
| View model | response needs composition | return the record |
| Runtime layer | use case crosses concerns | service is the entry |
| Concern folder | domain root past ~8 files or 2+ nameable concerns | stay flat |

The invariants that never disappear, even for two-field CRUD: the auth
assertion, no contract types past the edge, errors via `From`, rows inside the
store.

## The Root Is A Table Of Contents

A domain's root may contain only `mod.rs`, `model.rs`, the entry surface
(`runtime.rs` and/or `service.rs`), and `store/`. Everything else lives in a
named concern folder, and each concern folder follows the identical internal
grammar (exports-only `mod.rs`, `service.rs`, policy, helpers — each earned).

If a file cannot say which concern it belongs to, that is not a homeless file —
it is an unnamed concern. Name it. A root (domain or concern) holds roughly
5–9 entries; shrink a table of contents by naming concerns, never by merging
files. The same rule applies recursively to concern folders that outgrow it.

## The Placement Algorithm

Four questions give every file exactly one home:

1. **Which domain?** (source of truth + the domain's charter)
2. **Which concern within it?** No concern fits -> shared shapes (`model.rs`)
   or a concern you have not named yet.
3. **Which role within the concern?** (service / policy / mechanism / store —
   the eight jobs)
4. **Earned or inline?** (the proportionality table)

## Building A New Use Case

The end-to-end order for a new feature. Skip any step the proportionality
table says is unearned; never skip the four invariants (auth assertion, no
contract types past the edge, errors via `From`, rows inside the store).

1. **Wire shape**: request/response types in `anyharness-contract/src/v1/`.
2. **Owner**: durable-only -> the domain's `service`; live or multi-domain ->
   its `runtime`. A new nameable concern -> a new concern folder.
3. **Domain vocabulary**: input/record/view types in `model.rs`.
4. **The use case**: the pipeline fn (resolve -> decide -> execute) with its
   private Context, and `<usecase>_policy.rs` for the rules.
5. **State**: store fns for new rows — tier-1 surface, tier-2 row fns
   (see persistence.md).
6. **Errors**: new enum or new variants, `#[from]` for absorbed layers, one
   `From` impl in `api/http/<resource>_errors.rs`.
7. **Edge**: the handler stanza plus seam constructors in
   `<resource>_contract.rs` (see api.md).
8. **Span**: `#[tracing::instrument]` on the use-case entry.
9. **Wiring**: extend the domain's constructor in `app/` if new deps appeared.
10. **Tests**: policy tests with hand-built Contexts (no DB), store tests,
    one handler test through the stanza.

Reviewing existing code is the same list run in reverse: anything that
deviates is either a named migration exception or a finding.

## Smells (Greppable)

A job has leaked if you see: a closure or clone-for-closure in an orchestration
body · a strategy `match` in a facade · repeated tracing field blocks ·
`map_err` with a hand-rolled variant match · `.to_string()` on a typed error ·
control flow on `message.contains(...)` · a fetch inside a mapper or policy ·
`Utc::now()`/`Uuid::new_v4()` inside decision logic · a handler importing
domain internals beyond the facade and its types · a Context imported by
another file · the same rule decided in two places · effects performed before
validation completes.

## In-Repo Exemplars

Every rule above has a native exemplar — cite these in reviews:

```text
errors-at-the-edge      api/http/sessions_errors.rs
shared handler stanza   api/http/git_task.rs (one seam for 11 git handlers)
named auth assertions   api/http/access.rs
protocol doorstep       acp/** (dep-less permission mappers, typed provider errors)
typed adapter errors    adapters/git/types.rs
plan functions          domains/artifacts (plan_create / plan_update)
two-tier store          domains/sessions/store (row fns take &Connection, compose in one tx)
participant trait       domains/sessions/deletion.rs (cross-domain tx via narrow trait)
wiring template         app/product_mcp.rs (deps struct + build fn)
textbook small domain   domains/repo_roots
```

## Migration Exceptions

Known violations, named per the specs convention. The rule above is the law;
these are the debt:

- `LatencyRequestContext` threaded as a parameter through ~13 functions across
  api -> domains -> live (sessions startup/prompt paths). Target: span
  propagation.
- `domains/sessions/runtime/contract.rs` is a fetching mapper (store reads +
  live lookups inside `to_contract`), called per-record on list paths. Target:
  a `SessionView` composed by the runtime + a dep-less mapper.
- ~81 `anyharness_contract` import lines inside `domains/**`; worst:
  `runtime_config` persists wire types as rows, `agents/auth_config` uses
  contract structs as its domain model. Target: domain twins minted at the
  seams.
- `live/sessions` receives concrete `SessionStore`/`PromptAttachmentStorage`
  per call and `LiveSessionManager::start_session` takes 15+ positional params
  including four adjacent env maps. Target: launch bundle + capability traits.
- `api/http/agents.rs` carries a second error mechanism (`ProblemResponse`)
  alongside `ApiError`. Target: one mechanism.
- `api/http/workspaces_lifecycle.rs` implements the retire state machine in
  the handler (three copies including retention). Target: a lifecycle service
  in `domains/workspaces`.
- `WorkspaceService` and `WorkspaceRuntime` carry duplicated, diverged method
  bodies. Target: one entry surface.
