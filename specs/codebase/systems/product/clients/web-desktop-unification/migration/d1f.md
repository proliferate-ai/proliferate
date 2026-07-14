# Route Shared Persistence and Telemetry Through ProductHost (D1f)

Status: **current implementation scope**.

- Exact implementation base:
  `06bf880a1b98c6694bcf029badcc9fe5823111de`
- Prior completed implementation: PR #1180 (D1e), merge
  `06bf880a1b98c6694bcf029badcc9fe5823111de`
- Parent architecture:
  [`web-desktop-client-unification.md`](../README.md)
- Pipeline ledger:
  [`../../../../../../developing/deploying/web-desktop-unification-rollout.md`](../../../../../../developing/deploying/web-desktop-unification-rollout.md)

This is the living contract for routing product-owned device-local persistence
and product telemetry through the already-mounted `ProductHost`, and for
splitting the mount composition into a host-owned root, a product provider root,
and a product lifecycle root. Product source stays under `apps/desktop`; this
slice changes storage backing, telemetry transport ownership, and the provider
composition — not native transport, event names, vendor policy, or product
behavior. It is the persistence-and-telemetry half of the former "Complete
Shared ProductHost Adoption" row; the mechanical source move into ProductClient
is the next slice.

## Observable outcome

Movable product persistence (user/repo preferences, workspace UI, logical
session selection, compute-target appearance, the local automation executor id,
and the raw-localStorage product keys) hydrates and writes through
`host.storage` via one injected storage context, preserving every existing
persisted value with zero migration. Product telemetry — identity, tags, route
classification, the single `screen_viewed`, exception capture, and product
events — routes through a product-owned `useProductTelemetry` facade backed by
`host.telemetry`. Desktop still owns the storage backend (native Tauri
preferences store / browser localStorage), the vendor telemetry transport, the
Query client construction, the Cloud client, and pre-provider auth/boot
reporting.

## Owned areas

### Persistence re-backing and data preservation

- `desktopProductStorage` (`lib/access/browser/product-storage.ts`) moves off
  raw `window.localStorage` onto the **same** Tauri preferences store used today
  (`lib/access/tauri/store.ts` — `readPersistedValue`/`persistValue`
  semantics), so `user_preferences`, `repo_preferences`, `workspace_ui`,
  `selected_logical_workspace_id`, `compute_target_appearance_preferences`, and
  `automationLocalExecutorId` keep their existing values with zero migration.
  Reads normalize legacy raw-object values to JSON strings
  (`typeof v === "string" ? v : JSON.stringify(v)`); writes store the string.
  Outside Tauri (store load fails) the adapter falls back to
  `window.localStorage`, matching today's behavior.
- For keys that historically lived only in raw localStorage (chat-diff prefs,
  file-tree overlay, session-replacement tombstones, organization-join target,
  support-report jobs, home next-target selection, model-probe dismissal,
  cloud display-name suppression), the adapter `getItem` falls back to
  localStorage on a Tauri-store miss (read-through only; writes go to the
  canonical backend). This is a host-owned backend choice, not a migration
  framework, queue, or replay.
- Product persistence modules read the injected context through one
  product-owned facade hook, `useProductStorageContext`
  (`hooks/persistence/facade/use-product-storage-context.ts`), which binds
  `host.storage` plus a guarded `host.telemetry.captureException` from the
  mounted host and hands it to plain workflow functions as an explicit argument.
  Product code no longer imports a browser/Tauri storage global directly.
- `lib/infra/persistence/preferences-persistence.ts` survives only as the
  backend beneath the host storage adapter and the two retained Desktop native
  owners — updater state (`hooks/access/tauri/use-updater.ts`) and the SSH
  target profile (`lib/access/tauri/ssh-target-profile.ts`). No movable product
  module imports it after this slice.
- `ProductStorage` carries non-secret product state only. Auth/PKCE/SSH/updater/
  telemetry-install/boot-diagnostic/dev-override keys never route through it;
  they stay in their existing host-owned owners.

### Telemetry ownership

- A product-owned `useProductTelemetry`
  (`hooks/telemetry/facade/use-product-telemetry.ts`) exposes the typed adapter
  from `host.telemetry`. Product consumers (chat, session, cloud, workspace,
  billing, access, plans) emit product events and capture exceptions through it,
  either directly or by receiving `telemetry.track` as an injected dependency.
