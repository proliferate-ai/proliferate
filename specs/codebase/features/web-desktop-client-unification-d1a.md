# Web/Desktop Unification D1a: Desktop Host Adoption

Status: **frozen r2; implementation accepted pending merge**.

- Revision: `D1a-r2`
- Frozen: 2026-07-13
- Exact implementation base:
  `2ec15eaf8cfc870cbdbb42c225a5f1428e5282b4`
- Accepted implementation: PR #1157, head
  `90926523c3662067e02f8511db6c8e0058e119f1`
- Parent architecture:
  [`web-desktop-client-unification.md`](web-desktop-client-unification.md)
- Pipeline ledger:
  [`../../developing/deploying/web-desktop-unification-rollout.md`](../../developing/deploying/web-desktop-unification-rollout.md)

This file is the implementation contract for D1a only. If implementation
cannot satisfy it without changing a material decision, stop and return the
decision to the founder. Do not silently broaden the slice.

## 1. Observable outcome

The existing Desktop product runs beneath one real, Desktop-owned
`ProductHostProvider`. Desktop constructs a concrete immutable `ProductHost`
and concrete `DesktopBridge` from its existing implementations. A replacement
host snapshot is supplied only when an approved reactive input changes.

One Desktop-only product-lifecycle root is mounted through
`host.desktop`; D1a proves that boundary by moving the existing running-agent
count export through `desktop.nativeUi.setRunningAgentCount`.

All product source remains under `apps/desktop`.

## 2. Founder-approved boundary

The founder approved these material decisions:

1. The D1a lifecycle root contains only running-agent count export.
2. Desktop auth advertises its real current login methods: GitHub, password,
   and SSO. It does not advertise Google or Apple login. The current callback
   workflow remains authoritative; `finishLogin` is a thin adapter over it.
3. New host-facing Desktop links normalize through `ProductEntry`. The
   retained legacy `desktopNavigationTarget` adapter reads the raw query when
   rebuilding existing route strings so duplicate keys and exact encodings
   remain byte-compatible with the base implementation. The raw deep-link
   source supports the existing consumers plus the real `ProductLinks`
   observer.
4. `ProductStorage` uses guarded `window.localStorage`; no existing user data
   is migrated.
5. An updater check failure rejects through the bridge. It is not translated
   into “no update.”

Two additional constraints are binding:

- Deep-link work must not introduce persistence, retry, recovery, or a
  generalized queue. It may normalize existing behavior, multiplex the raw
  source, and support existing consumers.
- Every `DesktopBridge` implementation is a thin shape adapter over existing
  behavior. Apart from the accepted deep-link rejection containment and
  updater event-shape correction recorded in §4.1, D1a does not redesign,
  harden, or replace the underlying native capabilities.

## 3. Non-goals

D1a does not:

- move product pages, hooks, stores, routes, or providers into ProductClient;
- change Web;
- migrate broad native call sites;
- redesign authentication, query/cache ownership, AnyHarness runtime
  lifecycle, or deployment switching;
- change CSS, Tailwind scanning, assets, or visual behavior;
- move worker enrollment, updater watching, local automation, local-agent
  reconciliation, shortcuts, Dock activity, SSH, or support lifecycles into
  the new lifecycle root;
- add new deep-link destinations or a general link-delivery subsystem;
- migrate existing persistence keys or values; or
- perform unrelated correctness or hardening work.

## 4. Reconciled baseline

The specification was reconciled against the exact base SHA above. The
reconciliation result is **Yellow**: the merged foundation supports D1a, with
targeted specification needed for Desktop auth callbacks, inbound links,
storage, adapter shapes, and lifecycle membership. No architecture decision
was reopened.

Required merged foundation:

| Foundation | Final evidence |
| --- | --- |
| Canonical unification contract | PR #1149, merge `ff94b3db2` |
| Shared ProductClient CSS boundary | PR #1151, merge `36d40c2c0` |
| Embedded-browser removal | PR #1154, merge `4f7fe6ee5` |
| ProductClient host/bridge/provider foundation | PR #1153, merge `0b33e116d` |

