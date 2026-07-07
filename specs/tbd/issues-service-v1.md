# Issues Service v1 — internal issue tracker + notification queue (standalone spec)

*2026-07-06. The complete, self-contained spec for the internal issues service: the system of record for Proliferate's own bug lifecycle. An agent building this service needs this document and nothing else — the umbrella system design (Proliferate-side primitives, workflow definitions, rollout) lives in `issue-autofix-system-v1.md`; this doc owns everything that runs on the service's own box.*

*Provenance: all design decisions here were made explicitly with Pablo across 2026-07-06 alignment rounds. Items marked **[elaboration]** are mechanical detail derived from those decisions — veto freely. Items marked **[OPEN]** need Pablo's call before building that part. Do NOT make new design decisions beyond this doc without asking him.*

*Facts verified against merged `main` 2026-07-07 (post #968–971/#972/#976/#973): Grafana source corrected (no CloudWatch alarms exist — AMG alerting API is the source, §7.2), Sentry org/projects/severity-marker pinned (§7.1), support field shapes pinned incl. camelCase `sentryEventIds` and user-level `outreach_email` (§6.3), release format pinned (§8).*

---

## 0. What this service is

A small internal app — the **system of record** for issues found in production (Sentry exceptions, Grafana/CloudWatch alarms, user support tickets) and the queue for user-facing "we fixed it" emails. It stores truth, syncs from sources, enforces a state machine, and exposes three faces:

1. **A poll API** — Proliferate's workflow triggers poll it for new/triaged issues and spawn agent workflow runs.
2. **An agent-facing API / MCP server** — workflow agents claim issues, search for duplicates, attach investigations, link PRs, and update status through it (fronted by Proliferate's integration gateway, which handles per-workflow tool scoping).
3. **A thin web app** — employees glance at in-flight issues, filter, manually change status, click out to Sentry/Grafana/PRs; (phase 2) approve email drafts.

The service **never reasons** — agents and humans reason; the service enforces legality (state machine, claim CAS) and records everything (append-only events). Nothing in this service waits: workflow runs are short-lived executors; a human gate is just a state only a human (or a job observing human action, e.g. a PR merge) transitions.

Design stance: this is ALSO the reference implementation we hand design partners ("what your system looks like on the other side of the poll boundary"), so every contract here is written as if a customer will read it — one will.

## 1. Hosting, stack, auth (Pablo-pinned)

- **One EC2 instance** on AWS (deliberately AWS — agents have easy infra access via AWS CLI). Docker compose runs: `api` (FastAPI), `worker` + `beat` (Celery), `redis`, `web` (Next.js), `caddy`.
- **Postgres = small RDS with pgvector.** Backups are non-negotiable — this DB is the system of record and the audit trail. (If on-box Postgres is ever substituted, automated EBS snapshots are the floor.)
- **Not internet-facing in spirit**: Caddy is the single HTTPS entry. Basic auth in front of the web app for employees; `/api/*` and `/poll/*` pass through to the API, which enforces bearer service tokens. Machine callers (Proliferate poll trigger, integration gateway) hit the same entry with tokens.
- **Stack**: Python/FastAPI + SQLAlchemy/Alembic, Celery worker + beat INSIDE the service (no external EventBridge/Fargate scheduling), Redis broker, Next.js web. No Rust. Follow the main server's patterns (pydantic Settings config, httpx clients) — lift idioms where useful.
- **Updates**: `compose pull && compose up -d` — boring by design. Every job is idempotent; mid-deploy restarts and double-fires are harmless.
- **[OPEN]**: repo location (`services/issues/` in the proliferate monorepo vs its own repo) and the service's name.

## 2. File tree (build target)

```
issues/
├── compose.yaml                  # api, worker, beat, redis, web, caddy (postgres = RDS)
├── Caddyfile                     # Basic auth → web; /api/*, /poll/* → api (api enforces tokens)
├── .env.example                  # every secret named, none valued
├── README.md                     # points at this spec + the deep-dive doc (§12)
├── api/
│   ├── pyproject.toml            # fastapi, sqlalchemy, alembic, celery, redis, httpx, pgvector
│   ├── alembic/versions/0001_init.py   # all §3 tables, one migration
│   ├── issuesvc/
│   │   ├── config.py             # pydantic Settings — every env var (§10)
│   │   ├── main.py               # app factory; mounts api/ routers + mcp server
│   │   ├── auth.py               # require_human (Basic) / require_service (bearer + X-Run-Id capture)
│   │   ├── db/
│   │   │   ├── base.py           # engine/session helpers
│   │   │   └── models.py         # 6 tables (§3), SQLAlchemy
│   │   ├── domain/
│   │   │   ├── states.py         # THE state machine: TRANSITIONS table (§4) + assert_transition()
│   │   │   ├── issues.py         # claim CAS, dedupe-at-sync upsert, investigation attach, PR link
│   │   │   ├── search.py         # hybrid: ILIKE/tsvector + pgvector cosine, merged ranking
│   │   │   └── events.py         # append_event(actor, action, payload) — sole writer to events
│   │   ├── api/
│   │   │   ├── issues.py         # REST (§6.2)
│   │   │   ├── poll.py           # GET /poll/new-issues, /poll/triaged-issues (§6.1)
│   │   │   └── emails.py         # phase 2 (§8): drafts list, approve, mark-sent
│   │   ├── mcp/
│   │   │   └── server.py         # MCP tools (§5) → domain calls; thin, zero logic
│   │   ├── jobs/
│   │   │   ├── celery_app.py     # app + beat schedule (§7.0)
│   │   │   ├── sync_sentry.py    # §7.1
│   │   │   ├── sync_grafana.py   # §7.2
│   │   │   ├── sync_support.py   # §7.3
│   │   │   ├── check_merges.py   # §7.4
│   │   │   ├── reap_claims.py    # §7.5
│   │   │   └── release_watch.py  # phase 2 (§8) — plus email_sender.py, phase 2
│   │   └── clients/
│   │       ├── sentry.py         # org-token httpx: list issues, get event, list users-by-tag
│   │       ├── grafana.py        # AMG alerting API httpx: firing rule states (§7.2; no CW alarms exist)
│   │       ├── github.py         # PR state by URL
│   │       ├── proliferate.py    # SupportReport poll client (server endpoint, §6.3)
│   │       └── customerio.py     # phase 2: transactional send + deliveries check
│   └── tests/
│       ├── test_states.py        # every legal + illegal transition
│       ├── test_claim.py         # CAS races, attempt_count, reap
│       ├── test_poll.py          # cursor echo, at-least-once replay, limit
│       └── test_sync_*.py        # upsert idempotency per source (HTTP mocked)
└── web/                          # Next.js, deliberately thin
    ├── package.json
    ├── lib/api.ts                # server-side fetch with WEB_SERVICE_TOKEN (never in browser)
    └── app/
        ├── issues/page.tsx       # board: filter status/source, occurrence count, claimed-by,
        │                         #   deep links out, manual status change
        ├── issues/[id]/page.tsx  # events timeline + investigation writeup + reporters
        └── emails/page.tsx       # phase 2: draft queue, approve button
```

## 3. Schema — exact (Postgres, 6 tables)

```sql
CREATE TABLE issues (
  id                     BIGSERIAL PRIMARY KEY,
  source                 TEXT NOT NULL CHECK (source IN ('sentry','grafana','support')),
  source_id              TEXT NOT NULL,            -- Sentry issue id / alarm ARN+state-ts / support report id
  fingerprint            TEXT,                     -- Sentry fingerprint / alarm ARN; NULL for support
  deeplink               TEXT NOT NULL,            -- click-out to Sentry/Grafana/ticket
  title                  TEXT NOT NULL,
  agent_description      TEXT,                     -- triage agent's NL description
  status                 TEXT NOT NULL DEFAULT 'new',   -- §4 enum, enforced in domain/states.py
  root_issue_id          BIGINT REFERENCES issues(id),  -- set iff status='duplicate'
  severity               TEXT,                     -- 'critical' | 'normal' (phase 2 classification)
  routing_note           TEXT,                     -- triage difficulty note → fix model tier
  occurrence_count       INTEGER NOT NULL DEFAULT 1,
  first_seen             TIMESTAMPTZ NOT NULL,
  last_seen              TIMESTAMPTZ NOT NULL,
  claimed_by             TEXT,                     -- workflow run id; NULL = unclaimed
  claimed_at             TIMESTAMPTZ,
  attempt_count          INTEGER NOT NULL DEFAULT 0,
  root_cause             TEXT,                     -- attach_investigation writes these three
  repro_steps            TEXT,
  evidence_links         JSONB,
  fix_pr_url             TEXT,
  fix_commit_sha         TEXT,
  shipped_in_release_id  BIGINT REFERENCES releases(id),
  embedding              VECTOR(1536),             -- title+description; written at insert/triage
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_issues_source_fp ON issues(source, fingerprint) WHERE fingerprint IS NOT NULL;
CREATE INDEX ix_issues_status ON issues(status);

CREATE TABLE events (                              -- append-only; ALSO the poll-feed backbone (§6.1)
  id          BIGSERIAL PRIMARY KEY,               -- monotonic → poll cursor
  issue_id    BIGINT NOT NULL REFERENCES issues(id),
  actor       TEXT NOT NULL,                       -- 'run:<id>' | 'job:<name>' | 'human:<user>'
  action      TEXT NOT NULL,                       -- 'issue.created','issue.triaged','status.changed',
                                                   -- 'investigation.attached','pr.linked','claim',
                                                   -- 'reporter.linked','pr.merged','reaped.three_strikes',...
  payload     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_events_action_id ON events(action, id);

CREATE TABLE issue_reporters (
  id                BIGSERIAL PRIMARY KEY,
  issue_id          BIGINT NOT NULL REFERENCES issues(id),
  contact           TEXT NOT NULL,                 -- user_id or email
  kind              TEXT NOT NULL CHECK (kind IN ('submitted','affected')),
  source_ticket_id  TEXT,                          -- SupportReport id when kind='submitted'
  UNIQUE (issue_id, contact, kind)
);

CREATE TABLE releases (
  id           BIGSERIAL PRIMARY KEY,
  version      TEXT NOT NULL UNIQUE,
  released_at  TIMESTAMPTZ NOT NULL,
  commit_shas  JSONB NOT NULL                      -- shas contained in this release
);

CREATE TABLE emails (                              -- phase 2 behavior; schema exists day one
  id               BIGSERIAL PRIMARY KEY,
  recipient        TEXT NOT NULL,
  template         TEXT NOT NULL CHECK (template IN ('thank-you','affected-fixed')),
  issue_id         BIGINT NOT NULL REFERENCES issues(id),
  release_id       BIGINT REFERENCES releases(id),
  params           JSONB NOT NULL,                 -- CIO transactional params
  status           TEXT NOT NULL DEFAULT 'drafted' CHECK (status IN ('drafted','approved','sent')),
  cio_delivery_id  TEXT,                           -- ground truth = CIO deliveries endpoint
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sync_cursors (
  source      TEXT PRIMARY KEY,                    -- 'sentry' | 'grafana' | 'support'
  cursor      JSONB NOT NULL,                      -- per-source shape, §7
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Two email tiers via `issue_reporters.kind`: `submitted` = the person who filed a support ticket (thank-you + changelog credit), populated at sync time from `SupportReport.owner_user_id`; `affected` = users who hit the error silently, enumerated by querying the Sentry API's user tag **at ship time** (phase 2) — there is deliberately NO continuous issue→user reverse index. Duplicate linking appends reporters to the root issue, so a dupe ticket still earns its submitter a thank-you.

## 4. State machine — exact transition table

Single source of truth: `domain/states.py`. Every mutation calls `assert_transition(from, to, actor_kind)`; anything not in this table returns `invalid_transition` (as data, not an HTTP error — see §5 conventions).

| From | To | Allowed actor | Trigger |
|---|---|---|---|
| — | `new` | job | sync insert |
| `new` | `triaged` | run | triage: real + novel (writes `routing_note`, `agent_description`) |
| `new` | `dismissed` | run, human | triage spam/noise (reason REQUIRED) |
| `new` | `duplicate` | run, human | `mark_duplicate` (sets `root_issue_id`) |
| `new` | `needs-human` | run, job | triage can't decide; or 3-strike reap (§7.5) |
| `triaged` | `awaiting-merge` | run | fix workflow: PR open + review passed (requires `fix_pr_url`) |
| `triaged` | `needs-human` | run, job | investigation gate failed; or 3-strike reap |
| `needs-human` | `triaged` | human | Pablo re-queues for fix |
| `needs-human` | `dismissed` | human | Pablo kills it |
| `awaiting-merge` | `merged` | job | `check_merges` sees PR merged (records `fix_commit_sha`) |
| `awaiting-merge` | `triaged` | human | PR closed unmerged / needs rework |
| `merged` | `shipped` | job | `release_watch`: sha contained in a release (phase 2) |

`dismissed`, `duplicate`, `shipped` are terminal. A `duplicate` follows its root downstream.

**Claim is orthogonal to status** — exact CAS **[elaboration]**:

```sql
UPDATE issues
SET claimed_by = :run_id, claimed_at = now(), attempt_count = attempt_count + 1
WHERE id = :issue_id AND claimed_by IS NULL AND status = :expected_status
RETURNING id;   -- 0 rows → already_claimed (fetch claimed_by for the return) or not_found
```

`claimed_by` clears on any status transition and on reap. This CAS is what makes duplicate workflow fires (poll at-least-once delivery) harmless by construction.

## 5. Agent-facing tools (MCP server)

The MCP server (`mcp/server.py`) is a **thin 1:1 adapter** over the REST routes (§6.2) — zero logic of its own. It registers once with Proliferate's integration gateway, which handles auth injection, per-workflow tool scoping, and audit. There is no session-level "MCP injection" anywhere (Pablo, explicit).

Conventions (the highest-leverage design decisions in this service):
- **Errors are enumerated return values, not HTTP failures.** `already_claimed` and `invalid_transition` are *normal agent inputs*; each tool description tells the agent what to do on each outcome. Never make an agent interpret a 409.
- **The state machine lives in the API, not the prompt.** A confused agent physically cannot corrupt the lifecycle.
- **Every mutating call auto-appends to `events`** with the caller's identity (`X-Run-Id` header, captured by `auth.py`). Agents never remember to log; the service does.

```
claim
  args:    { issue_id: int, run_id: string }
  returns: { outcome: "ok" } | { outcome: "already_claimed", by: string } | { outcome: "not_found" }
  guidance: call FIRST in every workflow run; on already_claimed or not_found, exit silently.

update_status
  args:    { issue_id: int, status: enum(§4), reason?: string }
  returns: { outcome: "ok" } | { outcome: "invalid_transition", from: string, to: string }
  guidance: on invalid_transition, get_issue to re-read — another actor moved it; exit.

mark_duplicate
  args:    { issue_id: int, root_issue_id: int, confidence: number(0..1) }
  returns: { outcome: "ok" } | { outcome: "not_found" } | { outcome: "self_reference" }

mark_dismissed
  args:    { issue_id: int, reason: string }        // reason REQUIRED — audit for silent deaths
  returns: { outcome: "ok" } | { outcome: "invalid_transition", ... }

search_issues
  args:    { query: string, status?: string[], limit?: int = 10 }
  returns: { results: [{ issue_id, title, status, fingerprint, source, deeplink, score }] }
  guidance: run BEFORE deciding novel-vs-duplicate; hybrid lexical + embedding.

get_issue
  args:    { issue_id: int }
  returns: full issue row + reporters + last 20 events

attach_investigation
  args:    { issue_id: int, root_cause: string, repro_steps: string, evidence_links: string[] }
  returns: { outcome: "ok" } | { outcome: "invalid_transition", ... }
  guidance: ALL THREE fields required — this IS the "decently evidenced" gate. If you cannot
            fill them with confidence, call update_status(needs-human, reason) instead.

link_pr
  args:    { issue_id: int, pr_url: string }
  returns: { outcome: "ok" } | { outcome: "invalid_url" }

list_reporters
  args:    { issue_id: int }
  returns: { reporters: [{ contact, kind: "submitted"|"affected", source_ticket_id }] }
```

Gateway scoping (configured Proliferate-side, recorded here for reference): triage workflow → `claim, get_issue, search_issues, update_status, mark_duplicate, mark_dismissed`; fix workflow → all tools.

## 6. HTTP API — exact surface

`auth.py` exposes two dependencies: `require_human` (Basic, for web-app-backed routes) and `require_service` (bearer ∈ `SERVICE_TOKENS`; captures `X-Run-Id` for event attribution).

### 6.1 Poll feeds (service auth) — backed by `events` **[elaboration]**

The monotonic `events.id` IS the cursor. Two feeds, both implementing the poll contract that Proliferate's trigger primitive consumes (documented fully in the umbrella spec §2; the rules that matter to THIS side):

- Cursor is opaque to the caller: base64 `{"last_event_id": N}`. Server-issued, echoed back.
- **At-least-once**: the same cursor may be polled twice (caller crashed before persisting). Re-serving is safe by construction — these are SELECTs over an append-only table, never a destructive pop.
- `limit` caps burst; backlog drains across polls; `has_more` signals remaining items.

```
GET /poll/new-issues?cursor=&limit=50
  → items from events WHERE action = 'issue.created' AND id > cursor ORDER BY id LIMIT :limit

GET /poll/triaged-issues?cursor=&limit=50
  → items from events WHERE action = 'issue.triaged' AND id > cursor ORDER BY id LIMIT :limit

Item shape:
{
  "id": "evt_18842",                    // events.id — the idempotency key on the caller's side
  "kind": "issue.created",
  "occurred_at": "2026-07-06T21:14:03Z",
  "data": { "issue_id": 512, "source": "sentry", "title": "...", "fingerprint": "...",
            "deeplink": "...", "status": "new", "routing_note": null, "occurrence_count": 3 }
}
```

### 6.2 REST routes

```
Service (agents via gateway; §5 tools are 1:1 over these):
POST /v1/issues/{id}/claim           {run_id}
POST /v1/issues/{id}/status          {status, reason?}
POST /v1/issues/{id}/duplicate       {root_issue_id, confidence}
POST /v1/issues/{id}/dismiss         {reason}
POST /v1/issues/{id}/investigation   {root_cause, repro_steps, evidence_links[]}
POST /v1/issues/{id}/pr              {pr_url}
GET  /v1/issues/{id}                 → full row + reporters + last 20 events
GET  /v1/issues/{id}/reporters
GET  /v1/search?q=&status=&limit=    → hybrid ranked results

Human (web app; server-side token, Basic auth at the edge):
GET   /v1/issues?status=&source=&q=&cursor=&limit=50     → board query
PATCH /v1/issues/{id}                {status, reason}     → manual transition (same state machine;
                                                            'human' actor rows in §4)
GET   /v1/issues/{id}/events                              → full timeline

Phase 2: GET /v1/emails?status=drafted · POST /v1/emails/{id}/approve
```

### 6.3 Upstream dependency: the server's SupportReport endpoint

`sync_support` consumes `GET {server}/v1/support/reports?cursor=&limit=` — a NEW cursor-based endpoint on the main proliferate server (owned by the support workspace lane, not this service; it deliberately conforms to the same poll contract). If the endpoint isn't live yet when this service builds, stub `clients/proliferate.py` against the contract and proceed — do not read the server's DB or S3 directly.

Verified source shapes (merged #972/#976, table `support_report`): `urgent` and `notify_me` are NOT NULL booleans; `credit_consent`/`credit_name` (persisted for any kind); `telemetry_refs_json` is TEXT whose parsed shape is `{posthogDistinctId?, posthogSessionId?, sentryEventIds?: string[]}` — **camelCase keys** (the endpoint must parse and surface `sentryEventIds`). The outreach email is NOT on the report — it's `user.outreach_email` (nullable String(320); fall back to account email when null). Existing routes are all POST + `current_active_user`; the server has no admin/service-token support routes yet, so the new endpoint defines that auth pattern. Reporter contact resolution: `owner_user_id` → user's `outreach_email ?? email`.

## 7. Background jobs — exact mechanics (Celery, in-service)

### 7.0 Beat schedule

```python
beat_schedule = {
  "sync-sentry":  {"task": "sync_sentry",  "schedule": crontab(minute="*/5")},
  "sync-grafana": {"task": "sync_grafana", "schedule": crontab(minute="*/5")},
  "sync-support": {"task": "sync_support", "schedule": crontab(minute="*/5")},
  "check-merges": {"task": "check_merges", "schedule": crontab(minute="*/5")},
  "reap-claims":  {"task": "reap_claims",  "schedule": crontab(minute="*/15")},
  # phase 2: release-watch (hourly), email-sender (every 1 min, drains 'approved')
}
```

Every job idempotent; every run logs one summary line (scanned / inserted / updated / errors).

### 7.1 `sync_sentry`

Verified environment (merged 2026-07-06): org slug `proliferate`; projects `proliferate-server`, `proliferate-desktop`, `proliferate-desktop-native`, `anyharness`, `proliferate-target`, `proliferate-web`, `proliferate-mobile`. Identity tags available for the ship-time affected-user query: `org_id`/`user_id`/`sandbox_id`/`runtime_env` on server + E2B Rust surfaces; desktop renderer sets `organization_id` tag + `user.id` via `setUser` (query `user.id`, not a tag, there); **desktop-native events carry NO identity** (known gap, Tauri IPC deferred) — affected-user enumeration silently undercounts that project. Page-worthy vs ambient: filter `level:fatal` OR tag `critical_failure:true` (the `report_critical` contract, 7 call sites).

1. Read `sync_cursors['sentry']` → `{"last_seen": "<iso>"}`.
2. `GET /api/0/organizations/proliferate/issues/?query=is:unresolved&sort=date`, paginate until items older than `last_seen`.
3. Per Sentry issue, upsert on `(source='sentry', fingerprint=<sentry issue id>)`:
   - exists → update `occurrence_count` (Sentry's count) + `last_seen`; NO state change, NO event.
   - new → insert `status='new'` (title, deeplink, first/last_seen), compute `embedding`, `append_event('issue.created')`.
4. Advance cursor to newest `lastSeen`. Sentry's own fingerprint grouping IS this source's dedup.

### 7.2 `sync_grafana`

v1 ingests **alert-rule-fired errors only**. Verified reality (merged 2026-07-06): there are **no CloudWatch alarms** — alerting is AWS Managed Grafana, workspace `proliferate-ops` (`g-e532d030d8`, us-east-1), three provisioned rules (ALB 5xx>10/5m `bfrbv8roir474e`, p95>5s/10m `ffrbv99mqhgjkc`, ECS CPU>90%/15m `bfrbv9r4945xcd`), contact point → `#alerts`. So this job polls the **AMG alerting API** (service-account token) for rules in `firing` state; fingerprint = rule UID + window start. Sentry's two alert rules (`17267915` new/regressed-fatal, `442367` p95) don't need separate ingestion — their issues arrive via §7.1. Upsert identical to §7.1. "Detect novel patterns from raw logs" is explicitly OUT (that's a log-clustering system, not a sync job).

### 7.3 `sync_support`

1. Read cursor; poll the server endpoint (§6.3).
2. Per report:
   - `sentry_event_ids` present → resolve event → parent Sentry issue via Sentry API. If tracked locally → **link, don't create**: append reporter `(owner_user_id, kind='submitted', source_ticket_id)`, bump `occurrence_count`, `append_event('reporter.linked')`. This is dedup from structured evidence, before any agent reasoning.
   - otherwise → insert `status='new'`, `source='support'`, `fingerprint=NULL`, reporter row, embedding. Fuzzy dedup against existing issues is the **triage agent's** job (via `search_issues`), not this job's.
3. Echo cursor.

### 7.4 `check_merges`

1. `SELECT ... WHERE status='awaiting-merge' AND fix_pr_url IS NOT NULL`.
2. Parse `owner/repo/number`; `GET /repos/{o}/{r}/pulls/{n}`.
3. `merged: true` → transition `merged`, record `merge_commit_sha` → `fix_commit_sha`, `append_event('pr.merged')`.
4. `closed, merged: false` → `append_event('pr.closed_unmerged')` + Slack note; a human decides (→ `triaged` rework or `dismissed`).

This poller exists because the fix agent CANNOT report merges — it exits at `awaiting-merge`, before the human merges. No GitHub webhooks in v1 (Pablo-pinned; latency doesn't matter since emails are release-gated).

### 7.5 `reap_claims` **[elaboration]**

Claims older than 2h with no terminal transition = dead run. Clear `claimed_by`; if `attempt_count >= 3` → force `needs-human`, `append_event('reaped.three_strikes')`. A poison-pill issue can't loop forever.

## 8. Phase 2 — release watcher + emails (schema day one, build later; Pablo-pinned sequencing)

- `release_watch` (hourly): for each `merged` issue with `fix_commit_sha` ∈ some `release.commit_shas` → `shipped`; enumerate affected users by querying **Sentry's user tag at ship time**; materialize `emails` drafts from `issue_reporters` — `submitted` → `thank-you` (+ changelog credit), `affected` → `affected-fixed` courtesy. Severity for the affected tier uses conservative hard thresholds (error/user counts), never agent judgment alone. Verified release facts (#968): Sentry release format is `<component>@<VERSION>+<short_sha>` with a **12-char** sha (e.g. `proliferate-server@0.3.6+9affc0f0d489`); version source is the root `VERSION` file; `hotfix-production.yml` bumps VERSION + tags `proliferate-v*` — so `releases.commit_shas` matching must compare against 12-char short shas, and the release feed's natural hook is the promote/hotfix workflow (which already computes `${GIT_SHA:0:12}`).
- `email_sender` (1-min, drains `approved`): fires **Customer.io transactional** (`/v1/send/email`), records `cio_delivery_id`. Ground truth for delivery is the CIO **deliveries endpoint** — never the dashboard state field, never the metrics endpoint (twice-proven lesson). No Resend, no SES — bypassing CIO's topics/frequency caps is exactly why the old transactional welcome path was killed.
- Approval is a row-level state machine (`drafted → approved → sent`); the web email queue flips `approved`. Auto-send graduates later, thank-you tier first. (This table + flow is the engagement stack's deferred L4 `fix_notification_queue`, absorbed — see umbrella spec.)

## 9. Web app (deliberately thin)

Next.js, Basic auth at the edge, server-side API token (never shipped to the browser). Three views, glance-and-click-out, no config surface, no workflow editing:

1. **Board** (`/issues`) — filter by status/source, free-text search; rows show title, source badge, occurrence count, claimed-by, deep link out, PR link; manual status change (PATCH, same state machine).
2. **Detail** (`/issues/[id]`) — the events timeline rendered, investigation writeup (root cause / repro / evidence), reporters list.
3. **Email queue** (`/emails`, phase 2) — drafts pending approval; approve = one button.

## 10. Secrets / env (`.env.example` contents)

```
DATABASE_URL=                    # RDS Postgres w/ pgvector
REDIS_URL=
SENTRY_ORG_TOKEN=                # minted ONCE, shared with the dashboards' Errors panel (org:read,
                                 #   project:read, event:read)
GRAFANA_URL=                     # AMG workspace proliferate-ops (g-e532d030d8, us-east-1)
GRAFANA_TOKEN=                   # AMG service-account token (same provisioning path as §7.2 rules)
GITHUB_TOKEN=                    # PR state reads
PROLIFERATE_SUPPORT_TOKEN=       # server's /v1/support/reports
SERVICE_TOKENS=                  # comma-sep bearer tokens for machine callers
WEB_SERVICE_TOKEN=               # web app's server-side API token
BASIC_AUTH_USERS=                # caddy basic-auth credentials
# phase 2:
CUSTOMERIO_APP_API_KEY=
```

## 11. Build order

1. Migration 0001 + `domain/states.py` + `domain/issues.py` (claim CAS, upserts) + tests (states/claim are the correctness core — test first)
2. REST routes (§6.2) + auth + `domain/events.py`
3. Poll feeds (§6.1) + tests (cursor replay)
4. Jobs: `sync_sentry` → `sync_grafana` → `sync_support` → `check_merges` → `reap_claims`
5. `domain/search.py` (lexical first, pgvector second) + MCP server (§5)
6. Web app (board + detail)
7. Compose + Caddy + RDS + secrets; deploy
8. Phase 2 (separate pass, after the loop is proven): `release_watch`, `email_sender`, emails routes, email queue view

## 12. Docs deliverable

A navigable deep-dive doc in the same format as `codex/workflows-deep-dive.md` — reading paths ("to understand X, read these in order"), end-to-end flows, data model + transition table, per-layer file links, design rationale, known gaps — written as part of the build and kept current in the same PRs that change code. Plus: the state-transition diagram (§4) is the single shared truth referenced by both API validation and workflow prompts; the tool reference (§5) doubles as the customer-facing template artifact.

## 13. Explicitly out of scope (v1)

- Log clustering / novel-pattern detection from raw logs (alert-rule-fired only)
- GitHub/Sentry/Grafana webhooks (polling everywhere; revisit only if latency matters)
- Continuous issue→user reverse index (ship-time Sentry query instead)
- Flaky-test anything (no discriminator, no quarantine — cut entirely)
- Auto-merge, auto-send (both human-gated; graduation is a later, explicit decision)
- Any UI beyond the three views
