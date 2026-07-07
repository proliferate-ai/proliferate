# Engagement stack

The engagement stack delivers deliberate lifecycle email to maximize feedback,
retention, and class. Five email surfaces: company-email onboarding,
personal-email onboarding, winback after inactivity, heavy-user check-in, and
changelog broadcasts. A deferred sixth (fix notifications) is owned by the
issue-autofix system (`specs/tbd/issue-autofix-system-v1.md` section 9). The
server side lives in PR #967 (branch `engagement/customerio-sync`); Customer.io
objects live in workspace 219585 as draft campaigns.

See also: `specs/developing/analytics/customerio.md` documents the integration
module itself (identify, events, attribute push, env vars).

---

## Architecture

The system bridges Postgres state into Customer.io profile attributes, then
uses CIO's native segmentation and campaign machinery for targeting and sends.

```
Postgres (prod)                          Customer.io (workspace 219585)
-----------------                        ------------------------------
user ----------------+
auth_identity        |  identify (signup)   profile attributes
  .last_login_at     +--------------------->  email_type
client_daily_        |  nightly sync job      workspace_count
  activity           |  (09:00 UTC)           last_active_at
  .last_seen_at      |                            |
cloud_workspace -----+                            v
  .archived_at                            segments 17/18/19/20
                                                  |
                                                  v
                                          campaigns 2/3/4/5 (draft)
                                                  |
                                                  v
                                          email delivery (topics + freq cap)
```

Two write paths populate profiles:

1. Inline at signup: `identify_customerio_user()` fires on every desktop GitHub
   auth and includes `email_type` in the payload (computed once, immutable).
2. Nightly batch: the `customerio_engagement_sync` Celery beat task pushes
   `workspace_count`, `last_active_at`, and `email_type` (backfills existing
   profiles) for all users.

Once the three attributes exist, downstream targeting is pure CIO configuration
with no further server involvement.

---

## Server implementation

### File tree

```
server/proliferate/
+-- integrations/customerio.py        derive_email_type(), push_user_attributes(),
|                                      email_type in identify payload
+-- background/
|   +-- tasks/customerio_sync.py      nightly engagement sync (keyset pagination)
|   +-- beat_schedule.py              registers the task at 09:00 UTC
|   +-- config.py                     CUSTOMERIO_ENGAGEMENT_SYNC_TASK constant + route
|   +-- celery_app.py                 imports the task module
+-- config.py                         customerio_site_id, customerio_api_key

server/tests/unit/
+-- test_customerio.py                email_type + push_user_attributes coverage
+-- test_customerio_sync.py           pagination/payload tests (HTTP mocked)
```

### derive_email_type

`server/proliferate/integrations/customerio.py:26`

```python
def derive_email_type(email: str | None) -> str:
    """Classify an email as 'company' or 'personal'.

    Personal = domain in PUBLIC_EMAIL_DOMAINS (or missing/malformed domain).
    Company = any other domain.
    """
    domain = email_domain(email)
    if domain is None or domain in PUBLIC_EMAIL_DOMAINS:
        return "personal"
    return "company"
```

Reuses `email_domain()` from `server/proliferate/auth/sso/policy.py` and the
`PUBLIC_EMAIL_DOMAINS` frozenset from
`server/proliferate/constants/organizations.py:117` (gmail, outlook, yahoo,
icloud, proton, etc.). "Company" means the same thing here as it does in the
SSO/org code.

### Beat schedule registration

`server/proliferate/background/beat_schedule.py:13`

```python
def build_beat_schedule(config: Settings = settings) -> BeatSchedule:
    """Return the currently registered Beat schedule."""

    schedule: BeatSchedule = {}

    if config.customerio_site_id and config.customerio_api_key:
        schedule["customerio-engagement-sync"] = {
            "task": CUSTOMERIO_ENGAGEMENT_SYNC_TASK,
            "schedule": crontab(minute="0", hour="9"),
        }

    return schedule
```

The task only registers when CIO creds are present, so dev environments without
them stay inert.

### Nightly sync: aggregate queries

`server/proliferate/background/tasks/customerio_sync.py:38-74`

Three aggregate queries run per page of users (no N+1, never per-user):