### 4.1 Accepted r2 reconciliation

The founder accepted these narrow review-driven changes to the frozen r1
contract:

- `desktopNavigationTarget` preserves legacy route strings from the raw parsed
  query instead of round-tripping through lossy `ProductQueryParams`. The
  normalized `ProductEntry` codec remains the new host-facing path.
- `ensureDeepLinkBridge` remains once-only and first-handler-wins, awaits its
  initial snapshot before live registration, and contains both initial and
  live handler rejections. It still registers the live listener after a
  contained initial failure. This is bounded correctness preservation, not a
  retry, replay, persistence, recovery, or queue system.
- The existing updater wrapper consumes the real Tauri plugin
  `Started`/`Progress`/`Finished` event union before the bridge maps byte
  progress to a bounded fraction.
- Clean intent-stack boot builds ProductClient before Desktop Vite starts.
- The exact `pnpm --dir apps/desktop test` command is waived only for the
  identical base-existing design-system pretest violations in unchanged
  files. This is not a general test waiver.

At the D1a base, ProductClient contains:

```text
apps/packages/product-client/
  package.json
  src/host/
    product-host.ts
    desktop-bridge.ts
    ProductHostProvider.tsx
    ProductHostProvider.test.tsx
```

Desktop currently composes:

```text
BrowserRouter
  AppProviders
    QueryClientProvider(appQueryClient)
      CloudClientProvider(cloudClient)
        WorkspaceProviders
          AnyHarnessRuntime
            CloudWorkspaceMaterializationCacheBoundary
              AnyHarnessWorkspace
                TelemetryProvider
                  App
                    AppRuntime
```

`AppRuntime` currently mounts `useAuthBootstrap` and
`useExportRunningAgentCount` directly. `AppProviders` constructs one stable
Cloud client with `getProliferateClient()`.

## 5. Target ownership and file plan

`ProductHost` construction is a Desktop provider concern. Raw browser storage
stays behind `lib/access/browser`; raw Tauri aggregation stays behind
`lib/access/tauri`; existing pure deep-link normalization stays with the
current Desktop navigation domain. `DesktopProductLifecycleRoot` lives under
`providers` as an app-lifecycle boundary; it does not pretend to be a visual
component.

The exact D1a file plan is:

```text
apps/desktop/
  package.json                                      [modify]
  src/
    App.tsx                                         [modify]
    hooks/app/lifecycle/
      use-export-running-agent-count.ts             [modify]
      use-export-running-agent-count.test.tsx        [new]
    lib/access/browser/
      product-storage.ts                            [new]
      product-storage.test.ts                       [new]
    lib/access/tauri/
      deep-link.ts                                  [modify]
      deep-link.test.ts                             [new]
      desktop-bridge.ts                             [new]
      desktop-bridge.test.ts                        [new]
      updater.ts                                    [modify; accepted r2 expansion]
      updater.test.ts                               [modify; accepted r2 expansion]
    lib/domain/auth/
      desktop-navigation.ts                         [modify]
      desktop-navigation.test.ts                    [modify]
    providers/
      AppProviders.tsx                              [modify]
      DesktopProductLifecycleRoot.tsx               [new]
      DesktopProductLifecycleRoot.test.tsx          [new]
      DesktopProductHostProvider.tsx                [new]
      DesktopProductHostProvider.test.tsx           [new]
      desktop-product-host.ts                       [new]
      desktop-product-host.test.ts                  [new]

apps/packages/product-client/src/host/
  product-host.ts                                   [modify docs only]

pnpm-lock.yaml                                      [modify]

tests/intent/stack/
  boot.ts                                           [modify; accepted r2 expansion]
```

No file under `apps/web` or ProductClient product source is changed. The only
ProductClient edit is the `ProductLinks.observeInboundEntries` documentation
clarification in §8; its TypeScript shape is unchanged. If implementation
requires any other ProductClient contract change, stop and return to
specification.

