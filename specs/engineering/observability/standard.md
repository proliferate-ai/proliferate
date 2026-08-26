# Observability Standard

How Proliferate stays observable: which signal a change should emit, where
each signal goes, and what must never travel with it. Consider this document
in every PR: state the change's observability delta — or an explicit "none" —
in the PR description. System depth lives in
[`specs/engineering/observability/`](README.md);
this page is the per-PR decision layer over it.

## Harness launch-option authority events

The observation → create → actor → live-mutation chain emits these bounded
records:

| Event | Required safe fields |
| --- | --- |
| `agent.launch_options_probe.completed` | harness kind, basis/revision, result/state, counts, duration, bounded failure code |
| `agent.launch_options.served` | harness kind, basis/revision, state, counts |
| `session.launch_selection.validated` | session/correlation identity, harness kind, result, selected key names/counts, bounded rejection code |
| `session.initial_config.apply` | session identity, config key, membership/apply/confirmation result (`confirmed`, `unconfirmed`, `membership_rejected`, `membership_dropped`, `apply_failed`, `final_mismatch`) |
| `session.initial_config.dropped` | session identity, config key |
| `session.live_config.changed` | session identity, source sequence, changed key, apply result |

These events never contain selected values, model IDs, descriptions, provider
output, credentials, prompts, environment values, or filesystem paths. Probe
materialization errors use bounded codes rather than error bodies.

## The model

Four signal surfaces, deliberately separate:

- **Sentry** — exceptions, traces, breadcrumbs, critical-failure markers.
  Hosted-product components only, DSN-gated; a missing DSN or disabled
  telemetry must no-op, never block startup or handling work. Provider
  delivery is diagnostic and never a product request's success condition.
- **Structured server logs** — non-debug server logs are JSON with timestamp,
  level, message, canonical `release_id`, and correlation context
  (`server/proliferate/middleware/logging.py`). In the hosted stack they feed
  CloudWatch/Grafana; this — not Sentry — is the alert-evaluation source.
- **PostHog** — hosted-client product analytics. Autocapture and automatic
  page views are off; only explicitly permitted typed events are sent.
- **Anonymous telemetry** — first-party install-level `VERSION` /
  `ACTIVATION` / `USAGE` records, enabled in every deployment mode unless
  disabled. Vendor telemetry (Sentry, PostHog) is `hosted_product` only.

Sentry and logs correlate through release and request/product identifiers —
never by copying evidence bodies between systems. Server request telemetry
binds a generated request id, id-only user, and allowlisted correlation
fields, and clears the Sentry user at request teardown. No route string —
sanitized or otherwise — survives onto a Server Sentry event. The
logical cloud sandbox is `target_id`; the provider sandbox is `sandbox_id`;
the two must remain distinct.

## Diagnostics contract