```python
# Workspace count per user (active, non-archived)
workspace_counts_result = await db.execute(
    select(
        CloudWorkspace.owner_user_id,
        func.count(CloudWorkspace.id),
    )
    .where(
        CloudWorkspace.owner_user_id.in_(user_ids),
        CloudWorkspace.archived_at.is_(None),
    )
    .group_by(CloudWorkspace.owner_user_id)
)

# Product activity: max last_seen per user across surfaces
activity_result = await db.execute(
    select(
        ClientDailyActivity.actor_user_id,
        func.max(ClientDailyActivity.last_seen_at),
    )
    .where(ClientDailyActivity.actor_user_id.in_(user_ids))
    .group_by(ClientDailyActivity.actor_user_id)
)

# Login recency: max last_login across auth identities
login_result = await db.execute(
    select(
        AuthIdentity.user_id,
        func.max(AuthIdentity.last_login_at),
    )
    .where(AuthIdentity.user_id.in_(user_ids))
    .group_by(AuthIdentity.user_id)
)
```

### Nightly sync: per-user payload assembly

`server/proliferate/background/tasks/customerio_sync.py:77-93`

```python
for user_id, email in user_rows:
    # Derive last_active_at as GREATEST of activity and login
    candidates = [v for v in (activity_map.get(user_id), login_map.get(user_id)) if v]
    last_active_at = max(candidates) if candidates else None

    attributes: dict[str, Any] = {
        "workspace_count": workspace_counts.get(user_id, 0),
        "email_type": derive_email_type(email),
    }
    if last_active_at is not None:
        attributes["last_active_at"] = int(last_active_at.timestamp())

    ok = await push_user_attributes(user_id=str(user_id), attributes=attributes)
    if ok:
        pushed += 1
```

### Keyset pagination

`server/proliferate/background/tasks/customerio_sync.py:102-123`

```python
while True:
    async with async_session_factory() as db:
        query = (
            select(User.id, User.email)
            .order_by(User.id)
            .limit(PAGE_SIZE)
        )
        if last_id is not None:
            query = query.where(User.id > last_id)

        result = await db.execute(query)
        rows = result.all()

        if not rows:
            break

        total_users += len(rows)
        user_rows = [(row[0], row[1]) for row in rows]
        pushed = await _sync_page(db, user_rows)
        total_pushed += pushed
        last_id = user_rows[-1][0]
```

`PAGE_SIZE = 500`. Keyset (not OFFSET) means page cost stays constant at any
user count.

---

## Design rationale

**Hybrid inline + nightly.** `email_type` never changes after signup, so it is
computed once inline at identify time with zero extra queries. `workspace_count`
and `last_active_at` change constantly and involve aggregate queries across
multiple tables; a batch job avoids burdening every login or workspace-create
with that overhead and keeps profile freshness uniform (everyone synced within
24 hours).

**Keyset pagination.** The sync was designed for "many many users going forward"
from the start. OFFSET pagination degrades linearly; keyset on `user.id`
(indexed UUID primary key) costs O(page_size) regardless of table size.

**last_active_at = GREATEST of two signals.** The `User` table has no
`last_login` column. Login recency is tracked per provider on
`AuthIdentity.last_login_at`. Actual product usage is tracked per surface per
day in `ClientDailyActivity.last_seen_at`. Taking the max of both gives the
honest "last touched the product" timestamp. This replaces Customer.io's
built-in "Have not logged in recently" segment (old segment 2), which only
counted page-view events CIO received directly -- useless for a desktop app.

**Nightly email_type push replaces a backfill migration.** Because the nightly
sync pushes `email_type` for every user on every run, existing profiles get
backfilled automatically. No one-off migration script or manual attribute
import needed.

**Welcome transactional path removed.** The server previously sent a one-time
welcome email via CIO's App API (`send_customerio_welcome_email()`). This
bypassed subscription topics and frequency caps. The replacement is the
onboarding campaigns (3 and 4), which respect both. The
`User.customerio_welcome_sent_at` column is retained (no migration) but the
send path, claim/clear helpers, and three config vars
(`CUSTOMERIO_APP_API_KEY`, `CUSTOMERIO_FROM_EMAIL`,
`CUSTOMERIO_WELCOME_TRANSACTIONAL_MESSAGE_ID`) are deleted.

---

## Customer.io object inventory (workspace 219585)

### Segments (data-driven, on synced attributes)

| ID | Name | Condition |
|----|------|-----------|
| 17 | Company email | `email_type eq "company"` |
| 18 | Personal email | `email_type eq "personal"` |
| 19 | Heavy users (>50 workspaces) | `workspace_count > 50` |
| 20 | Inactive 7+ days | `last_active_at` older than 7 days |