- Route classification is product-owned: `use-telemetry-route-views` classifies
  the current pathname (`resolveDesktopTelemetryRoute`), hands the classified
  route to the host for vendor navigation metadata via
  `host.telemetry.routeChanged({ pathname, routeId })`, then emits exactly one
  `screen_viewed` product event through the typed adapter. The host adapter's
  `routeChanged` attaches only the vendor `route` tag and re-classifies nothing;
  the previous host-side `resolveDesktopTelemetryRoute` import,
  `previousTelemetryRoute` module singleton, `__resetDesktopTelemetryRouteForTest`
  hook, and duplicate `screen_viewed` emission are deleted, so exactly one
  code path emits the event.
- `ProductTelemetry.routeChanged` takes the already-classified
  `ProductRouteChange { pathname; routeId }` (added in
  `apps/packages/product-client/src/host/product-host.ts`) so classification is
  owned by product code and the host only attaches vendor metadata.
- The six telemetry lifecycle hooks (auth identity, agent seed, organization
  identity, route views, runtime state, workspace selection) read through the
  facade; auth identity reads `host.auth.state`.
- `lib/infra/query/query-client.ts` becomes product-owned:
  `createAppQueryClient(deps: { captureException })`. The host composition
  constructs the singleton with the Desktop capture
  (`providers/app-query-client.ts`) and provides it; there is exactly one
  QueryClient instance and the `meta.telemetryHandled` semantics are unchanged.

### Composition roots

- `DesktopHostProviders` (host-owned) mounts
  `QueryClientProvider(client=appQueryClient)` >
  `CloudClientProvider(client=cloudClient)` >
  `DesktopProductHostProvider(cloudClient)`. One `getProliferateClient()` via
  `useMemo`; the same `cloudClient` reference flows to the Cloud provider and
  the host constructor.
- `ProductProviderRoot` (product-owned; git-renamed from `AppProviders.tsx`)
  holds `WorkspaceProviders` > `TelemetryProvider`, carrying the moved
  workspace-connection resolution and materialization-cache boundary verbatim.
- `ProductLifecycleRoot` (product-owned) holds the shared lifecycle-hook block
  extracted from `AppRuntime` in identical order with identical boot-diagnostic
  bracketing, the `restoreSession` effect, and mounts the existing
  `DesktopProductLifecycleRoot` (which itself renders nothing when
  `host.desktop === null`).
- `App.tsx` is thinned to the error boundary, chrome, route tree, and modal/
  toast hosts. `main.tsx` renders
  `StrictMode > BrowserRouter > DesktopHostProviders > ProductProviderRoot >
  ProductLifecycleRoot > App`. One Query client, one Cloud client, one
  `ProductHostProvider`, one product provider root, one product lifecycle root,
  one router — none duplicated; old and new composition are never mounted
  together.

## Non-goals

This slice does not move product source into ProductClient, do Web
implementation work, rename or add telemetry events, change vendor policy or
payloads, add a storage migration/queue/retry/replay framework, or change any
persisted key's identity or shape.

## Recorded deviations and follow-ups

- **Query-client import — RESOLVED.** `ProductProviderRoot` no longer imports the
  `appQueryClient` module singleton. The workspace-connection resolver and its
  React Query cache reads moved into a cache-owner hook,
  `hooks/workspaces/cache/use-resolve-workspace-connection.ts` (a
  `hooks/**/cache/` path — sanctioned by `is_query_cache_owner_path` in
  `scripts/check_frontend_boundaries.py`), which reads the one client through
  `useQueryClient()`. Behavior and the single-instance guarantee are unchanged
  (the same `appQueryClient` mounted by `DesktopHostProviders` flows through
  context); no second QueryClient is constructed. The only remaining
  `appQueryClient` importers are its constructor (`providers/app-query-client.ts`)
  and the host composition (`providers/DesktopHostProviders.tsx`).
- **Module-level and error-boundary telemetry — RESOLVED (except one retained,
  below).** The plain (non-hook) product workflows and the settings error
  boundary now receive a narrow typed telemetry dependency injected from their
  calling hook (which reads `useProductTelemetry`), instead of importing
  `lib/integrations/telemetry/client`:
  `session-creation-materialization.ts` (injected `trackProductEvent` for
  `chat_session_created` + `captureException`),
  `session-creation-failure-cleanup.ts`, `session-created-runtime-cleanup.ts`,
  `use-empty-session-replacement-cleanup.ts` (injected `captureException`),
  `support-report-upload-payload.ts` (injected `support_report_submitted`
  `track` + injected `ProductSupportTelemetryContext`), all threaded from
  `use-session-creation-actions.ts` / `use-support-report-upload-queue.ts`. The
  class boundary `components/settings/screen/SettingsContentBoundary.tsx` gets
  the capture callback through a small functional wrapper that reads the facade
  and passes it as a prop. Same events, same payloads, same transport. The
  narrow injected-dep types follow the existing `TrackChatPromptSubmitted`
  pattern.
