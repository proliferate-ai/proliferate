# Web/Desktop Client Unification

Status: authoritative contract for the shared Desktop/Web connected DOM
product (`@proliferate/product-client`), its two thin hosts, the product
scope/authority isolation model, the capability policy, and the governance
rules under which the migration lands.

This spec is the settled contract promoted from the decision-complete
migration plan. On any conflict, this file wins over
[`../../tbd/web-desktop-unification-migration.md`](../../tbd/web-desktop-unification-migration.md)
(non-authoritative rollout history/execution detail) and
[`../../tbd/web-desktop-unification-intake-ledger.md`](../../tbd/web-desktop-unification-intake-ledger.md)
(historical intake snapshot). Binding execution state — chain state, intake
snapshots, the freeze ledger, and the external-configuration item schema —
lives in
[`../../developing/deploying/web-desktop-unification-rollout.md`](../../developing/deploying/web-desktop-unification-rollout.md),
never under `specs/tbd/`.

This contract does not redefine feature behavior. Auth, onboarding, settings,
chat, transcript, workspace, billing, workflow, and other product behavior
remain owned by their focused feature and primitive specs. This file decides
which layer owns cross-client behavior, what the host boundary is, and what
must be true at each migration checkpoint.

Scope: the DOM product in `apps/desktop`, `apps/web`, and `apps/packages/**`,
plus the narrow authority/lifecycle corrections in `anyharness/sdk-react` and
`cloud/sdk-react`. Mobile product behavior is outside this contract and must
remain green while shared SDK providers are corrected.

## 1. Outcome

Desktop and Web render one connected product implementation:
`@proliferate/product-client`.

Desktop is the visual, behavioral, and state-management source of truth. The
old Web product implementation is not a second source to reconcile: it is
deleted in the Web cutover landing and replaced by the Desktop-derived product
client in the same mainline landing.

```text
Desktop native host ----\
                         +--> one ProductClient --> Cloud SDK React
Web browser host --------/                      \--> AnyHarness SDK React
```

At completion:

- the same components, pages, hooks, stores, product workflows, Cloud SDK
  wiring, and AnyHarness SDK wiring implement the product on Desktop and Web;
- `apps/desktop` is a thin native bootstrap and transport host;
- `apps/web` is a thin browser bootstrap and transport host;
- product differences are caused by real capabilities, not by two product
  implementations drifting apart;
- Desktop keeps its current experience and native capabilities;
- Web gets that experience for managed-cloud work, without pretending it can
  access a user's local machine;
- the old Web chat client, polling loop, stores, pages, and controllers no
  longer exist;
- `@proliferate/product-surfaces` remains a separate package during this
  migration; `product-client` may consume its connected surfaces. Absorbing it
  is an optional later cleanup, not a migration prerequisite.

Hosts answer "how do I authenticate here?", "can this device access a local
runtime?", and "how do I open this link?" They do not reimplement product
behavior.

## 2. Closed decisions

1. **Desktop is the baseline.** Preserve its UI, interaction model, stores,
   warm workspace shell, and product workflows. Extraction and host cutover,
   not redesign.
2. **The package is `@proliferate/product-client`.** `product-surfaces`
   remains a separate package; `product-client` may consume it, and absorbing
   it is an optional later cleanup, not a prerequisite of this migration.
3. **The connected product is shared.** The package owns React pages, product
   routes, connected hooks, scoped stores, lifecycle orchestration, Cloud SDK
   React wiring, and AnyHarness SDK React wiring.
4. **One composite host contract.** One typed host object with nested
   capability groups; no separate auth-host/runtime-host provider trees.
5. **Product routes are shared.** Each app creates its browser router and owns
   raw transport callback entrypoints; `ProductClient` owns the authenticated
   product route tree and the ordinary login/join product screens.
6. **Desktop owns raw Tauri access.** `product-client` never imports Tauri or
   exposes a generic `invoke`. Shared product code calls a typed optional
   Desktop bridge.
7. **Web commands managed-cloud runtimes only.** It never discovers or
   directly connects to a local sidecar, SSH target, or Desktop-exposed local
   runtime. Server-visible local metadata may be shown read-only with an
   "Open in Desktop" action.
8. **Cloud AnyHarness behavior is identical.** Both hosts use the same shared
   gateway resolver and the same AnyHarness React provider/hooks for managed
   cloud workspaces.
9. **Authentication transport remains host-owned.** Product auth state and UI
   are normalized; cookies/CSRF/PKCE on Web and native vault/protocol handling
   on Desktop are not normalized away.
10. **No old Web product compatibility requirement.** Old Web presentation,
    stores, controllers, and ordinary product aliases are deleted. A bounded
    one-release redirect set exists only to order external/deployed URL
    producers safely; it is not a second product or a feature flag.
11. **Self-hosted Desktop remains supported.** Self-hosted Web is a named
    follow-up: the contract must allow one, but it is not an acceptance
    criterion for this cutover.
12. **Mobile is not involved.** Mobile continues to consume only its allowed
    SDKs, `product-domain`, and the native design layer, and stays DOM-free.
13. **The embedded Tauri browser is not preserved.** A separately reviewable
    removal lands before the mechanical move and deletes the live workspace
    browser panel, tab/actions, raw webview access, and their callers. It is
    not bridged or moved into product-client.
14. **The cache-scope correction lands first.** PR 0a (commit `bdd11aa5a`)
    landed the SDK/query-key foundation; PR 0b adds same-principal session
    authority generation plus credential-mutation ordering; PR 0c removes the
    credential-keyed global AnyHarness client map and adds target
    generation/client/stream lifecycle ownership. Product-client copies
    neither global cache pattern into a shared package.
15. **Host seams are separated from file movement.** Desktop adopts the host,
    bridge, and scoped-provider model while source paths remain stable (PR 1);
    only then does a freeze-gated PR mechanically move product source (PR 2).
16. **Each host marks its surface before rendering.** Both hosts set
    `data-proliferate-client="desktop|web"`. Shared Tailwind variants may use
    that marker for presentation; capability logic remains structural and is
    never implemented as CSS hiding.
17. **AnyHarness clients are scope-owned.** The SDK React module-global client
    map keyed by raw bearer token is removed before source movement. Product
    authority owns a bounded client registry; target-generation changes use a
    credential-free connection identity and a generic transition boundary for
    Cloud, local, and SSH runtimes.

## 3. Package ownership and build contract

### 3.1 Ownership boundary

