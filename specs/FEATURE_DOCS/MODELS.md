# Models and harness launch options

Status: current shipped contract

This document owns executable model and launch-control membership, target
observation, session launch intent, live session configuration, and the model
gateway. Agent credential selection and route material belong to
[Agent auth](AGENT_AUTH.md).

## Authority

There are two executable authorities, separated by session lifecycle:

1. Before a session exists, one target-local `HarnessLaunchOptions` observation
   is authoritative for a harness.
2. After a session exists, that session's `SessionLiveConfigSnapshot` is the
   only authority for its models, controls, allowed values, and current values.

Static catalog and registry data may provide installation pins, harness names,
auth declarations, compatibility metadata, and presentation. They cannot add,
remove, hide, seed, alias, or default an executable model or control value.
Unknown observed identifiers remain selectable and use their observed name or
raw identifier as presentation fallback.

## Target observation

The runtime owns one `harness_launch_option_states` row per harness kind. It is
not keyed by workspace, user, auth surface, or route. Each row contains:

- `basis_revision`: a hash of harness kind, installed harness identity, and the
  product-owned auth/route revision;
- a monotonic runtime-local `revision`;
- exact ordered models, a flat no-override control statement, and, when the
  harness can be switched without prompting or inference, exact control
  statements and defaults for each observed model;
- successful-observation and latest-attempt timestamps; and
- bounded probe evidence and failure code.

The implementation lives under
[`domains/agents/launch_options/`](../../anyharness/crates/anyharness-lib/src/domains/agents/launch_options/)
and [`domains/agents/launch_probe/`](../../anyharness/crates/anyharness-lib/src/domains/agents/launch_probe/).

### Probe rules

Startup, install reconciliation, applied agent-auth changes, and manual refresh
may request a probe. The probe:

1. computes the current basis revision;
2. materializes product-owned auth/route state without any workspace or session
   environment;
3. starts a headless, override-free harness session;
4. records the exact model list and flat no-override launch-control statement;
5. for bounded harnesses whose model config can be switched and read back
   without prompting, records the exact control statement and defaults after
   selecting every model; and
6. atomically replaces the one harness row.

Probe output is data, not a schema allow-list. Sparse and unknown identifiers
are persisted. A successful empty statement is `observed_empty`, not a reason
to consult static data.

`modelControls` is an optional compatibility extension of the one target
observation, not another authority. A row for the selected model is exact: a
present empty `controls` list means that model offers no launch controls. When
no row was observed, consumers use the flat no-override statement. A harness
whose model-control enumeration is required must publish a complete matrix or
fail the refresh and retain matching last-good state; it may not publish a
partial matrix and silently fall back for the missing models.

Workspace and per-session environment may not affect target observation.
Session creation rejects an environment key that would override an auth input
declared for the selected harness, because such a launch would contradict the
basis the runtime validated.

### State machine

The served states are:

| State | Executable choices |
| --- | --- |
| `detecting` | none; current basis has no successful observation |
| `refreshing` | matching last-good options, when present |
| `observed` | exact successful non-empty observation |
| `observed_empty` | exact successful empty observation |
| `last_good_after_failure` | matching last-good options plus failure evidence |
| `failed_without_observation` | none |

A basis change clears options before probing, so options from old installation
or auth material are never served under a new basis. Same-basis failure keeps
the matching last-good statement. Read also recomputes the basis, preventing an
auth/install event from exposing stale options before its invalidation task
runs.

`state` alone cannot say whether a `detecting` row is still converging. A
harness excluded from unattended probes stays `detecting` until somebody presses
Refresh, which reads identically to a probe that is about to answer. The
response therefore also carries `probePhase` for that harness (`idle`, `queued`,
`running`, `backoff`), the same lifecycle the agent-auth summary reports.

`probePhase` and `state` come out of one read of one durable row, returned
together so no caller can derive them apart and let them disagree. A row whose
`probe_state` is `probing` reports at least `queued`, whatever basis that row
carries: an auth change moves every harness's basis and can land under a probe
that is genuinely running, and that probe is the one whose result the client is
waiting for. A settled row at a moved basis reports `idle` instead, even though it
too is served as `detecting`, so a harness no unattended poke may refresh is not
polled forever.

The scheduler's in-memory slot refines the row rather than replacing it, in two
directions. An owner admits an attempt to its slot BEFORE writing `probing`
durably and before every await after it, so for an owner the slot leads the row:
it sharpens `queued` to `running`, and — the case that matters — a `probing` row
whose owner slot is `idle` is an ORPHAN, a durable start whose attempt is gone.
That happens without any crash, since dropping the refresh future releases the
guard and nothing releases the row, so the owner's slot is what stops a client
polling forever against an attempt that no longer exists. A read-only runtime has
no slot to refine anything with, because it never admits an attempt; the row is
its only source, and reporting it is what keeps a runtime that shares the document
converging with the owner probing it.