## 6. Provider composition

Desktop adds ProductClient as a workspace dependency and builds it before
Desktop typecheck, tests, and bundling. `AppProviders` passes the exact Cloud
client it already owns into the Desktop host provider:

```tsx
<QueryClientProvider client={appQueryClient}>
  <CloudClientProvider client={cloudClient}>
    <DesktopProductHostProvider cloudClient={cloudClient}>
      <WorkspaceProviders>
        <TelemetryProvider>{children}</TelemetryProvider>
      </WorkspaceProviders>
    </DesktopProductHostProvider>
  </CloudClientProvider>
</QueryClientProvider>
```

This location is binding:

- it is inside `QueryClientProvider`, because auth-method discovery uses the
  existing React Query hooks;
- it receives the same `cloudClient` object as `CloudClientProvider`;
- it is above the existing product, workspace, route, and lifecycle code; and
- it remains inside `BrowserRouter`, so existing auth/navigation hooks retain
  router access.

The provider must not create a second Cloud client, Query client, AnyHarness
runtime, auth store, or telemetry vendor instance.

### 6.1 Immutable host snapshot

Stable adapters are constructed outside render or memoized independently.
The provider constructs one snapshot conceptually as follows:

```tsx
const host = useMemo<ProductHost>(() => ({
  surface: "desktop",
  deployment: desktopDeployment,
  auth: desktopAuth,
  cloud: { client: cloudClient },
  storage: desktopProductStorage,
  links: desktopProductLinks,
  clipboard: desktopClipboard,
  telemetry: desktopTelemetry,
  desktop: desktopBridge,
}), [cloudClient, desktopAuth]);
```

The code need not use these exact local names, but it must preserve the
identity rules below.

The `ProductHost` object is replaced when and only when one of these snapshot
inputs changes:

| Reactive input | Required result |
| --- | --- |
| `useAuthStore().status` | Replace the host with the corresponding `loading`, `anonymous`, or `authenticated` auth snapshot. |
| Authenticated user identity fields | Replace the host with the newly mapped `ProductAuthUser`. |
| Advertised GitHub/password/SSO availability while anonymous | Replace the anonymous auth snapshot and host only when the normalized method list changes. |
| The `cloudClient` reference supplied by `AppProviders` | Replace the host and expose that exact new reference. |

These are explicitly not host-replacement triggers:

- access-token or refresh-token rotation;
- `useAuthStore().error` or another auth field not represented by `AuthState`;
- selected organization;
- route changes;
- selected workspace or AnyHarness runtime URL;
- workspace/runtime health;
- preference-store changes; and
- deployment switching during the current process.

The existing Cloud middleware reads current auth and organization authority at
request time. Workspace/runtime state remains under `WorkspaceProviders`.
Desktop deployment switching writes `apiBaseUrl` with `setDesktopAppConfig`
and then relaunches; the current process does not mutate its deployment
snapshot in place.

Callbacks and all non-reactive adapters retain stable identities across host
replacement. A parent re-render with unchanged inputs must not replace the
host object.

## 7. ProductHost construction

### 7.1 Deployment and Cloud

- `deployment.apiBaseUrl` uses `getProliferateApiBaseUrl()` for the current
  process.
- `switchDeployment(apiBaseUrl)` calls
  `setDesktopAppConfig({ apiBaseUrl })`, then `relaunch()`.
- `resetDeployment()` calls `setDesktopAppConfig({ apiBaseUrl: null })`, then
  `relaunch()`.
- A failed config write rejects and must not attempt to claim an in-process
  switch.
- `cloud.client` is the exact `cloudClient` supplied by `AppProviders`,
  including while Desktop is anonymous; existing middleware continues to
  decide request authority.

Existing symbols:

- `apps/desktop/src/lib/infra/proliferate-api.ts` —
  `getProliferateApiBaseUrl`