```text
apps/packages/product-client/   # the shared connected product
  src/
    ProductClient.tsx              # lightweight auth/product gate (from PR 2)
    AuthenticatedProductClient.tsx # route-lazy connected product (from PR 2)
    app/ pages/ components/ hooks/ stores/ providers/ config/ copy/ assets/
    lib/{domain,workflows,infra}/
    host/                          # product-host types + ProductHostProvider

apps/desktop/src/                # thin native host: bootstrap, native auth
                                 # transport, telemetry install, raw Tauri
                                 # access, native lifecycle, host CSS
apps/web/src/                    # thin browser host: bootstrap, env config,
                                 # browser auth/PKCE transport, telemetry
                                 # install, host CSS
```

This is an ownership map, not a rename mandate: the mechanical move preserves
Desktop's existing domain/responsibility taxonomy where it is already valid.

### 3.2 Dependency direction

```text
apps/desktop ----\
                  +--> product-client --> product-ui --> ui --> design/dom
apps/web --------/             |
                               +--> product-domain
                               +--> cloud-sdk / cloud-sdk-react
                               +--> anyharness/sdk / anyharness/sdk-react

apps/mobile --> product-domain + design/react-native + SDKs
```

- `product-client` imports neither app, no Tauri package or Desktop raw-access
  file, and no browser auth-cookie, PKCE, or vendor telemetry implementation.
- Apps import only public product-client entrypoints, never its internal
  stores and hooks.
- `product-ui` remains props-in/callbacks-out presentation; `product-domain`
  remains React-free and Mobile-safe; `ui` and `design` stay separate lower
  layers.
- No app-local copy of a product-client store or controller exists after its
  cutover; imports remain direct with no convenience barrel files.

### 3.3 Import-path rule

Package-private product-client imports use Node package imports:

```json
{ "imports": { "#product/*": "./src/*" } }
```

- Moved product-client internals rewrite `@/...` specifiers to `#product/...`
  with an AST module-specifier codemod (never blind text replacement — the
  repo contains unrelated `@@/` regex text);
- retained Desktop host files keep `@/...`;
- hosts import only public `@proliferate/product-client/<entrypoint>` exports;
- no app-level Vite alias or TypeScript `paths` for `#product`; `#/*` is an
  invalid Node package-import name and is not used;
- TypeScript, Vite, and Vitest all prove the mapping in PR 1, before the
  mechanical move;
- post-move scans reject `@/` inside product-client, `#product/` in either
  app, and unresolved `#product/` text in final bundles.

### 3.4 Package build contract and staged export map

`product-client` is private application source, not a published UI library. It
is a source-consumed workspace package: both host Vite builds compile the same
source; the package `build`/`typecheck` typechecks the source; Vitest runs
against the source. React, React DOM, React Router, and React Query are peer
dependencies (plus dev dependencies for package tests) resolved and deduped to
each host's single workspace version.

**The export map is staged.** This is binding scope resolution:

- **PR 1** creates the package skeleton exporting **host, provider, scope, and
  package-resolution primitives only** — `ProductHost` types,
  `ProductHostProvider`, `ProductScopeBoundary`, `ProductAuthorityHandle`
  types, the entry-intent coordinator contract, and the proven `#product/*`
  mapping. There is **no `ProductClient` export in PR 1**.
- The candidate root split — a lightweight `ProductClient` gate plus a lazy
  `AuthenticatedProductClient` — is built **in place at stable Desktop-owned
  paths** during PR 1, consuming those primitives. The §8 performance fixture
  measures this in-place candidate.
- PR 1's `desktop: null` proof tests **host/provider/capability composition**,
  not a package-owned product mount.
- **PR 2** mechanically moves the proven candidate root into the package and
  only then adds the real `ProductClient`/`AuthenticatedProductClient`
  exports.

The mechanical asset move is part of PR 2: product SVG/PNG/JPEG/MP3 assets and
`assets.d.ts` move under product-client; genuinely native window/application
resources stay in Desktop; Vite `?raw` behavior is preserved for file icons
and the bundled agent catalog; `provider-registry.generated.json` moves to
product-client with `scripts/vendor-provider-registry.mjs` generating at the
new owning path; `catalogs/agents/catalog.json` stays the repo-level generated
source of truth and is imported, never copied; a build test bundles
representative `?raw`, image, audio, JSON, and repo-level catalog imports in
both Desktop and Web.

## 4. The one host contract

The host is one value in one provider (an authority sketch, not mandated
property names):

```ts
interface ProductHost {
  surface: "desktop" | "web";
  deployment: ProductDeploymentHost;
  auth: ProductAuthHost;
  cloud: ProductCloudHost;
  persistence: ProductPersistenceHost;
  links: ProductLinksHost;
  telemetry: ProductTelemetryHost;
  desktop: DesktopBridge | null;
}
```

One `ProductHostProvider`; nested groups document authority without many React
contexts; the object is not a service locator. `surface` is descriptive —
product behavior checks a real capability (`desktop !== null`, a server
capability, or a workspace capability), not `surface === "web"` scattered
through components. The host supplies no page/settings/chat/composer/workspace
render slots; the only UI wholly outside product-client is genuine host chrome
or transport entry UI (native window controls, a browser OAuth callback
spinner).

### 4.1 Deployment authority

Supplies the normalized API origin/configuration, the current deployment/cache
key, deployment-change observation, Desktop's optional connect/switch/reset
operation, and Web's fixed configured deployment. It does not hardcode server
capabilities — billing, SSO, gateway, hosted-mode, and other capabilities come
from server truth. No persistent deployment-UUID protocol exists; the
credential-free deployment key derives from the normalized API configuration.

### 4.2 Auth authority

```ts
type ProductAuthStatus =
  | "bootstrapping" | "anonymous" | "authenticated" | "unreachable";

type ProductAuthorityIdentity = Readonly<{
  deploymentKey: string;
  actor: { kind: "anonymous" } | { kind: "user"; id: string };
  generation: number;
}>;
```

`ProductAuthHost` exposes normalized status, principal, `authGeneration`,
`bindAuthority(expected)` returning a `ProductAuthorityHandle` (or `null` on
mismatch), `startSignIn`, and CAS `signOut(expected)`. The handle provides one
atomic fresh access-token + `credentialRevision` snapshot, atomic
register-and-replay `observeCredentialRevision`, and
`invalidateIfCurrent({credentialRevision, reason})`.

Binding constraints:

- product code never reads cookies, PKCE state, native vault entries, or raw
  refresh credentials; host bootstrap owns restoration and publishes `status`;