The row's claim is therefore believed on trust by a read-only runtime, so it is
believed only for a bounded time. An attempt older than one whole-machine pass —
the per-probe timeout times every registered harness plus one, since the engine
runs one probe at a time — is abandoned: no attempt can legitimately still be
queued behind that much work, and past it the slot (or, read-only, nothing) is the
answer. The bound has to clear a real queue, not just one timeout, or a probe
waiting its turn behind a full pass is called abandoned while it is about to run.

The slot and the row cannot be read atomically, so the ORDER is part of the rule:
the slot is read FIRST and the row second, always. Row-first admits the one pair
that cannot be told apart from an orphan — an attempt that commits between the two
reads leaves a `probing` row beside an already-`idle` slot — and would retire the
observation the client is waiting for. Slot-first can only produce a slot livelier
than the row, which costs one extra poll. The ordering is enforced, not merely
documented: a phase reading carries when it was taken, a read carries when it was
taken, and deriving from the wrong order is refused.

One more source can look idle without being settled: an owner that has not yet
dispatched its startup probe pass. It serves HTTP while seed hydration and the
reconcile run ahead of that pass, so its slot map is empty because nothing has run
YET. Until the pass dispatches — or a whole-machine-pass worth of wall clock goes
by, so a stalled boot cannot wait forever either — a row claiming an attempt is
reported as queued rather than settled.

When a claim is withdrawn this way, the STATE withdraws it too, not only the
phase. `refreshing` is waited on without consulting `probePhase` at all, so a row
vetoed as an orphan is projected as though it were settled: its last observation
if it has one, `detecting` if it never had one. Otherwise the response would
contradict itself — a `refreshing` state next to an `idle` phase — and the client
that reads the state would keep polling an attempt the phase already denied.

The field is omitted only when nothing is in flight in the row AND the serving
runtime does not own the probe engine for its runtime home, the one case where no
source can answer.

Ownership itself is on the response as `canManuallyRefresh`. The refresh route
answers a non-owner with 409 `PROBE_ENGINE_NOT_OWNER`, and nothing else on any
wire carries that fact, so a surface that inferred it from "is this runtime local?"
rendered a Refresh control whose only outcome was an error toast. It reports
ownership alone; install state is a separate precondition already carried by
`readiness`, and a surface gating a Refresh control respects both.

Clients wait on a launch-option read only while `probePhase` is `queued` or
`running`, or while the state is `refreshing`. Every terminal state, and a
`detecting` row whose phase is `idle`, `backoff`, or absent, is an answer rather
than a wait.

## Pre-launch reads

Runtime API:

- `GET /v1/agents/{kind}/launch-options`
- `POST /v1/agents/{kind}/launch-options/refresh`

Cloud API:

- `GET /v1/cloud/harness-launch-options/sandboxes/{cloudSandboxId}/{harnessKind}`
- `POST /v1/cloud/harness-launch-options/{harnessKind}` from the authenticated
  target Worker

Home, new chat, Settings, Cowork and reviews, workflows, Web,
Desktop, and Mobile consume the same response for their selected target and
harness. View mappers may label, order, group, search, or lay out exact keys.
They may not union or intersect executable membership with catalog data.
When the observation contains a `modelControls` row for the selected model,
that row replaces the flat control statement for rendering and selection.
Changing models therefore also replaces the rendered controls and drops stale
control selections that the new model did not observe.

Settings presents the observed list read-only. Model visibility overrides and
server-side add/remove patches do not exist.

### Home probe-card dismissal

Home persists dismissal of its launch-options probe card under the raw-string
key `proliferate.home.modelProbeCardDismissed`, with exact value `"1"` as the
only dismissed sentinel. The facade owns an explicit per-mount hydration state:
`loading`, `visible`, or `dismissed`. While it is `loading`, the facade omits
the probe inputs entirely, so cached agent and launch-options data cannot mount
the card before the persisted choice is known. An exact sentinel settles to
`dismissed`; a missing value, any other raw value, or a captured read failure
settles to `visible`.

Hydration may transition only a still-loading state. A current user dismissal
moves the state synchronously to `dismissed` before the existing best-effort
sentinel write, and a late read cannot overwrite it. Reads use the mounted
host's storage context and its staleness guard, so an unmounted result is
ignored. Read and write failures retain the persistence layer's existing
captured, non-blocking behavior: a failed read still settles to visible, and a
failed write never rolls the in-memory dismissal back.