All segments have 0 members until the nightly sync runs against prod with
campaigns activated.

### Campaigns (ALL DRAFT as of 2026-07-06)

All campaigns use sender identity 3 (Pablo <pablo@proliferate.com>), message
limits enabled.

**Campaign 3 -- Onboarding (company)**
Trigger: joins segment 17 AND segment 6 (Valid Email Address).

| Action | Type | Detail |
|--------|------|--------|
| 6 | email (template 7) | Welcome, topic 2 (Onboarding) |
| 7 | delay | 345600s = 4 days |
| 8 | email (template 8) | Feedback ask, topic 3 (Founder updates) |

**Campaign 4 -- Onboarding (personal)**
Same cadence as campaign 3 but targets segment 18.

| Action | Type | Detail |
|--------|------|--------|
| 10 | email (template 9) | Welcome (personal copy), topic 2 |
| 11 | delay | 345600s = 4 days |
| 12 | email (template 10) | Feedback ask (personal copy), topic 3 |

**Campaign 5 -- Heavy users check-in**
Trigger: joins segment 19.

| Action | Type | Detail |
|--------|------|--------|
| 14 | email (template 11) | Casual founder note, topic 3 |

**Campaign 2 -- Winback (reworked)**
Re-triggered from old segment 2 onto segment 20. Template 4 rewritten with new
copy; topic 3.

**Campaign 1 -- Welcome (feedback call)**
Untouched, superseded. Delete after campaigns 3+4 are activated.

### Other objects

