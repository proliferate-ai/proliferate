# Alerting and Fix Loop

Status: current for the six checked-in Grafana rules, their delivery, and the operator tooling; target for the non-noisy severity contract (§5), the machine-legible alert shape, and the alert → issue → fix → test loop. Grade C — see [Known gaps](#known-gaps).

Read before touching: [`guides/operating/production-alerts.md`](../../../guides/operating/production-alerts.md) (the runbook and the two-workspace reality), `server/infra/observability/grafana/*.json` (rule identity, checksummed), `scripts/ops/grafana-{alerting,rebuild-bootstrap,sli-alerts}.mjs` (the only sanctioned writers), [observability](../observability/README.md) (the markers and ids this system selects on), [testing](../testing/README.md) (the proof-trailer convention that closes the loop), and the customer-loop spec, `specs/engineering/customer-loop/README.md` (the human-report leg of the same loop; landing in parallel, PR #2231).

Engineering systems are cross-cutting. This one owns **no product state**: it consumes every product and runtime spec's *Emits* (the markers a rule can select) and *Proof* (the tests a fix must extend), and it owns exactly two decisions — **when a person is interrupted**, and **what happens between the interruption and the test that proves it cannot recur.**

## 1. Purpose

Interrupt a person only when something is actually quite broken, or when something we did not expect to break has broken — and make every interruption legible enough that a person *or an agent* can go from the alert to the session, the fix, and the pinning test without asking anyone.

Two consumers, one contract:

- **Pablo, tomorrow morning**: opens Slack, sees only things that are
  broken, each with a link to the session story and the Sentry issue, and
  nothing that is merely "happening".
- **The fixing agent** (launch-week demo): consumes Sentry issues and session
  replays, files a `support:report`- or `alert:`-labelled issue, proposes a
  fix, and adds a test carrying the `Surfaced-by:` trailer. It needs stable
  rule names, ids it can join on, and links it can follow. It cannot use a
  paragraph.

Rulings encoded here (2026-08-25, not re-litigated in this document): non-noisy by law; Slack for production, phone only for production-down; a small fixed severity set; the tracker is culled, GitHub Issues is interim intake; every fixed issue leaves a test.

## 2. Owned state

No product tables. This system owns contracts and artifacts:

```text
server/infra/observability/grafana/production-alerts.json          five rules — OLD workspace g-e532d030d8 (proliferate-ops); delivers to Slack
server/infra/observability/grafana/production-alerts-rebuild.json  same five + datasource/contact/dashboard wiring — NEW workspace g-48655e6419
server/infra/observability/grafana/sli-alerts.json                 sign-in SLI rule (NEW workspace only)
guides/operating/production-alerts.md                              per-rule runbook sections; the runbook_url annotation targets these anchors
scripts/ops/grafana-alerting.mjs · grafana-rebuild-bootstrap.mjs · grafana-sli-alerts.mjs   check / export / apply / restore / verify — target-locked, live-gated
```

Ownership of the rule JSON files transfers from the observability tree to this system by this spec; they stay where they are on disk (no folder moves this pass) and are listed here as owned.

Live provider state — the Alertmanager config (receivers, routes), the SNS topic and its subscriptions, Slack webhooks, Sentry alert rules — is **mutable and discovered**, never owned. As of 2026-08-25 the OLD workspace's Alertmanager carries exactly three receivers, `grafana-default-sns`, `slack-ops-alerts`, `slack-eng-triage`; the root route delivers to `slack-eng-triage`, with one child route `severity=critical` → `slack-ops-alerts`. The issue-tracker receiver and its routes were removed by hand during the cull ([record](../../../guides/operating/production-alerts.md#retired-the-issue-tracker-webhook-contact-point)).

## 3. Public surface

What the rest of the codebase calls or reads:

| Surface | Owner | What it is |
| --- | --- | --- |
| `report_critical(...)` → `CRITICAL_FAILURE` log marker | `server/proliferate/integrations/sentry/client.py` (observability-owned emitter) | the **only** application-level bridge to a paging rule today; 11 call sites (materialization runner/failures, agent-auth worker/verification, billing authorization/reconciler/webhook drops) |
| the six rule identities (`proliferate_rule_uid` label, immutable) | rule JSON | what a route, a runbook anchor, and a `Surfaced-by: alert:<uid>` trailer join on |
| `severity` label ∈ {`critical`, `warning`} | rule JSON | the routing key; §5 fixes the set |
| `runbook_url` annotation | rule JSON | every firing alert links to its section of the runbook |
| Slack channels `#ops-alerts` (critical) and `#eng-triage` (warning), SNS email | live Alertmanager | the human destinations |
| `Surfaced-by: alert:<rule_uid> · sentry:<issue> · session:<id>` | test docstring trailer (testing spec §5 law 6) | how a fix points back at what surfaced it |
| GitHub issue labels `alert:<severity>` and `support:report` (customer loop) | GitHub Issues (interim intake) | the fix-loop work item; carries ids and links, never content |

Operator surface: `node scripts/ops/grafana-alerting.mjs check` (offline, in CI's repo-shape lane); live `export/apply/restore` and the rebuild/SLI tools, all gated on `GRAFANA_ALERTING_LIVE=1`.

## 4. Consumes

- **Observability's markers and ids.** A rule may select only a stable log
  marker or a metric derived from one; the ID tuple (`session_id`,
  `organization_id`, `release_id`, …) is what makes a firing alert lead
  anywhere. Until observability W1 merges, no server Sentry event carries a
  `session_id`, so no alert can link to a session story either.
- **Every product/runtime spec's Emits section.** The observability spec's
  audit (§4 there) is the inventory this system rules on: five systems have
  no Emits at all (agents, auth, clients, support, workflows); most others
  are product-shaped. An alert cannot exist for a signal that is not
  emitted. The gaps that matter for alerting specifically:
  - **sessions** — no `session.started/ended` marker at the CP; a session
    that never produces output is invisible.
  - **seam** — `workerDegraded` is computed and shown, never logged as a
    marker; a dead Worker fleet does not alert.
  - **environments** — provisioning outcomes exist in
    `provisioning_observability.py` but no failure-rate rule selects them.
  - **billing** — a budget-envelope hit is a product event, not a marker.
  - **model_gateway / integration_gateway** — per-call outcome is a ledger
    row / an audit row, not a log record; provider-side outage is invisible.
- **Every product/runtime spec's Proof section.** A fix that closes an alert
  extends the pinning test named there, or adds one with a trailer.
- **Testing's trailer convention** (`Spec:` / `Surfaced-by:`) and its checker
  (`PROD-PROOF-001`, target) — this system supplies the stable ids the
  trailer cites.
- **Customer-loop's intake** — a human report and an alert are two signal
  types feeding one fix path; the customer-loop spec owns the report leg.
- **Delivery's `release_id`** — every alert is attributable to a release;
  a spike that starts at a deploy boundary is a rollback question first.

## 5. Laws

**L1 — Non-noisy.** An alert fires only when (a) something is actually quite broken — a user-facing promise is failing now — or (b) something we did not expect to break has broken. Normal occurrences never alert: a single exception, a retried provider call, a slow request, a test-account failure, a cron that ran. The test for a proposed rule is the sentence *"if this fires at 3am and nobody looks, what is lost?"* — if the answer is "nothing", it is a dashboard panel, not an alert.

**L2 — Small fixed severity set.** Exactly two severities, and one out-of-band condition:

| Severity | Meaning | Destination | Expectation |
| --- | --- | --- | --- |
| `critical` | a product promise is failing for users now | Slack `#ops-alerts` | a person looks within the hour |
| `warning` | something unexpected broke; users may not feel it yet | Slack `#eng-triage` | looked at in the next working session |
| *production-down* | the API or the app is unreachable — not a rule label, a condition | **phone** (PABLO DECIDES the channel) | immediate |

No `info`. No per-team channels. A rule that does not fit one of these rows is not a rule.

**L3 — Rules select markers; code owns thresholds.** A rule matches a stable log marker or a metric derived from one (`CRITICAL_FAILURE`, `SignInFailureCount`). Business thresholds ("more than N failures per session") are computed in code and emit one marker when exceeded (observability L6), because a threshold that lives only in a rule is invisible to tests.

**L4 — Machine-legible or not at all.** Every firing alert carries: the rule uid, `severity`, `release_id`, the runbook anchor, and — where the rule has one exact log identity — the correlation ids of the triggering record (`session_id`, `organization_id`, `user_id`). Links are built from ids by a fixed scheme (observability L5). A human-written alert body with no ids is a defect of the rule, not of the reader.

**L5 — One route tree, checked in.** The Alertmanager route tree is the two-row table in L2 and nothing else. Receivers are never added to route around a problem; a new destination is a spec change. Live state is verified against the checked-in intent by the operator scripts, never assumed from it.

**L6 — Every alert is attributable.** A rule without a `runbook_url` annotation and an owner section in the runbook is invalid (`grafana-alerting.mjs check` already enforces the annotation); a rule nobody has looked at in 30 days of firing is noise by definition and is removed or re-thresholded (ratchet, §9).

**L7 — Alert → issue → fix → test, one path.** A real alert becomes a GitHub issue labelled `alert:<severity>` carrying ids and links (never log bodies); the PR that closes it adds or extends a test whose docstring trailer says `Surfaced-by: alert:<rule_uid>` (plus `sentry:` / `session:` when known) and `Spec: <owning spec>#<law>`. The issue is closed by the PR, never by hand. Recurrence of the same rule for the same cause after the PR merges is a broken fix, not a new incident. This is the same path the customer-loop spec uses for `support:report`; the two differ only in the first label.

**L8 — Contain before diagnosing; diagnose before cleaning.** First response is read-only (open the session story, the Sentry issue, the runbook section). Containment verbs are the owning product system's (cancel a run tree, pause a definition, hold a billing subject — runs / automations / billing specs); this system names *when* to use them, never re-implements them. Cleanup that destroys evidence (reaping an environment, rotating a key) waits for the issue to exist.

**L9 — Delivery is proven, not assumed.** A route that has not delivered a synthetic alert in the last 30 days is unproven. The Alertmanager `receivers/test` endpoint is the proof; the result (status + timestamp, never the webhook) is recorded in the runbook. A silent channel is the worst failure this system can have, and it is silent by construction.

**L10 — Signals die with their surfaces.** A culled feature's rules, routes, and runbook sections are deleted in the same PR as the feature (deletion-completeness; display names grep-gated). The tracker's receiver outliving the tracker by two days is the precedent this law comes from.

### Ruling on the rules that exist (2026-08-25)

| Rule (uid) | Today | Ruling under L1/L2 | Why |
| --- | --- | --- | --- |
| `CRITICAL_FAILURE in prod logs` (`bfrmh7e7x2k8wd`) | critical | **keep — the spine** | the only rule selecting an application-level promise; carries `user_id` + `release_id`; every `report_critical` call site is a deliberate "this must page" |
| `ALB 5xx > 10 in 5m` (`dfrmh7bc4yqrkf`) | critical | **keep** | user-facing failure by definition; the 10/5m floor keeps a single bad request from paging |
| `API p95 Latency > 5s for 10m` (`bfrmh7c7ecbnkb`) | critical | **keep as `warning`** — PABLO DECIDES | slow is unexpected-broke, not promise-failing; at 5s/10m it is real, but it should land in `#eng-triage` unless it co-fires with 5xx |
| `Server error rate > 10 in 10m` (`cfrmh7fttw4jke`) | warning | **keep** | the "something we did not expect" catch-all; combines server + worker groups, so it stays warning |
| `Analytics ingest errors` (`cfrmh7f2sbe2od`) | critical | **noise as critical → `warning`**, candidate for removal | analytics ingestion failing is not a product promise; PostHog/Metabase belong to the analytics system; keep only until that system rules on its own signal |
| `Sign-in failures > 5 in 10m` (`ffvtx33lbo5c0e`, NEW workspace) | warning | **keep**, promote to `critical` when it becomes a rate (failures / attempts > X%) | a raw count of 5 is a fine "unexpected" signal; a rate is a promise |
| `ECS CPU > 90% for 15m` (`cfrmh7d7od8g0c`) | retired 2026-08-21 | **stays retired** | infra symptom, not a product promise — the precedent for L1 |

**Missing** (each blocked on an Emits gap in §4, none constructible tonight without touching `cloud/`):

| Missing rule | Selects | Severity | Blocked on |
| --- | --- | --- | --- |
| Worker fleet degraded | `WORKER_DEGRADED` marker (observability W4) | critical when N≥2 targets in 5m, else warning | marker does not exist |
| Environment provisioning failure rate | `provisioning_observability.py` outcome records | warning | no marker on the failure edge |
| Session never produced output | `session.started` without `turn.ended` within budget | warning | sessions CP markers (target) |
| Budget envelope exhausted | `BUDGET_ENVELOPE_EXHAUSTED` marker | warning (never critical — it is the backstop working) | billing marker |
| Provider outage (model / integration gateway) | per-call outcome record, error-rate window | critical | gateways emit rows, not records |
| Delivery canary | absence of the monthly synthetic alert receipt | warning | L9 procedure (manual tonight) |
| **Production down** | external uptime probe on `/v1/health` and the web app | phone | PABLO DECIDES the probe + channel |

## 6. Emits

- **Alerts** — Grafana rule firings, delivered per L2 to Slack and SNS
  email; consumed by people and by the fixing agent.
- **`alert:*` GitHub issues** — the fix-loop work item, one per real
  incident, carrying ids/links only; consumed by the building loop (a PR
  closes it) and by the testing spec (the trailer cites it).
- **Delivery receipts** — the recorded result of each synthetic delivery
  test (L9); consumed by the runbook and by the monthly canary check.
- **Rule-identity checksums** — from `grafana-alerting.mjs check`; consumed
  by CI's repo-shape lane.

No product events. No tracker. No aggregation queue.

### Honeycomb SLI triggers (2026-08-27, starting values)

The five runtime SLIs (observability README §3 Flow 4) evaluate in Honeycomb's own trigger engine, not Grafana — the one-engine law covers log-sourced rules; lifecycle-record SLIs live beside their data. Their intent is `server/infra/observability/honeycomb/triggers/*.json` (applied/verified by `scripts/ops/honeycomb-triggers.mjs` on the monitor lane); the rows below are the thresholds of record, all **starting values** pending real traffic — re-tuning edits this table and the intent JSON in the same PR (`stamp` re-checksums).

| Trigger | Window | Threshold (starting) | Severity |
| --- | --- | --- | --- |
| session-create failures (`outcome=failed` only; `rejected` never pages) | 15m | > 5 | warning |
| agent-start failures | 15m | > 5 | warning |
| time-to-first-output p95 (`first_output_ms`) | 15m | > 10s | warning |
| launch-selection rejections (the four classifications) | 15m | > 5 | warning |
| orphaned operations (`abandoned` terminals — the collector finalizes dead producers) | 15m | > 10 | warning |

Routing: Honeycomb-native Slack recipient (Pablo creates it once in the Honeycomb UI; its id is checked into each intent file). Until the recipient exists, triggers evaluate with no destination and `verify` reports them `recipient pending`.

## 7. Fences

- **Observability** owns the markers, the ID tuple, the closed Sentry
  catalog, and the cross-link scheme. This system may *require* a marker
  (§4) but never writes an emitter.
- **Each product system** owns its containment verbs (runs: cancel tree;
  automations: pause definition; billing: hold) and its Emits. This system
  names the trigger, never the mechanism.
- **Testing** owns the trailer checker and proof placement; this system
  supplies rule uids as `Surfaced-by:` tokens.
- **Customer loop** owns the human-report leg (`support:report`); both legs
  share L7's path and the interim GitHub Issues intake.
- **Analytics** owns PostHog/Metabase ingestion health; the analytics-ingest
  rule is on loan until that system rules on it.
- **Delivery** owns rollback; "roll back the release" is a delivery verb
  this runbook points at.
- **The cull ledger**: no issue tracker, no `issues.proliferate.com`, no
  tracker receiver, no Linear/GitHub-app credentials on the server. Nothing
  here re-creates them.

## 8. Code map

```text
server/infra/observability/grafana/
├── production-alerts.json           five rules, OLD workspace (identity + label/annotation overlay)
├── production-alerts-rebuild.json   five rules + wiring, NEW workspace
├── sli-alerts.json                  sign-in SLI rule, NEW workspace
└── production-overview-dashboard.json  the one dashboard (not an alert)
scripts/ops/
├── grafana-alerting.mjs (+ .test.mjs)          OLD workspace: check / export / apply / restore
├── grafana-rebuild-bootstrap.mjs (+ .test.mjs) NEW workspace: check / apply / verify / slack-*
├── grafana-sli-alerts.mjs (+ .test.mjs)        NEW workspace SLI group only
└── grafana-{client,receipts,credential-process,metadata-inventory}.mjs   transport, receipts, target lock
server/proliferate/integrations/sentry/client.py   report_critical → CRITICAL_FAILURE (observability-owned; the marker this system pages on)
guides/operating/production-alerts.md              runbook: per-rule sections (runbook_url targets), operator procedure, two-workspace state
.github/workflows/ci.yml → "Repo shape checks"     runs grafana-alerting.mjs check offline
```

## 9. Proof

- `scripts/ops/grafana-alerting.test.mjs`, `grafana-rebuild-bootstrap.test.mjs`,
  `grafana-sli-alerts.test.mjs` — rule allowlist (exactly the known uids),
  checksum reproduction, approved labels/annotations, log metadata only on
  `bfrmh7e7x2k8wd`, target lock, console redaction.
- `node scripts/ops/grafana-alerting.mjs check` — offline, in CI's
  repo-shape lane: the checked-in intent is internally valid.
- `python3 scripts/check_docs.py` — every `runbook_url` anchor resolves
  (the runbook sections are docs).
- **Live acceptance** (manual, recorded in the runbook, never in CI): one
  synthetic `receivers/test` per receiver with `status: ok` and a timestamp;
  one synthetic `report_critical` in staging → Sentry issue tagged
  `critical_failure=true` **and** rule `bfrmh7e7x2k8wd` fires to
  `#ops-alerts`.
- **Ratchet** (target): a monthly review that lists every rule with its
  firing count and the number of `alert:*` issues that cite it; a rule that
  fired and produced no issue three months running is removed (L6).
- Pinning tests for fixes carry `Surfaced-by: alert:<uid>`; `PROD-PROOF-001`
  (testing spec, target) verifies the uid exists in the rule JSON.

## Current state (2026-08-25)

```text
server JSON logs ──► CloudWatch metric filters ──► Grafana (OLD workspace, 5 rules) ──► Slack #ops-alerts / #eng-triage
                                              └──► Grafana (NEW workspace, 5 + SLI) ──► SNS email (pablo@) [+ Slack via slack-apply]
Sentry issues ──► (no routing to Slack from Sentry; discovered in the Sentry UI)
tracker receiver ──► removed 2026-08-25 (route had continue=true; Slack delivery was never interrupted)
```

Honest inventory: six rules, all server-infra shaped, evaluated from CloudWatch. **Not present:** paging/on-call of any kind (no phone path, no ack, no escalation), SLOs, an incident process, a delivery-health canary, any runtime/fleet alert, any cost-anomaly alert, anything about runs or automations. Jank: the five rules exist twice (OLD + NEW workspace) with checksum tooling keeping them identical; `CRITICAL_FAILURE` is one marker carrying the whole application-level story; alert → human urgency is a Slack channel and nothing else.

## Minimum tonight

Goal: tomorrow morning Pablo opens `#ops-alerts` and `#eng-triage` and sees only real breakage, each alert linking to its runbook section and — once observability W1 is in — to the session. Each PR is config or docs; none changes product state; none touches `server/proliferate/server/cloud/**`. Live Grafana mutations are **ops steps listed here, not executed by a PR.**

| PR | Files | Change | Proof |
| --- | --- | --- | --- |
| **A1 — severity re-ruling** | `server/infra/observability/grafana/production-alerts.json`, `production-alerts-rebuild.json`, `guides/operating/production-alerts.md` | `API p95 Latency` → `warning`; `Analytics ingest errors` → `warning`; runbook sections updated with the L1 rationale and "what is lost if nobody looks" line per rule | `grafana-alerting.mjs check` green; `grafana-alerting.test.mjs` updated rows; checksums of the query models unchanged (labels only) |
| **A2 — machine-legible alert body** | both rule JSON files (annotations), runbook | add `proliferate_session_link` / `proliferate_sentry_link` annotation *templates* built from the ID tuple by the fixed scheme (observability L5) on the one rule with an exact log identity (`bfrmh7e7x2k8wd`); document the scheme | `check` accepts the new annotation keys (allowlist edit in `grafana-alerting.mjs`); test rows |
| **A3 — the fix-loop intake** | `.github/ISSUE_TEMPLATE/alert.yml`, `guides/operating/production-alerts.md` §"When it fires" | an issue template with fields for rule uid, severity, release, session id, Sentry issue, runbook anchor — ids only; runbook gains the L7 procedure and the trailer example; create labels `alert:critical`, `alert:warning` | template renders; `check_docs.py` green; `gh label list` shows both |
| **A4 — this spec** | this README, `engineering/README.md` row, `check_docs.py` registries | the document; ownership transfer of the rule JSON recorded | `check_docs.py` green |

**Ops steps for Pablo (live, not in a PR):**

1. Apply A1's label changes to both live workspaces:
   `GRAFANA_ALERTING_LIVE=1 node scripts/ops/grafana-alerting.mjs export --receipt <private>` then `apply`; `grafana-rebuild-bootstrap.mjs verify`.
2. Prove delivery (L9): `POST /api/alertmanager/grafana/config/api/v1/receivers/test` for `slack-ops-alerts` and `slack-eng-triage`; record status + timestamp in the runbook.
3. Decide the production-down channel (PABLO DECIDES 1) and, if it is a
   phone, wire the uptime probe to it — outside Grafana.

Queued for the morning after PR-Ab merges (each one file + one test, then a rule): `WORKER_DEGRADED` marker → *Worker fleet degraded* rule; provisioning failure edge marker → *Provisioning failure rate* rule.

## Target

- One Grafana workspace (PABLO DECIDES 3), one route tree exactly as L2,
  every rule with a runbook anchor and a delivery receipt under 30 days old.
- The missing-rules table in §5 filled: fleet, provisioning, session
  liveness, budget backstop, provider outage — each selecting a marker that
  a product spec's Emits section names.
- Production-down on a phone via an external probe, independent of the
  stack it watches.
- Sentry issue alerts (new issue in a release, regression of a resolved
  issue) routed to `#eng-triage` with the same ids — Sentry as a second
  evaluation source, not a second inbox.
- The fixing agent runs the L7 loop end to end: alert → `alert:*` issue →
  PR with a `Surfaced-by:` test → issue closed by merge; a person approves
  the PR, nothing else.
- The monthly noise ratchet (§9) runs as a script, not a meeting.

## PABLO DECIDES

1. **Production-down channel.** Recommend: an external uptime probe (any
   hosted checker) on `GET /v1/health` and the web app, delivering to
   Pablo's phone via the checker's own SMS/call path — not through
   Grafana/SNS, so the probe survives the stack it watches. Nothing else
   ever reaches the phone.
2. **Severity of `API p95 Latency` and `Analytics ingest errors`.**
   Recommend both → `warning` (A1). Alternative: keep latency `critical`
   but raise the window to 15m.
3. **Canonical Grafana workspace.** Recommend the NEW workspace
   (`proliferate-ops-rebuild`): it already has SNS email proven, the SLI
   group, the dashboard, and simpler tooling; run `slack-apply` there, then
   retire OLD after a two-week burn-in. Until then both stay identical by
   checksum.
4. **Sentry as an alert source.** Recommend: yes, but only "new issue in
   the current release" and "regression", both `warning`, both to
   `#eng-triage`; no per-event alerts.

## Known gaps

- No phone path exists; production-down is currently indistinguishable
  from "quiet".
- No delivery canary; the last proven Slack delivery on OLD predates the
  cull, the last proven SNS delivery on NEW is 2026-08-21.
- No alert carries a `session_id` until observability W1 merges and A2
  adds the link annotations.
- Two workspaces, one truth by checksum only.
- `alert:*` labels and the issue template do not exist until A3.
- The noise ratchet is a procedure, not a script.
- `check_proof_trailers.py` (testing, target) does not yet verify
  `alert:<uid>` tokens against the rule JSON.