- `unreachable` is the normalized state for a transiently unavailable
  authenticated deployment: it retains the resolved principal and generation
  underneath and never participates in cache identity;
- long-lived Cloud/AnyHarness operations request one atomic token + credential
  revision snapshot through the bound handle — never separate reads or a
  token captured at connection creation;
- `credentialRevision` is a monotonic, non-secret transport refresh signal
  that advances when the access token is replaced without replacing the
  authority; it is never scope/query-key identity;
- a late operation from authority N can neither obtain N+1's token nor let an
  N-era rejection invalidate N+1, even for the same principal; a request also
  passes the `credentialRevision` it actually used, so a late 401 from token A
  cannot invalidate newer token B within the same authority;
- **one host-owned auth coordinator** serializes and compare-and-swaps every
  credential-changing bootstrap, sign-in, callback commit, refresh
  replacement, 401 invalidation, and sign-out against the applicable
  authority, credential revision, or sign-in transaction id. It is the only
  path to stored-credential writes/clears; raw Cloud middleware and stream
  code never mutate storage behind the auth store;
- `startSignIn` creates a credential-free transaction id bound to the expected
  deployment and starting authority; callback credential commit succeeds only
  while that transaction is current;
- `signOut(expected)` CASes against the expected authority; a late
  generation-N clear cannot erase generation N+1. Web additionally serializes
  cookie-changing responses so a late logout `Set-Cookie` cannot clear a newer
  login;
- only a commit that replaces session authority advances `authGeneration`;
  ordinary refresh keeps the generation and advances only
  `credentialRevision`; stale callback/logout/refresh results are discarded
  without storage or state mutation;
- Desktop's semantic deployment connect/switch/reset lives in the deployment
  group; Web omits those methods; the Desktop bridge does not own a duplicate
  deployment API.

### 4.3 Cloud transport authority

The host owns credential transport and exposes exactly one scoped Cloud SDK
client factory (`createScopedClient({deployment, authority})` returning a
disposable client handle). The product client owns Cloud queries, mutations,
workspace classification, gateway lookup, managed-cloud connection resolution,
product orchestration, and query keys. A host must not own a parallel
managed-cloud workspace resolver or a module-global Cloud client.
`ProductScopeBoundary` creates the client for the current authority and
disposes it on scope teardown; a client cannot outlive its ProductScope.

Organization identity is operation input, not mutable transport ambient
state: every owner-sensitive query/mutation captures one immutable
`CloudOwnerContext` (`personal` or `organization` + id) before creating its
query key and request, and passes that same value explicitly to header
construction. Middleware never consults a live organization getter; an
organization switch cannot turn an A-keyed operation into a request against B.

The Cloud SDK React provider never publishes its resolved client into the SDK
process-global singleton, and `useCloudClient()` fails closed when no provider
is mounted (both removed in PR 1). A legacy global API may remain for
out-of-scope non-React consumers during the migration, but ProductClient,
Desktop, and Web neither populate nor read it for authenticated product work.

### 4.4 Persistence authority

Typed read/write/remove for non-secret, device-local product state only. The
key set is typed and owned by product-client; arbitrary string access is not
part of the interface. Web uses browser persistence; Desktop's typed adapter
dispatches each key to its existing owner (Tauri Store or WebView
`localStorage`). No key silently moves between backends or is renamed: any
backend/key migration requires an explicit read-old/write-new transition,
idempotency and rollback tests, and a declared old-value retirement point. The
adapter stores no bearer tokens, refresh credentials, PKCE verifiers, native
credential material, or provider API keys.

### 4.5 Link/navigation authority and entry intents

Internal product navigation is shared React Router behavior. The links group
owns only host-differing actions: open an external URL, semantic
open-in-Desktop handoff, shareable-link generation for the current deployment,
system-browser open from Desktop, and host-decoded inbound deep links.

Inbound transport state crosses the boundary as a normalized, validated,
credential-free, one-shot `ProductEntryIntent` (SSO login intent, organization
invitation, workspace/workflow location, completed billing return). Rules:

- host callback/deep-link code validates and persists the intent into a
  durable FIFO of unacknowledged intents before publishing; a later arrival
  never overwrites an earlier one;
- `observePending` is one atomic replaying subscription: an intent published
  during subscription is delivered by replay or live event, never dropped
  between restore and subscribe; delivery is at-least-once;
- exactly one ProductEntryIntent coordinator lives above replaceable
  ProductScopes; it is the sole consumer, processes serially, and deduplicates
  by `intentId`; the owning workflow accepts idempotently by `intentId`
  before the coordinator acknowledges and removes the entry; unacknowledged
  work replays after scope replacement or process restart;
- Desktop ingress registers the live URL listener before draining the initial
  `getCurrent()` value, persists before notifying, and deduplicates overlap;
- every intent carries a normalized credential-free target deployment key; the
  coordinator dispatches only while that deployment is current; a
  foreign-deployment head item never starves later valid work — hosted Web
  acknowledges it as `handed-off` after a successful Desktop handoff or moves
  it to durable, user-recoverable quarantine;
- raw callback URLs, OAuth state, credentials, and arbitrary navigation
  strings never enter the product intent.

### 4.6 Telemetry authority

Product-client emits typed product events and errors. The host installs
Sentry/PostHog/native diagnostics, supplies release/runtime identity, and owns
vendor lifecycle; product state has no direct vendor SDK access. The telemetry
group supplies one narrow route-instrumentation component compatible with
React Router's `<Routes>` contract — the sole infrastructure render adapter —
so hosts wrap shared routes with their Sentry router instrumentation without
importing Sentry into product-client. Existing replay-masking and payload
restrictions continue to apply; moving a component authorizes no new payload
fields.

### 4.7 Desktop bridge

`desktop` is `null` or one typed bridge grouping actual native capabilities:
local runtime readiness/connection; repository/folder selection and worktree
actions; open/reveal path, editor, terminal, shell; local agent/provider
credential operations (product-user authentication credentials remain
exclusively `ProductAuthHost`-owned); native context/application menus, dock,
window operations; updater/version/relaunch; desktop worker and local
automation execution; SSH target/tunnel operations; scratch-file persistence;
diagnostics and support-attachment collection.

The bridge is demand-driven — a typed method is added only when moved product
code needs it — and never exposes generic Tauri `invoke`, raw command names,
or a filesystem primitive broad enough to bypass product policy. Desktop-only
product orchestration may live in product-client and call the bridge; raw
execution remains in `apps/desktop`.

## 5. Product scope and provider composition

### 5.1 Scope identity

