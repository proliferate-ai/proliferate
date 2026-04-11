# Customer.io

## Purpose
Customer.io is Proliferate's server-owned lifecycle messaging integration.
Today it exists to tell Customer.io that a desktop GitHub-authenticated user
exists and that desktop authentication succeeded, so Customer.io can own any
follow-up journeys or communication.

## Used For
- Upserting a user into Customer.io after successful desktop GitHub auth
- Sending the `desktop_authenticated` lifecycle event
- Keeping Customer.io ownership on the server, not in the desktop client

## Workflows
- Desktop GitHub auth success
  - trigger: successful `GET /auth/desktop/github/callback` flow, after GitHub
    OAuth succeeds, the user is active, and the desktop auth code is created
  - code path: `server/proliferate/auth/desktop/service.py`
  - sends:
    - `identify_customerio_user(...)`
      - distinct id: `str(user.id)`
      - email: `user.email`
      - attrs:
        - `display_name`
        - `desktop_authenticated=true`
        - `desktop_auth_provider="github"`
    - `track_customerio_desktop_authenticated(...)`
      - event name: `desktop_authenticated`
      - event data: `{"auth_provider": "github"}`
  - failure behavior: Customer.io failures are logged and swallowed; desktop
    auth still succeeds
- Missing Customer.io credentials
  - trigger: either `CUSTOMERIO_SITE_ID` or `CUSTOMERIO_API_KEY` is unset
  - code path: `server/proliferate/integrations/customerio.py`
  - sends: nothing
  - failure behavior: the adapter becomes a no-op and auth behavior is unchanged

## Env Vars
Canonical source: `docs/reference/env-vars.yaml`

Active in the current implementation:
- `CUSTOMERIO_SITE_ID`
- `CUSTOMERIO_API_KEY`

Declared but not used by the current implementation:
- `CUSTOMERIO_APP_API_KEY`
- `CUSTOMERIO_FROM_EMAIL`
- `FRONTEND_BASE_URL`

## Current Usage
- Server adapter:
  - `server/proliferate/integrations/customerio.py`
- Auth seam:
  - `server/proliferate/auth/desktop/service.py`
- Intentionally unused auth lifecycle hooks in v1:
  - `server/proliferate/auth/users.py`
- No desktop-side Customer.io client code exists in this repo
- Current test coverage:
  - `server/tests/unit/test_customerio.py`
  - `server/tests/unit/auth/test_desktop_customerio.py`
  - `server/tests/integration/test_desktop_auth_customerio.py`