`proliferate-diagnostics-protocol` and the matching ProductClient/server pure
representations define diagnostics schema v1.1. Detailed records explain local
execution; canonical lifecycle records use the closed P0 catalog and one
`started` plus exactly one allowed terminal. The shared golden contract is
`fixtures/contracts/rust-observability-v1/`; it pins privacy rejections, API
shapes, limits, version compatibility, and the release RSS profile. The
standalone `proliferate-diagnostics-collector` consumes it over authenticated
loopback and owns only bounded local ingest, query, tail, export, health, and
collector-owned lifecycle evidence; its concrete process and transport seam is
documented in the [collector README](../../../anyharness/crates/proliferate-diagnostics-collector/README.md).
Desktop Tauri owns the packaged collector process, authenticated readiness and
restart policy, a same-user native query broker, and a bounded
`desktop-native.log` bootstrap/outage fallback. Tauri detail uses the collector
as its primary local path only while ready. Desktop renderer detail now enters
through one platform-neutral ProductClient port, is filtered and bounded by the
Desktop sink, and is submitted as exact schema-v1.1 batches through the
main-window-only Tauri handoff. An eligible direct pre-dispatch collector state
may retain those already-filtered records in `desktop-native.log` while the
command still returns the original unavailable result; post-dispatch failures
never fall back. The obsolete renderer diagnostics file receives no new writes,
but historical discovery remains available to support collection. The bundled
`anyharness serve` child and the Desktop dispatch Worker carry
`proliferate-diagnostics-client`: one global tracing layer per process feeds a
bounded admission queue with receipts, activated purely by possession of the
two reserved Desktop bridge/shutdown descriptors (`Disabled`, `Bundled`, or
`BundledDegraded` — an observability outcome, never a product failure).
Supported-macOS bundled runs write no new `anyharness.log*` once their producer
installs; a `BundledDegraded` bootstrap suppresses it whether or not the
producer installed, because the Desktop bridge still owns that run's
diagnostics authority. A collector-ready bundled run whose producer failed to
install keeps its legacy file sink, which is all that stands between it and no
diagnostics at all. Bundled runs write no `worker.log` — Desktop drains Worker
stdout/stderr into a bounded in-memory tail — while each producer keeps a fixed
bounded per-component fallback file family. Standalone, external
`ANYHARNESS_DEV_URL`, cloud/Supervisor, and unsupported-platform modes keep
their existing sinks, and historical log bytes are never rewritten. Support-file
migration is not part of this change. Collector builds add one
more route for the same accepted records: a provider-neutral OTLP/HTTP JSON
adapter whose destination URL and request headers are environment values rather
than contract fields. The adapter is compiled into every build, and what a build
may export is a compile-time constant, `EXPORT_POLICY` in
`proliferate-diagnostics-collector/src/export/policy.rs`, that no configuration
value can relax. A customer build carries `LifecycleOnly`, so only
`record_class == lifecycle` with every field `operational` can be exported and
the detailed class, the only class that can carry free text, never leaves the
machine; the `internal-dogfood-export` feature widens that to `All` and adds the
per-developer `dev.user` tag. The release job refuses a bundle whose packaged
collector does not report `lifecycle_only`, or whose binaries carry the
dogfood-only marker or dev-tag literals. Independently of the policy, any build
exports nothing until a destination is configured out of band, so customer
export stays dark until that configuration is a deliberate decision. Exported
records carry `proliferate.install_id`, a resource attribute the collector
stamps from a value its host passes on the process seam as `--install-id`; the
desktop passes the `desktop_install_id` it already owns. It is not a
wire-protocol field, so no producer can set or spoof it, and it is what
distinguishes one install failing forty times from forty installs failing once.
It is absent rather than invented when the host has no identity to give. The adapter is bounded best effort —
a fixed queue that drops rather than grows, a fixed batch, one attempt plus two
retries, a cooldown, and no disk outbox or replay — so a failing destination
changes only `exporter.state`, `exporter.dropped_records`, and a fixed-table
`exporter.last_error_classification` in `/v1/health`, never local ingestion,
retention, or a product result. Server log routing, Sentry, PostHog,
and anonymous telemetry are unchanged. The approved boundary and slice registry live in
[`../adrs/2026-08-10-rust-observability.md`](../../../adrs/2026-08-10-rust-observability.md).

Support snapshot preparation keeps that one-started-one-terminal shape and never adds an event to describe a failure. When the export permit refuses a preparation because the window is not canonical, and only while the preparation is still running rather than already interrupted, the existing `desktop.support_snapshot.prepare` operation appends exactly two bounded arguments to its terminal record: `failure_stage=export_permit` and `failure_reason=noncanonical_window`. Both are `Operational` enum values from a closed set. Interruption is first-wins, so a cancelled, deadlined, or abandoned preparation carries neither argument even if the permit would also have refused it, and every other failure cause carries neither argument. No timestamp, identifier, path, or window content ever rides these arguments, and the started record never carries them.

## Instrumenting a new feature

Choose by what actually happened, not by convenience — do not `raise` to flag
a non-failure, and reserve paging for real paging conditions: a `warning`
anomaly that fires constantly trains everyone to ignore the fatal ones.

