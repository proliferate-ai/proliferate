# Issue Auto-Fix System v1 — poll triggers, agent functions, workflows (umbrella spec)

*2026-07-06. End-to-end design for automating Proliferate's own issue lifecycle (Sentry / Grafana / support submissions → dedup → investigate → fix → PR → release → user notification). This is the UMBRELLA spec: the system design, the two new Proliferate product primitives, the workflow definitions, and everything that must be set up product-side. The internal service itself is fully specified in its own standalone doc — **`specs/tbd/issues-service-v1.md`** — so an agent can build it end-to-end from that file alone. This system is both real internal ops tooling and the reference implementation we hand to design partners (A9: every FDE-built workflow becomes a template).*

*Revision history: round 2 (2026-07-06) — declared THE implementation of the engagement stack's deferred L4 support-loop (§8); SupportReport ingestion, CIO transactional sends, ship-time Sentry affected-user query. Round 3 (2026-07-06, Pablo-guided) — hosting/stack/auth pinned (now §2 of the service spec); GitHub merge detection became an in-service poller; email infra moved to phase 2. Round 4 (2026-07-06) — split into umbrella + service specs. Round 5 (2026-07-07) — verified against merged main: #968–971/#972/#976/#973 ALL merged 2026-07-06 evening; §4 prerequisites updated to reality (Grafana = AMG API not CloudWatch alarms; alert rules already live; identity-tag gaps noted).*

---

## 0. One paragraph

