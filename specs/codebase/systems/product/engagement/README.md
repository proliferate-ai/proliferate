# Product Engagement

Status: authoritative for the current Customer.io lifecycle integration.

Product Engagement owns the server-to-Customer.io transport, the profile
attributes and lifecycle event produced by current code, and the gates that
make the integration active or inert. Customer.io campaigns, segments,
templates, ids, and activation state are mutable provider configuration, not
repository law. Discover and operate them through the
[Customer.io procedure](../../../../developing/operating/analytics/customerio.md).

## Applicability And Data Boundary

| Concern | Current behavior |
| --- | --- |
| Deployment modes | Active in hosted or self-hosted server deployments only when both Customer.io Track API settings are configured. A local profile can opt in the same way. |
| Source component | The Proliferate server. Desktop and other clients do not call Customer.io directly. |
| Identity | Customer.io's customer id is the Proliferate user UUID. |
| Data sent | Email, optional display name, optional GitHub login and avatar URL, account creation time, desktop-auth state/provider, product-readiness state, email classification, active workspace count, and latest activity time. |
| Destination | Customer.io Track API at `https://track.customer.io/api/v1`. |
| Enable/disable | Both `CUSTOMERIO_SITE_ID` and `CUSTOMERIO_API_KEY` are required. With either unset, identify and event calls return without sending, attribute pushes report failure, and the nightly Beat entry is not registered. |
| Privacy and replay | This integration transmits identified profile and lifecycle data. It sends no prompts, repository content, workspace names, session transcripts, or replay data. There is no replay capture in this system. |

Self-hosters who do not deliberately configure their own Customer.io account
receive the no-op behavior. Proliferate-hosted provider credentials and
provider state are not part of the self-hosted product contract.

## Desktop GitHub Authentication

Successful desktop GitHub authentication schedules a best-effort server task
after the auth code has been created. Both the shared provider callback and the
legacy desktop callback use the same Customer.io helper.

The task first identifies the profile with:

- customer id: the Proliferate user UUID
- `email`
- `desktop_authenticated = true`
- `desktop_auth_provider = "github"`
- `product_ready = true`
- `email_type`: `personal` for missing, malformed, or known public-provider
  domains; otherwise `company`
- optional `display_name`, `github_login`, `github_avatar_url`, and
  Unix-second `created_at`

It then records one `desktop_authenticated` event whose data is
`{"auth_provider": "github"}`.

The adapter uses a five-second request timeout. HTTP and transport failures are
logged without request credentials or response bodies and are swallowed, so
Customer.io cannot fail desktop authentication. Failure to schedule the
background task is also logged without failing auth.

Current owners:

- `server/proliferate/auth/identity/service.py`
- `server/proliferate/auth/desktop/service.py`
- `server/proliferate/integrations/customerio.py`

## Nightly Profile Sync

When both Track API settings exist, Celery Beat registers
`customerio.engagement_sync` for 09:00 UTC each day. The task keyset-paginates
users by UUID in pages of 500.

Each nonempty page performs exactly:

```text
1 user-pagination query
+ 1 aggregate query for active, non-archived workspace counts
+ 1 aggregate query for maximum client daily activity
+ 1 aggregate query for maximum auth-identity login time
```

The three aggregates are set-based for all user ids on the page, not one query
per user. For each profile the task writes:

- `workspace_count`: count of owned `cloud_workspace` rows whose
  `archived_at` is null, defaulting to zero
- `last_active_at`: Unix seconds for the later of maximum
  `client_daily_activity.last_seen_at` and maximum
  `auth_identity.last_login_at`; omitted when both are absent
- `email_type`: recalculated from the user's current email

Each profile write uses the Track API customer endpoint. A failed write is
logged and counted as not pushed; other profiles continue. The completion log
records users processed and successful pushes, but the task still returns
`ok` after partial profile-write failures.

Current owners:

- `server/proliferate/background/beat_schedule.py`
- `server/proliferate/background/config.py`
- `server/proliferate/background/tasks/customerio_sync.py`

## Provider Boundary

The repository does not define which campaigns, segments, templates, senders,
or subscription topics currently exist or are active in Customer.io. Those
objects may consume the code-owned event and attributes above, but their live
state must be discovered at operation time. Changes to provider configuration
do not change this contract unless they require a new event, attribute,
transport, or send gate in source.

Issue-reporter follow-up and notifications after a fix belong to
[Engineering Issue Lifecycle](../../engineering/issue-lifecycle/README.md),
not Product Engagement.

## Known Current Gaps

- Customer.io delivery is deliberately best-effort. There is no durable retry
  or reconciliation queue for inline identify/event calls.
- The nightly task reports partial profile failures in logs but returns success
  after processing the remaining profiles.
- Live campaign delivery and profile freshness are provider evidence; checked-in
  documentation cannot prove either one.

## Verification

Code-level coverage lives in:

- `server/tests/unit/test_customerio.py`
- `server/tests/unit/test_customerio_sync.py`
- `server/tests/unit/auth/test_desktop_customerio.py`
- `server/tests/integration/test_desktop_auth_customerio.py`

Use the [Customer.io operating procedure](../../../../developing/operating/analytics/customerio.md)
to verify current configuration and delivery without treating live provider
state as canonical documentation.