| Signal | Where it goes | How it's named | What enforces it |
| --- | --- | --- | --- |
| Server operation genuinely failed | Let the exception propagate; auto-captured as a `proliferate-server` Sentry issue | Release/environment/surface tags attached by the SDK init | Closed-catalog projection in `server/proliferate/integrations/sentry/**` |
| Anomaly the user didn't feel (latency budget exceeded, invariant violated, unexpected-but-recovered branch) | `capture_server_sentry_exception(..., level="warning", tags={"domain": ..., "action": ...})` — request still succeeds; emit on threshold, not per call (the budget lives in code, not in an alert rule) | Grouping comes from the exception type plus the catalog tags; callers cannot set `fingerprint`, and `anomaly`, `elapsed_ms`, and `budget_ms` are not catalog keys. Adding a new tag or extra means adding a validated row to the closed catalog in `sentry/privacy.py` | Closed catalog + `tests/unit/test_sentry_transport_privacy.py` |
| Page-worthy "must never happen" invariant | `report_critical(...)` — fatal Sentry event tagged `critical_failure=true` **and** the `CRITICAL_FAILURE` structured-log marker | The marker is the exact log identity | Grafana rule `bfrmh7e7x2k8wd` alerts on the marker in `/ecs/proliferate-prod` |
| Rust runtime diagnostics | One `#[tracing::instrument]` span per use-case entry; phase timings are span events, not hand-rolled `Instant::now()` pairs; log where an error is *handled*, not at every hop | Fields (`flow_id`/`flow_kind`/`prompt_id`) declared once on the span; observability context never appears in a function signature | Review (span doctrine); `tracing_error_reaches_the_sentry_client` tests guard Sentry delivery |
| Frontend product analytics | Typed catalog `apps/packages/product-client/src/lib/domain/telemetry/events.ts` → `trackProductEvent(...)` fanout (vendor, anonymous, or both) | Stable event names; payloads are enums, booleans, counts, versions, provider kinds — never arbitrary string bags | Typed event map; hosted PostHog events are explicitly permitted, others become at most Sentry breadcrumbs |
| Frontend exception | Capture from hooks or error boundaries, never ordinary render components; mark `meta.telemetryHandled = true` so global React Query handlers don't double-report | Low-cardinality tags only: `domain`, `action`, `provider`, `workspace_kind`, `route`; diagnostic values in scrubbed extras | Shared `scrubTelemetryEvent` scrubber (`apps/packages/product-client/src/domain/telemetry/scrub.ts`) |
| Install-level adoption signal | Anonymous telemetry record → `POST /v1/telemetry/anonymous`; prefer deriving it from an existing typed product event over adding a second telemetry call at the workflow hook | Fixed record types `VERSION` / `ACTIVATION` / `USAGE` with fixed milestone and counter names | Server-side schema validation on the endpoint |

One capture path per failure: for a handled AnyHarness failure, ProductClient
capture is suppressed only when the cause chain carries an exact
`urn:proliferate:anyharness:incident:<uuid>` RFC 7807 instance — the runtime
already owned that capture and returned the receipt.

## Scrubbing and redaction

Never send: email, display name, prompt or transcript content, terminal
output, file contents, repository names, raw file paths, request bodies,
cookies, authorization headers, tokens, secrets, environment values, or raw
provider responses. Correlation identifiers are diagnostic metadata, not
permission to copy user content into a vendor. Raw provider output is never a
safe Sentry grouping key or exception message. Scrubbers are the backstop,
not a license — callers keep content out of tracing fields in the first place.

The scrubbers are deliberately asymmetric; know which side of each line a
change sits on:

- **Who scrubs:** the server, the Web/Desktop/Mobile clients (via the shared
  `scrubTelemetryEvent` envelope wrapper), AnyHarness, Worker, and Supervisor
  all install explicit before-send scrubbers. **Desktop-native does not** —
  it transmits stack traces without an explicit scrubber (known gap, needs a
  separate implementation PR).
- **The Server is a closed catalog, not a scrubber:** `sentry/privacy.py`
  builds a new event from an allowlist rather than deleting from the SDK's
  event, so an unlisted key is structurally absent instead of merely redacted.
  Validation runs twice: pre-SDK public ingress in `sentry/client.py` sees the
  original Python objects, and the shared `before_send` /
  `before_send_transaction` projector sees only the SDK's already-serialized
  JSON representation and cannot recover erased provenance. Attachments are
  cleared in the callback (`hint["attachments"] = []`, read back and proved, or
  the event is dropped). The only emitted fingerprint is the adapter-synthesized
  `["billing", "stripe_webhook_drop", <drop_reason>]`. Init installs exactly
  eight integrations with `default_integrations=False` and
  `auto_enabling_integrations=False`, and disables ambient trace propagation,
  Spotlight, client reports, sessions, logs, metrics, profiles, gen-AI span
  streaming, and DB/HTTP source context. Middleware spans are off; the only
  five span ops produced are `http.server`, `websocket.server`,
  `queue.task.celery`, `queue.process`, and `queue.publish` — notably **not**
  `queue.submit.celery`. `environment` is a closed four-value catalog
  (`trusted-beta`, `staging`, `production`, `Production`). Release and
  environment are passed as exact empty strings when unresolvable, which is
  the pinned SDK's no-discovery sentinel (`None` would trigger ambient
  `SENTRY_RELEASE` / `SENTRY_ENVIRONMENT` discovery and a `production`
  default); both callbacks then remove the sentinel.
