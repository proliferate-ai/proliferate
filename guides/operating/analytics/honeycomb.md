# Operate Honeycomb

Status: current procedure, stub. Written 2026-08-20/21 as part of the
observability overnight push (Lane D, D3). Product SLIs beyond sign-in are
computed here (see [production-alerts.md](../production-alerts.md) for the
sign-in success-rate SLI, which is CloudWatch/Grafana, not Honeycomb).
Honeycomb has no alerting posture today: "no alerts initially, product SLIs
are computed here" per the Observability Context doc section 4. This stub
is a starting point for whoever owns E2 (runbooks) next; the intent is that
it grows real "when it fires, do X" content once at least one of these SLIs
is actually reporting from real data.

## Applicability

Hosted deployments only. Honeycomb receives OTLP from the local diagnostics
collector, environments `dogfood` (internal builds, both record classes) and
`production` (customer builds, lifecycle-only, does not exist yet -- see
Spec - Lifecycle Export Pipe, Stage 2). Dataset is `anyharness` for the SLIs
below, since Honeycomb routes by `service.name` and these three all come from
the AnyHarness runtime.

## Secret Safety

Never put a Honeycomb API key (read, ingest, or management) in CLI arguments,
shell history, command output, screenshots, issues, PRs, documentation, or
chat. `HONEYCOMB_READ_KEY` lives in `~/.proliferate-local/observability-keys.env`
(mode 0600); as of 2026-08-21 (re-checked live, ~08:2xZ) it still returns HTTP
401 `unknown API key` against `GET /1/auth`. A second key, `HONEYCOMB_CONFIG_KEY`
(minted by Lane B, see `~/.proliferate-local/dev/otlp-honeycomb.env`), can read
schema and create a query definition but gets HTTP 401 `this API key isn't
allowed to execute queries` when asked to run one. Neither is execute-capable
tonight; both need re-minting/rescoping before any of this is queryable via API
(same shape as the Sentry/PostHog write-scope blockers documented in
[[Accounts and Wiring State 2026-08-20]] -- provider UI, Pablo, 2FA/session
required).

## The three product SLIs (D3)

The draft query file this section described
(`product-sli-queries.json`) was superseded on 2026-08-27 by executable
trigger intent:
[`server/infra/observability/honeycomb/triggers/`](../../../server/infra/observability/honeycomb/triggers/)
applied and verified by
[`scripts/ops/honeycomb-triggers.mjs`](../../../scripts/ops/honeycomb-triggers.mjs)
(five SLIs, thresholds of record in the alerting spec).
**Update 2026-08-21 ~08:2xZ:** Lane B posted the Stage-1 dogfood proof to the
Accounts and Wiring doc ("Lane B2, Stage-1 dogfood proof") -- the `anyharness`
dataset genuinely holds real Stage-0 records now (6 emitted, zero drops, 12
columns created at 2026-08-21T08:15:01Z), confirming the dataset name, field
names, and the exact Rejected-vs-Failed split rule used below. That clears the
second of the two original blockers. The file is still [unverified against
the live API] end to end: no query in it has been executed, because both
Honeycomb keys above remain non-execute-capable. So SLI #1 below is now "real
data confirmed to exist, query specified, not yet run" rather than "specified
against an assumed-empty dataset."

### 1. Session-create success, split Rejected vs Failed

**Buildable now, and the source record is now confirmed live** -- the only
remaining blocker is the credentials note above, not missing instrumentation
or missing data. Source: `anyharness.session.create` lifecycle record
(`anyharness/crates/anyharness-lib/src/domains/sessions/service/create_lifecycle.rs`,
landed in PR #2180, Lane B Stage 0, unmerged). Terminal outcome is one of
`succeeded | rejected | failed | abandoned`
(`proliferate.lifecycle.outcome` attribute). Formula: failed-rate and
rejected-rate are each `COUNT(outcome=X) / COUNT(all terminal records)` over
a window, broken out because Rejected is user-fixable (belongs in a digest)
and Failed means we broke it (can page). Lane B's Stage-1 note confirms this
split needs no extra logic: only the `internal_error` error classification
ever produces `outcome=failed`, every other closed classification produces
`outcome=rejected`. Starting threshold, not yet calibrated against real data:
Failed rate > 2% over 15m with a 20-record minimum. Do not key any query on
`proliferate.trace_id` -- Lane B confirmed it does not exist in this dataset,
the Stage-0 emitters never set it.

**When it fires:** break down failed terminal records by
`proliferate.error_classification`. `internal_error` dominating is an
engineering page; any other single classification dominating usually means a
client/config condition that was misclassified as Failed instead of Rejected
-- check the classification logic in `create_lifecycle.rs` before escalating
further.

### 2. Launch-selection validity by bounded code

**Blocked on missing instrumentation**, not on data or credentials.
`session.launch_selection.validated` exists today only as a `tracing::info!`
call site (`create.rs:317-329` accepted, `:523-533` rejected), which the
diagnostics tracing layer turns into a `detailed` record, never `lifecycle`.
Customer builds export lifecycle-only by design, so this event structurally
cannot reach production Honeycomb data until it is promoted into the closed
lifecycle catalog with its own safe-field list -- the same treatment
`session.create` already received. Verified 2026-08-21 that PR #2180 does
not do this promotion; it is not in scope of Stage 0 as shipped. Computing
this SLI from the dogfood-only detailed record would produce a number that
silently goes to zero the day this ships to customers, which is a proxy
metric, not the SLI -- not built, on purpose. This needs a Rust follow-up
(protocol catalog addition plus a call-site change) before it can be
specified with a real threshold.

### 3. Time to first output (turn latency)

**Blocked, confirmed two ways as of Lane B's Stage-1 note.** First, this
lane's original finding: `anyharness.turn.execute` IS instrumented by PR
#2180 (Started on `begin_turn`/`ensure_open_turn`, Terminal on `turn_ended` /
`commit_staged_prompt_terminal`), but "Started to Terminal duration" needs a
delta between two separate OTLP log records sharing `proliferate.operation_id`.
Verified 2026-08-21 by reading the emitted record shape directly: there is no
`duration_ms` (or any numeric elapsed-time field) anywhere on the Terminal
record for this operation -- `turn.execute`'s only safe fields are
`stop_reason` and `engine_initiated`, neither numeric. Honeycomb computes
per-event calculations; it does not join two log rows by a shared attribute
inside one query (that is a trace-span feature and this export is OTLP logs,
not spans). Second, and more fundamental: Lane B's Stage-1 note independently
flags that `anyharness.model.request` -- the operation Lane B identifies as
the actual source for provider/time-to-first-output latency -- "is declared
in the producer's table but has NO runtime emitter yet." So even a
`duration_ms` fix on `turn.execute` would only measure whole-turn duration,
not the narrower "time to first output" the spec calls for; the operation
that would measure that has no emitter at all yet. This needs a Rust
follow-up either way: attach the elapsed time the RAII guard already holds
in-process as a new safe-listed `duration_ms` argument on the Terminal
record, and/or wire up a real `model.request` emitter. Once either lands, the
SLI is a straight P50/P95/P99 calculation filtered to `outcome=succeeded`.
