# Models

This document covers the model catalog and gateway systems.

## Catalog

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
[specs/FEATURE_DOCS/AGENT_AUTH.md](AGENT_AUTH.md). Harness install and the shipped catalog
document belong to [../codebase/platforms/product/agent-distribution.md](../codebase/platforms/product/agent-distribution.md). Which
models the gateway serves belongs to the [Gateway](#gateway) section below;
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
[live/sessions/probe.rs](../../anyharness/crates/anyharness-lib/src/live/sessions/probe.rs)),
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
([catalog/gateway_plan.rs](../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/gateway_plan.rs)),
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
- **Failure backoff.** A failed attempt arms an exponential backoff — 60s
  doubling to a 30-minute ceiling, spread by a deterministic ±20% jitter keyed on
  (harness, attempt) so the schedule stays assertable — that gates
  admission of *automatic* event pokes after failures only. It is never a
  freshness gate, a manual/forced refresh always bypasses it, and it is
  not persisted across restarts
  ([model_snapshot/config.rs](../../anyharness/crates/anyharness-lib/src/domains/agents/model_snapshot/config.rs),
  [backoff.rs](../../anyharness/crates/anyharness-lib/src/domains/agents/model_snapshot/backoff.rs)).
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

### Two-tier probing

The engine runs two tiers off the SAME closed event set, never a poll or a
timer. Both are single-flight per harness and neither blocks the event that
raised it.

- **Tier 2 is the full probe** described above: spawn the harness into its
  composed auth world and record what it advertises. It is the truth for the
  picker and for launch validation.
- **Tier 1 is an instant credential trial**: a roughly one-second key-scoped
  check that never spawns a harness. It answers only "does this credential
  still work right now", so a surface can show Authenticated or Expired before
  the slower Tier 2 observation lands. A gateway source is trialled with a
  `GET {base_url}/v1/models` using the harness's own virtual key (the surviving
  key-scoped fetch machinery), classified as green on a 2xx, expired on a
  401/403, and inconclusive (recording nothing) otherwise. Pasted api-key and
  native CLI logins stay heuristic and render unverified: a native login would
  need an unattended spawn (the keychain hazard cursor is excluded for), and a
  pasted key has no verifiably free provider endpoint wired yet, so neither is
  guessed. A green trial writes `Tier1Trial` evidence with an age into the
  agent-auth facts, which is the only path to a green Authenticated display
  before a full probe; a full observation always outranks it.

**The trial is behind a flag, defaulting OFF.** A trial makes a real network
call on every poke, so a deployment opts in through the engine's
`tier1_trial_enabled` tunable; when off, no trial runs and credentials keep
their heuristic (bare-presence or acknowledged-route) strength.

Retuned constants (ADR FR-2, A5):

- **Per-probe timeout 45s** (was 240s). A healthy harness answers ACP
  `initialize` in well under a second, so a probe still running at 45s is
  wedged, not slow, and the shorter ceiling turns it into a fast failed attempt
  the backoff then spaces out.
- **Spawn fast-fail.** A harness that cannot be spawned at all (missing or
  broken binary) returns immediately with a named `spawn_failed` code instead of
  waiting out the timeout, and arms the same backoff a probe failure does.
- **Backoff ceiling 30 minutes** (was 6h), keeping the 60s initial delay and
  the doubling ladder. The failures this brakes are transient, so a half-hour
  ceiling recovers a self-healed harness within one window instead of hours.

User-visible lifecycle: the runtime status projection exposes the engine's live
phase (`idle`, `queued`, `running`, `backoff`), the last-success age, the
last-failure detail, and `next_attempt_at` while in backoff. The agent-auth
projection folds the same lifecycle into its facts, so a pane can render
Probing or a scheduled next attempt without a second mechanism.

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
[model_snapshot_sync.rs](../../anyharness/crates/proliferate-worker/src/model_snapshot_sync.rs)
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
   [cloud-launch-catalog.ts](../../apps/packages/product-client/src/lib/domain/agents/cloud-launch-catalog.ts)).
2. The first shipped-catalog model matching any candidate supplies display
   name, description, control wiring, and availability metadata.
3. No match means the model still renders — id-shaped label, sparse metadata
   — subject to the unknown-model visibility default below.