- **Deliberately preserved:** the top-level Sentry `environment` field and the
  `runtime_env` tag on Worker/Supervisor events whose only allowed live value
  is `e2b`. The Server keeps `environment` only when it matches its closed
  four-value catalog; the client wrappers still use the snapshot/scrub/restore
  mechanic for it. Every other env-like key stays redacted; raw environment
  maps never pass.
- **Structural, not length, bounds:** client payload scrubbing bounds depth,
  array positions, and object properties (`[circular]`, `[truncated]`) but
  does not truncate strings by length — what you put in a string field ships.
- **Replay is off for customers, and internal-only on Desktop:** Web/Mobile
  Sentry replay rates are zero; Desktop renderer Sentry replay and Web/Mobile
  PostHog session recording are source-disabled and absent. Desktop PostHog
  recording never auto-starts and begins only for the closed internal audience
  in `product-client/src/domain/telemetry/replay-audience.ts`, and only when
  the PostHog project also enables replay server-side. The recorded page-URL
  route-id gap is closed by
  `product-client/src/domain/telemetry/route-id-redaction.ts`, which reduces
  every URL and every rrweb `href`/`src` to a bounded route template from a
  closed table and fails closed to `/unknown`. Widening to customers, or
  re-enabling any other surface, requires the reviewed synthetic privacy proof
  in [`frontend/telemetry.md`](../../areas/frontend.md); a new surface that can
  display prompts, files, paths, or credentials gets `[data-telemetry-block]` /
  `[data-telemetry-mask]` unless there is a reviewed reason not to.
- **Child-agent stderr never reaches Sentry:** AnyHarness marks it with a
  dedicated tracing target the Sentry layer ignores; a startup failure keeps
  at most eight lines / 1,024 UTF-8 bytes per line locally and returns a
  typed `AGENT_STARTUP_FAILED` problem instead.
- **Anonymous telemetry is the strictest tier:** install UUID and fixed
  low-cardinality fields only — no user identity, raw error strings, or any
  free-form/high-cardinality string, in any deployment mode.

## The incident behind the delivery rules

Production incident 2026-06-14 → 2026-07-15: a `sentry`-only crate bump left
`sentry-tracing` behind, splitting `sentry-core` into two linked instances;
the tracing layer captured into a clientless Hub and **every runtime ERROR
event was silently dropped while local logs still showed the errors**. Hence
two standing rules: the Rust workspace's `sentry`, `sentry-anyhow`, and
`sentry-tracing` dependencies must resolve to a single `sentry-core` instance
(the `tracing_error_reaches_the_sentry_client` tests in AnyHarness, Worker,
and Supervisor fail on any new divergence), and a missing Sentry event is
never evidence that the operation did not fail — structured/local logs are
the fallback evidence source.

## Deciding a change's observability delta

1. New failure path? Pick a row from the table above — propagate, `warning`
   anomaly with a stable fingerprint, or `report_critical`.
2. New user-visible flow? Decide whether it earns a typed product event and
   whether that event is permitted for PostHog.
3. New surface rendering user content? Apply the block/mask selectors; they
   stand even though no surface records today.
4. New identifier worth correlating on? It must join the server request
   telemetry allowlist — it is not automatically forwarded.
5. Touched a scrubber, telemetry gate, DSN wiring, or the Sentry crate pins?
   Say so explicitly; these paths carry the known gaps and the incident above.
6. Nothing observable changed? State "none" — that is a valid answer, silence
   is not.

Depth: [`observability/README.md`](README.md)
and [`sentry.md`](sentry.md) (system
contract), [`specs/areas/telemetry.md`](../../areas/frontend.md),
[`specs/areas/observability.md`](../../areas/anyharness.md)
(span doctrine), [`engineering/analytics/`](analytics.md)
(anonymous telemetry, PostHog, Metabase),
[`guides/operating/production-alerts.md`](../../../guides/operating/production-alerts.md)
(the six Grafana rules), and [`guides/operating/analytics/`](../../../guides/operating/analytics/README.md)
(operating Sentry/PostHog).