- **Error-boundary scope — RESOLVED.** `ProductLifecycleRoot` now renders the
  single `AppErrorBoundary` around an inner `ProductLifecycles` component that
  runs the shared lifecycle hooks, so a render-phase throw in any lifecycle is
  contained exactly as it was inside the old `AppRuntime` boundary. The same
  boundary also covers the product route/UI tree passed as `children`; the
  duplicate `AppErrorBoundary` was removed from `App.tsx` (single boundary).
  `main.tsx`'s composition tree is unchanged. A containment test was added to
  `providers/ProductLifecycleRoot.test.tsx`.
- **Auth product-event relocation — RESOLVED (host contract widened; single
  product emission wrapper).** The founder decision was taken (widen the frozen
  host contract rather than accept a below-host emitter). `ProductAuthHost` now
  returns normalized, non-secret result metadata:
  `startLogin(request): Promise<ProductLoginOutcome>` where
  `ProductLoginOutcome { provider: string; source: string }`, and
  `logout(): Promise<ProductLogoutOutcome>` where
  `ProductLogoutOutcome { provider: string }`. Values stay open strings at the
  package boundary (no desktop `AuthTelemetryProvider`/`AuthSignInSource` import
  crosses into the package); the emitting product code narrows them. This is the
  d1e §7.2 `void` return amended — d1e is left historical; this doc records the
  amendment.
  - The Desktop host adapter (`createDesktopAuthOperations` in
    `providers/desktop-product-host.ts`) surfaces the orchestration
    `{provider, source}` / `{provider}` results — already returned by
    `orchestration-provider-flow.ts` / `orchestration-password-flow.ts` —
    upward through `startLogin`/`logout`. `hooks/auth/workflows/use-auth-actions.ts`
    is now **transport-only**: it runs the orchestration flows and returns their
    results, with no `trackProductEvent`, no `captureTelemetryException`, and no
    failure classification. It stays beneath the host because it supplies
    `ProductAuthHost`; it does not call `useProductHost()`.
  - The single emission point is one product-owned wrapper,
    `hooks/auth/facade/use-audited-auth.ts` (`useAuditedAuth`), which wraps
    `host.auth.startLogin`/`logout` and emits through the typed
    `use-product-telemetry` facade with the exact prior semantics: success →
    `auth_signed_in {provider, source}` / `auth_signed_out {provider}` from the
    host outcome; non-abort, transport-attempted failure → `captureException`
    (skipped when the error is already telemetry-handled) then
    `auth_sign_in_failed {failure_kind: classifyTelemetryFailure(error),
    provider}`; abort → re-thrown, no emission. `cancelLogin` passes through with
    no emission (as before).
  - **Exact-condition fidelity.** The prior emitter only fired once an
    orchestration flow ran; the host has pre-transport rejection paths
    (unsupported Apple/Google/GitHub-link login, an unresolved SSO slug) that
    emitted nothing. A `markLoginNotAttempted`/`isLoginNotAttempted` disposition
    tag (`lib/domain/telemetry/errors.ts`, a WeakSet marker with no vendor
    coupling) marks those host throws so `useAuditedAuth` re-throws them without
    emitting — preserving "same events, same payloads, same conditions".
  - **Full coverage.** Every product login/logout caller routes through
    `useAuditedAuth`, including the two the move-list originally omitted:
    `use-github-sign-in`, `use-password-sign-in`, `use-sso-sign-in`,
    `use-org-slug-sso-sign-in`, `use-app-sidebar-sign-out-action`,
    `AccountPane` (sign-out + Google account link), and both org-join flows
    (`use-organization-join-invitation-flow`, `use-organization-join-auth-launch`).
    A grep for `track("auth_…")` outside tests returns exactly the three lines in
    `use-audited-auth.ts`; no direct `host.auth.startLogin`/`logout` product
    caller remains.
- **Contract-sanctioned direct transport (retained, not deferrals).** The sink
  (`client.ts`), startup wiring (`main.tsx`), the host adapter itself
  (`desktop-product-host.ts`), the Sentry route-instrumentation HOC
  (`InstrumentedRoutes` in `App.tsx`), the Query-client capture DI
  (`app-query-client.ts`),
  `hooks/access/tauri/use-updater.ts` (app-update events + capture; a host/OS
  updater-bridge consumer that moves in the extraction slice, not a product
  workflow), and pre-provider auth/boot reporting
  (`lib/access/tauri/auth.ts` keychain event, `lib/integrations/auth/*`,
  `hooks/auth/lifecycle/use-auth-bootstrap.ts`,
  `lib/workflows/cloud/ensure-desktop-worker.ts`) stay direct-transport by
  contract, because they are the transport, run before the host exists, or are
  host/OS-adjacent bridge consumers.