## Cloud copy

The Worker uploads changed runtime state and evidence verbatim. The server
stores one latest row by `(cloud_sandbox_id, harness_kind)` and accepts only a
higher source revision for the same basis/state stream. It does not rebuild the
statement, seed absent state, or apply catalog overrides.

A sleeping target may serve its own last copied statement with its evidence. A
never-observed target serves no explicit choices. State from two sandboxes
owned by the same user cannot collide or authorize one another.

The implementation seams are
[`launch_options_sync.rs`](../../anyharness/crates/proliferate-worker/src/launch_options_sync.rs)
and
[`server/cloud/harness_launch_options/`](../../server/proliferate/server/cloud/harness_launch_options/).

## Launch selection and intent

The picker initializes from the observation's defaults and sends raw executable
identifiers:

```json
{
  "modelId": "gpt-5.6-codex",
  "controlValues": {
    "collaboration_mode": "plan",
    "mode": "agent-full-access"
  }
}
```

Every rendered control with a selected/default value is represented. Defaults
come from the selected model's exact row when present and otherwise from the
flat statement. Omission means no value was promised; it never means “look up
a catalog default later.” Independent controls remain independent.

Session create reloads successful current-basis launch options even when the
selection is empty. It validates exact model, control, and value membership
against the selected model's row when present, otherwise against the flat
statement. An unsupported value returns `SESSION_LAUNCH_VALUE_UNSUPPORTED`
before a session is committed. Accepted create inserts the session and
complete `ResolvedLaunchIntent` in one transaction.

`modeId` is accepted only as a stateless N-1 HTTP decoder input and is converted
to `controlValues.mode` before entering the session domain. First-party callers
send `controlValues` directly.

Saved preferences, pending creates, reviews, and workflow nodes
store intended identifiers, not availability. Every execution revalidates
that complete selection against the execution target's current observation.
Unresolved intent fails typed or requests review; it never chooses a neighbor,
alias, or first row.

## Actor startup

The actor receives the persisted intent. Its native handshake produces the
session's initial models, controls, allowed values, and current values. Startup
then:

1. verifies every explicit intent value is a member of the live statement;
2. applies the explicit model first, then every explicit control;
3. waits for positive read-back of each value; and
4. publishes ready only when the complete live current statement matches the
   explicit intent.

The explicit model stays fail-closed: an absent or unconfirmed model fails
startup and cleans up the incomplete native session.

Controls carry exactly one carve-out, for value narrowing on quality controls
when the target could not publish a model-specific row or the harness changed
after observation. Some harnesses shrink a control's allowed values under the
applied model (codex `reasoning_effort` loses `max` under some models). A
control that the live statement still surfaces, whose requested value that
statement no longer offers, and that is not a posture control, is therefore
dropped to the live session default with a `membership_dropped` result and a
`session.initial_config.dropped` event; the final aggregate check then runs
against the intent minus the dropped controls.

Everything else stays fail-closed, because a silent default is worse than a
refused start:

- Posture controls are never dropped. Collaboration mode, the mode and
  approval-policy family, and sandbox mode decide what the agent is allowed to
  do, so launching one at the harness default after the user explicitly
  selected against it would silently change behavior. An unoffered posture
  value fails startup.
- A control id the live statement never surfaced at all fails startup. That is
  a vocabulary disagreement between the create-time observation and the live
  session, not per-model narrowing, and dropping it would make every future
  selection for that control a silent perpetual no-op.
- An OFFERED value that is rejected, timed out, or unconfirmed by its setter
  read-back fails startup and cleans up the incomplete native session.

A contradiction queues a new override-free target probe; configured session
values never become target defaults.

## Active session configuration

`SessionLiveConfigSnapshot` contains exact session-local models, controls,
allowed values, complete current model/control values, and a monotonic
`sourceSeq`. `session_live_config_snapshots` keeps the latest full row and
replaces it only with a higher sequence.

Every active-session picker reads this snapshot only. A mutation validates
against its latest statement, applies through ACP, waits for confirmation, and
persists the next full snapshot. Later target probes cannot add to or invalidate
an already running session.

Codex exposes collaboration (`collaboration_mode`, presented as **Mode**) and
execution access (`mode`, presented as **Access**) simultaneously. Access
values are `read-only`, `agent`, and `agent-full-access`; first-party code never
emits `full-access`.

## Observability and failure behavior

Bounded events correlate the path without model/control values, prompts,
credentials, descriptions, provider output, or filesystem paths:

- `agent.launch_options_probe.completed`
- `agent.launch_options.served`
- `session.launch_selection.validated`
- `session.initial_config.apply`
- `session.initial_config.dropped`
- `session.live_config.changed`

