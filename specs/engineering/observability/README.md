# Observability

Status: current for the signal sources, scrubbing law, and the checked-in
Grafana/Honeycomb artifacts; target for the legibility contract (§5) and the
cross-linked session story. Grade B — see [Known gaps](#known-gaps).

Read before touching: [`specs/engineering/observability/standard.md`](standard.md)
(the per-PR decision layer over this spec), [sentry.md](sentry.md) (component
behavior, closed catalog, privacy), `server/proliferate/integrations/sentry/**`,
`server/proliferate/middleware/{logging,request_context,request_telemetry}.py`,
`server/infra/observability/**`, `scripts/ops/grafana-*.mjs`,
[`specs/areas/observability.md`](../../areas/anyharness.md)
(span doctrine), and the
[rust-observability ADR](../../../adrs/2026-08-10-rust-observability.md)
(diagnostics plane).

Engineering systems are cross-cutting. This one owns **no product state**: it
consumes every product and runtime spec's *Emits* section (the signals) and
*Proof* section (the tests that pin them), and it turns those into one thing —
a legible account of what happened. A product system whose Emits section is
empty is invisible in production; §4 lists exactly which ones are.

## 1. Purpose

Answer, for any session, **what happened end to end** — user action → agent →
gateways → provider → failure — from one identifier, readable by a person in
under a minute and by an agent without a person. That is the only outcome;
everything below serves it.

Two readers, one story:

- **A person triaging**: opens the session, sees the turn timeline, the tool
  calls that failed, the Sentry issue that fired, and the latency that was
  outside budget — without switching identifiers between tools.
- **An agent fixing**: the launch-week demo agent consumes session replays and
  Sentry issues to propose fixes. It needs stable event names, ids it can
  join on, and links it can follow. Prose alerts and screenshots are not
  legible to it.

Stack, ruled 2026-08-25: **Sentry** (exceptions, releases, environments,
fingerprints) + **Grafana** (monitors over CloudWatch logs — the alert
evaluation source) + **Honeycomb** (traces and SLIs) + the **support
capture** path ([support](../../systems/support/README.md)), all cross-linked
from one `session_id`. Not Sentry alone.

## 2. Owned state

No product tables. Observability owns *contracts and artifacts*, all in-repo,
plus the discipline that keeps them true:

```text
server/proliferate/integrations/sentry/privacy.py       the closed catalog — every tag/extra/context key that may leave the server
server/proliferate/middleware/request_context.py        the correlation-id vocabulary (ContextVars) — the ID tuple, server side
server/infra/observability/grafana/*.json               alert rules + dashboard, checksummed; two workspaces today (§ Current state)
server/infra/observability/honeycomb/product-sli-queries.json   the SLI definitions (three, all parked — §4)
fixtures/contracts/rust-observability-v1/               diagnostics schema v1.1 golden contract (privacy rejections, limits)
proliferate-diagnostics-collector/src/export/policy.rs  EXPORT_POLICY — compile-time export ceiling, no config can widen it
scrubbers on every emitter                              server catalog · product-client scrubTelemetryEvent · AnyHarness/Worker/Supervisor before-send
```

Live provider state — Sentry projects, alert rules, Grafana contact points,
Honeycomb keys, Slack destinations — is **mutable and discovered**, never
owned: [operate Sentry](../../../guides/operating/analytics/sentry.md),
[production alerts](../../../guides/operating/production-alerts.md).
A checked-in JSON file is a *statement of intent* the operator scripts apply
and verify; it is not evidence the live workspace matches.

## 3. Public surface

The instrumentation API every other system calls (the only way a signal
enters):

| Surface | Owner file | What it is |
| --- | --- | --- |
| `report_critical(...)` | `integrations/sentry/client.py` | fatal Sentry event + the exact `CRITICAL_FAILURE` log marker — the one bridge from application failure to a page-worthy alert |
| `capture_server_sentry_exception(..., level, tags, extras)` | same | anomaly the user did not feel; tags/extras validated against the closed catalog, unlisted keys structurally absent |
| propagate the exception | Starlette/Celery integrations | genuinely failed operation → `proliferate-server` issue |
| structured log record | `middleware/logging.py` | JSON: ts, level, logger, message, `release_id`, correlation context, scalar extras — **the alert-evaluation source** |
| `with_correlation_context(**ids)` · `bind_background_correlation_context(**ids)` | `middleware/request_context.py` | bind the ID tuple for a request or a background job so logs and Sentry carry it |
| `#[tracing::instrument]` span per use-case entry; named `tracing` targets (`anyharness.*`) | `anyharness-lib/src/observability/mod.rs` | runtime events; the Sentry layer forwards ERROR events, the diagnostics client forwards lifecycle records |
| lifecycle records, closed P0 catalog (`anyharness.session.create`, `agent.start`, `turn.execute`, `tool.invoke`, `model.request`) | `proliferate-diagnostics-client/src/lifecycle.rs` | one `started` + exactly one terminal; exportable to Honeycomb under `EXPORT_POLICY` |
| `trackProductEvent(name, payload)` (126 typed names) | `product-client/src/lib/domain/telemetry/events.ts` | client product events → PostHog / anonymous telemetry (analytics owns routing) |
| `GET /v1/health` exporter fields (`exporter.state`, `dropped_records`, `last_error_classification`) | diagnostics collector | export health, never a product result |

Operator surface: `node scripts/ops/grafana-alerting.mjs <check|export|apply|restore>`
(old workspace), `grafana-rebuild-bootstrap.mjs <check|apply|verify|slack-*>`
and `grafana-sli-alerts.mjs` (rebuild workspace), both gated on
`GRAFANA_ALERTING_LIVE=1`; `scripts/ops/grafana-metadata-inventory.mjs`
(bounded read-only inventory).

Per-PR surface: every PR states its **observability delta** or an explicit
"none" ([`specs/engineering/observability/standard.md`](standard.md) §"Deciding a
change's observability delta").

## 4. Consumes

**Every system's Emits section.** Audited 2026-08-25 against the 30 product
and runtime specs on `main`. "Telemetry-shaped" means the section names at
least one stable, machine-consumable signal (a log marker, a tracing target,
a typed event, a named ship-now event); "product-shaped" means it lists only
UI/contract outputs; "empty" means no Emits section at all. Anything not
telemetry-shaped is invisible to this system today.

| System | Emits today | Verdict | What this system needs from it |
| --- | --- | --- | --- |
| [runs](../../systems/automations/runs.md) | `run.created/placed/status_changed/spawned_child/result_recorded/cancelled_tree` (target) | telemetry-shaped, **target** | the same names as log markers at the CP transition writer, stamped with the ID tuple |
| [seam](../../systems/environments/seam.md) | worker liveness → `workerDegraded`, heartbeat/enrollment events in `observability.rs`, target ship-now ingest | telemetry-shaped | `WORKER_DEGRADED` as a log marker (nothing alerts on it today — §Known gaps) |
| [environments](../../systems/environments/README.md) | sandbox transitions, usage segments, `provisioning_observability.py`, target `environment_bound/lost` | telemetry-shaped | provisioning outcome + duration per target, session-linked |
| [automations](../../systems/automations/README.md) | 14 `anyharness.workflow_*` tracing targets; CP emits nothing for definitions/invocations | telemetry-shaped (runtime only) | CP-side `invocation.created/deduped` markers when the trigger pipeline lands |
| [api](../../systems/api/README.md) | `token.minted/delegated/revoked`, `api.request` (target) | telemetry-shaped, target | audited request records with `run_id`/`session_id` |
| [billing](../../systems/billing/README.md) | segment/spend/envelope events | telemetry-shaped | `BUDGET_ENVELOPE_EXHAUSTED` marker at the enforcement point |
| [chat](../../systems/chat/README.md) | turn-end / reveal performance product events | telemetry-shaped (client) | turn-end latency keyed by `session_id` — today keyed by nothing joinable server-side |
| [organizations](../../systems/identity/organizations.md), [subagents](../../systems/subagents/README.md), runtime [workspaces](../../systems/workspaces/README.md) | named events | telemetry-shaped | keep; add `session_id` where a session exists |
| [sessions](../../systems/sessions/README.md) | the `SessionEventEnvelope` stream, status transitions, completion deliveries | product-shaped | **the story's spine** — the envelope is the replay; this system needs `session.started/ended`, `turn.started/ended` as ship-now records at the CP (target checkpoint) and the envelope's `session_id` on every Sentry event raised while serving that session |
| [integration_gateway](../../systems/integration_gateway/README.md) | `cloud_integration_tool_call_event` rows, typed error codes, approvals | product-shaped | tool-call outcome as a log record (`tool.invoked` with provider, outcome code, duration, `session_id`) — the rows exist, the log line does not |
| [model_gateway](../../systems/agent_auth/model-gateway.md) | ledger, spend attribution | product-shaped | per-request outcome/latency/model as a record with `session_id` (LiteLLM has it; nothing forwards it) |
| [agent_auth](../../systems/agent_auth/README.md), [github](../../systems/github/README.md), [slack](../../systems/slack/README.md), [accounts](../../systems/identity/accounts.md), [onboarding](../../systems/onboarding/README.md), [settings](../../systems/settings/README.md), product [workspaces](../../systems/workspace-surface/README.md), [runs-triage](../../systems/runs-triage/README.md) | contract/UI outputs | product-shaped | a failure-path marker each (auth resolution failed, install lookup failed, Slack post failed, …) |
| runtime [harnesses](../../systems/harnesses/README.md), [terminals](../../systems/workspaces/terminals.md), [artifacts](../../systems/sessions/artifacts.md), [desktop-host](../../systems/desktop-host/README.md) | runtime contracts | product-shaped | lifecycle records already exist for harness start (`anyharness.agent.start`); terminals/artifacts have none |
| [agents](../../README.md), [auth](../../systems/identity/accounts.md), [clients](../../areas/frontend.md), [support](../../systems/support/README.md), [workflows](../../systems/automations/README.md) | — | **empty** | an Emits section; support in particular must emit `support.report.captured` (report id, session id, release id) — it is the system that ties a human complaint to a session |

Also consumed: **release identity** from
[delivery](../shipping/release-delivery.md) (`release_id` on every log record and
Sentry release), and the **analytics fence** from
[analytics](analytics.md) (which typed events may reach PostHog).

## 5. Laws

**L1 — Legibility.** One session, one story. Every signal raised while doing
work for a session carries that `session_id`; every signal raised for a run
carries `run_id`; every signal carries `organization_id` and `release_id`.
The full tuple:

```text
organization_id · user_id (id only) · session_id · run_id (target) · invocation_id (target)
cloud_target_id (logical environment) · cloud_sandbox_id (provider — must stay distinct)
request_id · release_id · surface
```

These are **bounded correlation identifiers**, never license to copy content.
Server side the vocabulary is `request_context.py`; it must be *bound* (by the
request path, the gateway proxy, or the background-job entry) and *admitted*
(by the closed Sentry catalog) — both, or the id is silently absent. Before
the minimum-tonight PR the ContextVars for `session_id`, `interaction_id`,
`command_id`, `worker_id` existed and **nothing bound them, and the catalog
rejected them** (`test_sentry_transport_privacy.py` pinned `session_id` →
dropped). This law is target until W1 merges; it is the single most
important gap in the system.

**L2 — Machine-legible names.** Signal names are stable identifiers in the
form `<system>.<object>.<verb>` (`run.created`, `session.launch_selection.validated`,
`anyharness.session.create`, `token.minted`) and never free text; outcomes
are closed enums (`succeeded / rejected / failed / abandoned`); failures carry
a bounded code, never an error body. A rename is a seam change.

**L3 — Three surfaces, three jobs.** Structured logs → CloudWatch → Grafana is
the **alert-evaluation source**. Sentry is the **exception and release
surface**. Honeycomb is the **trace and SLI surface**. No surface is a
success condition for a product request; each is best-effort and no-ops when
unconfigured.

**L4 — Closed catalog, never-suspend scrubbing.** The server builds outbound
Sentry events from an allowlist, not by deletion; clients, AnyHarness,
Worker, and Supervisor install explicit before-send scrubbers; child-agent
stderr never reaches Sentry; anonymous telemetry is the strictest tier.
Nothing here relaxes for a demo. Full law in [sentry.md](sentry.md) and
[`specs/engineering/observability/standard.md`](standard.md) §Scrubbing.

**L5 — Cross-linked from one id.** Given a `session_id`, a reader can reach
the Sentry issues for it (tag search), the Honeycomb trace/lifecycle records
for it (`session_id` column), the CloudWatch log lines for it (JSON field),
and the product session page. Links are constructed from ids by a fixed
scheme, never hand-pasted into alerts.

**L6 — Emit on threshold, in code.** Latency and count budgets live in code
and emit one bounded record when exceeded; alert rules select markers, they
do not compute business thresholds. (Why: a rule that encodes a threshold is
invisible to tests.)

**L7 — One capture per failure.** A handled AnyHarness incident returns its
`urn:proliferate:anyharness:incident:<uuid>` receipt; the client does not
re-capture it. Propagate *or* capture *or* report-critical — never two.

**L8 — Signals die with their surfaces.** A culled feature's markers, rules,
SLIs, and typed events are deleted in the same PR (deletion-completeness),
and display names are grep-gated, not just slugs.

**L9 — The record is the replay.** The runtime session event log
(`SessionEventEnvelope`, append-only, seq-ordered — sessions Law 10) is the
canonical replay a fixing agent reads. Observability never builds a second
transcript; it *links to* the record and *annotates* it with ids.

**L10 — Issue → test.** Every production issue that gets fixed leaves a test
whose name or docstring cites the Sentry issue id or the event name that
surfaced it (owner: the testing spec; this system supplies the stable id).

## 6. Emits

- **Alerts** — Grafana rule firings on the six checked-in rules (five
  production + one SLI), delivered to Slack (`slack-ops-alerts` critical,
  `slack-eng-triage` warning) and SNS email. Thresholds, severities, and
  destinations are the **alerting** spec's; this system emits the markers
  the rules select (`CRITICAL_FAILURE` today).
- **Sentry issues** with release, environment, surface, and the ID tuple as
  tags — consumed by the fix loop and the demo fixing agent.
- **Honeycomb lifecycle records** (`anyharness` dataset, dogfood env) —
  consumed by the three SLI queries when a key that can execute exists.
- **Structured log stream** in `/ecs/proliferate-prod` — consumed by Grafana
  and by anyone reading a session's story.
- **Exporter health** on `/v1/health` — consumed by desktop support capture.
- **The per-PR observability delta** — consumed by review.

## 7. Fences

- **Alerting (+ fix loop)** owns rule thresholds, severity policy
  ("non-noisy": fire only when something is quite broken or something we did
  not expect to break broke; Slack for prod, phone only for production-down),
  routing, runbooks, and the issue→test loop. Observability owns the markers
  and the correlation that make a rule *possible*. The rule JSON files sit in
  this system's tree until the alerting spec lands; ownership transfers then.
- **Analytics** owns PostHog, anonymous telemetry, Metabase, and which
  product events are permitted ([analytics](analytics.md)).
- **Delivery** owns release construction and the `release_id` identity
  ([delivery](../shipping/release-delivery.md)).
- **Support** owns capture, S3 custody, redaction, and the Slack receipt
  ([support](../../systems/support/README.md)); observability consumes its
  report id as a correlation field.
- **Diagnostics plane** (collector, protocol, client, desktop debug story) is
  ADR-owned; this spec states the export law it must obey, not its internals.
- **Each product system owns its Emits.** Observability may *require* a
  signal (§4) but never writes another system's emitter.
- **Testing** owns tiers and proof placement; observability supplies ids.
- **The cull ledger**: the issue tracker and its Grafana receiver are gone
  (2026-08-25); nothing here re-creates an aggregation queue.

## 8. Code map

```text
server/proliferate/
├── integrations/sentry/{__init__,client,privacy}.py   init, capture helpers, closed catalog (TAG_VALIDATORS / EXTRA_VALIDATORS)
├── middleware/logging.py                              JSON log formatter, release_id, correlation fan-in
├── middleware/request_context.py                      ContextVars: the ID tuple + binders
├── middleware/request_telemetry.py                    per-request Sentry tags, path-derived session binding, correlation → Sentry at teardown, user clear
├── server/event_logging.py                            correlation-carrying structured event helper (misnamed — see gaps)
└── server/cloud/provisioning_observability.py         provisioning telemetry (environments-owned emitter)
server/infra/observability/
├── grafana/production-alerts.json                     OLD workspace g-e532d030d8 (proliferate-ops) — five rules
├── grafana/production-alerts-rebuild.json             NEW workspace g-48655e6419 (proliferate-ops-rebuild) — same five + wiring
├── grafana/sli-alerts.json                            sign-in SLI rule (rebuild)
├── grafana/production-overview-dashboard.json         the one dashboard
└── honeycomb/product-sli-queries.json                 three SLI query specs (parked)
scripts/ops/grafana-{alerting,client,rebuild-bootstrap,sli-alerts,metadata-*,receipts,credential-process}.mjs (+ tests)
anyharness/crates/
├── anyharness/src/telemetry.rs · proliferate-worker/src/logging.rs · proliferate-supervisor/src/logging.rs   Rust Sentry + scrubbers
├── anyharness-lib/src/observability/mod.rs            named tracing targets
├── proliferate-diagnostics-{protocol,client,collector}/   diagnostics plane; collector/src/export/{otlp.rs,policy.rs}
apps/packages/product-client/src/domain/telemetry/scrub.ts · lib/domain/telemetry/events.ts   client scrubber + typed events
apps/{desktop,web,mobile}/**/telemetry/**              per-surface Sentry adapters
fixtures/contracts/rust-observability-v1/              diagnostics golden contract
specs/engineering/observability/standard.md · specs/areas/observability.md · specs/areas/telemetry.md   standards this spec governs
guides/operating/production-alerts.md · guides/operating/analytics/sentry.md              operator procedures
```

## 9. Proof

- `server/tests/unit/test_sentry_transport_privacy.py` — the closed catalog:
  every tag/extra row, wrong-type rejection, attachment clearing, span-op
  negatives. **Any change to the ID tuple changes this file.**
- `server/tests/unit/test_request_telemetry_session_binding.py` — the
  path-derived `session_id` binding: a `sessions/<uuid>` pair binds, a
  non-UUID segment does not, a session-less path binds nothing.
- `tracing_error_reaches_the_sentry_client` in AnyHarness, Worker, and
  Supervisor — single `sentry-core` instance (the 2026-06 silent-drop
  incident).
- `scripts/ops/grafana-alerting.test.mjs`, `grafana-rebuild-bootstrap.test.mjs`,
  `grafana-sli-alerts.test.mjs`, `grafana-client.inventory.*.test.mjs` —
  rule allowlist, checksums, redaction of every console line, target lock.
- `fixtures/contracts/rust-observability-v1/` consumers in Rust, Python, and
  TS — diagnostics privacy rejections and limits.
- `apps/packages/product-client/src/domain/telemetry/*.test.ts` — client
  scrubber and route-id redaction.
- Offline gates run in CI's repo-shape job: `node scripts/ops/grafana-alerting.mjs check`,
  `python3 scripts/check_docs.py`.
- Live acceptance (manual, recorded in the PR): one synthetic
  `report_critical` in staging → Sentry issue tagged `critical_failure=true`
  **and** rule `bfrmh7e7x2k8wd` fires to Slack; one proxied session request
  → a Sentry event carrying `session_id`.

## Current state (what is wired on `main`, 2026-08-25)

```text
server JSON logs ──► CloudWatch ──► Grafana rules ──► Slack / SNS email     (live; the only path that alerts)
server + clients + runtime exceptions ──► Sentry                            (live; session_id NOT on server events before W1)
runtime lifecycle records ──► diagnostics collector ──► Honeycomb (OTLP)    (dogfood only; SLIs never executed — no execute key)
client typed events ──► PostHog / anonymous telemetry                       (analytics-owned)
support reports ──► S3 + Slack receipt                                      (support-owned; no session link surfaced)
```

Jank carried honestly: two Grafana workspaces with the same five rules
(OLD `proliferate-ops` delivers to Slack; NEW `proliferate-ops-rebuild`
delivers to SNS email + Slack via `slack-apply`); `cloud/observability.py`
has zero callers; `event_logging.py` is redaction/correlation logging, not
event shipping; `workerDegraded` is computed and shown but never alerted;
the 24K-LOC diagnostics plane is desktop-oriented; Desktop-native has no
before-send scrubber.

## Minimum tonight

Goal: by tomorrow morning a person can open a broken session and see its
story across Sentry, logs, and Honeycomb from one id, and every server
Sentry event raised for a session says which session. Each PR is glue or
config; none changes product state; none touches
`server/proliferate/server/cloud/**` (PR-Ab in flight).

| PR | Files | Change | Proof |
| --- | --- | --- | --- |
| **W1 — session id survives to Sentry and logs** | `integrations/sentry/privacy.py`, `middleware/request_telemetry.py`, `tests/unit/test_sentry_transport_privacy.py`, `tests/unit/test_request_telemetry_session_binding.py` | Admit the UUID-shaped correlation ids — `session_id`, `interaction_id`, `command_id`, `anyharness_workspace_id` — to `TAG_VALIDATORS` via `canonical_uuid` (non-UUID ids do not survive; `worker_id` and `external_sandbox_id` are not UUID-shaped and stay out). Bind `session_id` from the request path when a `sessions/<uuid>` pair appears (the gateway proxies runtime paths verbatim; the middleware sees them) so logs and Sentry carry it without touching `cloud/`. | Catalog rows flip to `survives=True`; the binding test proves a proxied path binds and a non-UUID segment does not; a request without a session binds nothing. |
| **W2 — Honeycomb SLIs marked parked with named triggers** | `server/infra/observability/honeycomb/product-sli-queries.json` | Replace the narrative `status` strings with `status: PARKED` + `trigger` per SLI (session-create: "execute-capable key exists"; launch-selection: "first support burden from selection failures"; time-to-first-output: "latency becomes a sales objection"). | JSON validates; `grafana-alerting.mjs check` unaffected. |
| **W3 — spec + standard aligned** | this README, `engineering/README.md` row | This document; the one-line index description; the standard's depth pointer already resolves. | `check_docs.py` green. |

Blocked tonight by the `cloud/` freeze, queued for the morning after PR-Ab
merges (each is one file and one test):

- **W4 — `WORKER_DEGRADED` marker.** `cloud/workspaces/service.py::_worker_degraded`
  logs a bounded marker (`cloud_target_id`, `cloud_sandbox_id`, `session_id`
  if bound) on the false→true edge; the alerting spec decides whether it
  becomes a rule. Closes the documented "nothing alerts on it" gap.
- **W5 — gateway binds the tuple.** `cloud/gateway/**` calls
  `with_correlation_context(session_id=…, cloud_target_id=…, cloud_sandbox_id=…)`
  around the proxy, making W1's path heuristic redundant (keep the heuristic
  as the fallback for non-proxied session routes).
- **W6 — delete `cloud/observability.py`** (zero callers).

## Target

- **The session story page.** The runs-triage surface renders, for one
  `session_id`: the checkpointed event log (turns, tool calls, results), the
  Sentry issues tagged with it, the Honeycomb trace link, the CloudWatch
  Logs Insights link, and the support reports citing it — five links built
  from one id by one scheme. This is the page the fixing agent reads.
- **Honeycomb as the SLI home.** The three SLIs run live in the `anyharness`
  dataset once an execute-capable key exists; SLIs are defined *there*, and
  Grafana keeps only *monitors* (infra rules + a burn-rate rule per SLI).
  New SLIs proposed with the fleet: session-create success, time-to-first-
  output, tool-call success by provider, run terminal outcome by definition.
- **Sentry configured well.** `environment` from the closed four-value
  catalog; `release` = component@version+sha12 on every emitter (already);
  fingerprinting = exception type + catalog tags (already, server); tag
  `session_id` on server, client, and runtime events; issue alerts route
  through the alerting spec, never straight to a person.
- **The runtime tags sessions.** AnyHarness's Sentry layer maps the
  `session_id` span field onto the event tag so runtime ERRORs join the same
  story (today runtime events carry org/user/sandbox/target only).
- **Fleet markers** at the CP transition writer (`RUN_TERMINAL` with a
  closed outcome enum, `SPAWN_LIMIT_BREACH`, `BUDGET_ENVELOPE_EXHAUSTED`) —
  emitters land with the runs/api/billing builds; rules with the alerting
  spec.
- **One Grafana workspace.** Consolidate to the rebuild; the old workspace
  is the rollback until a burn-in period passes, then retired with its JSON.

> [!decision] PABLO DECIDES: canonical Grafana workspace.
> Options: (a) `proliferate-ops-rebuild` (g-48655e6419) canonical, retire
> `proliferate-ops` (g-e532d030d8) after a one-week burn-in with Slack
> delivery re-verified on the rebuild; (b) keep both. Recommendation: (a) —
> the rebuild has the SLI rule, the dashboard, and the `check/apply/verify`
> tooling; two workspaces is the confusion tax the as-is analysis named.

> [!decision] PABLO DECIDES: Honeycomb credentials.
> The three SLIs are parked solely because neither available key can
> execute queries (`HONEYCOMB_READ_KEY` 401, `HONEYCOMB_CONFIG_KEY` cannot
> execute). Recommendation: mint one execute-capable key for the `anyharness`
> dataset this week; the session-create SLI has real data waiting.

> [!decision] PABLO DECIDES: the link scheme for the story.
> Recommendation: the app session route is the canonical entry
> (`/sessions/{id}` on the hosted app, once the CP registry exists — until
> then the workspace deep link); Sentry link = tag search
> `session_id:{id}` in the `proliferate-server` project; Honeycomb link =
> saved query with `session_id = {id}`; CloudWatch = Logs Insights with
> `filter session_id = "{id}"`. Encode the scheme once in a small server
> helper the triage surface and the alerting runbooks both import.

> [!decision] PABLO DECIDES: admit non-UUID session ids?
> Runtime session ids are UUID v4 by default, but a client may supply its own
> id on create (fixtures use `session-01`). Recommendation: no — the catalog
> admits canonical UUIDs only; custom ids stay local-only. Bounded beats
> complete for a vendor-bound tag.

## Known gaps

- [ ] L1 is target until W1 merges (admission + path binding); W5 adds
      gateway binding after the `cloud/` freeze lifts.
- [ ] `workerDegraded` never alerts (W4).
- [ ] Runtime Sentry events carry no `session_id` tag (target: span-field →
      tag mapping in `anyharness/src/telemetry.rs`).
- [ ] Client Sentry events carry no active-session tag; product-client
      `scrubTelemetryEvent` would need an allowlisted `session_id` tag
      (client fork item).
- [ ] Five specs have no Emits section at all (§4); `support` is the most
      consequential — a human report cannot be joined to its session.
- [ ] Two Grafana workspaces (ruling above).
- [ ] Three Honeycomb SLIs parked (ruling above).
- [ ] `cloud/observability.py` dead (W6); `event_logging.py` misnamed
      (rename rides the Wave-2 server regroup, not a behavior PR).
- [ ] Desktop-native lacks a before-send scrubber (pre-existing; do not
      widen desktop-native telemetry until closed).
- [ ] No cost-anomaly signal (E2B, AWS, LLM spend) — belongs to the alerting
      spec once billing emits `BUDGET_*` markers.
