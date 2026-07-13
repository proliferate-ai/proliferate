# Support capture v1 — implementation record & architecture

> Historical implementation record. The referenced
> `issue-autofix-system-v1.md` draft no longer exists in the current tree and
> its earlier resolution design was superseded by the accepted support-system
> contract. Use
> [`../codebase/features/support-system.md`](../codebase/features/support-system.md)
> for downstream issue/release/changelog behavior, and
> [`../codebase/features/support-reporting.md`](../codebase/features/support-reporting.md)
> for shipped capture behavior.

*2026-07-06. The complete record of the support-flow upgrade built across PRs
#972 (server capture fields), #976 (desktop modals), and the parked
`support-ops` prototype. Written after the 2026-07-06 split decision: capture
(this doc's subject) is permanent and merging; the then-current
resolution/triage/notify direction moved to an issue-service draft that has
since been replaced by
[`../codebase/features/support-system.md`](../codebase/features/support-system.md).
Read that document for everything after a report is captured.*

---

## 0. One paragraph

Users submit bug reports and feature prompts from two desktop modals. Reports
carry four new signals — `urgent`, `notify_me`, `credit_consent`/`credit_name`
(now on bugs too), and an account-wide `outreach_email` override — plus an
"Include app logs" toggle that, for the first time, lets a reporter exclude
diagnostics. Everything lands in the `support_report` Postgres row AND in
`request.json` in S3, which is the read boundary for the downstream issues
service. Slack gets a 🚨-titled message for urgent reports. The product layer
stops there by design: it captures and never resolves, triages, or emails
reporters.

## 1. Architecture and the deliberate boundary

```
Desktop app (Tauri)                     Product server                      S3 bucket
───────────────────                     ──────────────                      ─────────
SendFeedbackModal ─┐                                                   proliferate-support-
SubmitPromptModal ─┤ SupportReportJob                                  reports-{dev,prod}
                   ▼                                                   support/reports/
persisted upload queue ──POST──▶ /v1/support/reports ────────────────▶  {date}/{id}/
(retry/backoff, survives          (creates support_report row)            request.json  ◀── carries urgent/
 app restarts)         ──POST──▶ .../upload-targets                       diagnostics.json    notifyMe/credit
                                  (presigned S3 PUTs) ──client PUT──▶     attachment-*
                       ──POST──▶ .../complete                             complete.json
                                    │
                                    ▼
                              Slack webhook (🚨 title if urgent)

────────────────────────────── CAPTURE / RESOLUTION BOUNDARY ──────────────────────────────

Everything below was assigned to the then-planned issues service (now replaced
by [`../codebase/features/support-system.md`](../codebase/features/support-system.md)):
ingestion via a pollable /v1/support/reports endpoint (scoped, not built),
triage/fix workflows, state machine, and ALL reporter-facing email (Customer.io
transactional, approval-gated).
```

Why the boundary is where it is (decided at align, reaffirmed by the split):
mixing notification into the product is how transactional email systems
bifurcate — the old CIO welcome path died from exactly that. The product's
support tables are **capture-only**: no resolution columns exist or will be
added here. The `support-ops` repo prototyped the other side of the boundary
and validated the separations (service-owns-truth, duplicate grouping, gated
email) before the issues service was spec'd; it is now parked.

## 2. PR map and merge order

| PR | Branch | Base | Status |
|---|---|---|---|
| proliferate#972 | `support/capture-fields` | `main` | draft — **merge first** |
| proliferate#976 | `support/modal-fields` | `support/capture-fields` | draft, stacked — merge second |
| support-ops#1 | `init/core` | `main` (separate repo) | **parked, do not merge** (superseded) |

\#976 is stacked: its GitHub diff shows only desktop work on top of #972. The
regenerated SDK in #972 (`cloud/sdk/src/generated/openapi.ts`) is the contract
\#976 compiles against.

---

## 3. PR #972 — server capture fields

### 3.1 File tree

```
server/
├─ alembic/versions/
│  └─ c7f2a9b41d38_support_urgent_notify_and_user_outreach_email.py   [NEW]
├─ proliferate/
│  ├─ config.py                          [+support_report_internal_base_url]
│  ├─ auth/
│  │  ├─ models.py                       [UserRead +outreach_email]
│  │  └─ profile_api.py                  [+PATCH /v1/users/me]
│  ├─ db/
│  │  ├─ models/auth.py                  [User.outreach_email]
│  │  ├─ models/support.py               [SupportReport.urgent, .notify_me]
│  │  └─ store/support_reports.py        [persist both columns]
│  └─ server/support/
│     ├─ models.py                       [SupportReportCreateRequest +urgent/notifyMe]
│     ├─ service.py                      [thread fields through create flow]
│     ├─ notifications.py                [urgent/notify_me → Slack plan]
│     └─ domain/
│        ├─ message.py                   [urgent title + 2 new Slack fields]
│        └─ report_records.py            [urgent/notifyMe → request.json]
├─ tests/unit/
│  ├─ test_support_message_domain.py     [urgent-title assertions]
│  └─ test_support_report_records.py     [NEW]
cloud/sdk/src/generated/openapi.ts        [regenerated]
specs/codebase/features/support-reporting.md
```

### 3.2 Migration `c7f2a9b41d38` (chains off `ff9344886948`)

```python
def upgrade() -> None:
    if _has_table("support_report"):
        if not _has_column("support_report", "urgent"):
            op.add_column("support_report", sa.Column(
                "urgent", sa.Boolean(), nullable=False, server_default=sa.false()))
        if not _has_column("support_report", "notify_me"):
            op.add_column("support_report", sa.Column(
                "notify_me", sa.Boolean(), nullable=False, server_default=sa.false()))
    if _has_table("user") and not _has_column("user", "outreach_email"):
        op.add_column("user", sa.Column(
            "outreach_email", sa.String(length=320), nullable=True))
```

Idempotent via `_has_table`/`_has_column` guards — the dev profile
(`support-capture`, DB `proliferate_dev_support_capture`) was rebuilt more
than once during verification and this survived it. Single alembic head
preserved by chaining off #932's `kind`/`credit_consent` migration.

### 3.3 Wire contract

`server/proliferate/server/support/models.py` — same alias convention as the
existing credit pair, so clients learn nothing new:

```python
kind: Literal["bug", "feature"] = Field(default="bug")
credit_consent: bool = Field(default=False, alias="creditConsent")
credit_name: str | None = Field(default=None, alias="creditName", max_length=200)
urgent: bool = Field(default=False, alias="urgent")
notify_me: bool = Field(default=False, alias="notifyMe")
```

Both fields flow to **two** sinks via `service.py`: the `support_report` row
(`db/store/support_reports.py`) and, via `domain/report_records.py`, the
`request.json` object in S3. The S3 copy is what makes downstream consumers
(issues service) independent of product-DB reads for report content.

### 3.4 `PATCH /v1/users/me` — outreach_email

`server/proliferate/auth/profile_api.py` went from read-only to read/write:

```python
class ProfileUpdateRequest(BaseModel):
    outreach_email: str | None = None

    @field_validator("outreach_email")
    @classmethod
    def _validate_outreach_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        return str(_email_adapter.validate_python(cleaned))  # ValidationError → 422

@router.patch("/me", response_model=UserRead, ...)
async def update_current_user_profile(body, user, db) -> UserRead:
    if "outreach_email" in body.model_fields_set:
        user.outreach_email = body.outreach_email
    ...
```

Semantics worth remembering:
- key absent from PATCH body → value untouched (`model_fields_set` check)
- `null` or `""`/whitespace → cleared (falls back to account email)
- anything else must validate as an email → else 422

All support outreach should address `outreach_email ?? email`. **Caveat for
the issues service:** the autofix spec sends via Customer.io keyed on the
user profile — it must resolve this override or the setting is dead weight
(flagged to Pablo 2026-07-06; unresolved).

### 3.5 Slack urgency

`domain/message.py` — `SupportMessagePlan` gained a `title`:

```python
title = "*:rotating_light: URGENT support report*" if urgent else "*New support report*"
fields += [
    SupportMessageField("Urgent", "Yes" if urgent else "No"),
    SupportMessageField("Notify requested", "Yes" if notify_me else "No"),
]
```

Verified by unit test only — local dev has no `SUPPORT_SLACK_WEBHOOK_URL`.
Eyeball the real channel after the first urgent prod report.

### 3.6 Rode-along config fix

`notifications.py` referenced `settings.support_report_internal_base_url`
(the "view in admin" Slack link) but `config.py` never declared it, even
though `SUPPORT_REPORT_INTERNAL_BASE_URL` sits in `server/.env`. Fixed:

```python
support_report_internal_base_url: str = ""
```

### 3.7 Verification (all real, not mocked)

- `uv run pytest -q tests/unit` → 504 passed.
- Migration applied to fresh Postgres; `information_schema` confirms types.
- Real server boot on profile `support-capture` → `/setup` claim → bearer →
  `POST /v1/support/reports {"urgent":true,"notifyMe":true}` →
  DB row `urgent=t, notify_me=t` AND
  `s3://proliferate-support-reports-dev/.../request.json` contains both.
- outreach_email: set → GET reflects; `not-an-email` → 422; `""`/`null` → cleared.

---

## 4. PR #976 — desktop modals

### 4.1 File tree

```
apps/desktop/src/
├─ components/support/
│  ├─ SendFeedbackModal.tsx          [urgent/notify/credit/logs checks + footer]
│  ├─ SubmitPromptModal.tsx          [+notify-me check + footer]
│  ├─ SupportCheckboxRow.tsx         [NEW shared row]
│  ├─ SupportCreditField.tsx         [NEW shared credit check + name input]
│  └─ SupportModalFooter.tsx         [NEW "Updates go to {email} · change"]
├─ hooks/support/
│  ├─ facade/
│  │  ├─ use-support-modal-state.ts        [+urgent/notifyMe/includeLogs state]
│  │  └─ use-support-outreach-email.ts     [NEW GET/PATCH edit-state hook]
│  └─ lifecycle/
│     ├─ support-report-upload-payload.ts  [diagnostics now conditional]
│     └─ use-support-report-upload-queue.ts [skip diagnostics when logs off]
├─ lib/domain/support/report-types.ts [SupportReportJob +3 fields]
cloud/sdk/src/client/users.ts         [NEW getCurrentUser/updateCurrentUser]
cloud/sdk-react/src/hooks/support.ts  [fields threaded, web UI unchanged]
server/proliferate/server/support/service.py  [credit_name bugfix — §4.5]
specs/codebase/features/support-reporting.md
```

### 4.2 The modals (copy is Pablo's, verbatim from the workspace doc)

```tsx
// SendFeedbackModal.tsx (bug)
<SupportCheckboxRow checked={urgent} onCheckedChange={setUrgent}
  label="This is urgent" helper="We'll send you an email by tomorrow." />
<SupportCheckboxRow checked={notifyMe} onCheckedChange={setNotifyMe}
  label="Let me know when you fix this" helper="We'll send you an update within a day." />
<SupportCreditField label="Credit me" ... />
<SupportCheckboxRow checked={includeLogs} onCheckedChange={setIncludeLogs}
  label="Include app logs" />   {/* default ON */}
```

Prompt modal: `"Credit me if this merges"` (pre-existing) +
`"Let me know when you merge this"` (notifyMe; urgent is bug-only —
`urgent: kind === "bug" ? urgent : false`). The static
"We'll get back to you on this by tomorrow." line was removed — superseded by
the conditional helpers.

The shared rows are deliberately low-profile — plain `text-ui-sm` labels,
`space-y-0.5` group spacing, no borders — reworked mid-build from #932's
bordered-box idiom because 4 stacked boxes read as heavy (Pablo's call):

```tsx
// SupportCheckboxRow.tsx
<Label className="mb-0 flex cursor-pointer items-center gap-2.5 py-1 text-ui-sm text-foreground">
  <Checkbox checked={checked} onCheckedChange={(next) => onCheckedChange(next === true)} />
  <span className="text-ui-sm">{label}</span>
</Label>
{helper && checked ? (
  <p className="mt-0.5 pl-6 text-ui-sm text-muted-foreground">{helper}</p>
) : null}
```

### 4.3 Logs toggle — pipeline surgery, not just a checkbox

Diagnostics upload used to be unconditional. Now:

```ts
// support-report-upload-payload.ts
expectedClientUploads: {
  diagnostics: job.includeLogs !== false,   // was hardcoded true
  attachmentCount,
},
```

`completeRequestForUpload` accepts `diagnostics?: {...}` and emits
`diagnostics: null` + `packageManifest.diagnosticsIncluded: false` when
absent. The queue (`use-support-report-upload-queue.ts`) skips collection
entirely when logs are off; with no attachments either it completes directly
without ever requesting upload targets. Old persisted queue jobs (pre-field)
still upload — every new field is optional with a safe default. Covered by a
dedicated test:

```ts
it("skips diagnostics and completes directly when logs are excluded and there are no attachments", ...)
// asserts: buildSupportReportPackage never called, no upload-targets call,
// complete.diagnostics === null, create.expectedClientUploads.diagnostics === false
```

### 4.4 Outreach-email footer

`use-support-outreach-email.ts` wraps GET/PATCH `/v1/users/me` (via the new
`cloud/sdk/src/client/users.ts`) into begin/save/cancel edit state;
`SupportModalFooter.tsx` renders:

```tsx
<p className="text-ui-sm text-muted-foreground">
  Updates go to {outreach.effectiveEmail ?? "your account email"}
  {" · "}
  <Button variant="unstyled" onClick={outreach.beginEdit}>change</Button>
</p>
```

`effectiveEmail = outreach_email ?? email`, computed client-side. Save is
account-wide (a PATCH), not per-report. Server 422 surfaces inline.

### 4.5 The bug this lane caught

`server/proliferate/server/support/service.py` gated credit-name persistence
on `kind == "feature"` — a #932 leftover. With credit-me now on the bug
modal, every bug report's name would have been silently dropped:

```diff
-  credit_name=(body.credit_name if body.kind == "feature" and body.credit_consent else None),
+  credit_name=(body.credit_name if body.credit_consent else None),
```

### 4.6 Verification

- `pnpm vitest run src/components/support src/hooks/support` → 20/20.
- `tsc --noEmit` clean; touched server tests 9/9.
- Behavioral, on real infra (profile `support-modals`, real bucket): the
  all-checked submit → DB `urgent=t, notify_me=t, credit_consent=t,
  credit_name='Ada Lovelace'` + `request.json` carries urgent/notifyMe;
  logs-off submit → no `diagnostics.json` object exists; outreach round-trip
  + 422 both exercised. **Deviation:** the Tauri UI itself was never
  visually driven (headless build sandbox) — the identical code path was
  exercised via the built cloud-sdk dist. Worth 10 min in pdev before merge.

---

## 5. support-ops — parked prototype (do not build on)

Repo: `github.com/proliferate-ai/support-ops` (private), local `~/support-ops`,
PR #1 open and permanently unmerged. Superseded 2026-07-06 by the then-planned
issues service (now replaced by
[`../codebase/features/support-system.md`](../codebase/features/support-system.md)): S3-polling → pollable
server endpoint; sqlite resolution state → issues-service Postgres; Resend
sender → Customer.io transactional behind an approval queue. Rationale: two
parallel "we fixed it" email systems is the failure mode that killed the old
transactional welcome path.

What it proved on real data (5 dev reports) before parking, and what's worth
lifting when building the issues service:

- **Defensive `request.json` parsing** (`src/support_ops/parse.py`) — real
  reports are schemaVersion 2 without the new fields; every field optional
  with defaults. The issues service's `sync_support` needs the same posture.
- **Duplicate-group fan-out** (`canonical_report_id` self-FK; resolve on the
  canonical, duplicates inherit `resolution_message`/`resolved_at`; notify
  fans out over the group, filtering `notify_me=true AND notified_at IS NULL`).
  Direct ancestor of the spec's `root_issue_id` + reporter-append model.
- **Dry-run-first sends** (render to `./outbox/`, `--execute` to fire,
  idempotent via `notified_at`) — the manual precursor of the spec's
  `drafted → approved → sent` queue.
- **Graceful schema probing** — `product_db.py` checks `information_schema`
  for `outreach_email` and falls back to `email`, so it works on DBs from
  before #972.

## 6. Data reference

`support_report` row (capture-relevant columns after #972):

| column | type | source |
|---|---|---|
| `kind` | bug \| feature | #932 |
| `credit_consent` / `credit_name` | bool / varchar(200) | #932 (bugfix in #976) |
| `urgent` | bool NOT NULL default false | #972 |
| `notify_me` | bool NOT NULL default false | #972 |
| `owner_user_id` | FK user | #932 — the issues service's reporter identity |
| `telemetry_refs_json` | TEXT (JSON: posthogDistinctId, posthogSessionId, sentryEventIds[≤20]) | #932 — ticket↔Sentry dedup evidence |
| `status` / `completed_at` | lifecycle | #932 — poll-endpoint cursor material |

`user.outreach_email` — varchar(320) NULL, #972. Resolution rule everywhere:
`outreach_email ?? email`.

S3 layout per report: `support/reports/{date}/{id}/{request.json,
diagnostics.json?, attachment-*, complete.json}` — `complete.json` last;
its presence = fully uploaded.

## 7. What remains (as of 2026-07-06)

**Work:**
1. Merge #972 → then #976 (stacked). Optionally 10 min of eyes-on pdev for
   the modal spacing first (never visually driven).
2. Pollable `/v1/support/reports` endpoint — scoped in the Support Workspace
   doc (keyset cursor over `(completed_at, id)` + new index, items only for
   completed reports, structured telemetry_refs, static bearer token, S3
   pointers not content). **Awaiting Pablo's scoping approval.** ~1 lane.
3. Post-merge: watch one real urgent report hit Slack (webhook leg unverified
   locally).

**Human decisions (Pablo):**
1. **Modal copy vs pipeline reality** — "email by tomorrow" (urgent) and
   "update within a day" (notify) ship in #976, but the issues service emails
   at *ship time* (hours-to-days) and nothing automates an urgent same-day
   email. Soften copy pre-merge, or own it as a manual commitment.
2. **outreach_email must survive the CIO path** — the autofix spec sends via
   Customer.io keyed on profile email and never mentions the override. Needs
   a line in that spec (resolve `outreach_email ?? email` when drafting, or
   sync the override into the CIO profile), else the footer setting is inert.
3. Poll-endpoint scoping questions: (a) first-poll backfill: all history or
   from-now (recommend: full backfill — the service dedups); (b) emit
   resolved reporter email in `data`, or `owner_user_id` only per spec §4.1
   (recommend: emit resolved email, kills two birds with decision 2);
   (c) auth token: new `SUPPORT_POLL_API_TOKEN` setting vs waiting for a
   shared service-auth mechanism (recommend: new setting, trivial to swap).
