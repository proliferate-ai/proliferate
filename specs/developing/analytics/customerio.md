# Customer.io

## Purpose
Customer.io is Proliferate's server-owned lifecycle messaging and engagement
tracking integration. It identifies desktop GitHub-authenticated users,
tracks lifecycle events, and syncs engagement attributes nightly for
segmentation and campaign targeting.

## Used For
- Upserting a user into Customer.io after successful desktop GitHub auth
- Sending the `desktop_authenticated` lifecycle event
- Syncing engagement attributes nightly (`email_type`, `workspace_count`,
  `last_active_at`) for campaign segmentation
- Keeping Customer.io ownership on the server, not in the desktop client

## Attributes

### email_type
Derived at identify time and during the nightly sync. Values:
- `"company"` -- email domain is NOT in `PUBLIC_EMAIL_DOMAINS`
- `"personal"` -- email domain IS in `PUBLIC_EMAIL_DOMAINS`, or email is
  missing/malformed

Implementation: `derive_email_type()` in `customerio.py` uses
`email_domain()` from `server/proliferate/auth/sso/policy.py` against
`PUBLIC_EMAIL_DOMAINS` from `server/proliferate/constants/organizations.py`.

### workspace_count
Integer count of active (non-archived) `cloud_workspace` rows owned by the
user. Pushed during the nightly sync.

### last_active_at
Unix timestamp. `GREATEST(MAX(client_daily_activity.last_seen_at),
MAX(auth_identity.last_login_at))` per user. Omitted from the payload when
both sources are NULL. Pushed during the nightly sync.

## Workflows

### Desktop GitHub auth success
- trigger: successful desktop GitHub auth completion after GitHub OAuth
  succeeds, the user is active, and the desktop auth code is created. Current
  clients use shared `GET /auth/github/callback` with a desktop challenge;
  `GET /auth/desktop/github/callback` remains legacy compatibility.
- code path: `server/proliferate/auth/identity/service.py` for the shared
  flow; `server/proliferate/auth/desktop/service.py` for the legacy callback
- sends:
  - `identify_customerio_user(...)`
    - distinct id: `str(user.id)`
    - email: `user.email`
    - attrs:
      - `display_name`
      - `github_login`
      - `github_avatar_url`
      - `created_at` (unix seconds)
      - `desktop_authenticated=true`
      - `desktop_auth_provider="github"`
      - `product_ready=true`
      - `email_type` ("company" | "personal")
  - `track_customerio_desktop_authenticated(...)`
    - event name: `desktop_authenticated`
    - event data: `{"auth_provider": "github"}`
- failure behavior: Customer.io failures are logged and swallowed; desktop
  auth still succeeds.

### Nightly engagement sync
- trigger: Celery Beat schedule, daily at 09:00 UTC
- task: `customerio.engagement_sync` registered in `build_beat_schedule()`
- behavior: keyset-paginates all users (~500/page). Per page, runs two
  aggregate queries (workspace count, last_active_at) then pushes attributes
  via Track API `PUT /customers/{user_id}`.
- attributes pushed: `workspace_count` (int), `last_active_at` (unix ts,
  omitted if null), `email_type` ("company" | "personal")
- no-op when `CUSTOMERIO_SITE_ID` or `CUSTOMERIO_API_KEY` is unset
- logs a summary on completion
- code path: `server/proliferate/background/tasks/customerio_sync.py`

### Missing Customer.io credentials
- trigger: either `CUSTOMERIO_SITE_ID` or `CUSTOMERIO_API_KEY` is unset
- code path: `server/proliferate/integrations/customerio.py`
- sends: nothing (identify/track/push all no-op)
- failure behavior: the adapter becomes a no-op and auth behavior is unchanged

## Removed (historical)

### Transactional welcome email (removed)
Previously sent a one-time welcome email via the Customer.io App API after
first desktop auth. Removed because lifecycle campaigns in Customer.io
handle post-signup messaging without server-side transactional sends. The
`user.customerio_welcome_sent_at` column is retained (no migration) but the
claim/clear helpers, `send_customerio_welcome_email()`, and App API config
vars (`CUSTOMERIO_APP_API_KEY`, `CUSTOMERIO_FROM_EMAIL`,
`CUSTOMERIO_WELCOME_TRANSACTIONAL_MESSAGE_ID`) have been deleted.

## Env Vars
Canonical source: `specs/developing/reference/env-vars.yaml`

Track API (identify + event + nightly sync):
- `CUSTOMERIO_SITE_ID`
- `CUSTOMERIO_API_KEY`

## Current Usage
- Server adapter:
  - `server/proliferate/integrations/customerio.py`
- Auth seam:
  - `server/proliferate/auth/desktop/service.py`
- Nightly sync task:
  - `server/proliferate/background/tasks/customerio_sync.py`
- Idempotency column (retained, unused):
  - `user.customerio_welcome_sent_at` (alembic revision `b0c1d2e3f4a5`)
- No desktop-side Customer.io client code exists in this repo
- Current test coverage:
  - `server/tests/unit/test_customerio.py`
  - `server/tests/unit/test_customerio_sync.py`
  - `server/tests/unit/auth/test_desktop_customerio.py`
  - `server/tests/integration/test_desktop_auth_customerio.py`

## Sending Domain Setup
Customer.io requires a verified sending domain before transactional email
delivery is reliable. The proliferate workspace lives at
`https://fly.customer.io/workspaces/219585/settings/actions/email/sending_domains`.

Sending domain: **`proliferate.com`** (matches the default from address).
DNS for `proliferate.com` is managed in Cloudflare.

## Billing Labels
- Billing lifecycle sync is intentionally not implemented in the Pro billing
  slice.
- Future billing-owned analytics labels should use `free` and `pro`; `cloud`
  was the legacy paid label before the Pro billing cutover documented on
  2026-05-01.
