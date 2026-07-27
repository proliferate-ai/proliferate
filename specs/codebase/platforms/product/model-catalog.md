# Model Catalog

Status: target. The body is written in the ideal state. Every difference from
`main` today is listed in [Current gaps](#current-gaps); the list shrinks as
follow-up PRs land, and the label comes off when it is empty.

This document replaces the earlier "Model Catalog And Dynamic Registries"
plan, which prescribed a `model_registry/` implementation that was never
deployed (and whose partial predecessor was deleted in the catalog v2
cutover).

## Purpose

The model catalog answers one question for every surface: which models and
modes can this harness run, right now, under this auth source. Pickers,
launch validation, automations, and workflow definitions all consume the
answer.

The design principle is probe-first: the primary truth is what a harness
was actually observed to advertise, on a specific machine, under a specific
auth context, at a known time. Shipped lists exist to fill absence before
the first observation, never to override one.

Boundaries: which auth source a harness uses, and what happens to running
sessions when it changes, belong to agent-auth. Harness install and the
shipped catalog document belong to
[agent-distribution.md](agent-distribution.md). Which models the gateway
serves belongs to the [model gateway](model-gateway.md); this platform
observes that list through the harness, it does not define it.

## Truth tiers

Three tiers, one law: fresher and more specific wins; a lower tier fills
absence and never overrides an observation from a higher one.

1. **Machine snapshot.** What this machine's harness advertised under the
   active auth context, with the timestamp and harness version it was
   observed on. The truth for the picker and for launch validation wherever
   a runtime is attached.
2. **Cloud snapshot.** The cloud sandbox's most recent machine snapshot,
   synced up by the Worker per user. Serves every surface with no runtime
   attached: web new-chat against a cold sandbox, mobile, automations,
   workflow definition editors — all of which pick models for cloud
   execution, which is why only the cloud sandbox's document syncs (the
   desktop's never does). It is the same observation at rest, one hop
   staler.
3. **Shipped catalog models.** The nightly central probe's output inside
   `catalog.json`. Two jobs only: the cold-start seed a picker shows before
   any observation exists for that (harness, auth context), and a reviewed
   regression surface (a model vanishing from the nightly diff is a signal
   a human sees). It never overrides tiers 1 or 2.

The tiers cover model and mode lists. They deliberately do not cover
control wiring or curation: how a control is set (`switchVia`,
`variantSyntax`, create-field mappings) and which mode is safe unattended
are engineering and product knowledge a probe cannot invent, so the shipped
catalog stays authoritative for them and the probe merely confirms them.
Default model choices per (harness, auth context) are likewise curated in
the catalog; the probe's observed defaults inform the curator, never the
user.

## The machine snapshot document

### Location

One document per harness, `model-snapshot.json`, in the harness's managed
directory — next to the install manifest whose version it attests against.
The runtime home already holds one machine-truth document per question, and
the snapshot completes the family:

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
└── db.sqlite                               # sessions store (and, today, the
                                            #   gateway_model_probe table this replaces)
```

### Wire schema

The document is camelCase like its sibling `install-manifest.json` (not
snake_case like `state.json`), written atomically (tmp + rename) by the
same convention as the manifest. Entries are keyed by **catalog
auth-context id** — the exact strings the catalog already declares and
`ActiveAuthContexts` already carries (`anthropic-api`, `anthropic-oauth`,
`bedrock`, `gateway`, `baseline`), never a new vocabulary:

```json
{
  "schemaVersion": 1,
  "agent": "opencode",
  "entries": {
    "anthropic-api": {
      "probedAt": "2026-07-24T09:12:03Z",
      "mechanism": "acp",
      "attestation": { "name": "opencode", "version": "0.3.112" },
      "installIdentity": {
        "role": "agent_process",
        "version": "1.18.3",
        "sha256": "9b4f9f1b1c00…",
        "source": "pinned_archive"
      },
      "authFingerprint": "sha256:9f2c…",
      "models": [
        {
          "id": "anthropic/claude-fable-5",
          "provider": "anthropic",
          "name": "Claude Fable 5",
          "configOptions": null
        }
      ],
      "modes": [ { "id": "build", "name": "Build" } ],
      "observedDefaults": { "modelId": "anthropic/claude-fable-5", "modeId": "build" },
      "warnings": [],
      "lastAttempt": { "at": "2026-07-24T09:12:03Z", "outcome": "ok", "detail": null }
    },
    "gateway": {
      "probedAt": "2026-07-24T09:12:07Z",
      "mechanism": "acp",
      "attestation": { "name": "opencode", "version": "0.3.112" },
      "authFingerprint": "sha256:41ab…",
      "models": [ { "id": "proliferate/claude-fable-5", "provider": "proliferate" } ],
      "modes": [ { "id": "build", "name": "Build" } ],
      "observedDefaults": { "modelId": "proliferate/claude-fable-5", "modeId": "build" },
      "warnings": [],
      "lastAttempt": { "at": "2026-07-24T09:12:07Z", "outcome": "ok", "detail": null }
    }
  }
}
```

Field contract per entry:

| Field | Meaning |
| --- | --- |
| `probedAt` | Timestamp of the last **successful** observation; the lists below are from this run |
| `mechanism` | `acp`; present so a future cheaper mechanism can coexist, but every context today probes over ACP |
| `attestation` | The ACP `initialize` `agent_info` (`name`, `version`) — diagnostics about the binary that answered, never a staleness input (see [Staleness](#staleness)) |
| `installIdentity` | The install manifest's `agent_process` artifact (`version`, `sha256`, `source`) read at probe time — the staleness baseline. Absent when the manifest carried none |
| `authFingerprint` | Digest of the credential material the context resolved to at probe time (env values, discovery-file digests, or the gateway key), computed from the same launch facts the auth classifier reads |
| `models` | Observed models; `provider` preserved verbatim when the harness namespaces (`provider/model`), derived from the serving context otherwise |
| `modes` | Observed modes |
| `observedDefaults` | What the harness itself selected at probe time — curator input only, never served to users |
| `warnings` | Probe warnings, carried for diagnostics |
| `lastAttempt` | The most recent attempt of any outcome; a failed refresh updates this and nothing else |

A failed refresh therefore never destroys truth: the last good lists keep
serving, with `lastAttempt.outcome = "failed"` rendering as a
failed-refresh indicator next to the `probedAt` age.

The entry is a persistence of what the probe already returns
(`ProbeSnapshot` in
[live/sessions/probe.rs](../../../../anyharness/crates/anyharness-lib/src/live/sessions/probe.rs):
attestation, models, modes,
current selections, warnings), not a new observation format. The document
holds only the current entry per context; it stores no history and no
diffs. History lives server-side (below), and any "what changed" view is
computed at read time by comparing two snapshots — never stored.

### Probe mechanics

One mechanic, every context: spawn the harness over ACP in a throwaway
workspace with that context's materialized auth, read `initialize` + the
advertised models and modes, tear down. This is `probe_agent()`
([live/sessions/probe.rs](../../../../anyharness/crates/anyharness-lib/src/live/sessions/probe.rs))
— the same
code the central catalog pipeline runs — invoked locally by the runtime
instead of only by the `catalog-probe` CLI.

The gateway context is deliberately not special-cased. Probing it means
materializing the gateway route exactly as a launch would (base URL +
virtual key into the harness's isolated auth home) and spawning; what
comes back is what a gateway session would actually see — models under
the harness's own namespacing (opencode's `proliferate/...`), the mode
set, and the version attestation, all in one observation shape. This
uniformity is the point: a bare `GET /v1/models` against the proxy
answers what the proxy serves, not what the harness will offer once
configured against it, and it observes no modes at all — a second
observation format and a modes special case for one context.

There is one prerequisite fetch that survives, and it is materialization,
not observation: harnesses whose gateway config enumerates models
explicitly (opencode's provider models map) need the proxy's list to
*write that config* before any spawn. That fetch belongs to agent-auth's
route materialization (the `GatewayModelPlan` seam), runs against the
same `GET /v1/models`, and never writes the snapshot — the probe then
observes the configured harness like any other context. (Today's
[gateway_probe.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/gateway_probe.rs)/`gateway_model_probe`
sqlite chain, which served this
fetch's results directly to pickers, is still replaced by the document;
the seam keeps only its materialization job.)

Modes stay the harness's own story regardless of context: they are baked
into the binary, so every context's entry for the same attested version
reports the same set, and any fresh entry can fill a stale one's modes.
Mode wiring (`createField`, `liveConfigId`) stays catalog-authoritative
per the [truth tiers](#truth-tiers); the snapshot only confirms which
mode ids exist.

`baseline` is a context like any other: probing it (a spawn with no
credentials materialized) is how a harness's free and built-in models are
observed. And machine-side probing covers the one harness the central
pipeline never can: cursor is login-only and excluded from the scheduled
probe environment, so its shipped entry is always second-hand — but the
machine has the login, so its snapshot is first-hand. Cursor goes from
the worst-covered harness to the best-covered one.

### Staleness

Three reasons invalidate an entry, and nothing else does. Two are identity
reasons — the machine moved out from under the observation — and the third
is a bounded time budget for the changes no identity can see:

1. **Harness moved**: the entry's recorded `installIdentity` differs from
   the install manifest's `agent_process` artifact read now. The
   comparison is **manifest against manifest**, in one namespace by
   construction: equal iff `sha256` matches when both sides carry one,
   else iff `version` matches when both sides carry one. `sha256` is the
   stronger signal and is preferred because it moves even when a version
   string is reused (a `latest` republish, a re-pinned git sha).
2. **Auth moved**: `authFingerprint` differs from the current fingerprint
   of that context's credential material (for the gateway context: the
   virtual key and base URL).
3. **TTL expired**: `probedAt` is older than this entry's TTL — 24h plus a
   deterministic per-entry offset derived from `(harness, context)`,
   spreading a machine's entries across a 6h window so they never
   co-expire into one thundering herd at boot.

**Why the ACP attestation is not the identity.** The attestation
(`agent_info.version`) and the install manifest are different namespaces:
claude's manifest records the registry's pinned git sha while its
attestation reports its own semantic version, and cursor and grok report
no `agent_info` at all. Comparing across them makes every such entry
permanently stale — a probe storm on every startup, every launch and every
auth apply that backoff cannot damp, because those probes *succeed*. The
attestation is kept as diagnostics about the binary that answered; the
staleness baseline is the manifest-derived `installIdentity`.

**An unobservable identity is never a staleness reason.** When either side
of the comparison is absent — no manifest, no `agent_process` version (a
`source: "path"` dev install records none), or an entry written before the
field existed — the identity comparison is **indeterminate**, which is not
stale. Only reasons 2 and 3, or a missing entry, can then invalidate it. A
surface must not claim a version binding for an indeterminate entry.

**Why a TTL at all, given the identity rules.** Two changes are invisible
to every identity: the gateway adding or removing a model (the virtual key
and base URL are unchanged, so `authFingerprint` does not move) and a
keychain-backed context rotating its credential (no file and no env value
to fingerprint, so its fingerprint is constant by construction). Without a
time bound those entries are pinned for the life of the credential. Age
still never blocks a launch and never deletes truth: a TTL-expired entry
keeps serving its last good lists while the reconciler re-probes.

Staleness is deliberately scoped per (harness, context) via the
fingerprint rather than keyed on `state.json`'s global `revision` — the
revision bumps on *any* harness's auth mutation, so keying on it (as
today's `gateway_model_probe` table does,
[persistence/sql/0051_gateway_model_probe.sql](../../../../anyharness/crates/anyharness-lib/src/persistence/sql/0051_gateway_model_probe.sql))
invalidates every harness's observation whenever one harness's key
changes. The fingerprint makes invalidation exactly as wide as the change.

Precedence is identity before time, so the surface names the real cause.
And independently of every rule above, an attempt that completed inside
the last minute is never retried: the reconciler holds a 60-second
completed-attempt floor per (harness, context) so a mis-stated rule can
cost at most one probe per minute rather than one per poke.

A stale entry is not deleted: it renders as "needs refresh" until the
reconciler re-probes it, and launch validation stops trusting it (falling
back to the shipped catalog) until a fresh entry lands. An in-flight
probe never gates anything: launching during the re-probe window
validates against the fallback, so switching auth or updating a harness
never locks the user out of starting a session while the probe catches
up.

### The snapshot reconciler

Probing is a convergence primitive, wired the same way installs converge:
one reconciler, many pokes. The reconciler's rule is pure: for every
(installed harness, active auth context), if the document has no fresh
entry — missing, or stale by the rules above — probe it in the background
and write the entry. Fresh entries are never re-probed; running it twice
does nothing twice.

Pokes are a closed set, and every one is fire-and-forget — no poke ever
blocks the operation that raised it:

- **Runtime startup**: the startup pass that already reconciles installs
  (`spawn_startup_pass` in
  [domains/agents/runtime.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/runtime.rs):
  hydrate seed, reconcile installs) gains a third
  step — reconcile snapshots. This single poke covers a fresh cloud
  sandbox probing itself at creation (the template bakes installs, but a
  snapshot cannot be baked: it needs the user's auth, which lands only
  after boot) and a desktop whose app update staled entries. No
  first-boot detection exists or is needed; a machine with fresh entries
  no-ops.
- **Install completed**: both places an install finishes — the per-agent
  completion point inside the reconcile job, and the synchronous install
  endpoint — poke the reconciler for that harness. Onboarding's "checking
  for latest models" is this poke rendered, not a separate trigger: by
  the time onboarding has installed a harness and configured an auth
  source, the pokes have already fired, and the step surfaces their
  progress.
- **Auth applied**: the `state.json` apply handler already schedules
  fire-and-forget gateway probes on success
  (`schedule_gateway_probes` in
  [api/http/agent_auth.rs](../../../../anyharness/crates/anyharness-lib/src/api/http/agent_auth.rs));
  that call is
  replaced by a poke covering every harness whose context fingerprint
  the apply changed. The apply response never waits for a probe. The
  picker shows a re-probing state rather than stale data presented as
  current; you switch now, the probe catches up.
- **Session launch** (backstop): starting a session pokes the reconciler
  for that harness, adopted from today's launch-time gateway probe
  (`schedule_launch_probe_if_stale` in
  [catalog/gateway_resolver.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/gateway_resolver.rs),
  explicitly "never blocks this
  launch"). Any probe a machine missed gets self-healed at the next
  launch; the launch itself validates against whatever is fresh now.
- **Manual refresh**: the settings surface forces a re-probe per harness,
  with "refreshed N minutes ago", "needs refresh", and "refreshing"
  states read straight off `probedAt`, the staleness rules, and
  `lastAttempt`.

Pickers never poke; opening a menu reads the document as it is.

Probe status reaches clients the way install status already does: as
polled state, not push events. `GET /v1/agents/{kind}/model-snapshot`
answers per (harness, context) with the document's
`probedAt`/`lastAttempt`, a server-computed `snapshotAgeSeconds`, the
`stale`/`staleReason` verdict, whether the identity comparison was
determinate, and the engine's live `state` (`idle` | `queued` | `running` |
`backoff` — `queued` is a probe admitted to its slot but still waiting on
the per-harness gate or the machine-wide semaphore, which at a cap of one
is the common case and must not read as `idle`); surfaces poll and render
it exactly as they poll the reconcile job snapshot today. The credential-derived `authFingerprint` is never on
the wire — the boolean `stale` plus its reason is the whole client
contract.

Runner constraints, enforced by the probe code itself and stated here so
the wiring does not rediscover them: `probe_agent` requires the install
to exist (install-before-probe is checked, not conventional), must run
inside a tokio `LocalSet` (the ACP connection uses `spawn_local`; a bare
`tokio::spawn` will not do), and carries no overall timeout of its own —
the reconciler bounds each probe, on the probe's own thread so a
cancelled or timed-out attempt kills its child rather than leaking it.
Probes for one harness run serially; the reconciler stays off the install
reconcile's single job slot so a slow probe never delays an install.
Concurrent pokes for one (harness, context) coalesce onto a single spawn:
losers re-check the staleness gate after queueing and observe the
winner's entry.

**Probing materializes into a probe-owned scratch root**, a sibling of
`agent-auth/` under the runtime home, never into the live auth homes: the
recipes are byte-identical to a launch with exactly one substitution, the
materialization root. That keeps a probe out of the launch GC's blast
radius, keeps it from writing into the config dir a running session is
reading, and makes "time on disk" equal one probe attempt — the scratch
is owned by the probe's thread and removed on every exit path. Deciding
whether to probe writes nothing at all: the staleness gate reads state and
stats discovery files, and only an actual probe materializes credentials.

**One probe engine per runtime home.** The engine holds an advisory
exclusive lock on the runtime home; a second runtime sharing that home
(a dev sidecar beside the desktop) degrades to read-only — it serves the
document and the status surface, and it neither probes nor sweeps
abandoned scratch roots. Probing is convergence, not correctness: the
read-only runtime loses nothing a later poke on the owner cannot restore,
whereas two probe engines against one home is the unsound configuration.
The status surface reports which mode it is in, and a forced refresh on a
non-owner is refused rather than silently ignored.

**Cursor is manual-refresh only.** Its credential lives in the macOS
keychain, so an unattended spawn can surface an OS keychain prompt with no
user-visible cause. Every other harness's active contexts are probed
under the pokes below; cursor's entry is written only when a user asks for
it. (Cursor is also an attestation-less harness, so its entry is never
identity-stale — auth changes and the TTL are its refresh paths.)

The same reconciler runs everywhere. A cloud sandbox's runtime probes
under the same pokes and writes the same document; the Worker syncs that
one up as the cloud snapshot, while the desktop's document stays local
(nothing consumes it remotely — see [The cloud snapshot](#the-cloud-snapshot)).
Local and cloud differ only in whether the document additionally syncs
and in which surface renders the status, never in probe or storage logic.

## The cloud snapshot

The law first: **AnyHarness stores, never syncs.** The machine document
always and only lives in the runtime home
(`agents/<kind>/model-snapshot.json`); the runtime probes it and writes it
and does nothing else. The cloud snapshot is not a second store — it is
the cloud sandbox's document made readable while the sandbox sleeps, with
no writer except upload, no server-generated content, and no authority
over a reachable runtime: if the cloud row and a live runtime disagree,
the runtime is right by definition.

Only the **cloud sandbox's** document syncs up. The desktop's
local-surface document never does: every machineless consumer (web
new-chat, mobile, automations, workflow editors) is picking models for
cloud execution, so the cloud sandbox's observation is the one they need,
and the desktop's own picker always has its runtime attached and reads
the document live. A desktop snapshot at rest would be machinery without
a reader.

### Storage

The server stores cloud-sandbox snapshots in `agent_model_snapshot`,
which is today's `agent_catalog_snapshot`
([db/models/cloud/agent_gateway.py](../../../../server/proliferate/db/models/cloud/agent_gateway.py))
re-keyed from coarse route to auth
context:

```
agent_model_snapshot
  id               UUID pk
  harness_kind     String(64)
  auth_context_id  String(64)   -- catalog auth-context id ('anthropic-api', 'gateway', …)
  owner_user_id    UUID          -- machine observations always have an owner
  snapshot_json    Text          -- one machine-document entry, verbatim wire shape
  probed_at        timestamptz
  status           'active' | 'inactive'
```

There is no `surface` column: only the cloud surface ever syncs, so every
row is the owner's cloud sandbox observation. (Today's table carries
`surface`; it drops in the re-key migration.)

Every row is a machine's observation — there is no `source` column and no
ownerless seed row, because the server never generates snapshots. The
seed tier needs no rows at all: the layered read falls back to the
shipped catalog document the server already serves
(`GET /v1/catalogs/agents`), so "seed" is a read-time join, not stored
state with a writer to maintain.

The soft-versioning discipline is kept as-is: no unique key on the scope;
a write deactivates all prior `active` rows for
(harness_kind, auth_context_id, owner_user_id) and inserts the
new row as `active`; reads take the latest active row. The retained
inactive rows are the audit trail — they are what makes "what changed
between refreshes" answerable without storing diffs.

`snapshot_json` carries one machine-document entry verbatim (models,
modes, attestation, warnings), replacing today's models-only payload, so
the cloud tier serves exactly what the machine tier observed.

The override table (`agent_catalog_override`, same
[models file](../../../../server/proliferate/db/models/cloud/agent_gateway.py))
is already correctly shaped
and keeps its contract unchanged: one row per (user, harness) or
(org, harness), holding a `patch_json` of optional `remove` (model ids),
`update` (id → partial entry), and `add` (entries), applied in that order
on every layered read.

### Write paths

Today's three write paths collapse to one:

- **Worker upload**: the cloud sandbox's runtime probed and its document
  changed; the Worker pushes the changed entry. This absorbs today's
  separate `refresh`-with-payload and `mirror` routes, which were two
  names for the same write.

Today's third path — the server running gateway discovery itself
(enrollment lookup, virtual-key decrypt, `GET /v1/models`) — is deleted
with the uniform probe mechanic: the server cannot spawn a harness, so it
cannot produce an observation in the entry shape. Every cloud snapshot is
a machine's observation at rest; a user with no machine observation yet
is exactly what the read-time seed fallback is for.

The Worker is the only uploader, because it owns the sandbox's cloud
connection (the runtime never holds a product-server credential — the
same boundary auth delivery follows in the other direction). Concretely,
a `model_snapshot_sync.rs` module runs on the Worker's
`heartbeat_and_converge` tick
([proliferate-worker/src/runtime.rs](../../../../anyharness/crates/proliferate-worker/src/runtime.rs)),
shaped like the other per-tick convergence steps:

1. After each successful heartbeat, GET the runtime's snapshot documents
   over the narrow local AnyHarness surface the Worker already uses
   (localhost + optional runtime bearer, the same access pattern as
   `anyharness_update.rs`'s `/health` probe).
2. Compare each entry's `probedAt` against the last-uploaded values held
   in memory — worth at most one redundant upload after a Worker restart,
   which the server's soft-versioned write absorbs idempotently.
3. POST changed entries to the ingest route with the Worker's own bearer;
   the server resolves the owner from the Worker's sandbox row, so the
   payload carries no user identity.
4. Non-fatal like every convergence action: failures log and the next
   tick retries.

**Desktop does not sync.** The local-surface document stays on the
machine: the desktop picker always has its runtime attached and reads the
document live, and no machineless surface consumes a local observation —
they all pick models for cloud execution. Today's 60-second
[useGatewayCatalogMirrorSync](../../../../apps/packages/product-client/src/hooks/agents/lifecycle/use-gateway-catalog-mirror-sync.ts)
polling loop deletes with no replacement.

## Serving and merge

### Universe construction

For a given harness the **active universe** is the union of the machine
snapshot entries for every active auth context (one context for
single-route harnesses; several for multi-provider harnesses like
opencode, where all enabled sources materialize simultaneously — the
selection-set contract belongs to agent-auth). Each model in the universe
is tagged with the context that served it. Where no fresh entry exists for
an active context, the shipped catalog's models for that context fill in,
marked as seed data.

The universe's mode list comes from the freshest entry attested on the
installed version (any context — they agree on modes), with the shipped
catalog filling in before the first probe.

### Enrichment join

Snapshot models carry observation; the shipped catalog carries curation.
The picker joins them per model, in this order:

1. Build the candidate id set for the snapshot model: its `id`, its
   catalog aliases once matched, each also normalized through the
   default-chat-model normalizer (the existing
   `buildCloudModelLookup`/`runtimeModelCatalogLookupCandidates`
   machinery in
   [cloud-launch-catalog.ts](../../../../apps/packages/product-client/src/lib/domain/agents/cloud-launch-catalog.ts)).
2. The first shipped-catalog model matching any candidate by id or alias
   supplies display name, description, control wiring, and availability
   metadata.
3. No match means the model still renders — id-shaped label, sparse
   metadata — subject to the unknown-model visibility default below.

Identity, presence, and enabled state always come from the snapshot side
of the join; prose and wiring always come from the catalog side. Defaults
come from neither observation nor join: the shipped catalog's curated
default per (harness, auth context), with a user-set default on top.

### Launch validation

The runtime validates a requested model against the active universe — the
snapshot entries for the active contexts, shipped catalog only where no
fresh entry exists yet (first launch before the initial probe completes,
or a re-probe window after auth or the harness moved).
Resolution keeps today's order (exact id, then alias, then variant forms);
the two error kinds keep their shapes:

- Absent from every context's observation and the catalog:
  `SESSION_MODEL_UNSUPPORTED` (`SelectionUnsupported::UnknownModel`).
- Present, but only in contexts that are not active:
  `SESSION_MODEL_GATED` (`SelectionUnsupported::ModelGated`), with
  `required_contexts` naming the contexts whose snapshot entries (or
  catalog availability, pre-probe) contain the model.

Nothing a picker shows should be something launch refuses, and vice versa,
because both read the same universe.

### Serving per surface

- **Picker with a runtime attached** (desktop, connected cloud workspace):
  the runtime's launch options project the universe above; the frontend
  merge keeps its precedence (runtime wins identity and enabled state;
  cloud catalog data enriches; cloud-only agent kinds append as a gated
  fallback tail).
- **Picker with no runtime** (web new-chat, mobile, automations, workflow
  editors): the cloud snapshot's layered read for that user, harness, and
  auth context — own snapshot, else the shipped catalog's models as the
  read-time seed, plus the override patch. Entries render with their
  staleness visible when the snapshot is old.
- **Provider badges**: every served model entry carries its origin — the
  auth context that served it, and the `provider` namespace — as explicit
  fields, so the UI never infers origin from a model name.

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
id-shaped labels whenever the match is known. Saved selections resolve
through alias matching (exact id, then alias, then progressive
prefix-stripping for provider-qualified ids) so old intent keeps resolving
after renames.

Saved model choices everywhere (automations, workflow definitions, team
defaults) are intent, resolved against the executing target's snapshot at
run time; capability changes mark the config for review rather than
silently substituting a different model.

## Visibility and defaults

Visibility is product curation layered over capability, and is never
capability itself:

- A model is available when a tier serves it; it is visible when the
  shipped catalog's default visibility says so or the user's override
  patch says otherwise.
- Unknown live-discovered models default to hidden until curated or opted
  in.
- The visible set must never go empty for a harness with available models;
  the current selection stays rendered (with a stale warning) even when
  hidden, so old choices can be understood and repaired.
- Per-harness default models are curated in the shipped catalog per auth
  context; user-set defaults override them.

## API surface

### Cloud routes

The cloud snapshot's routes live in their own namespace, deliberately
named off both "gateway" (they serve every auth route) and "catalog" (that
word belongs to the agent-distribution document):

- `GET /v1/cloud/agent-models/{harness}?authContextId=`: the
  layered read (latest active snapshot, else the shipped catalog's
  models as the read-time seed, with the
  override patch applied). No `surface` param: the cloud store holds
  cloud-sandbox observations only.
- `POST /v1/cloud/agent-models/{harness}/refresh`: the single ingest
  route — a Worker-uploaded snapshot entry in the body. Absorbs today's
  separate `refresh` and `mirror` endpoints; the server never generates
  snapshots itself.
- `PUT`/`DELETE /v1/cloud/agent-models/{harness}/override`: the override
  patch, contract unchanged.

Snapshot identity on the wire matches the tables: harness, auth
context id, `probedAt`. Renames are hard cutovers with no alias windows;
all consumers are first-party (pre-launch ruling): the cloud SDK's
agent-gateway catalog functions, the sdk-react hooks
(`useAgentCatalog`, `useRefreshAgentCatalog`, `useMirrorAgentCatalog`,
`useUpsertCatalogOverride`, `useDeleteCatalogOverride`), the mirror-sync
hook, and the settings All Models surface.

### Runtime routes

The runtime exposes the machine document to its local clients. These
replace the runtime's gateway-models-only endpoints:

- `GET /v1/agents/{kind}/model-snapshot`: the polled status surface above —
  per-context `probedAt`, `snapshotAgeSeconds`, `lastAttempt`, `lastError`,
  `stale`/`staleReason`, `identityComparable`, the engine's `state` and
  `nextAttemptAt`, the manifest-derived `installIdentity`, and the engine's
  ownership mode. Model and mode lists come off the same document read — the
  `models`/`modes` arrays ride alongside `modelCount`/`modeCount` (S2b added
  the arrays; the counts predate them and stay for whatever already reads
  just a badge). The Worker's `model_snapshot_sync.rs` is this route's first
  consumer of the arrays: it has no other local surface to read the full
  entry from.
- `POST /v1/agents/{kind}/model-snapshot/refresh?authContextId=`: force a
  re-probe of ONE context (the manual-refresh poke), awaiting it. The
  parameter is required: a forced refresh of every active context would hold
  one request for as long as the probe timeout times the number of contexts,
  and a surface that wants "refresh everything" issues one request per
  context and polls the status route for progress. `202` with the status
  body; `400` when `authContextId` is absent; `404` when the harness or the
  context is not active here; `409` when this runtime does not own the probe
  engine, or when this machine's local auth configuration cannot be probed
  for that context; `502` only when a probe actually ran and failed.

## Code map

New Rust module, following the domain's pure-policy/effectful-apply
convention (`staleness.rs` decides, `document.rs` and the probe runners
act):

```
anyharness-lib/src/domains/agents/model_snapshot/
├── mod.rs                # ModelSnapshotService: the reconciler — gate, coalescing,
│                         #   per-harness serialization, the completed-attempt floor,
│                         #   backoff, and the pokes (startup, install-completed,
│                         #   auth-applied, session-launch backstop, manual refresh)
├── config.rs             # tunables, poke vocabulary, ownership mode, refresh error
├── document.rs           # wire schema + atomic 0600 read/write (mirrors installer/manifest.rs)
├── entry.rs              # ProbeSnapshot -> document entry (pure translation)
├── fingerprint.rs        # auth-context fingerprint from the probe seam's material
├── lock.rs               # the single-writer engine lock (one engine per runtime home)
├── probe.rs              # per-context invocation of live/sessions/probe::probe_agent
│                         #   on a thread that owns both the child and the scratch
├── reads.rs              # document/entry/status reads (available in read-only mode)
├── staleness.rs          # pure validity rules (mirrors installer/install_policy.rs)
├── status.rs             # the polled status projection (pure)
├── targets.rs            # which (harness, context) pairs may be probed
└── universe.rs           # fresh entries -> the launch-validation universe, behind a
                          #   seam so validation needs no probe engine
```

The picker-facing enrichment join stays where it is today (`catalog/` and the
frontend), so this module has no `projection.rs`: it owns the observation, not
the merge. `universe.rs` is the one projection it does own, and only because the
FRESHNESS rule is its own — a stale entry stops counting, and nothing outside
this module knows that rule.

The route-auth side owns the probe's materialization seam, because it is the
same render plane a launch uses:

```
anyharness-lib/src/domains/agents/route_auth/
└── probe_materialization.rs   # the two-phase seam: probe_auth_material (read-only,
    ├── scoping.rs             #   every gate evaluation) / materialize_for_probe
    └── scratch.rs             #   (only when probing); per-context source scoping;
                               #   the probe-owned scratch root + orphan sweep
```

New server package, mirroring `agent_gateway/`'s shape:

```
server/proliferate/server/cloud/agent_models/
├── __init__.py
├── api.py        # the three route groups above
├── models.py     # Pydantic wire models (camelCase aliases)
├── snapshots.py  # layered read, machine-snapshot ingest
└── overrides.py  # patch parse + remove→update→add apply
```

| Layer | Path | Owns |
| --- | --- | --- |
| Machine snapshot | `anyharness-lib/src/domains/agents/model_snapshot/` (new; beside [installer/](../../../../anyharness/crates/anyharness-lib/src/domains/agents/installer/manifest.rs) whose manifest/policy conventions it mirrors) | Document, probes, fingerprints, staleness, triggers, projection |
| Launch validation | [catalog/service.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/service.rs) + [catalog/selection.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/selection.rs) + [catalog/universe.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/universe.rs), [sessions/service/launch_options.rs](../../../../anyharness/crates/anyharness-lib/src/domains/sessions/service/launch_options.rs) | Snapshot-first universe, `SelectionUnsupported`, picker projection |
| Gateway model plan | [catalog/gateway_plan.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/gateway_plan.rs) | The surviving `GET /v1/models` materialization fetch: memoized 5 min, seed models as a warned floor, never snapshot truth |
| Cloud snapshot | `server/proliferate/server/cloud/agent_models/` (new; today's routes in [agent_gateway/api.py](../../../../server/proliferate/server/cloud/agent_gateway/api.py), tables in [db/models/cloud/agent_gateway.py](../../../../server/proliferate/db/models/cloud/agent_gateway.py)) | Layered reads, ingest, overrides, soft-versioned history |
| Cloud sync | `proliferate-worker/src/model_snapshot_sync.rs` (new; on the tick in [proliferate-worker/src/runtime.rs](../../../../anyharness/crates/proliferate-worker/src/runtime.rs)) | Heartbeat-tick upload of changed entries |
| Picker composition | [cloud-launch-catalog.ts](../../../../apps/packages/product-client/src/lib/domain/agents/cloud-launch-catalog.ts) and the chat/model domain | Merge precedence, identity normalization, visibility filtering, badges |

Deleted by this design:
[catalog/gateway_probe.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/gateway_probe.rs)'s
persistence half
and
[catalog/gateway_resolver.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/gateway_resolver.rs)
(with the `gateway_model_probe` sqlite
table), the `gatewayPolicy` seed fallback as a SERVING tier (agent-distribution
gap), and the frontend
[useGatewayCatalogMirrorSync](../../../../apps/packages/product-client/src/hooks/agents/lifecycle/use-gateway-catalog-mirror-sync.ts)
polling hook.

Two pieces of that chain deliberately survive, and both are materialization
rather than observation. `probe_gateway_models`' tolerant `GET /v1/models` fetch
moves into `gateway_plan.rs`, because a harness whose gateway config enumerates
models needs the proxy's list to WRITE that config before any spawn. And
`gatewayPolicy.seedModels` survives as a floor under that fetch, because
`render_opencode_gateway` hard-fails on an empty models map — so a failed fetch
must still yield a launchable list. An entry produced over that floor carries a
`"gateway model plan fell back to seed models"` warning, because the probe then
observes exactly the ids the floor just wrote into the harness's own config:
a tautology, and not a discovery of what the gateway serves.

## Failure modes

- Probe fails (harness crash, provider auth error): `lastAttempt` records
  the failure; the last good lists keep serving with their age and a
  failed-refresh indicator, never an empty picker.
- No snapshot and no runtime (new user on web): shipped catalog models
  serve, marked as unverified seed data.
- Snapshot is stale (identity moved, re-probe pending): rendered as "needs
  refresh"; launch validation falls back to the shipped catalog for that
  context until a fresh entry lands. Age alone never blocks a launch.
- Requested model absent from the active universe: launch rejects as
  unsupported (or gated, when other contexts explain it), naming what the
  active universe is.
- Machine document unreadable or schema-mismatched: treated as absent;
  the next trigger rewrites it whole. It is derived state — deleting it
  loses nothing that a re-probe cannot restore.

## Current gaps

Deltas between this document and `main`, each struck by its follow-up PR:

- [ ] The picker does not project the machine snapshot yet. Launch validation
      does (`validate_launch_in_universe` in
      [catalog/service.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/service.rs),
      reading
      [catalog/universe.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/universe.rs)),
      so an observed model launches; but `models`/`visible_models` — and
      therefore the runtime's launch options — still read the shipped catalog
      alone, so an observed-only model is launchable without appearing in any
      menu. Closing this is the [enrichment join](#enrichment-join) plus the
      explicit provider/serving-context fields two bullets down: a model shown
      with no curated display name or control wiring would be worse than one
      absent from the menu. Note the asymmetry is pre-existing and in the safe
      direction — the shipped catalog already carries trial-verified models a
      harness does not advertise.
- [ ] **The legacy gateway-models route now serves seed data only**, and this is a
      deliberate, bounded regression rather than a latent bug. The poke wiring
      deleted the last two writers of the `gateway_model_probe` table (the
      auth-apply scheduler and the launch-time trigger), while
      `resolve_with_source` behind
      `GET /v1/agents/{kind}/catalog/gateway-models` still reads only that table
      — so it reports `source: "seed"` until a user presses the legacy Refresh.
      Two consumers regress for the length of the window: the settings **All
      Models** tab shows the seed list with no probe freshness, and the
      desktop→cloud **mirror push**
      ([gateway-catalog-mirror.ts](../../../../apps/packages/product-client/src/lib/domain/agents/gateway-catalog-mirror.ts)
      pushes only `source === "probe"`) stops, so machineless surfaces keep
      serving whatever they last received. The window closes when this route's
      consumers move to the snapshot route: the mirror consumer is **deleted** by
      the route cutover and the snapshot re-key, and the All Models tab is
      rebuilt on the runtime status/snapshot surface. Restoring a writer here
      would mean re-creating the revision-keyed table this design deletes, so
      the fix is the cutover, not a patch. **Deploy implication: this must not
      ship to users without the route cutover and the snapshot re-key in the
      same release train.**
- [ ] The cloud snapshot exists (`agent_catalog_snapshot` in
      [db/models/cloud/agent_gateway.py](../../../../server/proliferate/db/models/cloud/agent_gateway.py))
      but is keyed by
      coarse route (`native`/`api_key`/`gateway`) instead of auth context,
      stores a models-only payload, carries ownerless seed rows and a
      `source` column (both leave: seed becomes a read-time fallback to
      the served shipped catalog), and is read only by the settings "All
      Models" tab. Composer, web, mobile, automations, and workflows all
      read the shipped catalog instead. The re-key (route →
      `auth_context_id`, `models_json` → `snapshot_json`, table rename)
      is one migration; the soft-versioning write pattern is kept.
- [ ] The server has three catalog write paths (`refresh` with optional
      payload, `mirror` with `source="runtime-mirror"`, and overrides —
      all in
      [agent_gateway/api.py](../../../../server/proliferate/server/cloud/agent_gateway/api.py));
      the first two collapse into the single ingest route, and the
      server-side gateway discovery inside `refresh` (enrollment lookup,
      virtual-key decrypt, `GET /v1/models`) deletes — the server never
      generates snapshots.
- [ ] The gateway model plan chain —
      [gateway_resolver.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/gateway_resolver.rs),
      [gateway_probe.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/gateway_probe.rs)
      with its `gateway_model_probe` sqlite table
      (keyed on the global `state.json` revision, so any harness's auth
      change invalidates every harness's probe), the `gatewayPolicy` seed
      fallback, and the 60-second
      [useGatewayCatalogMirrorSync](../../../../apps/packages/product-client/src/hooks/agents/lifecycle/use-gateway-catalog-mirror-sync.ts)
      poll — is
      the gateway-context special case of the machine snapshot and is
      replaced by it (jointly ruled with the agent-distribution and
      model-gateway gap lists).
- [ ] No staleness UI exists: `probed_at` is stored on cloud snapshots but
      no surface renders "refreshed N minutes ago" or "needs refresh",
      and no auth fingerprint exists to compute staleness from.
- [ ] Model entries do not carry provider namespace or serving-context as
      explicit fields; the frontend derives what it can from ids.
- [ ] Route rename `/v1/cloud/agent-gateway/catalog/*` →
      `/v1/cloud/agent-models/*` (hard cutover; first-party consumers:
      the catalog functions in
      [cloud/sdk/src/client/agent-gateway.ts](../../../../cloud/sdk/src/client/agent-gateway.ts),
      the sdk-react agent-gateway catalog hooks in
      [cloud/sdk-react/src/hooks/agent-gateway.ts](../../../../cloud/sdk-react/src/hooks/agent-gateway.ts),
      the mirror-sync hook, and
      [HarnessAllModelsSection](../../../../apps/packages/product-client/src/components/settings/panes/agents/harness/HarnessAllModelsSection.tsx)).
- [ ] Onboarding contains no "checking for latest models" step (the
      surface rendering the install-completed and auth-applied pokes).
- [x] ~~Nothing uploads the cloud sandbox's fresh machine snapshot yet: the
      Worker's heartbeat tick has no~~
      [model_snapshot_sync.rs](../../../../anyharness/crates/proliferate-worker/src/model_snapshot_sync.rs)
      ~~step, so every machineless consumer (web new-chat, mobile,
      automations, workflow editors) serves whatever the cloud snapshot last
      held — stale or entirely absent for a harness that has never been
      manually refreshed through the legacy route. Closing this means the
      module this doc already names in "Write paths"/"Code map".~~ **Closed
      by S2b**: the module now runs on every heartbeat tick, GETs the
      runtime's model-snapshot status per harness
      (`GET /v1/agents/{kind}/model-snapshot`, whose response this same PR
      extends with the `models`/`modes` arrays the route's own doc comment
      always promised — see the "Runtime routes" note below), diffs
      `probedAt` against an in-memory last-pushed cache, and POSTs changed
      contexts to `POST /v1/cloud/agent-models/{harness}/refresh` with the
      Worker's bearer. **Narrowing, not fully closing**: the cloud route
      itself ships on a separate branch (B4/C2) not yet merged as of this
      PR, so against today's `main` the POST 404s and is logged-and-swallowed
      like any other convergence failure — the sync is inert, not broken,
      until that route lands. It is also inherently cloud-sandbox-only: the
      ingest route's `resolve_upload_owner` refuses `runtime_kind !=
      "cloud_sandbox"` with a 403, so a desktop Worker's attempt always logs
      a swallowed 403, which is correct — "Desktop does not sync" above.