- `apps/desktop/src/lib/access/tauri/config.ts` — `setDesktopAppConfig`
- `apps/desktop/src/lib/access/tauri/updater.ts` — `relaunch`
- `apps/desktop/src/lib/access/cloud/client.ts` — `getProliferateClient`

### 7.2 Authentication

The provider reuses:

- `useAuthStore` for status/user;
- `useAuthBootstrap` for `restoreSession`;
- `useAuthActions` for password, GitHub, SSO, cancellation, logout, and the
  already-supported Google-link action;
- `useDesktopAuthMethods`, `useGitHubDesktopAuthAvailability`, and
  `useSsoDiscovery` for the anonymous method list; and
- `handleDesktopCallbackUrl` for callback completion.

The current App root must consume `host.auth.restoreSession` instead of
mounting a second `useAuthBootstrap`. There is one bootstrap hook owner and
one bootstrap invocation; startup timing and diagnostic events remain in
`AppRuntime`.

Auth-state mapping is exact:

| Desktop state | ProductHost state |
| --- | --- |
| `bootstrapping` | `{ status: "loading" }` |
| `anonymous` | `{ status: "anonymous", methods }` |
| `authenticated` | `{ status: "authenticated", user }` |

The user mapping is `id`, `display_name -> displayName`, `email`,
`avatar_url -> avatarUrl`, and `github_login -> githubLogin`.

Anonymous `methods` contains only currently available `password`, `github`,
and `sso`. Google and Apple login are not advertised. A direct request for an
unadvertised login method rejects clearly.

Every `LoginRequest` variant has an exact disposition:

| Request | D1a behavior |
| --- | --- |
| Password | Delegate email/password to `signInWithPassword`. |
| GitHub with omitted purpose or `purpose: "login"` | Delegate `prompt` to `signInWithGitHub`. |
| GitHub with `purpose: "link"` or `"required_github_link"` | Reject. The current action hard-codes login; D1a does not add a new GitHub-link orchestration. |
| Google with `purpose: "link"` | Delegate to the existing `linkGoogle` action. |
| Google login or `required_github_link` | Reject. |
| Apple, any purpose | Reject. |
| SSO without `slug` | Delegate the existing email/organization/connection fields to `signInWithSso`. |
| SSO with `slug` | Reuse the existing slug flow: call `discoverDesktopSso` with the supplied selectors, then call `signInWithSso` using the resolved organization/connection. Disabled or unresolved discovery rejects with the existing generic unavailable behavior. |

No request field may be silently discarded or coerced into another purpose.
D1a does not add Google, Apple, or GitHub-link login behavior.

`finishLogin({ code, state })` requires Desktop OAuth state, reconstructs the
existing Desktop callback URL using `DESKTOP_AUTH_REDIRECT_URI`, and delegates
to `handleDesktopCallbackUrl`. If state is absent or the existing callback
handler declines the callback, `finishLogin` rejects. It does not exchange
codes, mutate auth state, or create recovery behavior independently.

### 7.3 Storage, links, clipboard, and telemetry

`ProductStorage` is a thin asynchronous wrapper over `window.localStorage`:

- `getItem` returns the stored string or `null`;
- `setItem` writes the supplied string;
- `removeItem` removes the key; and
- browser storage exceptions reject the returned promise.

No existing key is copied, renamed, or migrated.

`ProductClipboard.writeText` delegates to `copyText`.
`ProductLinks.openExternal` delegates to `openExternal`.

Telemetry delegates to the existing Desktop functions:

- `trackProductEvent`
- `captureTelemetryException`
- `setTelemetryUser` / `clearTelemetryUser`
- `setTelemetryTag`
- `resolveDesktopTelemetryRoute`
- `getSupportReportReleaseId`
- `getSupportReportTelemetryRefs`

`routeChanged` preserves the existing route classification and suppresses a
repeat emission when two pathnames resolve to the same Desktop telemetry
route. D1a does not add events, vendor instances, or telemetry policy.

## 8. Deep-link normalization

The existing behaviors remain owned by:

- `ensureDeepLinkBridge` for the raw Tauri source;
- `handleDesktopCallbackUrl` for auth callbacks and the existing navigation
  consumer;
- `desktopNavigationTarget` for current route strings; and
- `useDevDesktopHandoff` for the development handoff poller.

D1a establishes a shared host-facing normalization model while retaining the
legacy route adapter's byte-compatible query handling:

1. Add pure encode/decode helpers in
   `lib/domain/auth/desktop-navigation.ts` that translate existing supported
   Desktop URLs to and from `ProductEntry`.
2. Keep `desktopNavigationTarget(url)` as an existing-consumer adapter that
   uses the raw parsed query when rebuilding route strings, returning the same
   exact route bytes for every currently supported URL.
3. Construct `ProductLinks.buildReturnUrl` from the encoder.
4. Construct `ProductLinks.observeInboundEntries` by subscribing to the raw
   source, decoding recognized non-auth URLs, and delivering only successful
   `ProductEntry` values.

The raw source may hold an in-memory set of active listeners and one native
live-listener handle. Each subscription reads Tauri's existing `getCurrent()`
once for its initial snapshot, then receives URLs that arrive while that
subscription is active. It must not retain raw URLs or entries after delivery
and must not add persistent storage, retry, recovery, backoff, deduplication
history, or a queue.

For D1a, “initial + live” means exactly “the host's current Tauri snapshot at
subscription + events arriving after subscription.” It does not promise
replay of arbitrary live events that arrived before a later subscriber
mounted. The documentation on `ProductLinks.observeInboundEntries` must be
updated to state this bounded no-queue meaning; the method signature and
capability ownership do not change.

The once-only legacy bridge awaits its initial callback before registering the
live listener. Initial and live callback rejections are contained, and a
contained initial failure does not prevent live registration. Unsubscription
must be race-safe if native listener registration is still in flight. These
requirements preserve the existing delivery boundary; they do not add retry,
replay, persistence, recovery, or a queue.

The encoder/decoder covers destinations already handled by
`desktopNavigationTarget` or emitted by literal Desktop return URLs in the
current codebase. Unsupported `ProductEntry` kinds reject from
`buildReturnUrl`; malformed, auth-callback, and unknown inbound URLs decode to
`null`. D1a does not invent a route for an unsupported entry.

The existing auth/navigation consumer remains active in D1a. ProductClient
does not take over internal routing in this slice, so no product observer is
mounted merely to exercise the new adapter.

## 9. DesktopBridge mapping

`desktop-bridge.ts` exports one stable concrete `DesktopBridge`. Every method
delegates to an existing Desktop access function. Permitted work is limited to
argument renaming, return-shape normalization, callback-shape normalization,
and the explicit failure mapping below.

| Bridge group | Existing symbols | Required adaptation |
| --- | --- | --- |
| `runtime` | `getRuntimeInfo`, `restartRuntime` | Map `RuntimeInfo.url` to `{ runtimeUrl }`; do not add auth-token discovery. |
| `files` | `pickFolder`, `getHomeDir`, `pathIsDirectory`, `listAvailableEditors`, `listOpenTargets`, `openTarget`, `revealInFinder`, `openInTerminal` | Rename methods only; preserve current arguments/results and existing outside-Tauri fallbacks. |
| `localCredentials` | `listConfiguredEnvVarNames`, `setEnvVarSecret`, `deleteEnvVarSecret` | Rename methods only. |
| `nativeUi` | `showNativeContextMenu`, `listenForShortcutMenuEvents`, `setRunningAgentCount`, `setWorkspaceActivityIndicator`, `setWebviewZoom` | Adapt menu types; turn async native listener registration into a race-safe synchronous unsubscribe; preserve other behavior. |
| `updater` | `isTauriPackaged`, `getAppVersion`, `checkForUpdate`, `downloadAndInstall`, `relaunch` | Consume the real plugin `Started`/`Progress`/`Finished` event union, then map current to `null`, available to `DesktopUpdate`, error to rejection, and byte progress to a bounded `0..1` fraction when total length is known. |
| `worker` | `getDesktopInstallId`, `ensureDesktopDispatchWorker`, `stopDesktopDispatchWorker` | Preserve ensure result; discard the stop result after successful completion. |
| `ssh` | `getSshDirectTargetProfile`, `setSshDirectTargetProfile`, `deleteSshDirectTargetProfile`, `ensureSshAnyHarnessTunnel` | Preserve profile fields; map `localUrl` to `{ runtimeUrl }`. |
| `scratch` | `readWorkspaceScratchPad`, `writeWorkspaceScratchPad` | Rename methods and preserve timestamps/nullability. |
| `diagnostics` | `logRendererEvent`, `collectSupportDiagnostics`, `saveDiagnosticJson`, `stageSupportReportAttachment`, `readStagedSupportReportAttachment`, `deleteStagedSupportReportAttachment` | Adapt object/positional arguments only; preserve nullability and failures. |