- Changelog broadcast: newsletter id 3 "Changelog broadcast (template -- clone
  per release)" (template 12), DRAFT. From identity 2 (hello@), topic 1, segment
  6, layout 2. Structure: title + one-line summary + one hero image (placeholder
  swapped per release), a "New" section only (top 4-5 bold-led bullets), then
  "See the full changelog" + "Download for Mac" links. Distilled from the landing
  /changelog (~/landing/content/changelog/*.mdx); Improvements/Fixes stay on the
  web page. (An earlier bare template f61066f2-... was superseded by this.)
- Layouts: id 1 "Empty Layout" (appends its own unsubscribe -- used by the live
  transactional welcome); id 2 "Campaign -- no footer" (just `{{ content }}`, no
  unsubscribe). The 6 campaign templates (7/8/9/10/11/4) and the changelog
  newsletter all use layout 2, because their bodies carry a styled unsubscribe
  footer -- pairing them with layout 1 double-renders the unsubscribe link (a bug
  found + fixed 2026-07-06; see Render gotchas).
- Sender identities: 2 = Proliferate <hello@proliferate.com> (changelog); 3 =
  Pablo <pablo@proliferate.com> (all campaign emails).
- Frequency cap: Email -- 5 per 7 days.
- Topics: 1 Product updates, 2 Onboarding & getting started, 3 Check-ins & feedback.

---

## Merge-order warning

> **Transactional message id 2 ("Desktop Welcome") IS live in prod.** The CIO
> dashboard shows `state: draft`; this is misleading. `has_sent: true` and the
> deliveries log prove it sends on every desktop GitHub auth (steady stream of
> delivered + opened emails). PR #967 removes the server send path for this
> message.
>
> Required sequence: approve email copy -> activate campaigns 3+4 -> merge
> PR #967. Merging first opens a window where new signups receive no welcome
> email.

Post-activation cleanup: delete campaign 1 and the Desktop Welcome
transactional (message id 2) once onboarding campaigns are confirmed delivering.

---

## L4 supersession (fix notifications)

Fix-notification and support-loop emails are owned by
`specs/tbd/issue-autofix-system-v1.md` (section 9). That spec absorbs the
engagement workspace's L4 design note entirely. This stack must not build
`fix_notification_queue` or any fix-notification server code.

Two future asks the issues service will make:

1. A read path for `SupportReport` pollable by an external service (the issues
   service's ingestion job 3).
2. Parameterized CIO fix-notification templates (reporter vs affected-user
   variants, with issue summary and changelog URL placeholders).

L3 synergy (build nothing now): the changelog broadcast can eventually pull a
"fixed this release, thanks to X" section from the issues service's shipped
query -- changelog credit falls out of data that system already has.

---

## Changelog flow (L3)

Zero server code. Operator workflow per release:

1. Write the release's changelog entry (the source of truth is the landing
   /changelog, ~/landing/content/changelog/*.mdx).
2. Clone newsletter 3 "Changelog broadcast (template -- clone per release)".
3. Edit the clone: swap title, one-line summary, hero image src (host a
   screenshot), and the top 4-5 "New" bullets. Keep segment 6 + topic 1.
4. Test-send to pablo@proliferate.com (real Track API send, see Render gotchas --
   not /emails/test).
5. Approve and send.

A sent newsletter cannot be re-sent -- clone it. (This bit the 2026-06-16
blast.)

---

## Render gotchas (learned the hard way, 2026-07-05/06)

Test-sending in Customer.io is a minefield; three separate endpoints look like
they send and do not.

- **`/verify/email` validates, it does not deliver.** It returns 204 and creates
  no delivery record. Two agent runs reported "5 sent" against it while the inbox
  stayed empty. Same trap for the UI-oriented `/emails/test`.
- **The only reliable delivering path is the Track API** `POST /v1/send/email`
  (CLI: `cio send email --environment-id 219585 --to ... --from ... --subject ...
  --body ...`). It returns a `delivery_id`.
- **Deliveries endpoint is the only ground truth.** After any send, confirm with
  `GET /v1/environments/219585/deliveries` filtered to the recipient and check
  for a new record in state sent/delivered. Do not trust the dashboard state
  field (it called the live transactional welcome "draft") or the metrics
  endpoint (it lags badly).
- **Liquid only renders against an identified profile.** A transactional send
  with anonymous sample data prints `{{customer.first_name | default: "there"}}`
  literally. Bind the send to a real profile (identifiers `{"email": ...}` on a
  profile that has the attribute) so `customer.*` resolves. This is a
  test-harness artifact only -- live campaigns always target real profiles.
- **Double unsubscribe.** A template body with its own unsubscribe footer, paired
  with a layout that also appends one, renders two links. Fixed by pairing
  footer-carrying templates with the footer-less layout 2. Always confirm exactly
  one `{% unsubscribe_url %}` in the final (body + layout) render, and always use
  the Liquid TAG form `{% unsubscribe_url %}`, never the variable `{{ ... }}`.

---

## Operational runbook

### cio CLI

Auth token lives at `~/.cio/config.json` (`sa_live_*` key). The token expires
periodically; a 401 `invalid_client` error means re-authenticate with
`cio auth login`.

Schema introspection: `cio schema <resource>.<method>` before every mutating
call. Preview mutations with `--dry-run`.

### API gotchas (hard-won)

- Campaign creation requires `type: "none"`, then a separate `PUT` with
  `update_type: "recipients"` to set the segment-attribute trigger.
- Template bodies must be single-line HTML; the API rejects raw/escaped
  newlines. Omit `body_plain` (auto-generated).
- Unsubscribe must be the Liquid TAG `{% unsubscribe_url %}`. The variable form
  `{{ unsubscribe_url }}` renders empty and silently breaks all sends (this
  broke all 51 sends of the June blast).
- `/v1/environments/{env}/verify/email` validates an email address without
  delivering. It is NOT a send endpoint. Real sends go through Track API
  `POST /v1/send/email`.
- The deliveries endpoint (`GET /v1/environments/219585/deliveries`, filter by
  recipient) is the ONLY ground truth for whether an email was delivered. The
  dashboard `state` field lies (see merge-order warning). The metrics endpoint
  lags badly.

### Changelog send flow

Newsletter from template -> segment 6 -> topic 1 -> test to pablo@ -> approve
-> send. Sent newsletters cannot be re-sent; clone them.

---

## Remaining work and open decisions

1. **Copy review** -- the 5 `[TEST]`-prefixed emails in Pablo's inbox need
   line-by-line approval. One flagged item: the heavy-user email says
   "50+ workspaces is real usage," which brushes against the no-power-user-
   framing decision made for that surface.

2. **Backfill decision** -- activate onboarding with backfill (all ~71 existing
   valid-email users enter the sequence immediately) or without (new signups
   only). This is a human call with no technical blocker either way.

3. **Activation order** -- campaigns 3+4 first (onboarding replaces the live
   transactional welcome), then campaign 2 (winback) and campaign 5
   (heavy-user).

4. **Behavioral verify** -- run the sync job against a dev profile and confirm
   CIO profiles show correct `workspace_count`, `last_active_at`, `email_type`
   values. The worktree is kept alive for this.

5. **Post-activation cleanup** -- delete campaign 1 (superseded) and the
   Desktop Welcome transactional (message id 2) once onboarding is confirmed
   delivering.
