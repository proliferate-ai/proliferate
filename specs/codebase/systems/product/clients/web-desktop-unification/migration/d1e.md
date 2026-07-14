# Route Shared Identity and Navigation Through ProductHost (D1e)

Status: **current implementation scope**.

- Exact implementation base:
  `0eab251fd35d26022165f7f0852db2885a8c4093`
- Prior completed implementation: PR #1168 (D1d), merge
  `de249faf06c629e094c20e33f94f33d4e6c4c8f2`
- Parent architecture:
  [`web-desktop-client-unification.md`](../README.md)
- Pipeline ledger:
  [`../../../../../../developing/deploying/web-desktop-unification-rollout.md`](../../../../../../developing/deploying/web-desktop-unification-rollout.md)

This is the living contract for routing product-owned authentication identity,
deployment reads, Cloud authority, and inbound product destinations through the
already-mounted `ProductHost`. Product source stays under `apps/desktop`; this
slice changes consumers and the two ProductClient contract gaps below, not
native transport or product behavior. It is the identity-and-navigation half of
the former "Complete Shared ProductHost Adoption" row; shared persistence and
telemetry are the next slice.

## Observable outcome

The existing Desktop product reads normalized auth state, semantic auth
operations, `host.deployment.apiBaseUrl`, and the single `host.cloud.client`
through `useProductHost()`. Inbound `proliferate://` deep links decode once into
a lossless `ProductEntry` and route through one product-owned lifecycle. Desktop
still owns OAuth/PKCE transport, credential persistence, deployment
config/relaunch, raw OS deep links, and Cloud-client construction.

## ProductClient contract corrections

Two representable-for-Web gaps close in
`apps/packages/product-client/src/host/product-host.ts`:

- `ProductQueryParams` becomes ordered, duplicate-preserving readonly
  `[key, value]` pairs (no `Record`/`Object.fromEntries`), and a new
  `ProductLocationState { query?; fragment? }` is applied to every
  `ProductEntry` kind. Decoded values, ordering, duplicates, and the fragment
  survive decode → route and supported encode → decode; exact percent-encoding
  bytes need not.
- `AuthState` gains the states the Desktop and Web gates already render:
  `loading`; `anonymous` with an optional `ProductAuthIssue`
  (`deployment_unreachable`, `access_denied`, `callback_failed`); and
  `authenticated` with a `ProductAuthReadiness` (`ready` /
  `action_required: connect_github`) and a nullable `user` for the Desktop
  cached-degraded path. `AuthCallback` becomes a success/failure discriminated
  union. This is normalization only; the shared gate decides presentation and
  never infers readiness from surface, token, or Cloud-client presence.

## Current to target flow

```text
Before

product auth/identity/deployment/routing code
  -> useAuthStore / useAuthActions / getProliferateApiBaseUrl directly
  -> two parallel deep-link decoders (legacy route table + ProductEntry)
       fire on the same URL

After

product code
  -> useProductHost()
       host.auth.state / startLogin / cancelLogin / logout
       host.deployment.apiBaseUrl
       host.cloud.client (authority-capable, usable while anonymous)
       host.links.observeInboundEntries -> one ProductEntry per deep link
```

## Owned areas

### Normalized auth snapshot and callback state machine

- `DesktopProductHostProvider` publishes the corrected `AuthState`
  (issue/readiness, nullable authenticated user) without changing raw
  transport. `finishLogin` normalizes the host-decoded callback into
  success/failure before commit; the raw URL, PKCE verifier, state proof, and
  provider cookie stay host-owned and are never persisted, put in route state,
  or sent to telemetry.
- One host-owned single-flight claims each matching callback and reaches a
  single terminal result (success commit, provider failure, malformed/expired
  cleanup, mismatched-state no-op, or `exchange_failed`). StrictMode, rerender,
  and reload/back join the current flight or observe `already_consumed`; they
  never exchange or commit twice. Terminal cleanup runs even when error
  reporting fails.
- Organization-join continuation stays the one explicit pre-auth product
  intent with its existing one-hour expiry/clear rules; it is not folded into
  the OAuth transaction and does not become a generic pending-intent queue.

### Auth identity consumers

- The root gate/bootstrap, login UI and per-method sign-in hooks, account/logout
  actions, organization-join launch/invitation flows, and the product identity
  and query-enablement consumers read `host.auth` rather than importing the
  Desktop store/actions/mode.
- Retained store readers are the host constructor and adapters, the auth store
  and orchestration transport, the `isProductAuthRequired` definition, and
  (deferred to the next telemetry slice) `use-telemetry-auth-identity.ts`.

### Deployment and Cloud authority

- `AppProviders` reads `host.deployment.apiBaseUrl` for scope work and keeps the
  single `getProliferateClient()` construction in the composition root.
  `getProliferateClient()` is a lazily-memoized singleton; no second client is
  constructed.
- Anonymous auth state can use a non-null Cloud client; a `null` client disables
  Cloud work clearly.

### Navigation seam

- `decodeDesktopProductEntry`/`encodeDesktopReturnUrl` use ordered pairs plus
  fragment and preserve every currently recognized callback/query value.
- `productEntryRoute` is the single `ProductEntry` → in-app-route mapper,
  reproducing each legacy destination (workspace, workflow,
  organization-join/invitation → Account settings, billing return, integration
  callback, settings section) and appending leftover query pairs and the
  fragment losslessly, with canonical destination keys winning over shadowing
  leftovers.
