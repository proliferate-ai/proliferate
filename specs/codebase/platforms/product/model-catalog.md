# Model Catalog

Status: target. The body is written in the ideal state. Every difference from
the in-flight agents integration stack (`agents/integration-rc1`) is listed in
[Current gaps](#current-gaps); the list shrinks as follow-up PRs land, and the
label comes off when it is empty.

This revision replaces the earlier per-auth-context design (context-keyed
entries, credential fingerprints, TTL staleness, the cross-context universe
union). The ruling that drove the rewrite: **a probe answers "what models and
modes would a session launched right now show" — nothing else.** One
observation per harness, refreshed by events, tied to the auth state that
produced it by provenance rather than by content inspection.

## Purpose

The model catalog answers one question for every surface: which models and
modes can this harness run, right now, under its current auth. Pickers,
launch validation, automations, and workflow definitions all consume the
answer.

The design principle is probe-first: the primary truth is what a harness was
actually observed to advertise, on a specific machine, under its current
composed auth world, at a known time. Shipped lists exist to fill absence
before the first observation, never to override one.

Boundaries: which auth sources a harness uses, how they are delivered, and
what happens to running sessions when they change belong to
[agent-auth.md](agent-auth.md). Harness install and the shipped catalog
document belong to [agent-distribution.md](agent-distribution.md). Which
models the gateway serves belongs to the [model gateway](model-gateway.md);
this platform observes that list through the harness, it does not define it.

## The observation and its two supports

One law: **the observation is the truth wherever it exists; nothing overrides
it.** Two supporting artifacts exist, each with a deliberately narrow job:

1. **Machine observation.** One document per harness recording what that
   harness advertised when spawned into its current auth world. The truth for
   the picker and for launch validation wherever a runtime is attached.
2. **Cloud copy.** The cloud sandbox's observation at rest, synced up by the
   Worker, serving every surface with no runtime attached (web new-chat
   against a sleeping sandbox, mobile, automations, workflow editors — all of
   which pick models for cloud execution, which is why only the cloud
   sandbox's document syncs and the desktop's never does). Same observation,
   one hop staler, never authoritative over a reachable runtime.
3. **Shipped catalog models.** The nightly central probe's output inside
   `catalog.json`. Two jobs only: the cold-start seed a picker shows in the
   window before a machine's first observation exists, and a reviewed
   regression surface (a model vanishing from the nightly diff is a signal a
   human sees). It never overrides an observation.

The observation covers model and mode lists, including per-model
`configOptions` and per-model mode vocabularies where the harness reports
them. It deliberately does not cover control wiring or curation: how a
control is set (`switchVia`, `variantSyntax`, create-field mappings), which
mode is safe unattended, display names, and default visibility are
engineering and product knowledge a probe cannot invent, so the shipped
catalog stays authoritative for them on every render, forever. Default model
choices are likewise curated in the catalog; the probe's `observedDefaults`
inform the curator, never the user.

## The machine observation document

### Location

One document per harness, `model-snapshot.json`, in the harness's managed
directory — next to the install manifest of the binary it observed:

```
~/.proliferate/anyharness/                  # default_runtime_home()
├── agents/
│   └── <kind>/
│       ├── install-manifest.json           # what the installer materialized
│       ├── model-snapshot.json             # what the harness advertised (this spec)
│       ├── native/…                        # installed artifacts
│       └── agent_process/…
├── agent-auth/
│   ├── state.json                          # what the control plane selected
│   └── <family>-home-<rev>/…               # materialized per-harness auth homes
└── db.sqlite                               # sessions store
```

### Wire schema

camelCase like its sibling `install-manifest.json`, written atomically
(tmp + rename). **One entry per harness — there is no per-context map.**

```json
{
  "schemaVersion": 2,
  "agent": "opencode",
  "probedAt": "2026-07-27T09:12:03Z",
  "attestation": { "name": "opencode", "version": "0.3.112" },
  "installIdentity": {
    "role": "agent_process",
    "version": "1.18.3",
    "sha256": "9b4f9f1b1c00…",
    "source": "pinned_archive"
  },
  "stateRevision": 1721820000000,
  "models": [
    {
      "id": "proliferate/claude-fable-5",
      "provider": "proliferate",
      "name": "Claude Fable 5",
      "configOptions": null
    },
    { "id": "anthropic/claude-fable-5", "provider": "anthropic" }
  ],
  "modes": [ { "id": "build", "name": "Build" } ],
  "observedDefaults": { "modelId": "proliferate/claude-fable-5", "modeId": "build" },
  "warnings": [],
  "lastAttempt": { "at": "2026-07-27T09:12:03Z", "outcome": "ok", "detail": null }
}
```

Field contract:

| Field | Meaning |
| --- | --- |
| `probedAt` | Timestamp of the last **successful** observation; the lists are from this run |
| `attestation` | The ACP `initialize` `agent_info` — provenance about the binary that answered |
| `installIdentity` | The install manifest's `agent_process` artifact read at probe time — provenance about the install that answered |
| `stateRevision` | The `state.json` revision the probe materialized under (`0` = no document = native) — provenance about the auth world that answered |
| `models` | Observed models; `provider` preserved verbatim from the harness; `configOptions` and any per-model mode vocabulary carried verbatim where reported |
| `modes` | Observed modes (harness-level) |
| `observedDefaults` | What the harness itself selected at probe time — curator input only, never served to users |
| `warnings` | Probe warnings, carried for diagnostics |
| `lastAttempt` | The most recent attempt of any outcome; a failed refresh updates this and nothing else |

**The provenance fields are not gates.** `attestation`, `installIdentity`,
and `stateRevision` exist so a human debugging "why does the picker show X"
can line the observation up against the state file and the install manifest,
and so the Worker upload can skip unchanged documents. Nothing computes
freshness from them — [freshness is event-driven](#freshness-is-event-driven).
There is no `authFingerprint`, no `authContextId`, no per-context anything:
each of those was a door back to context-division and is deliberately absent.

A failed refresh never destroys truth: the last good lists keep serving, with
`lastAttempt.outcome = "failed"` rendering as a failed-refresh indicator next
to the `probedAt` age.

The entry is a persistence of what the probe already returns
(`ProbeSnapshot` in
[live/sessions/probe.rs](../../../../anyharness/crates/anyharness-lib/src/live/sessions/probe.rs)),
not a new observation format. The document holds only the current
observation; it stores no history and no diffs. History lives server-side
(below), and any "what changed" view is computed at read time by comparing
two snapshots — never stored.

## Probe mechanics

**One mechanic: spawn the harness into its current composed auth world,
exactly as a launch would, and record what it advertises.** The probe renders
the same profile a launch renders — every enabled source composed, the same
per-harness recipes, the same env deltas including the recipes' own
sanitization — with exactly one substitution: every file lands under a
probe-owned scratch root instead of the live runtime home. Nothing is added,
nothing is subtracted, nothing is scoped to a single source, and nothing is
scrubbed. The governing rule: **probe env == launch env — only the file root
moves.**

Consequences, each load-bearing:

- **Native is not a special case.** A harness with no `state.json` entry
  resolves to the empty profile, so the probe observes the user's real login
  — exactly what a session would use. There is no `baseline` pseudo-context;
  the no-auth-at-all cold start is the shipped catalog's seed window.
- **A multi-source harness is observed composed.** Opencode with the gateway
  plus an API key plus a native login is spawned with all of them, and the
  observation is the union menu a real session shows — recorded as one list,
  each model carrying the harness's own `provider` namespace verbatim.
- **A partially broken source is truth, not failure.** If one of opencode's
  providers has a dead key, the spawn succeeds and the observation honestly
  records the reduced menu — which is exactly what a session would show. No
  fallback fills the gap with fiction.
- **The recipes' sanitization is fidelity.** A gateway-routed claude probe on
  a Bedrock-exporting host records gateway models, not Bedrock's menu,
  because the launch recipe strips the ambient rerouting flags and the probe
  runs the same recipe.

Per-model detail is carried verbatim: `configOptions` (reasoning levels and
similar) and per-model mode vocabularies ride the observation untouched.
Mode wiring (`createField`, `liveConfigId`) stays catalog-authoritative; the
observation only confirms which ids exist.

The one prerequisite fetch that is not observation survives as
materialization: harnesses whose gateway config enumerates models explicitly
(opencode's provider models map) need the proxy's list to *write that config*
before any spawn. That fetch belongs to the route-materialization seam
([catalog/gateway_plan.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/gateway_plan.rs)),
runs against `GET /v1/models` with the harness's own key, and never writes
the observation — the probe then observes the configured harness like any
other spawn. `gatewayPolicy.seedModels` survives only as a floor under that
fetch (an empty models map hard-fails the opencode recipe); an observation
produced over the floor carries a warning, because the probe then observes
the ids the floor wrote — a tautology, not a discovery.

Machine-side probing covers the one harness the central pipeline never can:
cursor is login-only and excluded from the scheduled probe environment, so
its shipped entry is always second-hand — but the machine has the login, so
its observation is first-hand.

## Freshness is event-driven

**Probes fire on events, not on suspicion.** There are no credential
fingerprints, no TTLs, and no staleness computation: validity is "the
observation was probed after the last applied auth change", and the event
chain guarantees it. The closed set of triggers:

- **Auth applied (the primary trigger).** The runtime acknowledges an applied
  `state.json` (agent-auth's ack-gated delivery), and the ack fires a probe
  for every harness whose entry the applied document changed. The apply
  response never waits for the probe; the picker shows a refreshing state
  rather than stale data presented as current.
- **Install completed.** Both places an install finishes — the reconcile
  job's per-agent completion and the synchronous install endpoint — poke the
  probe for that harness. A new binary may advertise a new menu.
- **Login terminal closed.** A native login performed through the product's
  login terminal changes the harness's own credentials; terminal exit pokes
  the probe. (A login performed entirely outside the product has no event —
  see the safety net below.)
- **Runtime startup (the safety net).** The startup pass that reconciles
  installs gains a third step: re-probe every installed harness,
  unconditionally, in the background. This single unconditional pass is what
  catches everything that happened while the runtime was down or that had no
  event — an out-of-band `claude login` in a plain terminal, a re-login with
  a different account, a gateway-side model change. It is deliberately
  bookkeeping-free: no comparison decides whether to probe, because the
  comparison machinery (fingerprints over credential material, discovery-file
  stats, TTL windows) cost more in complexity than the handful of background
  spawns it saved.
- **Manual refresh.** The settings surface forces a re-probe per harness.

What this deliberately tolerates: an out-of-band credential change while the
runtime is running leaves the observation wrong until the next startup or
manual refresh. Sessions still work (the harness reads its own credentials
live); only the menu lags. That trade — bounded, visible lag in exchange for
deleting the entire staleness apparatus — is the ruling.

Nothing ever blocks on a probe: launching during a refresh window validates
against the current observation (or the seed, before the first one), so
switching auth or updating a harness never locks the user out of starting a
session while the probe catches up.

## The probe engine

The engine is a convergence primitive with lifecycle guards; the guards
protect live sessions and the machine, not staleness bookkeeping:

- **Scratch isolation.** A probe materializes into a probe-owned scratch root
  (`agent-auth-probe/<harness>-<pid>-<nanos>/`, 0700), a **sibling** of
  `agent-auth/`, never a child: the launch-side revision GC never enumerates
  it, and a probe can never write into the config dir a running session is
  reading (`claude-config/` is shared and not revision-keyed). The scratch is
  owned by the probe's thread and removed on every exit path.
- **Single-flight per harness.** Concurrent triggers for the same harness
  coalesce onto one in-flight probe; losers observe the winner's entry.
  Queued counts as in-flight. Probes run serially per harness, off the
  install reconcile's job slot, each bounded by the engine's timeout on the
  probe's own thread so a cancelled attempt kills its child rather than
  leaking it.
- **Orphan sweep.** At engine construction the owner sweeps abandoned scratch
  roots (a SIGKILLed probe runs no guard), age-thresholded.
- **One engine per runtime home.** The engine holds an advisory exclusive
  lock; a second runtime sharing the home degrades to read-only — serves the
  document and status, neither probes nor sweeps, and refuses a forced
  refresh rather than silently ignoring it.
- **Cursor is manual-refresh only.** Its credential lives in the macOS
  keychain, so an unattended spawn can surface an OS keychain prompt with no
  user-visible cause. Every other harness probes under the events above;
  cursor's observation is written only when a user asks.

The same engine runs everywhere. A cloud sandbox's runtime probes under the
same events and writes the same document; the Worker syncs it up as the cloud
copy, while the desktop's document stays local. Local and cloud differ only
in whether the document additionally syncs, never in probe or storage logic.

## The cloud copy

The law first: **AnyHarness stores, never syncs.** The machine document
always and only lives in the runtime home; the runtime probes it and writes
it and does nothing else. The cloud copy is the cloud sandbox's document made
readable while the sandbox sleeps — no writer except upload, no
server-generated content, and no authority over a reachable runtime.

Only the **cloud sandbox's** document syncs up. The desktop's never does:
every machineless consumer picks models for cloud execution, so the cloud
sandbox's observation is the one they need, and the desktop's own picker
always has its runtime attached.

### Storage

```
agent_model_snapshot
  id               UUID pk
  harness_kind     String(64)
  owner_user_id    UUID          -- machine observations always have an owner
  snapshot_json    Text          -- the machine document, verbatim wire shape
  probed_at        timestamptz
  status           'active' | 'inactive'
```

**Keyed by (harness, owner) — there is no `auth_context_id` column** (the
per-context re-key is superseded by the composed observation), no `surface`
column (only cloud syncs), and no `source` column or ownerless seed rows (the
server never generates observations; the seed is a read-time fallback to the
served shipped catalog, not stored state with a writer to maintain).

Soft-versioning is kept as-is: no unique key on the scope; a write
deactivates prior `active` rows for (harness_kind, owner_user_id) and inserts
the new row as `active`; reads take the latest active row ordered by
`(probed_at DESC, id DESC)` — the tie-break is required, since a re-sent
document repeats its `probedAt`. Retained inactive rows are the audit trail
that makes "what changed between refreshes" answerable without storing diffs.

The override table (`agent_catalog_override`) keeps its contract unchanged:
one row per (user, harness) or (org, harness), a `patch_json` of optional
`remove`/`update`/`add` applied in that order on every layered read.

### Write path

One writer: **Worker upload**. On the heartbeat-and-converge tick,
[model_snapshot_sync.rs](../../../../anyharness/crates/proliferate-worker/src/model_snapshot_sync.rs)
GETs the runtime's snapshot documents over the narrow local surface, diffs
`probedAt` against an in-memory last-pushed cache (worth at most one
redundant upload after a Worker restart, which the soft-versioned write
absorbs idempotently), and POSTs changed documents to the ingest route with
the Worker's own bearer; the server resolves the owner from the Worker's
sandbox row. Non-fatal like every convergence action. The ingest route
refuses non-cloud-sandbox Workers — desktop does not sync; its former
60-second mirror-poll hook is deleted with no replacement.

## Serving

### The picker is the observation

For a harness with a fresh-enough machine observation (any observation — age
never disqualifies), the picker's menu **is** the observation's model list.
Where no observation exists yet (first minutes of a first boot; a machineless
surface for a user whose sandbox never probed), the shipped catalog's models
serve as the seed, marked as unverified. There is no union across contexts,
because there are no contexts: one harness, one list.

### Enrichment join

The observation carries capability; the shipped catalog carries curation.
The picker joins them per model:

1. Build the candidate id set for the observed model: its `id`, its catalog
   aliases once matched, each normalized through the default-chat-model
   normalizer (the existing `buildCloudModelLookup` machinery in
   [cloud-launch-catalog.ts](../../../../apps/packages/product-client/src/lib/domain/agents/cloud-launch-catalog.ts)).
2. The first shipped-catalog model matching any candidate supplies display
   name, description, control wiring, and availability metadata.
3. No match means the model still renders — id-shaped label, sparse metadata
   — subject to the unknown-model visibility default below.

Identity and presence always come from the observation side; prose and
wiring always come from the catalog side. Defaults come from neither: the
shipped catalog's curated default, with a user-set default on top. Provider
badges read the model's own `provider` field — verbatim from the harness —
never an inference from the model name or the harness kind.

### Launch validation

One typed refusal, kept for exactly one consumer: **saved intent**. A
requested model that resolves against the current observation (exact id,
then alias, then variant forms; seed pre-first-probe) launches. One that
does not is refused with `SESSION_MODEL_UNSUPPORTED` — protection against a
harness silently substituting its own default on an unattended run, which is
the one outcome worse than either refusal or loud in-session failure.

The gated taxonomy is deleted: no `SESSION_MODEL_GATED`, no
`required_contexts`, no enumeration of which auth would serve a model. An
interactive picker cannot construct that request (the picker is the
observation), and the answer to "why isn't my model here" is the settings
surface, not a launch error.

### Saved model intent

Saved model choices everywhere (automations, workflow definitions, team
defaults) are intent, resolved against the executing target's observation at
run time via the alias chain. A choice that no longer resolves marks the
config for review rather than silently substituting — never a silent model
swap.

## Model identity

Four identities stay separate in running-session UI:

- `requestedModelId`: the launch intent (may be an alias or an auto id).
- `effectiveModelId`: what the running ACP session reports; active-session
  truth once the session exists.
- `canonicalModelId`: the catalog identity used for display, dedupe, and
  selected state.
- `liveConfigModelValue`: the raw value the running session's model control
  accepts, preserved for writes back to it.

Pending sessions may show the requested model; once the session reports an
effective model, the chip and selected row follow it, normalized to the
canonical id when a match exists. Curated display names win over raw
id-shaped labels whenever the match is known.

## Visibility and defaults

Visibility is product curation layered over capability, never capability
itself:

- A model is available when the observation (or, pre-probe, the seed) serves
  it; it is visible when the shipped catalog's default visibility says so or
  the user's override patch says otherwise.
- Unknown live-discovered models default to hidden until curated or opted in.
- The visible set must never go empty for a harness with available models;
  the current selection stays rendered (with a warning) even when hidden.
- Per-harness default models are curated in the shipped catalog; user-set
  defaults override them.

## API surface

### Cloud routes

- `GET /v1/cloud/agent-models/{harness}`: the layered read — latest active
  observation, else the shipped catalog's models as the read-time seed, with
  the override patch applied. No `authContextId` and no `surface`
  parameters: one observation per harness, cloud-sandbox observations only.
- `POST /v1/cloud/agent-models/{harness}/refresh`: the single ingest route —
  a Worker-uploaded machine document in the body. Worker-authenticated only;
  the server never generates observations.
- `PUT`/`DELETE /v1/cloud/agent-models/{harness}/override`: the override
  patch, contract unchanged.

### Runtime routes

- `GET /v1/agents/{kind}/model-snapshot`: the polled status surface —
  `probedAt`, `snapshotAgeSeconds`, `lastAttempt`, `lastError`, the engine's
  live `state` (`idle` | `queued` | `running` | `backoff`), the provenance
  fields, the engine's ownership mode, and the `models`/`modes` arrays off
  the same document read.
- `POST /v1/agents/{kind}/model-snapshot/refresh`: force a re-probe of the
  harness (the manual-refresh poke). No `authContextId` parameter — one
  composed observation. `202` with the status body; `404` when the harness
  is not installed here; `409` when this runtime does not own the probe
  engine; `502` only when a probe actually ran and failed.

Renames are hard cutovers with no alias windows; all consumers are
first-party.

## Code map

```
anyharness-lib/src/domains/agents/model_snapshot/
├── mod.rs                # the engine: single-flight, per-harness serialization,
│                         #   backoff, and the event pokes (startup, auth-applied,
│                         #   install-completed, login-terminal, manual refresh)
├── config.rs             # tunables, poke vocabulary, ownership mode, refresh error
├── document.rs           # wire schema + atomic 0600 read/write (one entry per harness)
├── entry.rs              # ProbeSnapshot -> document (pure translation)
├── lock.rs               # the single-writer engine lock (one engine per runtime home)
├── probe.rs              # invocation of live/sessions/probe::probe_agent on a thread
│                         #   that owns both the child and the scratch
├── reads.rs              # document/status reads (available in read-only mode)
├── status.rs             # the polled status projection (pure)
└── targets.rs            # which harnesses may be probed (installed; cursor manual-only)
```

Deleted from the per-context design: `fingerprint.rs`, `staleness.rs` and its
test tree, `universe.rs`'s cross-context union, per-context slots and
backoff, and `route_auth/probe_materialization/scoping.rs` with the
attribution scrub — the probe materializes the full composed profile through
the same
[probe_materialization.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/probe_materialization.rs)
seam (phase A shrinks to a state read; phase B and the scratch are
unchanged).

| Layer | Path | Owns |
| --- | --- | --- |
| Machine observation | `anyharness-lib/src/domains/agents/model_snapshot/` | Document, probe engine, events, status |
| Probe materialization | [route_auth/probe_materialization.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/probe_materialization.rs) | The composed launch world under a scratch root; the orphan sweep |
| Launch validation | [catalog/service.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/service.rs), [sessions/service/launch_options.rs](../../../../anyharness/crates/anyharness-lib/src/domains/sessions/service/launch_options.rs) | Observation-first resolution, the single typed refusal, picker projection |
| Gateway model plan | [catalog/gateway_plan.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/gateway_plan.rs) | The surviving `GET /v1/models` materialization fetch: memoized, seed floor warned, never observation truth |
| Cloud copy | `server/proliferate/server/cloud/agent_models/` | Layered reads, Worker ingest, overrides, soft-versioned history |
| Cloud sync | [proliferate-worker/src/model_snapshot_sync.rs](../../../../anyharness/crates/proliferate-worker/src/model_snapshot_sync.rs) | Heartbeat-tick upload of changed documents |
| Picker composition | [cloud-launch-catalog.ts](../../../../apps/packages/product-client/src/lib/domain/agents/cloud-launch-catalog.ts) and the chat/model domain | Merge precedence, identity normalization, visibility, badges |

## Failure modes

- Probe fails (harness crash, provider auth error): `lastAttempt` records the
  failure; the last good lists keep serving with their age and a
  failed-refresh indicator, never an empty picker.
- One source inside the composed world is dead: the probe succeeds and
  records the honest reduced menu — that is what a session would show.
- No observation and no runtime (new user on web): shipped catalog models
  serve, marked as unverified seed data.
- Out-of-band credential change with the runtime up: the observation lags
  until the next startup or manual refresh; sessions are unaffected (the
  harness reads its own credentials live).
- Requested saved model absent from the observation: typed refusal naming
  the model; the saved config is marked for review.
- Machine document unreadable or schema-mismatched: treated as absent; the
  next event rewrites it whole. It is derived state — deleting it loses
  nothing a re-probe cannot restore.

## Proof

Named, binary assertions; the probe re-cut is done when they are green. IDs
are stable — tests reference them by name.

- **B1** Probe env ≡ launch env modulo the file root, parameterized over
  every harness × source-combination in the recipe table.
  (probe_materialization tests)
- **B2** Any probe writes one schemaVersion-2 document — single entry, no
  `entries` map, no fingerprint — with `stateRevision` equal to the state
  file's and `installIdentity` equal to the manifest's. (document tests)
- **B3** Opencode with gateway + api_key + native login yields one
  observation whose model list contains every provider's models with
  verbatim `provider` fields. (engine test)
- **B4** A gateway-claude probe on a host exporting
  `CLAUDE_CODE_USE_BEDROCK` and `ANTHROPIC_API_KEY` records gateway models,
  not Bedrock's menu. (probe env tests)
- **B5** The five events (auth-apply ack, install completed, login-terminal
  exit, unconditional startup pass, manual refresh) are the only probe
  spawn sites; no poll, timer, or gate-triggered spawn exists. (wiring
  tests)
- **B6** A crashed probe updates `lastAttempt` only and the last-good lists
  keep serving; a dead provider inside the composed world yields a
  successful reduced observation, never seed backfill. (engine degraded
  tests)
- **B7** Concurrent triggers coalesce to one spawn; a SIGKILLed probe
  leaves zero credential bytes after the sweep; a non-owner runtime's
  forced refresh is a 409. (concurrency/sweep/lock tests — survive the
  re-cut verbatim)
- **B8** The picker menu equals the observation wherever one exists (seed
  only in true absence); launch accepts exactly the resolvable set; and
  `SESSION_MODEL_GATED`/`required_contexts` no longer exist anywhere in
  the codebase (grep-gated, so deleted concepts stay deleted). (universe
  tests + grep gate)

## Current gaps

Deltas between this document and the integration stack
(`agents/integration-rc1`), each struck by its follow-up PR. The stack
implements the superseded per-context design; these gaps are the re-cut.

- [ ] **The document and engine are per-context.** `model-snapshot.json`
      carries an `entries` map keyed by auth-context id with per-entry
      `authFingerprint`; the engine's slots, backoff, and status are keyed
      per (harness, context); `targets.rs` enumerates active contexts. All
      of it collapses to one composed observation per harness
      (schemaVersion 2).
- [ ] **Staleness machinery exists and deletes.** `fingerprint.rs`,
      `staleness.rs` (identity comparison, TTL with jitter, the
      completed-attempt floor as a staleness input), and the gate-evaluation
      phase-A credential hashing all delete under the event model. The
      startup pass becomes an unconditional background re-probe; the other
      events fire on their own triggers. (The single-flight, scratch,
      sweep, lock, and cursor rules all survive unchanged.)
- [ ] **Per-context scoping and the attribution scrub exist and delete.**
      `route_auth/probe_materialization/scoping.rs` and `attribution_scrub`
      go; `materialize_for_probe` renders the full composed profile.
- [ ] **The probe is not wired to the auth-apply ack or the login terminal.**
      The apply handler pokes on state application (pre-ack) and no poke
      exists on login-terminal exit; both move to the event set above once
      agent-auth's ack-gated delivery lands.
- [ ] **The cross-context universe union exists and deletes.**
      `catalog/universe.rs`'s union and `validate_launch_in_universe`'s
      context handling reduce to observation-first resolution with the
      single `SESSION_MODEL_UNSUPPORTED` refusal; `SESSION_MODEL_GATED`,
      `SelectionUnsupported::ModelGated`, and `required_contexts` delete.
- [ ] **The cloud store carries `auth_context_id`.** `agent_model_snapshot`
      re-keys to (harness_kind, owner_user_id) and `snapshot_json` holds the
      whole machine document; the cloud routes and the Worker sync drop
      their per-context parameters and diffs.
- [ ] **The status UI is per-context.** The All Models surface (C3) polls
      and renders per-context status; it becomes one per-harness
      status/refresh row.
- [ ] The picker does not project the machine observation yet: launch
      validation reads it, but `models`/`visible_models` and the runtime's
      launch options still read the shipped catalog alone. Closing this is
      the [enrichment join](#enrichment-join); the pre-existing asymmetry is
      in the safe direction.
- [ ] The composer's provider badge still calls
      `getProviderDisplayName(harnessKind)` instead of reading the model's
      own plumbed-through `provider` field.
- [ ] The retained `inactive` cloud rows have no retention bound; the
      document owes a retention rule (keep N per scope, or an age bound) and
      the sweep that enforces it.
- [ ] The legacy gateway-models routes (`GET .../catalog/gateway-models`,
      `POST .../catalog/refresh-gateway`) still serve beside the snapshot
      surface; they delete with the C-track cutover of the All Models tab.
      The desktop mirror-sync hook (`useGatewayCatalogMirrorSync`) and its
      `gateway-catalog-mirror.ts` push are already gone — the route cutover
      on the integration branch deleted them.
- [ ] Onboarding contains no "checking for latest models" step (the surface
      rendering the install-completed and auth-applied events).