Remote caches and live streams are scoped at least by **deployment +
authenticated principal (or explicit anonymous) + in-memory `authGeneration`**.
That tuple is exact: `bootstrapping` and `unreachable` never participate in a
cache key; a transiently unreachable authenticated authority retains principal
and generation; an unreachable client with no resolved authority mounts no
authenticated remote providers.

`authGeneration` is a process-local, monotonic **session authority epoch** —
not deployment identity or token version. It advances when anonymous becomes
authenticated (or the reverse), the principal changes, or logout/revocation/a
replacement login invalidates the prior session authority. It does not advance
on ordinary token refresh; routine Web token rotation updates transport
credentials without remounting the QueryClient or tearing down active
AnyHarness streams.

`cacheScopeKey` is never overloaded with workspace or materialization
identity; credentials and expiring gateway URLs never participate in semantic
cache identity.

### 5.2 Provider order

```text
Host bootstrap and auth transport
  -> ProductHostProvider
    -> ProductEntryIntentCoordinator (durable FIFO; survives scope replacement)
      -> lightweight ProductClient auth/readiness gate
        -> when authority is resolved:
          ProductScopeBoundary (deployment + principal/anonymous + auth generation)
            -> scope-owned QueryClientProvider
              -> scope-owned CloudClientProvider
                -> anonymous: shared login/join content
                -> authenticated: scope-owned AnyHarness client registry
                  -> shared AnyHarness runtime/workspace providers
                    -> lazy AuthenticatedProductClient
```

Mandatory properties: no module-global QueryClient in Desktop, Web, or
product-client; no Cloud React provider write to (or hook fallback through)
the Cloud SDK process-global client; no module-global AnyHarness client
registry or credential-bearing client cache; presentation states cannot churn
a retained authority's scope key; a scope change cancels or makes unreachable
old queries, streams, and connection completions; Cloud and AnyHarness
consumers see the same scope; providers are not copied per host; Web does not
mount the Desktop local-runtime subtree; teardown runs once and removes every
listener, timer, subscription, and stream owned by the prior scope.

### 5.3 Product state classes

| State | Owner | Lifetime |
| --- | --- | --- |
| Server entities and remote results | Query cache / owning SDK | Product scope |
| Active AnyHarness connection/stream | AnyHarness SDK React + scoped target/stream transition owner | Target slot + generation + product authority |
| Actor-sensitive selection, drafts, pending prompts, tabs | Product-client scoped store factories | Product authority; reset before replacement authority renders |
| Organization-sensitive client state | Product-client organization-scoped stores | Deployment + principal + organization |
| Workspace-local UI state | Product-client stores keyed by logical workspace id | Workspace within product authority |
| Non-sensitive device preferences | Product-client store + host persistence | Device |
| Auth secrets and pending OAuth state | Host auth transport | Host security rules |
| Native runtime/process state | Desktop host/bridge | Desktop process |
| Pure product decisions | `product-domain` or product-client `lib/domain` | Stateless |

Actor-sensitive stores are scope-owned factories instantiated under
`ProductScopeBoundary`; organization-sensitive stores are factories under a
nested organization boundary; workspace-sensitive stores are keyed/factored so
a delayed writer reaches only the old instance. A reset module-global
singleton is not sufficient — an old Promise can retain its setter and write
after rollover. Every asynchronous writer captures/checks its owning authority
epoch before emitting external side effects. Persisted device-global keys keep
Desktop's existing backend/key/schema through the mechanical move; actor-,
organization-, and workspace-sensitive persisted values are credential-free,
namespaced by declared lifetime, and removed/ignored on rollover. Old Web
stores receive no compatibility migration.

## 6. Routing, callbacks, and capability policy

### 6.1 Route ownership

One `BrowserRouter` per app; one shared product route tree. Hosts own routes
that terminate a transport protocol (Web OAuth/PKCE callback and auth error,
Web SSO-slug and invitation entry decoders, Stripe/billing return decoders,
Desktop protocol/deep-link ingress, development-only host diagnostics).
`ProductClient` owns the canonical shared routes:

```text
/login  /  /workflows  /workflows/:workflowId
/workspaces  /workspaces/:workspaceId  /settings?section=<sectionId>
```

This preserves Desktop's URL/state semantics: workspace selection reconciles
from `/workspaces/:workspaceId`, active sessions remain tab/store-owned, and
Settings sections remain query-string state overlaying the warm
`MainScreen`/workspace shell (a performance and stream-continuity invariant —
the shell stays mounted across authenticated route changes). Desktop's
host/legacy entrypoints (`/index.html`, `/setup`, `/settings/cloud` +
`/settings/billing` billing decoders, `/automations{,/:workflowId}` thin
redirects through the Web R+1 window, DEV-only `/playground/**`) are preserved
explicitly through the mechanical move.

Web permanently retains `/auth/callback`, `/auth/error`,
`/join/:organizationId`, and the `/settings/cloud` billing-return decoder
(handling `returnSurface=desktop` before navigating browser returns to shared
`/settings?section=billing`), so browser OAuth, SSO, invitations, and Desktop
checkout/portal returns need no flag day. Cutover release R adds a bounded
Vercel 307 redirect set before the SPA catch-all (`/settings/cloud` bypasses
it); the exact array and per-route dispositions are rollout detail in the
migration plan §10.3–10.4. Redirects are retained through R+1 and at least
seven days, then removed only after the producer ledger is rechecked. Every
inbound-URL producer (OAuth redirect configuration, Stripe return URLs, GitHub
App returns, invitation links, server-generated Web links, Desktop handoff
URLs) is audited against the producer ledger; external/deployed configuration
changes follow the rollout ledger's external-item sequencing (§10 below).

### 6.2 AnyHarness resolution

Normal product code never constructs `AnyHarnessClient`; it uses the shared
SDK React providers and hooks. The product client owns logical workspace
classification, materialization selection, Cloud workspace records, and shared
provider composition. Both hosts use one product-client gateway resolver for
managed cloud; Desktop additionally supplies local/SSH connection authority
through its bridge.

Credential-free connection identity is **target slot + target generation**:

```text
slot:  cloud:<deployment-key>:<logical-cloud-workspace-id>
       local:<desktop-runtime-slot-id>          # stable, never a PID
       ssh:<deployment-key>:<ssh-target-id>
gen:   cloud:<anyharness-workspace-id>:<runtime-generation>
       local:<process-generation>
       ssh:<tunnel-generation>
```

