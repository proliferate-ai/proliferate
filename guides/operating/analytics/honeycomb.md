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
(mode 0600); as of 2026-08-21 it returns HTTP 401 `unknown API key` against
`GET /1/auth` and needs re-minting before any of this is queryable via API
(same shape as the Sentry/PostHog write-scope blockers documented in
[[Accounts and Wiring State 2026-08-20]] -- provider UI, Pablo, 2FA/session
required).

## The three product SLIs (D3)

Full source-record citations and the checked-in draft Honeycomb query
specification live in
[`server/infra/observability/honeycomb/product-sli-queries.json`](../../../server/infra/observability/honeycomb/product-sli-queries.json).
That file is [unverified against the live API] end to end tonight: it has
never been applied, because (1) the read key above is broken, and (2) as of
this writing Lane B has not yet posted a Stage-1 dogfood proof note (dataset
name and record shapes actually observed) to the Accounts and Wiring doc, so
even a working key would query an empty dataset for these operations. Poll
that doc; the moment both are true this file should move from "specified" to
"applied and showing a number."

### 1. Session-create success, split Rejected vs Failed

**Buildable now** -- the only blockers are the two above, not missing
instrumentation. Source: `anyharness.session.create` lifecycle record
(`anyharness/crates/anyharness-lib/src/domains/sessions/service/create_lifecycle.rs`,
landed in PR #2180, Lane B Stage 0, unmerged). Terminal outcome is one of
`succeeded | rejected | failed | abandoned`
(`proliferate.lifecycle.outcome` attribute). Formula: failed-rate and
rejected-rate are each `COUNT(outcome=X) / COUNT(all terminal records)` over
a window, broken out because Rejected is user-fixable (belongs in a digest)
and Failed means we broke it (can page). Starting threshold, not yet
calibrated against real data: Failed rate > 2% over 15m with a 20-record
minimum.

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

**Blocked on a missing duration field**, not on data or credentials.
`anyharness.turn.execute` IS instrumented by PR #2180 (Started on
`begin_turn`/`ensure_open_turn`, Terminal on `turn_ended` /
`commit_staged_prompt_terminal`), but "Started to Terminal duration" needs a
delta between two separate OTLP log records sharing `proliferate.operation_id`.
Verified 2026-08-21 by reading the emitted record shape directly: there is no
`duration_ms` (or any numeric elapsed-time field) anywhere on the Terminal
record for this operation -- `turn.execute`'s only safe fields are
`stop_reason` and `engine_initiated`, neither numeric. Honeycomb computes
per-event calculations; it does not join two log rows by a shared attribute
inside one query (that is a trace-span feature and this export is OTLP logs,
not spans). This needs a Rust follow-up: attach the elapsed time the RAII
guard already holds in-process as a new safe-listed `duration_ms` argument on
the Terminal record. Once present, the SLI is a straight P50/P95/P99
calculation filtered to `outcome=succeeded`.