- New `use-product-entry-routing` subscribes once to
  `host.links.observeInboundEntries`, maps each entry, navigates, and
  unsubscribes on replacement/unmount. It mounts once in `AppRuntime` outside
  the auth route gate. Navigation failure is reported once via
  `host.telemetry.captureException` and dropped; no retry/persist/queue.
- The legacy parallel decoder is deleted: `desktopNavigationTarget`,
  `handleDesktopNavigationUrl`, and the orphaned `navigateDesktopRoute` DI hook
  are gone, so each deep link now reaches exactly one consumer (auth callbacks
  the auth transport; every non-auth URL the ProductEntry observer).

## Ownership and failure behavior

- Product code never receives PKCE verifiers, tokens, cookies, native-vault
  records, raw callback URLs, or mutable Desktop config.
- One auth bootstrap, one Cloud client, one Query client, one
  `ProductHostProvider`, one router — none duplicated.
- A malformed, unknown, or auth-only inbound URL produces no `ProductEntry`.
  A recognized entry with duplicate query keys or a fragment keeps them.
- Unsubscribe prevents any later initial/live delivery to that observer.
- An unavailable deployment is represented in auth state, not faked as
  authenticated or beta-denied.

## Non-goals

This slice does not move product source into ProductClient, do Web
implementation work, add persistence/replay/retry/recovery/queue for inbound
entries or callbacks, add an in-process deployment switch, rewire telemetry or
storage hydration, or add any new login/access/beta/account-linking policy.

## Recorded deviations and follow-ups

- **`source` OAuth discriminator not re-emitted** into internal routes: no route
  consumer reads `source` (`use-settings-navigation` reads
  section/checkout/join fields/flowId/status/failureCode only), so it is inert.
  Contract-aligned (the mapping list omits `source`) and behavior-preserving.
- **Codec split for the file-size threshold**: `decodeDesktopProductEntry`,
  `encodeDesktopReturnUrl`, and `productEntryRoute` stay in
  `lib/domain/auth/desktop-navigation.ts`; the shared query/fragment/entry
  primitives moved to a sibling `desktop-navigation-codec.ts` so both files stay
  under the frontend size threshold. Pure refactor; the public seam and its
  tests are unchanged.
- **Deployment/Cloud reads centralized (resolved)**: the six probe hooks
  (`use-auth-methods`, `use-github-auth-availability`, `use-sso-discovery`,
  `use-server-capabilities`, `use-control-plane-health`,
  `use-app-capabilities`) now derive their query-key scope and probe target from
  `useProductHost().deployment.apiBaseUrl` (the base URL is threaded into each
  probe's `queryFn` so the hook's inputs are fully host-derived, with query keys
  and enablement unchanged), and `cloud-sandbox-gateway.ts` receives the Cloud
  client (its `buildUrl` dependency) as an explicit parameter threaded from
  `host.cloud.client` — it no longer calls `getProliferateClient()`. Because the
  provider builds the host and cannot read it back, each probe hook exposes a
  `*For(apiBaseUrl)` core that the provider calls with its own deployment adapter
  URL; the public wrapper reads `useProductHost()`. `getProliferateApiBaseUrl()`/
  `getProliferateClient()` now remain only in the definitions (`proliferate-api`,
  `client`), the `AppProviders` composition root, the `desktop-product-host`
  deployment adapter, and `telemetry/client.ts` (deferred to the telemetry
  slice). The deployment/Cloud rewire table is now satisfied.

## Acceptance proof

Focused tests prove: every auth state including beta denial, bootstrap
unreachable, GitHub action-required, Desktop cached-user-null, and ready;
callback success, provider error, malformed/missing/mismatched/expired state,
exchange failure, terminal cleanup, and StrictMode/reload without a second
exchange or commit; a pre-auth organization-join surviving login, resuming
once, and retaining one-hour expiry; Desktop start/cancel/finish/logout
delegating once; the host snapshot changing only on auth/deployment/client
inputs; anonymous state using a non-null Cloud client; duplicate pairs, empty
values, ordering, Unicode, and fragments surviving decode → route and supported
encode → decode; initial and live `ProductEntry` delivery with
replacement/unmount cleanup and no replay; auth URLs never entering product
routing while every non-auth callback maps to its existing destination; and
only the composition root constructing the Cloud client.

Verification run at the reviewed head:

| Command | Result |
| --- | --- |
| `pnpm --filter @proliferate/product-client test` | pass (7) |
| `pnpm --filter @proliferate/product-client build` | pass |
| `pnpm --dir apps/desktop test` (via `vitest run`) | 3040 pass; 13 failures pre-existing and identical on base `0eab251fd` in unrelated files |
| `pnpm --dir apps/desktop build` | pass |
| `python3 scripts/check_frontend_boundaries.py` | pass |
| `python3 scripts/report_frontend_structure.py --strict --summary-only` | pass |
| `git diff --check` | clean |

The exact `pnpm --dir apps/desktop test` command carries the same
founder-approved waiver as prior slices: its `pretest` design-system check flags
base-identical arbitrary-utility violations in unchanged files, so the suite is
run through `vitest run` directly. `apps/web` does not consume
`@proliferate/product-client`, so no shared type it uses changed.