Runtime-tier SDK query keys use authority scope + slot + generation — never
`runtimeUrl`, token, or connection revision; workspace keys keep logical
workspace ids. A slot-owned connection-material coordinator shares normal
in-flight resolution, supersedes older attempts on forced refresh, and
CAS-installs on both connection-resolution revision and the observed
`credentialRevision` (delayed A is discarded and its waiters adopt B; a failed
latest attempt retries rather than installing older A). Managed connection
material remembers its `credentialRevision`; a revision advance marks material
stale and forces slot-owned refresh on the next operation/reconnect without
tearing down healthy streams. A generic transition boundary serializes
generation changes with atomic `register(authority, slot, generation,
resource)` — late old-generation registrations are rejected and closed; a
local-process or SSH-tunnel generation transition fans out to every workspace
attached to that slot and leaves unrelated slots alone. Clients carry
operation leases: same-generation material rotation retires the old client
(no new work, in-flight settles, released at zero leases); authority or
generation teardown force-closes every lease. Query/client eviction is never
accepted as stream teardown.

Web negative guarantees (test assertions, not hidden controls): `desktop` is
`null`; no local runtime bootstrap executes; no global local
workspace/repo/cowork inventory query executes; no local AnyHarness URL is
constructed; no direct SSH connection is attempted; no raw AnyHarness client
is created at a page or workflow callsite; selecting a server-visible local
record renders an honest Desktop handoff.

### 6.3 Capability policy

Capability checks derive from three sources — host/device (bridge present),
deployment/server (API-advertised capabilities), and the selected resource —
never one manually synchronized boolean object. Managed-cloud
create/open/resume, chat/transcript/config, files/changes/terminal/subagents,
cloud secrets/integrations/org policy, cloud workflow create/edit/run, and
billing/usage/plan settings are the same shared product on both hosts.
Local/SSH creation, local runtime inventory, native file/editor/terminal
actions, local agent credentials, native updater, and self-host deployment
switch are Desktop-only; Web hides them or offers a truthful Desktop handoff
(read-only server-visible summaries where the matrix allows). Controls are
functional or absent — no dead disabled controls for layout parity. Context
menus share product content; Desktop renders natively, Web renders a DOM menu
with native-only actions omitted.

## 7. Styling and assets

Desktop's rendered product is the visual source of truth.