Underlying rejections propagate unless the existing function already provides
a documented outside-Tauri fallback. The adapter must not add retries,
timeouts, caches, validation policy, logging policy, telemetry, or fallback
behavior.

## 10. Desktop lifecycle root

`AppRuntime` removes its direct `useExportRunningAgentCount()` call and mounts
one component outside auth and route gates:

```tsx
export function DesktopProductLifecycleRoot() {
  const { desktop } = useProductHost();
  return desktop === null
    ? null
    : <RunningAgentCountLifecycle desktop={desktop} />;
}

function RunningAgentCountLifecycle({ desktop }: { desktop: DesktopBridge }) {
  useExportRunningAgentCount(desktop.nativeUi.setRunningAgentCount);
  return null;
}
```

The nested component is required so hook membership remains valid if
`desktop` changes between a bridge and `null` in a test or future host.

`useExportRunningAgentCount` receives the bridge function as a dependency but
retains its existing behavior:

- export the initial busy-session count once;
- subscribe once to `useSessionDirectoryStore`;
- export only when the count changes;
- ignore the returned promise exactly as today; and
- unsubscribe on unmount or when the bridge callback changes.

Replacing a host snapshot with the same stable `desktopBridge` must not
resubscribe or re-export. Replacing the bridge with `null` unmounts the inner
lifecycle and cleans up.

No other lifecycle moves in D1a.

## 11. Main control flow and failure path

The approved main control flow is:

```text
AppProviders creates one Cloud client
  -> DesktopProductHostProvider reads reactive auth/method state
  -> provider combines that snapshot with stable Desktop adapters
  -> ProductHostProvider supplies the exact immutable host object
  -> AppRuntime uses host.auth.restoreSession once
  -> DesktopProductLifecycleRoot sees host.desktop
  -> running-agent hook exports through the existing Tauri function
```

The approved representative failure path is an invalid or unsupported inbound
deep link:

```text
Tauri supplies raw URL
  -> once-only raw bridge awaits initial delivery, then registers live delivery
  -> ProductEntry decoder returns null
  -> ProductLinks emits nothing
  -> existing auth/navigation handler retains its existing handled/unhandled result
  -> no persistence, retry, recovery, or queued replay occurs
```

Other binding failure behavior:

- an initial or live legacy deep-link handler rejection is contained without
  adding retry or queueing, and a contained initial failure does not prevent
  live listener registration;
- updater `kind: "error"` becomes a rejected bridge check;
- an unsupported auth method or invalid callback rejects;
- a deployment config-write failure prevents relaunch sequencing; and
- native adapter failures otherwise preserve the underlying rejection or
  existing fallback.

## 12. Tests and acceptance proof

### 12.1 Focused automated tests

`DesktopProductHostProvider.test.tsx` proves:

- the provider exposes `surface: "desktop"` and a non-null bridge;
- it exposes the exact Cloud client supplied by `AppProviders`;
- auth status, mapped user, and method availability replace the host object;
- an unrelated rerender preserves host identity;
- static host groups and `desktopBridge` retain identity across auth
  replacement; and