Three sources of trouble (Sentry exceptions, Grafana/CloudWatch alerts, user-submitted support tickets via the server's `SupportReport` table) sync into one normalized **issues service** (own app, own DB — see service spec). Proliferate gains two generic primitives: **poll triggers** (a workflow fires per new item from any conforming endpoint) and **agent-callable functions** (external tools exposed to workflow agents via the integration gateway as MCP tools). Two workflows run the lifecycle: a cheap **triage** workflow (dedup / spam / route) and a frontier-routed **fix** workflow (investigate → fix → test → PR → in-loop review → notify Pablo). Humans hold two gates: PR merge and email approval. On release, the service matches shipped fixes to affected/reporting users and drafts thank-you and courtesy emails via Customer.io. Nothing waits inside a workflow; the issues table is the queue and the state machine is enforced service-side.

## 1. Principles

- **P1 — The issues service is the system of record; Proliferate is the actor.** The service stores truth and exposes endpoints; it never reasons. Workflows read state, think, act, and write state back through function calls; they never store truth.
- **P2 — One pattern everywhere: a state machine in the service, poll-triggered workflows as state-transition executors.** No long-running workflow ever waits on a human. A human gate is just a state only a human (or a job reflecting human action) transitions. Retries are free: an item stays in its state until successfully claimed.
- **P3 — Correctness by construction, not careful timing.** Poll-side spawn dedup (idempotency key) + service-side `claim()` compare-and-swap means duplicate fires are harmless. Illegal state transitions are rejected by the service API, so a confused agent physically cannot corrupt the lifecycle.
- **P4 — Cheap models + good retrieval beat frontier + none.** Triage runs on a GLM-class model; its dedup quality is bounded by the service's `search_issues` endpoint, not model IQ. Frontier is reserved for investigation/fix, routed per-issue by the triage difficulty assessment.
- **P5 — Always PR, never auto-merge (v1).** Every fix lands as a PR + Slack notification. Same conservatism for user-facing email: drafts sit in an approval queue until Pablo approves; auto-send is a later, per-template graduation (thank-you tier first).
- **P6 — Built as product, not as bespoke glue.** The only new Proliferate surfaces are the poll trigger primitive and gateway MCP registration. Everything customer-visible — the poll contract, the state diagram, the tool reference — is written as if a customer will read it, because one will.

## 2. New product primitive #1 — poll triggers

A trigger config on a workflow: Proliferate polls a customer-owned endpoint on an interval and spawns one workflow run per new item. In flight with the workflows agent (PR #921 lineage), building in parallel with the service.

### Trigger config fields
- `url` — the poll endpoint
- `auth` — header name + secret ref (secret lives in the existing secrets/gateway store, never in the workflow definition)
- `interval` — poll frequency (5 min for this system)
- `schema` — JSON Schema that each item's `data` must validate against
- `workflow` — target workflow definition
- `paused` — bool

### Poll endpoint contract (the public one-pager — THE artifact handed to design partners)

```
GET <url>?cursor=<opaque>&limit=50
Authorization: <configured header>

200 →
{
  "items": [
    {
      "id": "evt_18842",           // stable, unique — idempotency key
      "kind": "issue.new",          // namespaced event type
      "occurred_at": "2026-07-06T21:14:03Z",
      "data": { ... }               // validated against trigger schema
    }
  ],
  "cursor": "eyJsYXN0X2V2ZW50X2lkIjoxODg0Mn0",  // opaque, server-owned; echo next poll
  "has_more": false
}
```

Rules:
- **Cursor is opaque and server-issued.** Proliferate stores and echoes it, never interprets it.
- **`id` is the idempotency key.** Proliferate guarantees at-most-one workflow spawn per `id` per trigger config (seen-set / dedup window). Combined with service-side `claim()` CAS this yields exactly-once *effects* without either side being perfect.
- **`data` is schema-validated.** Items failing validation are skipped and surfaced as trigger errors — never silently dropped, never fed to an agent malformed.
- **Delivery is at-least-once.** The endpoint may see the same cursor twice (Proliferate crashed before persisting); returning the same items twice must be safe. No ack callback, no two-phase protocol — the claim function absorbs the rest. **Never a destructive queue-pop.**
- **Fan-out:** one item = one workflow run; `data` becomes the run's typed input. `limit` caps burst; backlog drains across successive polls.

For this system, two trigger configs point at the service's feeds: `/poll/new-issues` → triage workflow, `/poll/triaged-issues` → fix workflow (feed details in the service spec §6.1).

## 3. New product primitive #2 — agent-callable functions (via integration gateway)

There is **no session-level "MCP injection" concept** (Pablo, explicit): all MCPs and external tools flow through the existing integrations gateway (landed 07-03). The issues service exposes an MCP server; it registers once with the gateway, which does auth injection, per-workflow tool scoping, policy, and audit. Per-workflow function grants are gateway configuration: the workflow definition references which gateway-registered tools its agents may use; the gateway enforces at call time.

Conventions (apply to ANY agent-facing external API, not just this one):
- **Errors are enumerated return values, not HTTP failures** — `already_claimed`, `invalid_transition` are normal agent inputs with per-outcome guidance in the tool description. The single biggest quality lever for agent-facing APIs.
- **The state machine is encoded in the API, not the prompt.** Prompts describe intent; the API enforces legality.
- **Every mutating call auto-appends to the service's audit log** with the calling run's identity (`X-Run-Id` header, passed by the gateway).

The full tool set (9 tools: `claim`, `update_status`, `mark_duplicate`, `mark_dismissed`, `search_issues`, `get_issue`, `attach_investigation`, `link_pr`, `list_reporters`), exact argument/return schemas, and per-outcome guidance live in the **service spec §5**. Gateway scoping: **triage workflow** → `claim, get_issue, search_issues, update_status, mark_duplicate, mark_dismissed`; **fix workflow** → all tools.

## 4. What must be set up on the product side

Everything in this section is Proliferate-repo work (or ops), NOT the service build:

1. **Poll trigger primitive** (§2) — workflows engine. In flight (PR #921 lineage). Design rulings already confirmed with the workflows agent: at-least-once + opaque cursor + id idempotency, no queue-pop; no forced tool calls (`agent.emit` with schema validation is the typed output channel); parallel lanes deferred, chaining = fire-and-forget `workflow.run` as a step; no mid-run plan mutation; Slack notify delivery (W4) graduated from deferred to REQUIRED — the fix workflow terminates in a Slack ping.
2. **Gateway registration** for the issues-service MCP server + per-workflow tool scoping config.
3. **Server endpoint `GET /v1/support/reports`** — cursor-based, conforming to the §2 poll contract *deliberately* (dogfooding the artifact we hand customers), admin/service-token-authed, surfaces `telemetry_refs_json` **parsed** (TEXT blob today). Owned by the support workspace lane; scoping needs Pablo's approval before build. Consumed by the service's `sync_support` job.
4. **Sentry org token** — minted ONCE with scopes serving both the dashboards' Errors panel and this system's ingestion (`org:read`, `project:read`, `event:read`). Pablo's task, shared with the Dashboards workspace open item. **Still the one missing credential** (verified 2026-07-07: DSNs wired, no API token exists).
5. ~~Grafana + Sentry alert rules~~ **DONE** (verified merged 2026-07-07): AMG workspace `proliferate-ops` (`g-e532d030d8`) with 3 rules (5xx/p95/CPU) → `#alerts`; Sentry rules `17267915` (fatal/regressed) + `442367` (p95) → `#sentry-channel`. `sync_grafana` polls the AMG alerting API. Residual click: invite the Sentry app to `#alerts` to consolidate channels (cosmetic, not blocking).
6. ~~Instrumentation PRs merge~~ **DONE** — #968–971 merged 2026-07-06. Delivered: identity tags (with two known gaps: desktop-native events carry no org/user identity; E2B `org_id` = first-membership guess for multi-org users), release format `<component>@<version>+<12-char-sha>`, `report_critical` fatal marker, background correlation binding.
7. ~~Support capture PRs merge~~ **DONE** — #972/#976 merged 2026-07-06. Delivered: `urgent`/`notify_me` on `support_report`, `credit_consent`/`credit_name` for all kinds, `user.outreach_email` (user-level, not per-report), `telemetry_refs_json` = camelCase `{posthogDistinctId, posthogSessionId, sentryEventIds[]}`.
8. **Slack webhook** for fix-workflow notifications — reuse the `#alerts` incoming webhook (Proliferate Alerts app `A0BFD1Z5GV7`), or one of the existing product webhooks (`SUPPORT_SLACK_WEBHOOK_URL` etc.) if fix pings should land elsewhere.
9. **Releases feed**: the deploy pipeline (or a manual step, v1) creates a `releases` row in the service on each release — version + contained shas. **[OPEN — mechanism]**: CI step calling the service API vs manual; ask Pablo when phase 2 approaches. (Verified natural hook: `promote-production.yml`/`hotfix-production.yml` already compute `${GIT_SHA:0:12}` and the version from the root `VERSION` file — a one-step `curl` there would suffice. Sha matching must use 12-char short shas to align with the Sentry release format.)

## 5. The issues service (summary — full spec in `issues-service-v1.md`)

Own app on one EC2 box (FastAPI + in-service Celery + Redis + Next.js + Caddy; RDS Postgres w/ pgvector). System of record: 6 tables (`issues`, append-only `events` doubling as the poll-feed backbone, `issue_reporters` with `submitted`/`affected` kinds powering the two email tiers, `releases`, `emails` = the L4 notification queue absorbed, `sync_cursors`). State machine enforced service-side (`new → triaged → awaiting-merge → merged → shipped`, with `dismissed`/`duplicate`/`needs-human` branches; claim CAS orthogonal to status; 3-strike reap → `needs-human`). Five Celery jobs: `sync_sentry`, `sync_grafana` (alert-rule-fired only), `sync_support` (links tickets to Sentry issues via attached event ids *before* any agent reasoning), `check_merges` (PR poller — the fix agent can't observe merges; it exits at `awaiting-merge`), `reap_claims`. Phase 2: `release_watch` + `email_sender` (CIO transactional; deliveries endpoint = ground truth). Thin Next.js web app: board, detail timeline, (phase 2) email approval queue.

## 6. The workflows (2)

### 6.1 Triage (cheap model, GLM-class; trigger: poll `/poll/new-issues`, 5-min)

1. `claim` — exit silently on `already_claimed`/`not_found`.
2. `get_issue` + `search_issues` → duplicate? → `mark_duplicate(root, confidence)`, done.
3. Spam / noise / expected-behavior → `mark_dismissed(reason)`, done. (Reason required — the one place issues can die before a human sees them stays auditable.)
4. Real + novel → difficulty assessment → `update_status(triaged)` with a `routing_note` that selects the fix workflow's model tier.

### 6.2 Fix (routed model; trigger: poll `/poll/triaged-issues`, 5-min)

1. `claim`.
2. **Investigate** — deeplinks + log access + (sandbox issues) SSH into the affected instance. Hard gate: `attach_investigation(root_cause, repro_steps, evidence_links)` — all fields required; can't fill them confidently → `update_status(needs-human)` + Slack with what was tried, exit. ("Decently evidenced" made concrete as required output fields, not a vibe call.)
3. **Fix + test** — write fix, add/run tests. Unresolvable test failures → `needs-human` like any blocked fix. (Flaky-test handling is OUT of v1 entirely — no discriminator, no quarantine, no flakiness workflow; when real, flakes become another issue kind in this same system.)
4. **Open PR** → `link_pr`.
5. **In-loop review** — spawn a *fresh* reviewer agent inside the same run (fresh context deliberately: it reads the diff cold, like a real reviewer). Fix agent addresses feedback in-loop until review passes. Review is not a separate executor because the fix agent holds the PR context; bouncing through the state machine would force re-investigation from scratch.
6. **Notify Pablo** — Slack (issue, evidence, who's affected, PR link) → `update_status(awaiting-merge)`, exit.

Everything after `awaiting-merge` (merge detection, release matching, emails) is the service's job — the user-facing emails can't live with the PR context anyway; their trigger is the release shipping, days later.

### 6.3 End-to-end walkthrough (release day)

Sentry groups a new exception → `sync_sentry` inserts (`new`) + `issue.created` event → feed-1 trigger fires triage → real, novel, medium difficulty → `triaged` + `issue.triaged` event → feed-2 trigger fires fix → claim, investigate (SSH), evidenced root cause, fix, tests pass, PR, in-run review passes, Slack ping → `awaiting-merge`. Pablo merges → `check_merges` flips `merged` + records sha. Meanwhile a `SupportReport` describing the same crash synced in — its attached `sentry_event_ids` linked it to the tracked issue at sync time, its submitter appended as a reporter. Release cut → `release_watch` matches sha → `shipped` → Sentry user-tag query enumerates affected users → email drafts materialize → Pablo approves in the queue → CIO transactional sends, confirmed via the deliveries endpoint. The reporter gets "we saw this and fixed it" within hours-to-days of reporting, automatically.

## 7. Build list & sequencing

Pablo-pinned sequencing: **service builds FIRST** (from `issues-service-v1.md`, its §11 build order); poll-trigger primitive lands in parallel (~day one). If the primitive lags, the service's feeds are still the contract — drive workflows manually until the trigger lands. Email infrastructure is PHASE 2 (schema day one, build later).

**Proliferate product:** 1. poll trigger primitive (§2, workflows agent) · 2. gateway MCP registration + scoping (§3) · 3. server `GET /v1/support/reports` (§4.3)
**Ops/Pablo:** 4. Sentry org token (§4.4) · 5. alert-rule login clicks (§4.5) · 6. merge #968–971, #972/#976, #973 (§4.6–7)
**Issues service:** 7. everything in `issues-service-v1.md` (§11 there)
**Workflow definitions:** 8. triage + fix (§6)
**Docs:** 9. poll contract one-pager (§2) · 10. the service's deep-dive doc (service spec §12) · 11. state diagram + tool reference (live in the service spec; referenced by workflow prompts)

## 8. Relationship to the engagement stack (supersedes L4)

Aligned with Pablo 2026-07-06: **this system is the implementation of the engagement stack's deferred L4 support-loop** ("we fixed the bug you reported / that affected you"), not a second system beside it. The L4 design note in the Engagement Workspace doc is marked superseded-by-this-spec.

Absorbed from L4's analysis (all approved): `SupportReport` as the support-ticket source (owner_user_id → reporter identity; github/linear links; sentry_event_ids → dedup evidence) · the service's `emails` table = L4's `fix_notification_queue` (same approval state machine, reporter-vs-affected split) · ship-time Sentry affected-user query (no continuous reverse index) · CIO transactional sends with deliveries-endpoint ground truth · no parallel webhook receivers.

Out of scope here (engagement stack, unchanged): onboarding campaigns, winback, heavy-user check-in, changelog broadcasts (L1–L3). Future synergy, build-nothing-now: the L3 changelog broadcast can pull its "fixed this release, thanks to X" section from the service's `shipped` query.

## 9. Reconciliation with in-flight workspaces (decided 2026-07-06)

Four Vault workspaces (`Workspace/Extraneous/`) reconciled via subagent analysis:

- **Exceptions** (draft PRs #968–971 + Slack/Grafana alert wiring) — pure prerequisite instrumentation, zero conflict. Merge the PRs. Identity tags (#970) make the ship-time affected-user query work; release-sha sync (#968) makes the release watcher trustworthy. The doc's aspirational workflow lines (auto-investigate + user apology) are superseded by §6 here; implementation notes fold into `specs/developing/analytics/sentry.md`, doc archived. Lane 5's two human-login clicks are Pablo's, this week.
- **Support** — split: PRs #972/#976 (capture fields + modal UI) merge; this system depends on them. The `support-ops` repo's notify flow (S3-polling CLI + sqlite + Resend) is SUPERSEDED — two parallel "we fixed it" email systems is the failure mode §8 exists to prevent; the repo parks as a manual-CLI prototype reference. The server grows the §4.3 endpoint.
- **Dashboards** (PR #973) — zero overlap (aggregate metrics vs per-issue lifecycle). Reuse: the Sentry org token minted ONCE for both. (The EventBridge→Fargate pattern was noted as reusable, but round 3 chose in-service Celery.)
- **Tests** — flaky-test handling cut from v1 entirely; the Tests workspace keeps its merge-confidence scope, no flakiness ownership assigned.

## 10. Explicitly deferred / v2

- Novel-pattern detection from raw logs (log clustering) — v1 ingests only alert-rule-fired Grafana/CloudWatch errors
- Flaky-test handling (discrimination, quarantine, flakiness workflow) — deliberately ignored for now
- Auto-merge for any fix category (P5 holds until trust is earned)
- Auto-send email without approval (graduates per-template, thank-you tier first)
- Webhook-push anywhere (Sentry/Grafana ingestion, GitHub merges) — polling suffices; revisit only if latency matters
- Await-child workflow chaining, parallel lanes (fire-and-forget `workflow.run` is the v1 chaining shape)
- Generalizing the service's web app into a product surface
