# Customer.io

## Purpose
Customer.io is Proliferate's server-owned lifecycle messaging integration.
It identifies a desktop GitHub-authenticated user, tracks the
`desktop_authenticated` event, and sends a one-time transactional welcome
email so Customer.io can own any follow-up journeys or communication.

## Used For
- Upserting a user into Customer.io after successful desktop GitHub auth
- Sending the `desktop_authenticated` lifecycle event
- Sending a one-time welcome transactional email after first product-ready
  desktop GitHub auth
- Keeping Customer.io ownership on the server, not in the desktop client

## Workflows
- Desktop GitHub auth success
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
    - `track_customerio_desktop_authenticated(...)`
      - event name: `desktop_authenticated`
      - event data: `{"auth_provider": "github"}`
    - `send_customerio_welcome_email(...)` (only on first successful auth)
      - uses Customer.io App API
      - transactional message id: `CUSTOMERIO_WELCOME_TRANSACTIONAL_MESSAGE_ID`
      - from: `CUSTOMERIO_FROM_EMAIL`
      - message data: `display_name`, `github_login`
  - failure behavior: Customer.io failures are logged and swallowed; desktop
    auth still succeeds. If the welcome email send fails, the
    `customerio_welcome_sent_at` claim is cleared so a later auth retries.
- Welcome email idempotency
  - storage: `user.customerio_welcome_sent_at` (TIMESTAMPTZ NULL)
  - claim: an atomic UPDATE sets the column only when currently NULL; the
    welcome is sent only when this UPDATE wins the race
  - on send failure: column is cleared so a later auth attempt can retry
- Missing Customer.io credentials
  - trigger: either `CUSTOMERIO_SITE_ID` or `CUSTOMERIO_API_KEY` is unset
  - code path: `server/proliferate/integrations/customerio.py`
  - sends: nothing (identify/track no-op)
  - failure behavior: the adapter becomes a no-op and auth behavior is unchanged
- Missing Customer.io App API config
  - trigger: any of `CUSTOMERIO_APP_API_KEY`,
    `CUSTOMERIO_FROM_EMAIL`, or
    `CUSTOMERIO_WELCOME_TRANSACTIONAL_MESSAGE_ID` is unset
  - sends: nothing for the welcome email; identify/track still run
  - failure behavior: welcome send is skipped; the user's
    `customerio_welcome_sent_at` claim is cleared so a later configured
    deployment can still send the welcome on a later auth

## Env Vars
Canonical source: `specs/developing/reference/env-vars.yaml`

Track API (identify + event):
- `CUSTOMERIO_SITE_ID`
- `CUSTOMERIO_API_KEY`

App API (welcome transactional email):
- `CUSTOMERIO_APP_API_KEY`
- `CUSTOMERIO_FROM_EMAIL`
- `CUSTOMERIO_WELCOME_TRANSACTIONAL_MESSAGE_ID`

## Current Usage
- Server adapter:
  - `server/proliferate/integrations/customerio.py`
- Auth seam:
  - `server/proliferate/auth/desktop/service.py`
- Idempotency column:
  - `user.customerio_welcome_sent_at` (alembic revision `b0c1d2e3f4a5`)
- Intentionally unused auth lifecycle hooks in v1:
  - `server/proliferate/auth/users.py`
- No desktop-side Customer.io client code exists in this repo
- Current test coverage:
  - `server/tests/unit/test_customerio.py`
  - `server/tests/unit/auth/test_desktop_customerio.py`
  - `server/tests/integration/test_desktop_auth_customerio.py`

## Sending Domain Setup
Customer.io requires a verified sending domain before transactional email
delivery is reliable. The proliferate workspace lives at
`https://fly.customer.io/workspaces/219585/settings/actions/email/sending_domains`.

Sending domain: **`proliferate.com`** (matches the default
`CUSTOMERIO_FROM_EMAIL=hello@proliferate.com`). DNS for `proliferate.com` is
managed in Cloudflare. We initially evaluated `proliferate.dev` but switched
to `.com` because `.dev` lives on Namecheap, whose host-records UI does not
allow MX entries on subdomains (Customer.io needs MX on
`cio153296.<sending-domain>`).

DNS records Customer.io requires for `proliferate.com` (exact host/value
strings come from the Customer.io dashboard once the sending domain is added;
Customer.io namespaces them under a workspace-specific `cio<id>` subdomain):

- Two `MX` records at the workspace subdomain (e.g. `cio153296`) →
  `mxa.mailgun.org` and `mxb.mailgun.org`, both priority 10
- One `TXT` (SPF) at the same workspace subdomain →
  `v=spf1 include:mailgun.org ~all`
- One `TXT` (DKIM) at `cio._domainkey.<workspace-subdomain>` → the long
  `k=rsa; p=…` value shown in the dashboard
- One `TXT` (DMARC) at `_dmarc` → `v=DMARC1; p=none`

All five records must be **DNS-only** in Cloudflare (grey cloud). Proxying
breaks DKIM/MX/SPF.

## Dashboard Setup Status

As of 2026-05-20 the Customer.io dashboard side is wired up:

- **Sending domain**: `proliferate.com` added and **Verified** (all of MX,
  SPF, DKIM, DMARC pass). Records live in Cloudflare under account
  `7dd4e2f61945284cc05f0f0123e0068b`.
- **From address**: `Proliferate <hello@proliferate.com>` (mailbox provisioned
  in Google Workspace).
- **App API key**: `proliferate-server (welcome email)` created and stored as
  `CUSTOMERIO_APP_API_KEY` in the production secret store. The Track API
  Site ID + API Key are stored as `CUSTOMERIO_SITE_ID` /
  `CUSTOMERIO_API_KEY`.