Identity and presence always come from the observation side; prose and
wiring always come from the catalog side. Defaults come from neither: the
shipped catalog's curated default, with a user-set default on top.

### Attribution

Every model row in a listing or popover carries an origin icon. The rule is
**never derived from the model's name or from the harness kind**; it is
derived from the auth selection for single-source harnesses and from the
observation for the multi-source one:

| Harness kind | Attribution source | Rendered as |
| --- | --- | --- |
| single-source (claude, codex, grok, cursor) | the enabled selection ([specs/FEATURE_DOCS/AGENT_AUTH.md](AGENT_AUTH.md)'s `SINGLE_SOURCE_HARNESSES`) | bedrock-typed entry → AWS logo on every row; azure-typed → Microsoft logo; `gateway` → Proliferate logo; native (no rows) → no icon |
| opencode | the observation's `provider` field, verbatim | that provider's logo, per row |

Rationale: a single-source harness's whole list is served by one source, so
the selection *is* the attribution and per-row inference would only add ways
to be wrong. Opencode's list is genuinely mixed, and the observation already
carries `provider` verbatim from the harness, which makes it the only honest
per-row answer.

The icon mapping is an explicit table with a **neutral fallback** for any
provider that has none. And the hard rule: **attribution never gates
anything** — an unknown provider, a missing logo, or an unmapped icon
renders neutrally and changes nothing about whether a model is selectable,
launchable, or visible.

### Status and refresh in settings

The per-harness settings pane's model section is specified in
[specs/FEATURE_DOCS/AGENT_AUTH.md](AGENT_AUTH.md)'s pane anatomy (§7); two properties belong to
this platform:

- **The probe status indicator is the same component as the auth status
  row** — probe status on the left, refresh on the right. Rationale: "when
  was this last checked, and can I check again" is one question, whether the
  subject is a credential or a model list, so it gets one control.
- **The list is auto-collapsed by default.** It is reference material, not
  the reason a user opened the pane.

### Probing during a degraded apply

An apply can land while gateway enrollment sync is incomplete, in which case
the renderer has dropped the gateway source (possibly leaving no sources at
all for that harness — [specs/FEATURE_DOCS/AGENT_AUTH.md](AGENT_AUTH.md)'s degraded-apply
section). The ruling: **the probe still runs**, its results are served
normally, and the surface shows a co-located *gateway setup in progress*
pending badge; the enrollment-sync completion trigger then re-applies and
the resulting ack fires a fresh probe.

Rationale: this platform's law is that the observation is what a session
would actually show, and during that window a session really would run
without the gateway. Recording it honestly and labelling the window beats
inventing a no-probe state for something that lasts seconds — and there is
no third option in which the picker shows models the harness did not
advertise.

### Launch validation

One typed refusal, kept for exactly one consumer: **saved intent**. A
requested model that resolves against the current observation (exact id,
then alias, then variant forms; seed pre-first-probe) launches. One that
does not is refused with `SESSION_MODEL_UNSUPPORTED` — protection against a
harness silently substituting its own default on an unattended run, which is
the one outcome worse than either refusal or loud in-session failure.
Catalog rows marked trial-verified stay launchable even when absent from the
observation — the pre-existing asymmetry in the safe direction, since the
shipped catalog carries trial-verified models a harness does not advertise.

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
test tree, per-context slots, and
`route_auth/probe_materialization/scoping.rs` with the attribution scrub
(`universe.rs` is not deleted but re-cut in place to the composed
`ObservedUniverse`) — the probe materializes the full composed profile through
the same
[probe_materialization.rs](../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/probe_materialization.rs)
seam (phase A shrinks to a state read; phase B and the scratch are
unchanged).

| Layer | Path | Owns |
| --- | --- | --- |
| Machine observation | `anyharness-lib/src/domains/agents/model_snapshot/` | Document, probe engine, events, status |
| Probe materialization | [route_auth/probe_materialization.rs](../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/probe_materialization.rs) | The composed launch world under a scratch root; the orphan sweep |
| Launch validation | [catalog/service.rs](../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/service.rs), [sessions/service/launch_options.rs](../../anyharness/crates/anyharness-lib/src/domains/sessions/service/launch_options.rs) | Observation-first resolution, the single typed refusal, picker projection |
| Gateway model plan | [catalog/gateway_plan.rs](../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/gateway_plan.rs) | The surviving `GET /v1/models` materialization fetch: memoized, seed floor warned, never observation truth |
| Cloud copy | `server/proliferate/server/cloud/agent_models/` | Layered reads, Worker ingest, overrides, soft-versioned history |
| Cloud sync | [proliferate-worker/src/model_snapshot_sync.rs](../../anyharness/crates/proliferate-worker/src/model_snapshot_sync.rs) | Heartbeat-tick upload of changed documents |
| Picker composition | [cloud-launch-catalog.ts](../../apps/packages/product-client/src/lib/domain/agents/cloud-launch-catalog.ts) and the chat/model domain | Merge precedence, identity normalization, visibility, badges |

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
(`agents/integration-rc1`), each struck by its follow-up PR:

- [ ] The picker does not project the machine observation yet: launch
      validation and the runtime's launch options gate against the observed
      universe, but the projected menu (`models`/`visible_models`) still
      reads the shipped catalog alone. Closing this is the
      [enrichment join](#enrichment-join); the pre-existing asymmetry is
      in the safe direction.
- [ ] The composer's provider badge still calls
      `getProviderDisplayName(harnessKind)` instead of applying
      [Attribution](#attribution)'s rule (selection-derived for
      single-source harnesses, the model's own plumbed-through `provider`
      field for opencode). The explicit icon table and its neutral fallback
      do not exist yet either.
- [ ] No settings surface renders the §7 model section as specified: the
      probe status indicator does not reuse the auth status-row component,
      and the list is not auto-collapsed.
- [ ] The degraded-apply pending badge does not exist. A probe that runs
      while gateway enrollment sync is incomplete serves its results with no
      indication that the observed world was missing the gateway source.
- [ ] The retained `inactive` cloud rows have no retention bound; the
      document owes a retention rule (keep N per scope, or an age bound) and
      the sweep that enforces it.
- [ ] The legacy gateway-models routes (`GET .../catalog/gateway-models`,
      `POST .../catalog/refresh-gateway`) still serve beside the snapshot
      surface. The All Models cutover has happened, so their only remaining
      consumers are release fixtures plus an orphaned frontend access
      client — deletion is now unblocked cleanup. The desktop mirror-sync
      hook (`useGatewayCatalogMirrorSync`) and its
      `gateway-catalog-mirror.ts` push are already gone — the route cutover
      on the integration branch deleted them.


## Gateway

Status: target. This document describes the accepted destination for the model gateway. The body is written in the ideal state. Every difference from `main` today is listed in [Current gaps](#current-gaps); the list shrinks as follow-up PRs land, and the label comes off when it is empty.

## Purpose

The model gateway gives harnesses access to a set of models whose inference
is paid for and controlled by whoever deploys Proliferate. It is a hosted
[LiteLLM Proxy](https://docs.litellm.ai/docs/simple_proxy) instance with a
custom model list. Proliferate's server is the gateway's control plane
(enrollment, keys, budgets, usage import) and is never in the inference
data path.

The gateway is one of the auth sources a user can select for a harness.
Which source a harness uses, `state.json` materialization, and fail-closed
launch behavior all belong to the agent-auth platform, not this document.

## The artifact

The gateway is defined by two files in `server/litellm/`:

- `config.yaml`: the model list, in LiteLLM's
  [proxy config format](https://docs.litellm.ai/docs/proxy/configs)
  (`model_list` entries with `model_name`, `litellm_params`, and
  `os.environ/<VAR>` key references). The single source of truth for which
  models exist, which upstream provider serves each, and which access
  groups each belongs to. Dev and prod both run this exact file.
- `Dockerfile`: layers `config.yaml` onto the pinned upstream LiteLLM
  image for deployed environments.

Config laws, enforced by review (the file's comments restate them):

- The model list is explicit. Unknown model names return 400 from the
  proxy, so every name a harness may pin (including dated ids like
  `claude-sonnet-4-5-20250929`) needs its own `model_name` entry.
- Aliases stay within one provider. A `model_name` may re-point to a
  cheaper or newer upstream id only when the same provider serves both; a
  cross-provider alias silently swaps the model a harness thinks it is
  talking to.
- Upstream ids are verified against the pinned LiteLLM version's model
  manifest, never invented. The manifest also prices spend for usage
  import; an unknown id can pass traffic while mispricing it.
- Every entry carries `model_info: {access_groups: [...]}` naming the
  harness group(s) it belongs to. Group names are exactly the harness
  `harness_kind` identifiers of the gateway-capable harnesses (`claude`,
  `codex`, `opencode`, `grok`) — no translation table; see LiteLLM's
  [model access groups](https://docs.litellm.ai/docs/proxy/model_access_groups).
  This one reviewed file is therefore also the harness-to-model map; no
  client-side model filtering exists anywhere. `cursor` is deliberately
  absent from the vocabulary: it is native-only (no gateway recipe exists
  for it), so no model belongs to a `cursor` group and no `cursor` virtual
  key is ever minted.
- No dev shims. Because dev and prod run this exact file, any local
  convenience placed in it ships to production verbatim. Two shims are
  banned by name:
  - [`mock_response`](https://docs.litellm.ai/docs/completion/mock_requests):
    a LiteLLM per-model setting (`litellm_params: {mock_response: "..."}`)
    that makes the proxy return that hardcoded string as the completion
    without calling any provider. Useful locally to test wiring with no
    API key; in production it would silently serve fake completions while
    everything looks healthy.
  - Cross-provider test aliases: pointing one provider's `model_name` at
    another provider's upstream so a harness "works" in dev without that
    provider's key. This happened: before PR #906, `grok-4` resolved to an
    Anthropic Haiku model because dev had no xAI key, so a user selecting
    grok was actually talking to Claude.
  If a dev setup needs either, it goes in a docker-compose override file
  that only dev loads (a second `-f` compose file replacing the mounted
  config); none is checked in today.

## Deployment

The same two files are consumed differently locally and deployed. The
asymmetry is intentional:

| | Local (`make server-litellm-up`) | Deployed (ECS) |
| --- | --- | --- |
| Image | Upstream `ghcr.io/berriai/litellm` as-is | Our image (upstream plus `COPY config.yaml`), built by `_deploy-litellm.yml`, pushed to ECR `proliferate-litellm` |
| Config | Bind-mounted read-only from the checkout: edit, restart, no build | Baked into the image, so the ECR digest is the reviewed config and rollback is the previous image |
| Secrets | Shell env via docker-compose passthrough | GitHub environment secrets to SSM SecureStrings to task-definition `valueFrom` (see below) |
| Database | `litellm-db` compose sidecar (postgres, local volume) | External database via `LITELLM_DATABASE_URL`, never part of any image |
| Updates | On file save | `deploy-staging.yml` change-detects `server/litellm/**`; prod follows the normal promote flow |

### Image pin

The upstream image is pinned as `vX.Y.Z@sha256:...`. The digest makes
builds reproducible (tags can be re-pointed), and the tag keeps the
reviewed version visible. `scripts/ci-cd/litellm-image-pin.test.mjs`
asserts the Dockerfile and `server/docker-compose.yml` carry the identical
pin and fails any bump that skips review. Bumping the pin is the
highest-risk gateway change, since it swaps the code serving all inference
and the pricing manifest; the procedure is in
[gateway-models.md](../../guides/operating/gateway-models.md).

### Secrets

The deploy workflow is the only writer. Nothing is ever set by hand on ECS
or SSM. Source of truth is the GitHub environment secret
(`AGENT_GATEWAY_MANAGED_<PROVIDER>_API_KEY`, `LITELLM_MASTER_KEY`,
`LITELLM_DATABASE_URL`). Every deploy re-pushes all of them to SSM under
`/proliferate/{env}/litellm/*` and re-renders the task definition, so a
hand-edit survives only until the next deploy and then silently reverts.
Rotation is therefore "update the GitHub secret, rerun the deploy" and
nothing else. The `MANAGED` prefix distinguishes our inference-spend keys
from users' BYOK keys (agent-auth's vault). Bedrock is the exception: no
key in cloud (the ECS task role carries
`proliferate-gateway-bedrock-invoke`), optional `GATEWAY_AWS_*` env vars
locally.

### Database

The proxy's Postgres holds its state: virtual keys, teams, budgets, spend
logs. It is why key issuance survives restarts and why the proxy is not a
freely-recreatable stateless container.

## Account model

**Orgs are the only billing subject.** There is no personal subject and no
self-pay/company-pay split: a "personal org" is simply the default org
created at signup that nobody else has joined, and it bills like any other
org. One law downstream of that: the whole account shape has exactly one
form.

One LiteLLM [team](https://docs.litellm.ai/docs/proxy/users) per org
(`org-<uuid>`) — the org's wallet; the budget lives on the team and mirrors
the org's remaining credit. One LiteLLM user per **(org, member)**
(`org-<org>-user-<uuid>`) — never one global user spanning orgs, so any
user-scoped LiteLLM control is org-scoped by construction. Under each
member's LiteLLM user, one
[virtual key](https://docs.litellm.ai/docs/proxy/virtual_keys) per
(member, gateway-capable harness), each granted its harness's access group
by name (`{"models": ["claude"]}` at `/key/generate`). The key is the whole
differentiator: one deployment, one public URL, and what a key can see and
invoke is determined proxy-side by its group grant and team budget.

- `GET /v1/models` with a harness key returns only that harness's models,
  so discovery-based CLIs (grok) see the right list with no client logic.
- Invoking an out-of-group model returns 403 `key_model_access_denied`.
- Spend from every key in the team aggregates against the team budget.
- Per-member, per-harness spend attribution falls out of per-key spend rows
  for free; charts read our imported ledger, never the proxy.
- Per-member caps, when wanted, are one call per member — either a LiteLLM
  team-member budget or a budget on the member's per-org LiteLLM user (the
  two are equivalent now that users never span orgs). The forbidden shape
  is a budget on any identity that spans teams. LiteLLM's organizations
  entity above teams is enterprise-licensed and not assumed here.

**Which org pays (v1): the user's default org, always.** Sessions resolve
the default org's enrollment; there is no per-workspace payer resolution
and no funded-org fallback logic. Billing a session to the org that owns
its workspace is the parked end state (it requires the delivered
`state.json` to carry per-org key material — an agent-auth contract change
— and is deferred with it).

**An unfunded org fails closed.** An org with no credit grant and no
explicitly configured budget gets no gateway: the state renderer withholds
key material and launches refuse with a typed error. No "no ledger means
unlimited" branch, and never a literal `0` budget handed to LiteLLM (which
reads 0 as *uncapped*). This is safe because every default org is funded by
the signup grant; a genuinely unfunded org is an honest "billing not set
up" state, not a trap.

### Billing integration

The gateway does not meter spend; the billing platform's LLM credit ledger
does ([specs/FEATURE_DOCS/BILLING.md](BILLING.md) owns grants and Stripe). The invariant
behind the division of labor: the ledger is the meter, the LiteLLM budget
is a mirror, and disabling the virtual key is the enforcement act.

Each LiteLLM layer owns exactly one concern, and money never attaches to
keys:

| LiteLLM entity | Maps to | Owns |
| --- | --- | --- |
| team | the org | money: pooled budget mirror, overage-uncapped mode, reactivation |
| user | (org, member) | identity + optional per-member caps, org-scoped by construction |
| key | (org, member, harness) | access: group grant and spend attribution; never a budget |

Two consequences billing can rely on:

- The gateway's primitives to billing are org-level: enroll, set budget,
  disable, reactivate — each fanning out to the org's N member keys
  internally. Billing code never counts keys, so key granularity can
  change without touching billing.
- Credit grants are the only funding interface: the free signup grant
  (landing on the human's default org, deduped per GitHub identity — one
  grant per human, and creating orgs mints nothing), top-up grants, and
  seat-minted grants (paid seats → grants, `source='seat'`, idempotent by
  `source_ref`; the seat→grant wiring itself belongs to billing's separate
  pass — this platform only consumes the resulting ledger rows). A joining
  member never brings their free grant into an org; it stays on their
  default org forever, which is what keeps invite-farming worthless.

- The credit ledger on the org's billing subject is authoritative: grants
  (free credits, seats, top-ups) minus imported spend debits.
- The usage importer pages the proxy's `/spend/logs`, resolves each row's
  virtual key back to an enrollment and billing subject, and writes
  deduped debit rows. After importing it reconciles every affected
  subject: at zero remaining credit it disables the subject's virtual
  keys and marks the enrollment exhausted, so gateway launches fail
  closed. Re-enabling happens the same way in reverse when credit
  returns.
- The LiteLLM team budget mirrors the ledger; it is a backstop against
  importer lag, not the meter. Funded orgs get their remaining credit as
  the team budget, floored at a small positive value when exhausted
  (LiteLLM reads a budget of 0 as uncapped). An org with no grants and no
  explicitly configured budget is not mirrored at a default — it is
  unfunded, and unfunded fails closed (no key material, typed launch
  refusal).
- Overage-enabled subjects get no proxy budget at all: the proxy is
  uncapped for them, and the guardrail is the ledger plus the top-up
  loop. When such a subject drops below the top-up threshold, a Stripe
  charge lands as a new credit grant and reactivates the enrollment
  (keys unblocked, budgets raised).

Enrollment is the idempotent provisioning of this shape for one
(org, member): ensure the org team (with budget), the member's per-org
LiteLLM user, and the member's per-harness keys; encrypt the raw keys
(Fernet) on enrollment rows; track a sync status whose fingerprint covers
the expected key-set shape, so adding a gateway-capable harness (or
changing the identity scheme) flips enrollments to `pending` and the next
pass re-mints. Virtual keys have no user-facing CRUD anywhere; they exist
only through enrollment and surface only inside rendered `state.json`.
Free-credit grants run before sync so the LiteLLM budget mirrors the
resulting balance.

## Control plane vs data plane

Two base URLs in server config, one per plane:

- `agent_gateway_litellm_base_url`: private control-plane address. Only our
  server calls it, only with the master key, to mint and rotate keys,
  update team budgets, and import spend.
- `agent_gateway_litellm_public_base_url`: data-plane address handed to
  harnesses via `state.json`. A harness in a sandbox calls it directly with
  its virtual key; the proxy checks key, group, and team budget, then
  forwards upstream with our provider key. No inference byte touches
  `api.proliferate.com`.

```text
control plane (session setup):   server ──master key──► LiteLLM admin API
data plane (every request):      harness ──virtual key──► LiteLLM ──► provider
```

## API surface

`/v1/cloud/agent-gateway/` owns exactly the gateway-account relationship:

- `GET /enrollment`: the subject's provisioning state (team, keys, sync
  status).
- `GET /capabilities`: deployment-level discovery. `gateway_enabled`
  (self-hosts may run no gateway), `public_base_url`, and enrollment
  status; the settings UI reads this to decide whether to offer the
  gateway as an auth option.

Nothing else. BYOK key vault, auth selections, `state.json`, and org policy
are `/v1/cloud/agent-auth/` (agent-auth platform); per-user probed model
snapshots are the model-catalog platform. Renames are hard cutovers with no
alias windows: all consumers are first-party (pre-launch ruling).

## Code map

| Layer | Path | Owns |
| --- | --- | --- |
| Artifact | `server/litellm/` | config.yaml + Dockerfile; what the proxy serves |
| Integration client | `server/proliferate/integrations/litellm/` | Raw HTTP client for the proxy admin API (keys, teams, spend). The only code that talks to the proxy. |
| Gateway account | `server/proliferate/server/cloud/agent_gateway/` | Enrollment, budgets, top-ups, free credits, usage import, signup hook. The account subset only: auth selections and model snapshots belong to their own platforms. |

Deploy pipeline: `.github/workflows/_deploy-litellm.yml` (build, secret
push, task-def render), gated per environment by `deploy-staging.yml`
change detection and the promote flow.

## Failure modes

- Out-of-group model: 403 `key_model_access_denied` from the proxy.
- Unknown model name: 400 from the proxy (explicit-list law).
- Exhausted team budget: the proxy rejects. The subject's remaining-credit
  mirror floors at a near-zero cap rather than 0, which LiteLLM would read
  as uncapped.
- Enrollment sync failure: the enrollment row carries the error state. Key
  minting is idempotent per deterministic alias; orphaned keys from a
  crash are purged and re-minted.
- Gateway not deployed (`gateway_enabled` false): the gateway auth option
  is not offered and nothing fails at session start.

## Proof

- `scripts/ci-cd/litellm-image-pin.test.mjs`: pin consistency (CI).
- Gateway smoke (`scripts/agent-gateway-smoke/`): end-to-end reachability
  per harness.
- Scoped-key verification: mint a key granted one group, assert
  `GET /v1/models` returns exactly that group and an out-of-group invoke
  403s. Verified live against the pinned image (v1.93.0, 2026-07-24).
- Team-budget aggregation: spend from every key in a team aggregates against
  that team's budget (the mechanism the whole per-harness-key account model
  depends on) — confirmed standard LiteLLM behavior, live-verified against
  the pinned image (v1.93.0, 2026-07-25) ahead of B2's per-(subject,harness)
  minting.

Org-only account model (named, binary assertions; the unification corridor
is done when they are green — IDs are stable, tests reference them by name):

- **D1** Signup produces: team `org-<id>`, LiteLLM user
  `org-<org>-user-<id>`, one key per gateway-capable harness (cursor
  absent), and the free grant on the default org's billing subject.
  (enrollment pytest)
- **D2** A second account on the same GitHub identity gets no grant, and
  creating additional orgs mints nothing. (free-credits pytest)
- **D3** An unfunded org: the renderer withholds key material, launches
  refuse with the typed error, and LiteLLM never receives a literal `0`
  budget. This assertion *replaces* the "no grant means unlimited" tests,
  which must be deleted, not kept green. (budget + renderer pytest)
- **D4** Spend through a member's harness key lands in the imported ledger
  attributed to (user, org, harness, model), and the team aggregate equals
  the sum across member keys — live-verified against the staging proxy.
  (usage-import pytest + live run)
- **D5** Spend-to-zero disables keys and withholds material → typed
  refusal; a top-up grant reactivates → launch succeeds. (release
  scenarios, rewired to org subjects)
- **D6** The migration re-parents a personal enrollment onto the default
  org, re-mints keys under the per-org LiteLLM user, revokes the old keys,
  is idempotent on re-run, and a session launched after it works.
  (migration pytest + intent test)
- **D7** Adding a gateway-capable harness kind flips enrollments to
  `pending` and the next pass mints exactly the missing key. (enrollment
  fingerprint pytest)
- **D8** `get_gateway_enrollment_for_user` resolves the default org
  unconditionally; the funding guard and the name-ordered org choice are
  gone from the codebase (grep-gated). (budget pytest + grep gate)

## Current gaps

Deltas between this document and `main`, each struck by its follow-up PR:

- [ ] The Rust `provider_for_model` prefix-matcher is a provisional stand-in
      for provider-tagged catalog model entries; it now only labels enriched
      gateway-model / launch-option rows for the UI (the client-side
      `gatewayPolicy.providers` filter it used to back is gone — B5 — now
      that LiteLLM access-group tags enforce harness-to-model scoping
      server-side).
- [ ] `api.py`/`service.py`/`models.py` still share one `agent_gateway`
      package across the gateway-account and agent-auth domains (S1 split
      only the URL prefixes: BYOK vault, selections, state, and org policy
      now answer under `/v1/cloud/agent-auth/`, while this document's
      `/v1/cloud/agent-gateway/` narrowed to enrollment + capabilities as
      specified); the matching Python module split is still pending. Catalog
      routes already live in their own `agent_models` module
      (see Catalog section's §Cloud routes above).
- [ ] No product-server route emits `agent_gateway_credits_exhausted`
      ([budget.py](../../server/proliferate/server/cloud/agent_gateway/budget.py)).
      Exhaustion is enforced — the usage importer disables the LiteLLM virtual
      keys, and the agent-auth state render withholds key material so the
      runtime fails closed at launch — but neither wall answers a request with
      that code, so a client cannot distinguish "exhausted" from a generic
      gateway failure on the product surface. The release scenarios still
      classify the string off the proxy response
      (`managed-cloud-fixture-smoke-1.ts`, `t3-bill-4.ts`). The code's only
      product-server producer was the server-side catalog prober, which the
      model-catalog re-key deleted.
