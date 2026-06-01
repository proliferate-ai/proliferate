# Local Mobile Development

Status: authoritative for local mobile development workflows.

Use this doc when testing `apps/mobile` against local or profile-backed Cloud
state. Use [`README.md`](README.md) for full-stack local startup and
[`dev-profiles.md`](dev-profiles.md) for profile ownership, ports, and state.

## Working Modes

Use the narrowest mobile mode that proves the change:

1. Mobile web against a dev profile:
   - fastest path for screen logic, React Query behavior, API integration, and
     profile-backed data
   - avoids native OAuth redirect setup
   - uses the same profile server/database as desktop and hosted web
2. Native mobile auth helper:
   - use for Expo Go, iOS simulator, physical devices, native deep links,
     SecureStore, Apple sign-in, safe-area behavior, and React Native-only
     rendering
   - runs its own ngrok-backed server path and is not profile-native
3. Dev refresh token:
   - use only in `__DEV__` when testing authenticated native screens without
     repeating OAuth
   - token must belong to the same local database being tested

## Mobile Web Against A Profile

Start the full profile first:

```bash
make dev-init PROFILE=<name>
make dev PROFILE=<name>
```

Then run Expo web using the profile environment:

```bash
source ~/.proliferate-local/dev/profiles/<name>/launch.env
pnpm --dir apps/mobile web:profile
```

This uses:

```text
EXPO_PUBLIC_PROLIFERATE_API_BASE_URL=http://127.0.0.1:$PROLIFERATE_API_PORT
PROLIFERATE_MOBILE_WEB_PORT=<profile mobile web port>
```

Use mobile web first for most UI and API changes because it exercises the real
Cloud SDK, React Query, mobile shell, auth state, and profile data without
native redirect friction.

## Native Mobile Auth

Use native mobile when the behavior depends on Expo Go, iOS simulator/device
behavior, native redirect handling, SecureStore, Apple sign-in, physical
keyboard/safe-area behavior, or React Native rendering.

The canonical helper is:

```bash
make dev-mobile-auth
```

It starts or checks local Postgres, runs server migrations, starts ngrok for the
API, starts the server with `API_BASE_URL` set to the ngrok URL, and starts Expo
with `EXPO_PUBLIC_PROLIFERATE_API_BASE_URL` set to the same URL.

It prints provider redirect URIs to add in provider consoles, including:

```text
https://<ngrok-host>/auth/mobile/google/callback
```

Overrides:

```bash
PROLIFERATE_MOBILE_PORT=8090 make dev-mobile-auth
MOBILE_EXPO_ARGS="--lan" make dev-mobile-auth
```

`make dev-mobile-auth` is the supported path for testing real native mobile
OAuth. It is intentionally separate from profile-native development today.

## Dev Refresh Token Path

Do not globally disable mobile auth. Mobile has a dev-only refresh-token path:

```text
EXPO_PUBLIC_PROLIFERATE_DEV_REFRESH_TOKEN=<refresh-token>
proliferateDevRefreshToken=<refresh-token>
```

The mobile app consumes this only in `__DEV__`. The token is exchanged through
the normal `/auth/mobile/session/refresh` endpoint, so server auth and account
readiness still run.

For profile-backed native mobile testing, use a refresh token minted for a user
in the same profile database. Until a repo-owned helper exists for minting that
token from a profile user, the canonical supported paths are:

- mobile web against the profile
- `make dev-mobile-auth` for native OAuth

## Local Checks

Run the mobile checks that match the change:

```bash
pnpm --filter @proliferate/mobile typecheck
pnpm --dir apps/mobile web:profile
```

When auth, native storage, deep links, simulator/device rendering, or
TestFlight-only behavior is part of the change, also verify the native path with
`make dev-mobile-auth` or the relevant release lane in
[`../deploying/ci-cd.md`](../deploying/ci-cd.md).