- **Transactional message**: `Desktop Welcome`. The Customer.io App API's
  `transactional_message_id` field accepts either the trigger name or the
  numeric id; we use the **trigger name** `desktop_welcome` in production env
  (`CUSTOMERIO_WELCOME_TRANSACTIONAL_MESSAGE_ID=desktop_welcome`) because it
  is stable across workspace clones. The numeric id `2` is shown in the
  dashboard for reference only. Subject `Welcome to Proliferate`. Body uses
  Liquid vars `message_data.display_name` and `message_data.github_login`
  (both optional via `| default:`). The server caps these fields to 256
  characters before sending; the template should still escape them
  (`{{ ... | escape }}`) since `display_name` is free-form GitHub input.

**Outstanding caveat — test mode:** the workspace is still in Customer.io's
test mode (free-trial default). In test mode the App API accepts sends but
routes them to `test@customeriotest.com` rather than the real recipient.
Move the workspace out of test mode (link in the in-app banner) before
expecting real users to receive the welcome email.

## Re-running the Setup Runbook

If you ever need to redo this from scratch (different workspace, different
domain, fresh account), the steps are:

### 1. Create the App API key
1. Open `https://fly.customer.io/workspaces/<workspace-id>/settings/api_credentials`.
2. Under **App API Keys**, click **Create App API Key**.
3. Name it descriptively (e.g. `proliferate-server (welcome email)`).
4. Copy the key once — it is shown a single time. Store it in the production
   secret store for `CUSTOMERIO_APP_API_KEY`. Do not paste it into chat,
   shell history, or git-tracked files.

### 2. Create the welcome transactional message
1. Open `https://fly.customer.io/workspaces/<workspace-id>/journeys/transactional`.
2. Click **Create message**. Name: `Desktop Welcome`.
3. Subject: `Welcome to Proliferate`. From / To are `Set in API call`.
4. Body should reference the Liquid variables `{{ message_data.display_name }}`
   and `{{ message_data.github_login }}` — both are optional, so prefer copy
   that reads naturally without them (use `| default: '…'`).
5. Set the trigger name (e.g. `desktop_welcome`) on the Configure Settings
   step — this is what you put in env as
   `CUSTOMERIO_WELCOME_TRANSACTIONAL_MESSAGE_ID`. Click **Activate**.

### 3. Verify the sending domain
1. Open
   `https://fly.customer.io/workspaces/<workspace-id>/settings/actions/email/sending_domains`.
2. Click **Add a sending domain** and enter the domain (e.g.
   `proliferate.com`). Pick **Setup manually** so DNS stays under your
   control rather than handing Customer.io a Cloudflare API token.
3. Customer.io will display five records under a workspace-specific
   subdomain (e.g. `cio153296.<your-domain>`). Add them in Cloudflare DNS:
   - **MX × 2**: at the workspace subdomain → `mxa.mailgun.org` /
     `mxb.mailgun.org`, priority `10` each. **DNS-only (grey cloud).**
   - **SPF**: `TXT` at the workspace subdomain → `v=spf1 include:mailgun.org ~all`.
   - **DKIM**: `TXT` at `cio._domainkey.<workspace-subdomain>` → the
     `k=rsa; p=…` value (long, ~400 chars).
   - **DMARC**: `TXT` at apex `_dmarc` → `v=DMARC1; p=none`.
4. Click **Verify domain** in the Customer.io dashboard — Cloudflare DNS
   usually propagates in seconds, so verification is essentially immediate.

Provider note: Namecheap's basic Host Records UI does not support MX on
subdomains. If the sending domain is on Namecheap, either move its DNS to a
provider that does (Cloudflare, Route53, etc.) or pick a different sending
domain. We hit this with `proliferate.dev` and switched to `proliferate.com`.

### 4. Populate production env
Set in the production secret store / Terraform tfvars (do not commit
secrets):

- `CUSTOMERIO_SITE_ID` — Track API site id from
  `.../settings/api_credentials` → **Tracking API keys**
- `CUSTOMERIO_API_KEY` — Track API key (paired with the site id)
- `CUSTOMERIO_APP_API_KEY` — from step 1
- `CUSTOMERIO_FROM_EMAIL` — `hello@proliferate.com` (default already in tf)
- `CUSTOMERIO_WELCOME_TRANSACTIONAL_MESSAGE_ID` — trigger name from step 2

Apply Terraform (`server/infra/main.tf`) so the ECS task picks the new vars
up on next deploy.

### 5. Verify end-to-end
1. After the deploy reaches production, sign into the desktop app with a
   GitHub account that has not previously signed in (or, in staging, use a
   user whose `customerio_welcome_sent_at` is NULL).
2. Confirm the user appears in Customer.io with `desktop_authenticated=true`,
   `product_ready=true`, and `github_login` populated.
3. Confirm the `desktop_authenticated` event was tracked on that profile.
4. Confirm the transactional **Desktop Welcome** message shows a successful
   delivery in Customer.io. The user's row in `users` should have
   `customerio_welcome_sent_at` set.
5. Sign in again on the same account and confirm a second welcome email is
   *not* sent — the idempotency claim must hold.

If a send fails, the column is cleared automatically; check server logs for
`Failed to send Customer.io welcome email` and re-attempt by signing in
again.

## Billing Labels
- Billing lifecycle sync is intentionally not implemented in the Pro billing
  slice.
- Future billing-owned analytics labels should use `free` and `pro`; `cloud`
  was the legacy paid label before the Pro billing cutover documented on
  2026-05-01.