- **`useProductStorageContext` folder placement.** The context facade hook lives
  under `hooks/persistence/facade/` (a documented hook responsibility folder,
  mirroring `hooks/telemetry/facade/use-product-telemetry.ts`) so the strict
  frontend structure check passes.
- **Two session-creation files allowlisted for size.** Threading the typed
  telemetry deps pushed `session-creation-materialization.ts` (398→415) and
  `use-session-creation-actions.ts` (396→406) just past the 400-line soft
  threshold; both have `scripts/max_lines_allowlist.txt` entries (split
  deferred), matching the precedent set by `session-replacement-tombstones.ts`.

## Persistence inventory at the reviewed head

`rg "localStorage|sessionStorage|preferences-persistence" apps/desktop/src`
(non-test) retains only host-owned/infra matches, each with its retained reason:

| Match | Retained reason |
| --- | --- |
| `lib/access/browser/product-storage.ts` | The host storage adapter itself (the backend). |
| `lib/access/tauri/auth.ts` | Auth session/pending keychain fallback (security-sensitive). |
| `lib/access/tauri/ssh-target-profile.ts` | Retained Desktop native owner over `preferences-persistence`. |
| `hooks/access/tauri/use-updater.ts` | Updater state (OS updater), retained native owner. |
| `hooks/access/tauri/updater-dev-mock.ts` | Dev-only updater mock. |
| `hooks/app/lifecycle/use-running-agent-count.ts` | Dev-only running-agent override. |
| `hooks/app/lifecycle/use-debug-session-activity.ts` | Doc-comment reference to a debug flag. |
| `lib/infra/measurement/boot-stall-diagnostics.ts`, `debug-startup.ts`, `debug-session-activity.ts` | Boot/debug diagnostics (host infra). |
| `lib/integrations/telemetry/anonymous.ts`, `anonymous-storage.ts` | Anonymous-telemetry install/state fallback (host telemetry infra). |
| `hooks/preferences/lifecycle/use-user-preferences-lifecycle.ts`, `use-repo-preferences-lifecycle.ts`, `hooks/preferences/workflows/use-worktree-auto-delete-adoption.ts`, `lib/workflows/preferences/user-preferences-persistence.ts` | Import references / comments only; the persistence functions now write through the injected host storage helper. |
| `hooks/organizations/workflows/use-organization-join-invitation-flow.ts`, `hooks/support/lifecycle/use-support-report-upload-queue.ts` | Comment-only references to the retired raw-localStorage path. |

No movable product module imports `preferences-persistence.ts`;
`rg "resolveDesktopTelemetryRoute|previousTelemetryRoute|__resetDesktopTelemetryRouteForTest"
apps/desktop/src/providers/desktop-product-host.ts` is empty.

## Acceptance proof

Focused tests prove: the injected JSON storage helper's hydration and
write-failure semantics; each re-backed persistence key hydrating from and
writing to the host store with legacy values normalized and no migration;
`DesktopHostProviders` constructing one Cloud client and passing the same
reference to the Cloud provider and the host; `ProductLifecycleRoot` mounting
one `DesktopProductLifecycleRoot`, firing `restoreSession` once through the
host, and providing command-actions context under StrictMode; the route-views
hook emitting one `screen_viewed` and one vendor `routeChanged` per route
change; and the Query client remaining a single instance with
`meta.telemetryHandled` preserved.

Verification run at the reviewed head:

| Command | Result |
| --- | --- |
| `pnpm --filter @proliferate/product-client test` | pass (7) |
| `pnpm --filter @proliferate/product-client build` | pass |
| `pnpm --dir apps/desktop exec vitest run` (full) | 3099 pass; 13 failures pre-existing and byte-identical on base `06bf880a1` (7 unrelated files: automations location selector, `FileChangeCall` clipboard mock, playground fixtures, workspace-bootstrap, settings navigation, keyboard-resolution, markdown highlighting) |
| `pnpm --dir apps/desktop build` | pass |
| `python3 scripts/check_frontend_boundaries.py` | pass |
| `python3 scripts/report_frontend_structure.py --strict --summary-only` | pass (TOTAL 0) |
| `git diff --check` | clean |

The full `vitest run` is invoked directly (not the `test` script) under the same
founder-approved waiver as prior slices: the `pretest` design-system check flags
base-identical arbitrary-utility violations in unchanged files. The 13 failures
were confirmed pre-existing by running the same 7 files at base `06bf880a1` and
diffing the failing-test sets to empty.