- `apps/packages/design/src/css/product.css` is the shared Desktop-derived
  product stylesheet (created in PR 2 from `desktop.css`'s product selectors);
  `desktop.css` reduces to importing `product.css` plus genuinely native
  window-chrome overrides. One defined cascade, no duplicate import: Desktop
  `index.css` → `design/desktop.css` → `product.css` + native overrides; Web
  `index.css` → `design/product.css` + browser-host CSS.
- Both hosts set `document.documentElement.dataset.proliferateClient` before
  rendering; `product.css` may expose `desktop:`/`web:` variants from that
  marker for genuine visual differences only — never to hide controls whose
  hooks/queries would still execute.
- The Tailwind `@source "../../../product-client/src"` line is added **in
  PR 1** together with a fail-closed assertion; without it, classes in moved
  JSX are silently omitted from both production bundles.
- The `product.css` export-map entry and copier proof, appearance
  initialization (synchronous pre-render initializer called by both host
  mains; CSS default equals product default), fonts/assets ownership, and
  durable shared test IDs move with product-client per the rollout detail.
- No Web-specific restyling during cutover; Tauri window chrome and macOS
  safe-area elements remain Desktop host UI.

## 8. Hosted Web performance budget

PR 1 includes a feasibility build before the PR 2 freeze: the in-place
candidate root (lightweight gate + lazy authenticated root, at Desktop-owned
paths) is mounted in a deterministic browser-safe host and measured at
`/login` and authenticated `/`, using `data-product-ready="login"` and
`data-product-ready="authenticated-home"` markers, Vite manifest generation,
and a deterministic route-asset measurement (fresh-cache Playwright, gzip
level 9 for JS/CSS, emitted bytes for fonts/images/audio, only assets
requested before readiness).

Acceptance targets for that build: login JS 525,000 B; login CSS 45,000 B;
login fonts/images 100,000 B; login total 670,000 B; authenticated `/` total
1,750,000 B; Web host overhead ≤5% over the PR 2 ProductClient home fixture.
The byte targets must be proven, or an evidence-backed replacement budget must
be committed under explicit spec review, before PR 2 is authorized — never a
silent ratchet. Independently of exact numbers, login/callback entries exclude
authenticated product roots, Monaco, Shiki grammars/themes, xterm, editors,
and non-entry routes. PR 2 commits the moved fixture's measured asset ledger;
PR 4 enforces the committed budgets against the real Web host.

## 9. Lifecycle ownership

Every root effect has an assigned owner:

- **Host bootstrap/process lifecycles** stay app-owned: API/deployment
  configuration bootstrap, Web cookie/PKCE transport, Desktop vault/protocol
  transport, vendor telemetry installation, startup diagnostics, Tauri
  reload/context-menu policies, sidecar process bootstrap and raw health
  transport, window/process listeners.
- **Shared product lifecycles** move with product-client: entry-intent queue
  coordination above ProductScope, organization selection, session/workspace
  selection and intent dispatch, query/stream-connected behavior, preference
  hydration/persistence orchestration, home deferred launches, support UI
  state, command/shortcut interpretation, Cloud workspace and workflow
  orchestration.
- **Desktop-capability product lifecycles** live in product-client and call
  the optional bridge (not mounted when the bridge is absent): local agent
  reconcile/auth sync, local automation execution, worker enrollment tied to
  auth transitions, updater presentation, product-aware native menu dispatch,
  worktree preference sync, native support/diagnostic collection.

Invariants preserved from the current Desktop root: auth bootstrap completes
its initial decision before runtime-dependent work assumes a principal;
runtime bootstrap starts only after auth leaves `bootstrapping`; worker
enrollment observes the authenticated→anonymous transition; preference
hydration completes before default-sync effects write; updater/menu/deep-link
/global dispatch listeners mount once; every timer/listener/stream has
deterministic cleanup; the workspace shell stays warm across routes;
provider/scope teardown cannot let a stale completion mutate the next actor.

## 10. Migration governance

The migration executes as a serialized chain with binding governance. The
live chain state, ledgers, and templates are in the
[rollout ledger](../../developing/deploying/web-desktop-unification-rollout.md);
step-by-step execution recipes remain rollout detail in the TBD migration
plan. The governance rules themselves are contract:

### 10.1 Checkpoint sequence

| Checkpoint | Outcome |
| --- | --- |
| PR 0 | Cache/runtime authority fencing: 0a landed (`bdd11aa5a`); 0b adds same-user auth generation + credential-mutation CAS; 0c owns AnyHarness clients, streams, and target replacement. |
| PR 1 | Desktop consumes the new host/scope seams in place; primitives-only package skeleton; candidate root split at Desktop-owned paths; enforcement generalized; ledgers committed. |
| Pre-PR-2 cleanup | Embedded Tauri browser feature and callers removed (separately reviewable). |
| PR 2 | Freeze-gated mechanical move of Desktop product source into product-client; Desktop mounts the package `ProductClient`. |
| PR 3 | Delete the old Web product; retain a buildable thin browser host. Review-only. |
| PR 4 | Web host adapters + mount the same `ProductClient`. Review-only. |
| Landing | One cutover landing merges the reviewed PR 3 + PR 4 work; docs-only post-cutover verification seals completion. |
| Follow-up | Self-hosted Web against the same host contract (explicitly unplanned here). |

PR 1 is behavioral boundary work without path churn; PR 2 is path churn
without behavior work; PR 3/PR 4 are separate review units that ship as one
Web deploy unit.

### 10.2 Sliding two-PR stack and review/merge ownership

The chain runs as a sliding two-PR stack: at most two PRs with active writers
exist at any time; one writer per phase; the orchestrator — never an
implementer — review-accepts, merges, and marks ready. A child phase forks
from its parent's immutable review-accepted head with `PARENT_AT_FORK`
recorded durably (orchestrator log + child PR body) and asserted at fork.
After the parent squash-merges, the child restacks with
`git rebase --onto <target> $PARENT_AT_FORK`, proves equivalence (identical
base trees ⇒ pre/post child tree equality; changed base ⇒ `git range-diff`
against the accepted evidence branch with independently reviewed conflict
resolutions and pre/post patch hashes), force-with-lease pushes, reruns CI,
and is independently re-reviewed. Docs gates and the freeze gate deliberately
collapse the stack to main.

Reviewed states are preserved as plainly named evidence branches under
`refs/heads/wdu-evidence/**` (fetchable with ordinary `git fetch origin`,
never force-pushed). Evidence branches are deleted only AFTER the docs-only
post-cutover verification PR (Phase V) has merged, and only according to the
branch index committed in its release record — never earlier at any
intermediate checkpoint. Commit SHA, tree SHA, and stable patch hash are
recorded in the PR body/ledger. Consumers fetch and assert existence +
recorded-hash equality before comparing. Committed ledgers contain no secret values — secrets are
referenced by name/location only.

### 10.3 Intake and freeze gates

The PR-1 and PR-2 intake gates are committed docs-only ledger phases
(`wdu/intake-pr1`, `wdu/intake-pr2-freeze`) appending binding snapshots to the
rollout ledger — never to `specs/tbd/`. The PR-1 snapshot records the
then-current main SHA, the accepted PR 0c head (the PR 1 code baseline), and a
disposition for every live conflicting branch/worktree/PR. The PR 2 freeze
requires **both** an explicit dated user signal and the merged freeze ledger
(timestamp, base SHA, freeze owner, planned duration, disposition/retargeting
for every conflicting Desktop branch/worktree). Freeze validity is revalidated
three times — at PR 2 launch, immediately before its review-acceptance, and
immediately before its merge — each time re-running the live conflict
inventory; any expiry or new undispositioned conflict hard-stops until a
renewed signal plus a committed ledger amendment lands and the PR is
re-reviewed. PR 1 and PR 2 verify the committed ledger evidence on main, not
transcripts.

### 10.4 Web cutover landing

PR 3 (`delete legacy Web`) and PR 4 (`Web ProductClient`) are permanently
review-only PRs that are **never merged**. The landing branch
(`wdu/web-cutover-landing`) is created from fresh main and **cherry-picks
exactly the recorded ordered commit list `G_BASE..H_HEAD`** (immutable
accepted heads preserved as evidence branches) — never an unspecified merge of
heads. Equivalence is proven before merge: exact tree equality when the
landing base equals the PR 3 base; otherwise recorded stable patch hashes plus
a `range-diff` manifest with independent review of every non-identical hunk
and conflict resolution. Drift, a newly detected surface, or a
release-coordinate issue returns the work to the PR 4 writer, whose
re-accepted head lands on a new versioned evidence branch and forces the
landing to be rebuilt and re-proven. The landing runs combined CI, the full
PR 4 gate battery, and a pre-merge completeness battery (Mobile DOM-boundary +
typecheck; all affected SDK/package builds and tests) before its single merge;
PR 3/PR 4 then close as review-only records.

### 10.5 Deployment selection and external-configuration ordering

Deployment selection is modeled as **three reviewed sets**, produced during
PR 4 review and re-asserted at landing time from the real last-successful
staging/production deploy bases:

- **DETECTED** — the deploy-surface detector's output over the real bases
  (plan-job outputs prove this set only, never lane execution);
- **EFFECTIVE_STAGING** — the automatic staging lanes actually expected to
  execute after environment gates (proven only by per-lane enabled/skipped
  evidence);
- **PRODUCTION** — the exact explicit `only_surfaces` set for the canonical
  promote workflow.

Every DETECTED surface is explicitly dispositioned: PRODUCTION; reviewed
staging-only (ungated lanes — Server, Web, and E2B — cannot be suppressed on
the automatic path, so an ungated exclusion is reviewed staging-only or the
chain stops); gate-suppressed (only actually gated lanes: Mobile build via
`MOBILE_DEPLOY_ENABLED`, Desktop via `DESKTOP_DEPLOY_ENABLED`, Workers via
`WORKERS_DEPLOY_ENABLED`, and LiteLLM via `LITELLM_DEPLOY_ENABLED` in
`.github/workflows/_deploy-litellm.yml`; gate lists are verified against the
actual workflow files, never assumed); or a separate reviewed
artifact-release disposition (a detected Runtime surface has no hosted deploy
lane). If Desktop is included, the release-prep version bump
(covering every canonical owning coordinate) is a distinct reviewed commit
inside the replay list, with the exact-SHA tag and a new draft release created
and published only at production promotion per the canonical desktop release
procedure.

The landing order is binding: a landing hold explicitly blocks other main
merges, main-CI reruns/manual dispatches, AND manual `deploy-staging.yml`
`workflow_dispatch` runs (the workflow exposes an independent dispatch
trigger); pre-override quiescence is proven under that hold — draining every
queued/running Deploy Staging run regardless of trigger source as well as
qualifying main-CI runs and their source correlations across a bounded
propagation barrier — before the reviewed staging environment-gate overrides
are set and read back; the merge happens only then; merge-SHA tree equality
plus green main CI gates the automatic staging path; the automatic staging
run is verified to have executed exactly EFFECTIVE_STAGING; gates are
restored to their recorded prior state with the restoration read back and
verified; and only then is the exact landing merge SHA promoted to production
with the exact PRODUCTION `only_surfaces` and
`require_staging_success=true`.

**Override cleanup invariant.** From the first override mutation onward, every
failure, non-success, or unverifiable outcome enters a finally-style cleanup:
restore EVERY gate to its recorded prior value or prior absence, read the
restoration back and verify it, then release the landing hold and halt —
except as the terminality rule below requires the hold to be kept longer
(any cancellation-requested run and any abnormal or unverifiable staging
execution, not only an unexpected Deploy Staging run). The cleanup covers a
partial override write or read-back failure,
a failed merge, a merge-SHA tree mismatch, an exact-landing-SHA main CI
failure/cancellation/timeout, an automatic staging
failure/cancellation/timeout, an unexpected lane execution, an unexpected
Deploy Staging run from any trigger source (a manual `workflow_dispatch` or
any run other than the expected exact-landing-SHA automatic run), and any
state that cannot be verified. If restoration itself fails, production
promotion is hard-stopped and the landing hold remains in place while the
failure is escalated — the hold is never released over unrestored gates. Only
verified automatic staging success plus verified gate restoration may proceed
to production promotion.

**Terminality rule: cancellation is not terminal proof, and the hold outlives
unproven runs.** A cancellation request does not prove a run stopped, and a
cancelled run may already have acted. Once overrides are armed, gate
restoration (with read-back verification) remains prompt in every case, but
the landing hold may release only after ALL of the following are proven:
every cancellation-requested run — a source main-CI run or any deploy run —
is confirmed terminal; for EVERY cancellation-requested source main-CI run —
regardless of its terminal conclusion, including one that wins the race and
completes SUCCESS despite the cancellation request — every downstream Deploy
Staging run it emitted is enumerated and accounted for across a bounded
event-propagation barrier (zero emissions is acceptable; each emitted run
routes through the abnormal-staging clause of this rule and must be fully
handled), with the barrier proving that no late or otherwise unaccounted
downstream emission remains before hold release; and every abnormal, failed,
cancelled, timed-out, or
unverifiable staging execution — including the expected exact-landing-SHA
staging run executing unexpected lanes — is confirmed terminal AND its
per-lane/deploy-summary/log evidence proves it produced no side effects, or
every possibly affected staging surface is restored to its recorded
pre-landing staging baseline with artifact/health/routes re-verified. Any
unproven terminality, any unaccounted, late, or unhandled downstream
emission, and any unproven side-effect assessment or recovery retains the
hold and hard-stops production with escalation. A fully
proven failure path releases the hold only into halted-for-review, never into
promotion. The failure and recovery evidence is recorded per the standing
failure-evidence requirements (Phase V / incident record). The full mechanics
live in the rollout ledger.

**External configuration is mutated only after the landing merges, every
PRODUCTION surface deploys at the exact merge SHA, and old + canonical routes
verify.** Before the merge, external items are inventoried, verified,
classified, and recorded only. After deploy verification, items are applied
one producer at a time: source change → activation (redeploy/restart/rebuild
at the same landing SHA per the item's recorded mechanism) → secret-safe
live-consumption proof → that producer's smoke. A source edit without
activation is never an update. **Any failure after a producer's
source-of-truth mutation** — a failed or unverifiable activation, a failed or
unverifiable live-consumption proof, or a failed smoke — triggers immediate
source restore, re-activation at the same landing SHA, live rollback proof,
the item's mapped recovery smoke, recorded evidence of both the failure and
the recovery, and a halt. If the recovery itself cannot be proven, the
sequence remains halted until it is. An uncertain source-write outcome — a
write that fails, times out, or returns an unverifiable result — is treated
as a possible mutation, and a single re-read cannot rule out a late
asynchronous apply. Proven-unchanged requires either an authoritative
terminal status for the write operation PLUS a confirming read, or a bounded
settling barrier with repeated authoritative reads proving the prior value
remained stable throughout; with that proof, record the evidence and halt
before continuing. Without it, treat the item as changed/unverifiable and run
the full recovery above while halted. Every item — changed or unchanged —
closes only with live proof plus a successful mapped smoke. The per-item
schema is defined in the rollout ledger.

### 10.6 Release-surface closure and the Phase V release record

Before the accepted PR 4 head freezes, Phase H inventories and explicitly
dispositions every required user-facing release surface: the landing page,
public docs, changelog/release notes, in-app release notes/copy,
install/download surfaces, support/runbook surfaces, and any further release
surface the sweep discovers. Each disposition is exactly one of
update-in-this-landing (the change enters the replay list),
update-post-landing (with a named owner and deadline), or no-change-needed
(with the reason recorded). These dispositions and their evidence carry into
the landing's release plan and the Phase V record.

The migration completes only when the docs-only post-cutover verification PR
(Phase V) commits the immutable release record at
`specs/developing/deploying/web-desktop-unification-release-record.md` and
merges. That record seals, at minimum:

- the exact landing merge SHA and per-surface deployed SHAs, with the reviewed
  DETECTED / EFFECTIVE_STAGING / PRODUCTION sets and per-surface dispositions;
- the landing-ordering evidence: quiescence proof, prior gate state, override
  set/read-back, merge-SHA tree-equality + main-CI proof, EFFECTIVE_STAGING
  per-lane execution proof, verified gate restoration, and the production
  promotion record (`only_surfaces`, `require_staging_success=true`,
  non-dry-run deploy-summary `headSha` evidence per surface, and the
  deploy-run links for every staging and production run cited);
- per-surface artifact/health verification and old + canonical inbound route
  verification;
- each release-surface disposition and its outcome/evidence (if Desktop
  shipped: the released version and exact SHA, the exact-SHA tag, the
  published GitHub Release, and stable updater-manifest verification at that
  version/SHA);
- the complete external-item table: for every item, changed or unchanged, its
  secret-safe source location, actual before value, actual after value
  (secrets redacted by name/location, never by value), required-change
  classification, activation mechanism used, secret-safe live-consumption
  proof, and who applied the change and when — plus, for every mapped smoke,
  the flow run, its result, and its timestamp (explicit item→smoke mapping
  wherever a shared smoke covers multiple items);
- all failure and recovery evidence (source restores, re-activations, live
  rollback proofs, recovery smokes, resolutions);
- the requirement-by-requirement audit against this spec's definition of done;
- the `wdu-evidence/**` branch index (names + recorded hashes) authorizing
  their cleanup.

No evidence branch is deleted before Phase V merges. There is no
recovered-stable completion path: a halted external sequence blocks
verification, evidence-branch cleanup, and completion.

### 10.7 Rollback

PR 0b, PR 0c, the docs/intake phases, PR 1, the browser removal, and PR 2 are
each independently reversible merged units at their boundary. PR 3/PR 4 never
merge (nothing to roll back on main). The cutover landing is the single
functional Web-cutover rollback unit on main — but only until external
mutations begin; after any external item changes, rollback must also restore
each changed item's recorded previous value (with re-activation), or
intentionally retain the compatibility redirects until every changed producer
is rolled back. No permanent old/new runtime flag exists as rollback
infrastructure. If a Desktop behavior cannot be preserved through the bridge,
stop and model the missing narrow capability — never move raw Tauri access
into product-client. If Web cannot execute an action, show a truthful
absence/handoff — never a Web-specific imitation with a second product owner.

## 11. Enforcement and verification

Both frontend enforcement scripts (`scripts/report_frontend_structure.py`,
`scripts/check_frontend_boundaries.py`) are generalized in PR 1 from
Desktop-only traversal/predicates to an explicit ownership-root/rule table
covering Desktop and product-client (and Web where a rule applies), with
plant-a-violation tests per root/rule pair and deliberately migrated
allowlists. The Tailwind source assertion and the ProductClient
performance-fixture check fail loudly at the same boundary.

The move gate includes these literal scans (all empty), plus both scripts'
AST/path checks:

```bash
rg -F '"@/' apps/packages/product-client/src
rg -F '"#product/' apps/desktop/src apps/web/src
rg -F '#product/' apps/desktop/dist apps/web/dist
```

Verification tiers: shared Playwright journeys run one journey body under
Desktop web-renderer and hosted-Web fixtures (host fixtures own only
bootstrap/auth and unavailable-capability expectations); a native Desktop lane
remains required for Tauri-only operations; isolated Desktop profiles are
exercised at PR 0b, PR 0c, PR 1, and PR 2 (the PR 2 profile includes
self-host server reconnect, relaunch, and keychain credential preservation);
PR 2 carries a CSS/Tailwind visual baseline proving unchanged Desktop
rendering; CI rejects a production Web artifact without the ProductClient
mount. The focused unit/component test matrix and tier ownership are rollout
detail in the migration plan §18; the canonical release-test inventory remains
owned by `specs/developing/testing/`.

## 12. Definition of done

Ownership: `@proliferate/product-client` is the connected shared DOM product;
Desktop and Web import and mount the same `ProductClient`; `product-surfaces`
remains a separate package that `product-client` may consume; each app contains only host ownership;
Mobile imports remain unchanged and DOM-free.

Behavior: Desktop's visual/behavioral baseline is preserved, including local,
direct SSH, managed-cloud, native settings, updater, and self-host connection
paths; Web exposes the same managed-cloud product experience, never attempts
local runtime discovery, and truthfully hands off unsupported actions; cloud
chat/transcript/config/files/terminal behavior has one SDK React owner; the
warm workspace shell and route continuity remain intact.

Security and state isolation: auth secrets remain host-owned; Web bearer
tokens are memory-only in production; connection code requests fresh tokens
through an authority-bound handle; delayed old-authority work cannot read,
overwrite, clear, or invalidate a replacement authority for the same
principal; no cache, stream, draft, prompt, tab, or selection crosses
deployment/actor/authority-generation scope; organization-sensitive state is
keyed/reset by organization; credentials are absent from query/cache identity;
runtime query identity uses target slot/generation; no module-global
QueryClient, process-global Cloud client publication/fallback, or
bearer-keyed AnyHarness client map remains.

Deletion: old Web polling/raw AnyHarness client, product
stores/controllers/pages, duplicate Desktop copies, the embedded Tauri
browser, any generic Tauri bridge, and every permanent compatibility
flag/wrapper/duplicate mutation owner are gone.

Verification: both apps build and typecheck; moved tests pass under
product-client; Desktop's full relevant suite passes; shared Playwright
journeys pass in both host lanes; native smoke covers Tauri-only boundaries;
isolated profiles were exercised at the required checkpoints; Web login/home
stay within the committed evidence-backed budgets with ≤5% host overhead; the
chain's ledgers (host-dependency, store-lifetime, move-manifest, producer,
restack, replay, release record) are durable and zero-unclassified; the
post-cutover verification PR is merged.

## 13. Migration exceptions and current state

- PR 0a is landed (`bdd11aa5a`, PR #1144); PR #1143 (workflows authoring V1)
  is merged. Every other checkpoint is pending; the code on main does not yet
  implement this contract's host boundary, scope ownership, or package. The
  rollout ledger's chain-state section is the live record.
- [`web-cloud-local-parity.md`](web-cloud-local-parity.md) still describes the
  superseded separate-controller model for some surfaces; PR 1 (and the PR 2
  move) reconcile it and the frontend structure guides listed in the migration
  plan §20. Until then, this spec wins on any conflict about connected-product
  ownership.
- The old Web product under `apps/web/src` remains live until its checkpoint
  deletes it, and `product-surfaces` stays a separate consumed package; no new
  product behavior may be
  built in the old Web controllers, and any feature adding a genuinely
  host-specific operation extends the one host contract narrowly with both
  positive and negative host tests.

## Related docs

- Binding execution/freeze ledger:
  [`../../developing/deploying/web-desktop-unification-rollout.md`](../../developing/deploying/web-desktop-unification-rollout.md)
- Rollout history/execution recipes (non-authoritative):
  [`../../tbd/web-desktop-unification-migration.md`](../../tbd/web-desktop-unification-migration.md),
  [`../../tbd/web-desktop-unification-intake-ledger.md`](../../tbd/web-desktop-unification-intake-ledger.md)
- Frontend structure: [`../structures/frontend/README.md`](../structures/frontend/README.md),
  [`../structures/frontend/packages/README.md`](../structures/frontend/packages/README.md)
- SDK ownership: [`../structures/sdk/README.md`](../structures/sdk/README.md)
- CI/CD and release: [`../../developing/deploying/ci-cd.md`](../../developing/deploying/ci-cd.md)
- Testing standard: [`../../developing/testing/README.md`](../../developing/testing/README.md)