- the provider does not construct a second Cloud client.

`desktop-product-host.test.ts` proves:

- deployment switch/reset write the expected config before relaunch;
- config-write failure does not continue to relaunch;
- auth method mapping omits unavailable/unsupported methods;
- every login request/purpose/slug variant follows the disposition in §7.2;
- unsupported login and rejected callback paths reject;
- clipboard, external-link, and telemetry adapters delegate once.

`desktop-bridge.test.ts` proves every bridge method delegates to the named
existing access function with the required shape conversion. At minimum it
must explicitly cover runtime URL mapping, early-unsubscribe listener races,
updater current/available/error/progress mapping, worker-stop result discard,
SSH URL mapping, and diagnostics argument mapping.

Deep-link tests prove:

- every currently supported Desktop route retains its exact route-string
  result;
- existing literal return URLs round-trip through `ProductEntry` where their
  corresponding entry kind is supported;
- initial `getCurrent()` and live URLs reach active listeners;
- two existing consumers can subscribe without creating two native live
  listeners;
- unsubscribe during listener-registration is safe;
- unknown/auth/malformed URLs do not emit `ProductEntry`; and
- the module does not retain or replay delivered live entries and has no
  persistence, retry, recovery, or queue.

Storage tests cover get/set/remove/null and exception propagation.

Lifecycle tests prove:

- `desktop: null` performs no running-count export and creates no store
  subscription;
- a Desktop bridge exports the initial count;
- busy/idle changes export only changed counts;
- unchanged counts do not re-export;
- host replacement with the same bridge does not duplicate work; and
- bridge removal/unmount cleans the subscription.

The existing ProductHostProvider tests remain green.

### 12.2 Required commands and accepted evidence

The accepted implementation records successful results for:

```bash
pnpm --filter @proliferate/product-client build
pnpm --dir apps/desktop build
python3 scripts/report_frontend_structure.py --strict --summary-only
git diff --check
```

Nine focused test files pass with `153/153` tests. The fail-closed Tier-2
workflow-definition lifecycle also passes after clean intent-stack boot was
updated to build ProductClient before Desktop.

The exact command below reaches the existing design-system pretest and fails
identically on the frozen base and accepted head because of violations in
unchanged files:

```bash
pnpm --dir apps/desktop test
```

The founder accepted that one base-equivalent pretest failure as a scoped
waiver for this slice. It does not waive focused tests, builds, structure
checks, CI, or future regressions.

### 12.3 Local Desktop smoke

Using named profile `d1a-host` per
`specs/developing/local/dev-profiles.md`, the accepted implementation proved:

- Desktop opens without a missing-host/provider error;
- the existing auth bootstrap reaches the same visible state as the base;
- local and Cloud workspace surfaces still load through their existing
  providers; and
- creating a replacement auth snapshot does not restart the local AnyHarness
  runtime or construct a second Cloud client.

The smoke was refreshed after the final product-code changes. Accepted head
`90926523c3662067e02f8511db6c8e0058e119f1` only adds the clean Tier-2 build
dependency. This is a Desktop smoke, not a Web or full release-qualification
run.

## 13. Completion and stop conditions

D1a's implementation has been accepted at PR #1157 head
`90926523c3662067e02f8511db6c8e0058e119f1`. The observable outcome,
reconciled file plan, focused tests, builds, structure checks, Tier-2 CI, and
named-profile smoke are satisfied, with only the explicit base-equivalent
pretest waiver in §12.2. Record the actual merge SHA here before marking the
slice complete.

Stop and return to specification if implementation requires:

- changing `ProductHost` or `DesktopBridge` capability ownership;
- new auth behavior rather than an adapter;
- a deep-link queue, persistence, retry, or recovery mechanism;
- hardening or redesigning a native capability;
- moving another lifecycle;
- moving product source; or
- touching Web or CSS.

Later ProductClient source movement and Web adoption must be reconciled and
specified after D1a is finalized; they are not implied by this freeze.