Events include safe identifiers, basis/revision or source sequence, state,
counts, duration, and result/error codes. See
[Observability](../OBSERVABILITY.md) for the repository-wide scrubber contract.

Prompt-time provider rejection is not executable-membership authority. Known
model-unavailable and model-configuration failures receive bounded error codes
for actionable client presentation, while the original diagnostic stays behind
the error's technical-details disclosure. Clients may offer the model picker;
they do not remove an observed model, rewrite the saved selection, or retry the
same non-retryable request automatically.

Release coverage includes sparse/unknown Claude identifiers, model-scoped
Claude controls (including the absence of `fast` under Fable), current Grok
identifiers, both Codex controls, empty/failure/basis-change states, exact
create rejection, startup contradiction, active-session isolation, and cloud
target isolation. The deterministic gates and real-profile verifier are in
[Testing](../TESTING.md).

## Static agent data after the cutover

[`registry.json`](../../catalogs/agents/registry.json) remains the hand-owned
harness allow-list and auth/install declaration. The distribution catalog may
carry pinned artifacts and non-executable compatibility/presentation metadata.
Executable model rows, defaults, visibility, trial exceptions, per-model
tuning truth, and selection/projection services are not launch authorities.

## Model gateway

> Superseded for ownership by
> [model_gateway/README.md](../codebase/systems/product/model_gateway/README.md) (the system
> spec: owned tables, public surface, laws, code map). This section stays as
> the harness-facing contract only; do not extend it.

The model gateway lets a deployment pay for and control inference while the
harness remains the execution client. It is a distinct control/data plane; its
configured model list is ultimately observed through the harness before any
Product surface may offer it.

### Data plane

LiteLLM is the OpenAI-compatible proxy. Its explicit
[`config.yaml`](../../server/litellm/config.yaml) maps model names to upstream
providers and access groups. Unknown model names fail. Cross-provider aliases
are forbidden because they silently change semantics. Every model carries the
harness access group allowed to invoke it; no client-side filter substitutes
for proxy enforcement.

Each active account+harness enrollment receives a scoped virtual key. `GET
/v1/models` returns only that key's access group and out-of-group inference is
denied. Runtime materialization delivers the scoped key only to the selected
harness route and strips ambient provider variables that would bypass it.

### Control plane

The server owns enrollment, budget state, top-ups, key rotation/revocation, and
usage import. Master LiteLLM credentials stay server-side. Product clients and
Workers never receive them. Runtime gets only a scoped key through the agent
auth materialization path.

### Account model

Organizations are the gateway and billing subject. A personal experience is a
one-member default organization, not a separate gateway payer. Enrollment,
budget, usage, and sandbox ownership therefore retain organization identity;
no client-supplied user-only key can select a different payer.

Gateway and native sources may coexist when a harness supports multiple auth
sources. The override-free probe observes the resulting harness menu; neither
gateway configuration nor catalog rows are copied directly into launch-option
membership.

### Billing and failures

Usage imports are idempotent and attributed to the owning account/team,
harness, and model. Unfunded or disabled enrollment fails closed and withholds
key material. Invalid/expired scoped keys, out-of-group models, and unknown
models remain typed failures; they are never retried through a different
provider.

Gateway logs and errors obey the secret-scrubbing rules in
[Observability](../OBSERVABILITY.md). Smoke and release qualification use real
scoped keys and verify both model listing and denied out-of-group invocation.

## Code map

| Concern | Owner |
| --- | --- |
| Target state, basis, validation | `anyharness-lib/src/domains/agents/launch_options/` |
| Override-free probe | `anyharness-lib/src/domains/agents/launch_probe/` |
| Create intent | `anyharness-lib/src/domains/sessions/{launch_intent.rs,service/create.rs}` |
| Startup confirmation | `anyharness-lib/src/live/sessions/actor/` |
| Active state/mutation | `anyharness-lib/src/domains/sessions/live_config/` |
| Worker copy | `proliferate-worker/src/launch_options_sync.rs` |
| Server target store/API | `server/proliferate/server/cloud/harness_launch_options/` |
| Runtime and cloud SDKs | `anyharness/sdk/`, `cloud/sdk/` |
| Product presentation | `apps/packages/product-client/src/lib/domain/agents/cloud-launch-catalog.ts` |
| Gateway control plane | `server/proliferate/server/agent_auth/` |
| Gateway data plane | `server/litellm/` |

## Decision record

The why and rejected alternatives are recorded in
[ADR 2026-08-19](../../adrs/2026-08-19-target-observed-harness-launch-options.md).
