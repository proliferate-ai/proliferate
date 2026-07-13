# Web/Desktop Product Client Unification

Status: non-authoritative rollout history and execution detail. The settled
contract has been promoted to
[`../codebase/features/web-desktop-client-unification.md`](../codebase/features/web-desktop-client-unification.md)
(canonical; it wins any conflict with this file), and the binding
execution/freeze ledger lives at
[`../developing/deploying/web-desktop-unification-rollout.md`](../developing/deploying/web-desktop-unification-rollout.md).
This file retains the migration's execution recipes, inventories, and tables
as rollout detail only. Do not cite it as the source of truth for code review
or release readiness.

Scope: the DOM product in `apps/desktop`, `apps/web`, and
`apps/packages/**`, plus the narrow authority/lifecycle corrections required in
`anyharness/sdk-react` and `cloud/sdk-react`. Mobile product behavior is
explicitly outside this migration and must remain green while shared SDK
providers are corrected.

## 1. Outcome

Desktop and Web will render one connected product implementation:
`@proliferate/product-client`.

Desktop is the visual, behavioral, and state-management source of truth. The
current Web product implementation is not a second source to reconcile. It is
deleted in the Web cutover stack and replaced by the Desktop-derived product
client in the same combined mainline landing.

At the end:

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
- the existing `product-surfaces` package is absorbed by and replaced with
  `product-client`; there are not two connected shared-product packages.

The concise mental model is:

```text
Desktop native host ----\
                         +--> one ProductClient --> Cloud SDK React
Web browser host --------/                      \--> AnyHarness SDK React
```

The hosts answer questions such as "how do I authenticate here?", "can this
device access a local runtime?", and "how do I open this link?" They do not
reimplement product behavior.

### 1.1 Cutover in one screen

| Checkpoint | Outcome |
| --- | --- |
| PR 0 | Finish cache/runtime authority fencing (`0a` landed; `0b` adds same-user auth generation and credential-mutation CAS; `0c` owns AnyHarness clients, streams, and target replacement). |
| PR 1 | Make the current Desktop product consume the new host/scope seams while its files stay in place. |
| Pre-PR-2 cleanup | Remove the live embedded Tauri browser feature and its callers; it is intentionally not bridged or moved. |
| PR 2 | Mechanically move Desktop product source into `product-client`; Desktop mounts the package completely. |
| PR 3 | Delete the old Web product implementation while retaining a buildable thin browser/auth host. |
| PR 4 | Implement that Web host's adapters and mount the same `ProductClient` completely. |
| Follow-up | Specify and ship self-hosted Web against the same host contract. |

PR 1 contains behavioral boundary work without path churn. PR 2 contains path
churn without product behavior work. PR 3 and PR 4 remain separate review
units but ship as one Web deploy unit.

## 2. Decisions

These choices are closed for this migration.

1. **Desktop is the baseline.** Preserve its UI, interaction model, stores,
   warm workspace shell, and product workflows. This is an extraction and
   host cutover, not a redesign.
2. **The package is `@proliferate/product-client`.** Rename/absorb
   `@proliferate/product-surfaces`; do not expand `product-surfaces` under its
   old meaning and do not keep both packages permanently.
3. **The connected product is shared.** The package owns React pages,
   product routes, connected hooks, scoped stores, lifecycle orchestration,
   Cloud SDK React wiring, and AnyHarness SDK React wiring.
4. **There is one composite host contract.** There will not be separate
   `auth-host`, `runtime-host`, `updater-host`, and similar provider trees.
   The one host object has a few typed, nested capability groups.
5. **Product routes are shared.** Each app creates its browser router and owns
   raw transport callback entrypoints. `ProductClient` owns the authenticated
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
    stores, controllers, and ordinary product aliases may be deleted. A small
    one-release redirect set exists only to order external/deployed URL
    producers safely; it is not a second product or feature flag.
11. **Self-hosted Desktop remains supported.** A self-hosted Web distribution
    is a follow-up. The contract must allow one, but it is not an acceptance
    criterion for this cutover.
12. **Mobile is not involved.** Mobile continues to consume only its allowed
    SDKs, `product-domain`, and native design layer.
13. **The embedded Tauri browser is not preserved.** A named cleanup lands
    before PR 2 and removes the live workspace browser panel, tab/actions, raw
    webview access, and their callers. It is not added to the Desktop bridge or
    moved into product-client.
14. **The cache-scope correction lands first.** Commit `bdd11aa5a` landed the
    SDK/query-key foundation. A follow-up adds same-principal session authority
    generation plus credential-mutation ordering; an SDK/Desktop follow-up
    removes the credential-keyed global AnyHarness client map and adds
    target-generation/client/stream lifecycle ownership. The
    in-place Desktop restructuring then adds the full ProductScopeBoundary
    before source moves. Product-client does not copy either global cache
    pattern into a shared package.
15. **Host seams are separated from file movement.** Desktop adopts the host,
    bridge, and scoped-provider model while source paths remain stable. Only
    then does a quiet-window PR mechanically move product source.
16. **Each host marks its surface before rendering.** Both hosts set
    `data-proliferate-client="desktop|web"`. Shared Tailwind variants may use
    that marker for presentation, while capability logic remains structural
    and may not be implemented as CSS hiding.
17. **AnyHarness clients are scope-owned.** The SDK React module-global client
    map keyed by raw bearer token is removed before source movement. Product
    authority owns a bounded client registry; target-generation changes use a
    credential-free connection identity and a generic transition boundary for
    Cloud, local, and SSH runtimes.

## 3. Non-goals

This migration does not:

- redesign Desktop;
- preserve the current Web UI or its URLs;
- make Mobile render DOM product code;
- build self-hosted Web deployment/configuration;
- invent a new deployment identity protocol or `/meta` handshake;
- redesign every persistence schema;
- duplicate or redefine the canonical Tier 2/3/4 release-test inventory owned
  by `specs/developing/testing/`;
- replace the Cloud or AnyHarness SDKs;
- build a generic plugin system for host behavior;
- carry old and new product paths behind a permanent feature flag;
- split every large Desktop module merely because it is being moved.

The migration preserves ownership-correct lower packages. In
particular, `product-ui`, `product-domain`, `ui`, and `design` stay separate.
They can be consolidated later only for a concrete reason.

## 4. Why the current model must change

The repo currently has three connected DOM product implementations:

- the full Desktop product under `apps/desktop/src/**`;
- a much smaller, independent Web product under `apps/web/src/**`;
- a narrow connected Cloud surface package under
  `apps/packages/product-surfaces/src/**`.

That shape creates duplicate owners. The duplication is already material:

- Web chat constructs raw `AnyHarnessClient` instances and polls events rather
  than using Desktop's SDK React streaming path;
- Web has independent transcript, composer, optimistic-prompt, configuration,
  and session stores;
- Web and Desktop have separate route trees and product shell behavior;
- Web's Cloud/auth provider owns a module-global QueryClient;
- the existing Web workspace connection hook is not the path used by its chat
  implementation;
- Web behavior therefore cannot be made trustworthy by sharing a few visual
  components.

The old architectural formulation—shared presentation with separate Web and
Desktop controllers—is explicitly superseded. Pure shared presentation is
still useful, but it sits below a single shared connected product.

This plan also supersedes the relevant ownership assumptions in the current
`web-cloud-local-parity.md` draft: separate connected controllers, Web-specific
product screens, Mobile participation, and Web URL compatibility are not part
of this migration.

## 5. Terms

**Product client**
: The connected DOM application: pages, shell, product routes, components,
  hooks, product stores, product lifecycles, Cloud SDK React consumers, and
  AnyHarness SDK React consumers.

**Host**
: The small Desktop or Web layer that owns bootstrap and access to external
  systems that differ by deployment surface.

**Deployment**
: The Proliferate API/control-plane instance to which the client is currently
  connected. Hosted Web has one configured deployment. Desktop may switch to a
  self-hosted deployment.

**Product scope**
: The cache and lifecycle boundary for the current deployment, explicit actor
  (authenticated principal or anonymous), and in-memory authority generation.
  When any changes, old remote state and live work must not leak into the new
  scope. Presentation/transport statuses such as `bootstrapping` and
  `unreachable` are not scope identity.

**Runtime target**
: The AnyHarness process that owns a workspace materialization: Desktop local,
  managed cloud, or direct SSH. A host's device capabilities determine which
  target kinds it can command.

**Server-visible local metadata**
: Cloud/control-plane records describing work that runs on another user's
  Desktop. Web may show these records, but that does not grant Web a route to
  the local AnyHarness process.

## 6. Target ownership

### 6.1 Target tree

The exact internal domain folders may continue to evolve under the frontend
structure rules. The ownership boundary is fixed:

```text
apps/packages/product-client/
  package.json
  src/
    ProductClient.tsx              # lightweight auth/product gate
    AuthenticatedProductClient.tsx # route-lazy connected product
    app/
    pages/
    components/
    hooks/
    stores/
    providers/
    config/
    copy/
    assets/
    lib/
      domain/
      workflows/
      infra/
    host/
      product-host.ts
      ProductHostProvider.tsx

apps/desktop/src/
  main.tsx
  App.tsx                       # host callbacks + ProductClient mount
  host/
    desktop-product-host.ts
  bootstrap/
  auth/                         # native auth transport and callback ingress
  telemetry/                    # native vendor/runtime installation
  lib/access/tauri/**           # raw Tauri boundary
  native-lifecycle/             # process/window effects that do not own product state
  index.css                     # host-only/native CSS

apps/web/src/
  main.tsx
  App.tsx                       # browser callbacks + ProductClient mount
  host/
    web-product-host.ts
  config/env.ts
  auth/                         # browser session, PKCE, callback transport
  telemetry/                    # browser vendor/runtime installation
  index.css                     # host-only/browser CSS
```

This is an ownership map, not a demand to rename every file during the move.
PR 2 must preserve Desktop's existing domain/responsibility taxonomy where
it is already valid. Structural cleanup that is unrelated to the host boundary
can happen afterward.

### 6.2 Dependency direction

```text
apps/desktop ----\
                  +--> product-client --> product-ui --> ui --> design/dom
apps/web --------/             |
                               +--> product-domain
                               +--> cloud-sdk / cloud-sdk-react
                               +--> anyharness/sdk / anyharness/sdk-react

apps/mobile --> product-domain + design/react-native + SDKs
```

Rules:

- `product-client` imports neither app.
- `product-client` imports no Tauri package or Desktop raw-access file.
- `product-client` imports no browser auth-cookie, PKCE, or vendor telemetry
  implementation.
- apps may import only public product-client entrypoints, not its internal
  stores and hooks.
- `product-ui` remains props-in/callbacks-out presentation.
- `product-domain` remains React-free and Mobile-safe.
- there is no app-local copy of a product-client store or controller after its
  cutover.
- imports remain direct; the migration does not create convenience barrel
  files.

### 6.3 Import-path rule during the move

Desktop's `@/` alias currently means `apps/desktop/src`. Those imports cannot
be moved unchanged into a package because `@/` is Desktop-owned and Web has no
matching `@/` alias today.
The decision is to use Node package imports inside product-client:

```json
{
  "imports": {
    "#product/*": "./src/*"
  }
}
```

Rules:

- moved product-client internals rewrite `@/...` module specifiers to
  `#product/...`;
- retained Desktop host files keep `@/...`;
- Desktop and Web import only public
  `@proliferate/product-client/<entrypoint>` exports;
- do not add app-level Vite aliases or TypeScript `paths` for `#product`;
- `#/*` and `#/...` are invalid Node package-import names and must not be used;
- use an AST/module-specifier codemod, not a blind text replacement (the repo
  contains unrelated `@@/` regex text);
- TypeScript, Vite, and Vitest must all resolve the package mapping in PR 1
  before the mechanical move starts;
- post-move scans reject `@/` in product-client, `#product/` in either app, and
  unresolved `#product/` text in final bundles.

### 6.4 Package build contract

`product-client` is private application source, not a reusable published UI
library. It contains code-split pages, CSS, and product assets (including the
Desktop file/connector icon sets). The simplest target is therefore a
source-consumed workspace package:

- its public export map points at the small set of source entrypoints the hosts
  need. The map is staged: in PR 1 it exposes host, provider, scope, and
  package-resolution primitives plus their types only; the real
  `ProductClient`/`AuthenticatedProductClient` exports are added in PR 2 when
  the proven candidate root moves into the package;
- Desktop and Web Vite compile the same source in their own bundles;
- the package `build`/`typecheck` command typechecks the source; it does not
  need to manufacture a separately publishable application bundle;
- Vitest runs against the source;
- React, React DOM, React Router, and React Query resolve to the host's one
  workspace version, avoiding duplicate runtimes. They are peer dependencies
  (and development dependencies for package tests), not package-owned runtime
  dependencies; both host Vite configs verify/dedupe them;
- package-private imports use the `#product/*` mapping proven in TypeScript,
  Vite, and Vitest; they do not depend on either app's alias.

Lower packages may keep their current `dist` build. If implementation evidence
shows a built product-client package is materially safer, its build must also
copy/emit CSS and assets and preserve dynamic imports; silently using plain
`tsc` output without those resources is not a valid alternative.

The mechanical asset move is part of PR 2:

- move Desktop product SVG/PNG/JPEG/MP3 assets and `assets.d.ts` declarations
  under product-client so both host bundles resolve the same imports;
- keep genuinely native window/application resources in Desktop;
- preserve Vite `?raw` behavior for file icons and the bundled agent catalog;
- move `provider-registry.generated.json` to product-client and change
  `scripts/vendor-provider-registry.mjs` to generate at the new owning path;
- keep `catalogs/agents/catalog.json` as the repo-level generated source of
  truth and import it from product-client (do not copy a second catalog);
- add a build test that bundles representative `?raw`, image, audio, JSON, and
  repo-level catalog imports in both Desktop and Web.

## 7. The one host contract

The host is one value in one provider. The following is an authority sketch,
not a requirement to use these exact property names:

```ts
type ProductSurface = "desktop" | "web";

interface ProductHost {
  surface: ProductSurface;
  deployment: ProductDeploymentHost;
  auth: ProductAuthHost;
  cloud: ProductCloudHost;
  persistence: ProductPersistenceHost;
  links: ProductLinksHost;
  telemetry: ProductTelemetryHost;
  desktop: DesktopBridge | null;
}
```

It is intentionally composite:

- there is one `ProductHostProvider`;
- nested groups document authority without creating many React contexts;
- feature hooks consume narrow methods from that one value;
- the object is not a service locator and cannot return arbitrary app
  internals;
- `surface` is descriptive. Product behavior normally checks a real capability
  (`desktop !== null`, a server capability, or a workspace capability), not
  `surface === "web"` scattered through components.

The host does not supply page, settings-pane, chat, composer, or workspace
render slots. Product-client renders those surfaces itself. The only UI that
stays wholly outside it is genuinely host chrome or transport entry UI, such
as native macOS window controls or a browser OAuth callback spinner.

### 7.1 Deployment authority

The deployment group supplies:

- the normalized API origin/configuration;
- the current deployment/cache key;
- a way to observe deployment changes;
- Desktop's optional connect/switch/reset operation;
- Web's fixed configured deployment.

It does not hardcode server capabilities. Billing, SSO, gateway, hosted-mode,
and other product capabilities continue to come from server truth (`/meta`,
viewer, organization, or the owning SDK query).

No new persistent deployment UUID protocol is required. For this migration,
the cache-scope foundation may derive a credential-free deployment key from
the normalized API configuration it already owns.

### 7.2 Auth authority

The auth group exposes normalized product state and semantic actions:

```ts
type ProductAuthStatus =
  | "bootstrapping"
  | "anonymous"
  | "authenticated"
  | "unreachable";

type ProductAuthorityIdentity = Readonly<{
  deploymentKey: string;
  actor: { kind: "anonymous" } | { kind: "user"; id: string };
  generation: number;
}>;

interface ProductAuthHost {
  status: ProductAuthStatus;
  principal: { id: string } | null;
  authGeneration: number;
  bindAuthority(expected: ProductAuthorityIdentity): ProductAuthorityHandle | null;
  startSignIn(input: ProductSignInIntent): Promise<{ transactionId: string }>;
  signOut(expected: ProductAuthorityIdentity): Promise<boolean>;
}

interface ProductAuthorityHandle {
  readonly identity: ProductAuthorityIdentity;
  getFreshCredentialSnapshot(): Promise<Readonly<{
    accessToken: string | null;
    credentialRevision: number;
  }>>;
  observeCredentialRevision(listener: (revision: number) => void): () => void;
  invalidateIfCurrent(input: {
    credentialRevision: number;
    reason: AuthorityRejection;
  }): Promise<boolean>;
  dispose(): void;
}
```

`unreachable` is the normalized target model for a transiently unavailable
authenticated deployment. Desktop does not expose that auth status today; PR
0b introduces it while retaining the resolved principal/authority underneath.

The exact state shape may reuse existing Cloud SDK types. The important
constraints are:

- product code does not read cookies, PKCE state, native vault entries, or raw
  refresh credentials;
- host bootstrap owns restoration and publishes `status`; product code never
  starts a second auth-bootstrap lifecycle;
- `ProductScopeBoundary` binds one authority handle to its captured
  `{deployment, principal-or-anonymous, authGeneration}` tuple. The handle
  compares that tuple before returning a fresh token or invalidating auth. A
  mismatched bind returns `null`; a disposed/stale handle fails token access
  and makes `invalidateIfCurrent` a no-op;
- long-lived Cloud/AnyHarness operations request one atomic token + credential
  revision snapshot through that bound handle instead of reading them
  separately or capturing a token at connection creation time;
- each authority also owns a monotonic, non-secret `credentialRevision` that
  advances when its access token is replaced without replacing the authority.
  It is a transport refresh signal, never a ProductScope/query-key identity;
- `observeCredentialRevision` atomically registers and replays the current
  revision. Connection installation is serialized with those observations and
  compare-and-swaps both its connection-resolution revision and snapshot
  credential revision; token A can never be installed and labeled revision B;
- a late operation from authority N can neither obtain N+1's token nor let an
  N-era rejection invalidate N+1, even when the principal id is the same. A
  request also passes the `credentialRevision` it actually used, so a late 401
  from token A cannot invalidate newer token B within the same authority;
- one host-owned auth coordinator serializes and compare-and-swaps every
  credential-changing bootstrap, sign-in, callback commit, refresh replacement,
  and sign-out against the applicable authority, credential revision, or sign-in
  transaction id. It may use an internal ticket/mutex, but there is no separate
  public operation-revision identity, cache key, or product concept;
- `startSignIn` creates a credential-free transaction id bound to the expected
  deployment and starting authority. OAuth/SSO state carries that id. Callback
  credential commit succeeds only if that transaction is still current;
- `signOut(expected)` compare-and-swaps against the expected authority. A late
  generation N clear cannot erase generation N+1. Web must also serialize
  cookie-changing responses so a late logout `Set-Cookie` cannot clear a newer
  login; server revocation is token-specific;
- all credential storage writes/clears and normalized auth-state changes go
  through that coordinator. Raw Cloud middleware and stream code never mutate
  storage behind the auth store;
- successful current operations may publish/replace credentials; only a commit
  that replaces session authority advances `authGeneration`. Ordinary refresh
  keeps that generation and advances only `credentialRevision`. Stale
  callback/logout/refresh results are discarded without storage or state
  mutation;
- login, logout, actor change, and deployment change advance scope and fence
  stale work;
- auth UI consumes normalized methods and truthful server-advertised methods;
- Desktop's optional semantic deployment connect/switch/reset methods live in
  the deployment group and internally use native primitives. Web omits those
  methods; the Desktop bridge does not own a duplicate deployment API.

### 7.3 Cloud transport authority

The host owns credential transport and exposes exactly one scoped Cloud SDK
client factory for the current auth/deployment state. The product client owns Cloud
queries, mutations, workspace classification, gateway lookup, managed-cloud
connection resolution, product orchestration, and query keys. A host must not
own a parallel managed-cloud workspace resolver or module-global Cloud client.

The seam is a factory, not a client singleton. Conceptually:

```ts
interface ProductCloudHost {
  createScopedClient(input: {
    deployment: ProductDeployment;
    authority: ProductAuthorityHandle;
  }): { client: CloudClient; dispose(): void };
}
```

`ProductScopeBoundary` calls it for the current authority and disposes the
returned handle on scope teardown. Product-client supplies the bound authority
handle plus all product-specific query/mutation behavior. A client cannot
outlive its ProductScope.

Organization identity is operation input, not mutable transport ambient state:

```ts
type CloudOwnerContext =
  | { ownerScope: "personal"; organizationId: null }
  | { ownerScope: "organization"; organizationId: string };
```

The Cloud SDK query-key helpers already support owner scope and organization
identity; this migration preserves those correct keys and audits callsites for
missing/mismatched owner context. Every owner-sensitive query/mutation captures
one immutable `CloudOwnerContext` before it creates its query key and request,
and passes that same value explicitly to header construction. Middleware must
not consult `useOrganizationStore.getState()` or another live organization
getter. An organization switch therefore cannot turn an A-keyed operation into
a request against B.

The current Cloud SDK React provider writes its resolved client into the Cloud
SDK's process-global singleton, and `useCloudClient()` falls back to that
singleton outside context. PR 1 removes both behaviors: the React provider
never publishes globally, and `useCloudClient()` fails closed when no provider
is mounted. Every plain Cloud SDK call moved into the connected product
receives the scoped client explicitly. A legacy global API may remain for
out-of-scope non-React consumers during this migration, but ProductClient,
Desktop, and Web may neither populate nor read it for authenticated product
work.

This split matters because:

- Web uses refresh-cookie/CSRF semantics and an in-memory access token;
- Desktop uses its native credential/deployment mechanism;
- the connected product must use one Cloud SDK React behavior after the client
  has been created;
- host transport cannot import a product-client store to discover the current
  organization. The product operation supplies its captured request context.

### 7.4 Persistence authority

The persistence group is only for non-secret, device-local product state:

```ts
interface ProductPersistenceHost {
  read(key: ProductPersistenceKey): Promise<unknown>;
  write(key: ProductPersistenceKey, value: unknown): Promise<void>;
  remove(key: ProductPersistenceKey): Promise<void>;
}
```

The implementation is host-backed: Web uses browser persistence; Desktop's
typed adapter dispatches each key to its existing owner (for example Tauri
Store or WebView `localStorage`). PR 1/PR 2 do not silently move a key between
backends or rename it. Any backend/key migration requires an explicit
read-old/write-new transition, idempotency and rollback tests, and a declared
old-value retirement point. The adapter does not store bearer tokens, refresh
credentials, PKCE verifiers, native credential material, or provider API
keys.

The key set is typed and owned by product-client; arbitrary string access is
not part of the interface.

### 7.5 Link/navigation authority

Internal product navigation is shared React Router behavior. The links group
owns only actions whose encoding/execution differs by host:

- open an external URL;
- request a semantic "open this location in Desktop" handoff;
- generate/copy a shareable link for the current deployment;
- open a system browser from Desktop;
- accept a host-decoded inbound deep link.

The shared product asks for semantic locations such as a workspace or workflow
identity. It does not concatenate a Tauri protocol URL or a hosted-Web origin.

Inbound transport state crosses the boundary as a normalized, validated,
credential-free, one-shot `ProductEntryIntent`, for example SSO login intent,
organization invitation, workspace/workflow location, or a completed billing
return. The links group owns this protocol:

```ts
interface ProductEntryIntentHost {
  observePending(listener: (intent: ProductEntryIntent) => void): () => void;
  acknowledge(
    intentId: string,
    disposition: "accepted" | "handed-off",
  ): Promise<boolean>;
  quarantine(
    intentId: string,
    reason: ProductEntryIntentRejection,
  ): Promise<boolean>;
}
```

Host callback/deep-link code validates and persists the intent before
publishing it into a durable FIFO of unacknowledged intents; a later arrival
never overwrites an earlier one. `observePending` is one atomic replaying
subscription: from the observer's perspective, an intent published during
subscription is delivered either by replay or by the live event and cannot
fall between a separate restore and subscribe call. Delivery is at-least-once.

Exactly one ProductEntryIntent coordinator lives above replaceable
ProductScopes. It is the sole consumer, processes the FIFO serially, and
deduplicates by `intentId`. The owning workflow accepts idempotently by
`intentId`; only then does the coordinator acknowledge and remove the queue
entry. Unacknowledged work replays after scope replacement or process restart.
There is no claim/lease protocol unless a future design introduces genuinely
independent consumers or a cross-tab shared queue.

Desktop ingress registers the live URL listener before draining the initial
`getCurrent()` value, persists before notifying, and deduplicates any overlap.
This prevents a live deep link from falling between startup drain and listener
registration.

Every intent includes a normalized credential-free target deployment key.
The coordinator dispatches only while that deployment is current. Desktop may
perform its explicit validated deployment-switch/relaunch flow and then resume
the queue. A foreign-deployment head item may not starve later valid work:
hosted Web atomically acknowledges it as `handed-off` after a successful
Desktop handoff, or moves it to a durable non-blocking quarantine with a
user-visible recovery/dismiss action. An explicit terminal rejection uses the
same quarantine path. An unacknowledged dispatchable intent survives a Web
OAuth redirect, ProductScope replacement, or Desktop
deployment-switch/relaunch without being misapplied to another server. Raw
callback URLs, OAuth state, credentials, and arbitrary navigation strings
never enter the product intent.

### 7.6 Telemetry authority

The product client emits typed product events and errors. The host installs
Sentry/PostHog/native diagnostics, supplies release/runtime identity, and owns
vendor lifecycle. Product state is not granted direct access to vendor SDKs.

The telemetry group also supplies one narrow route-instrumentation component
compatible with React Router's `<Routes>` contract. ProductClient renders its
shared route definitions through that component; Desktop and Web may wrap it
with their existing Sentry router instrumentation without importing Sentry
into product-client. This is the sole infrastructure render adapter and is not
a page, settings, chat, or workspace render slot.

Existing replay-masking and payload restrictions continue to apply. Moving a
component does not authorize new payload fields.

### 7.7 Desktop bridge

`desktop` is either `null` or one typed bridge. It groups actual native
capabilities required by product behavior, for example:

- local runtime readiness and connection;
- repository/folder selection and local worktree actions;
- open/reveal path, editor, terminal, and shell operations;
- local agent/provider credential operations (product-user authentication
  credentials remain exclusively owned by `ProductAuthHost`);
- native context menu, application menu, dock, and window operations;
- updater/version/relaunch actions;
- desktop worker and local automation execution;
- SSH target/tunnel operations;
- scratch-file persistence;
- diagnostics and support-attachment collection.

The bridge is demand-driven: add a typed method only when moved product code
needs it. It must never expose generic Tauri `invoke`, raw command names, or a
filesystem primitive broad enough to bypass product policy.

Desktop-only product orchestration may live in product-client and call this
bridge. Raw execution remains in `apps/desktop`. This lets local automation,
agent reconcile, updater UI, and native menus observe shared product state
without making the Desktop app import product-client's internal stores.

## 8. Product scope and provider composition

### 8.1 Scope identity

Remote caches and live streams must be scoped at least by:

- deployment;
- authenticated principal (or explicit anonymous state);
- the current in-memory auth generation.

That tuple is exact. `bootstrapping` and `unreachable` never participate in a
cache key. A transiently unreachable authenticated authority retains its
principal and generation; an unreachable client with no resolved authority
does not mount authenticated remote providers. Only a deliberate
invalidation/logout transitions to explicit anonymous and advances the epoch.

`authGeneration` is a process-local, monotonically increasing **session
authority epoch**, not deployment identity or access-token version. The
product scope changes independently when deployment changes.
`authGeneration` advances when:

- anonymous becomes authenticated or authenticated becomes anonymous;
- the authenticated principal changes;
- logout, revocation, or a replacement login invalidates the prior session
  authority.

It does not advance for an ordinary access-token refresh that continues the
same authenticated session. Routine Web token rotation must update transport
credentials without remounting the QueryClient or tearing down active
AnyHarness streams.

The target model deliberately separates three concerns, using one current SDK
primitive and one current Desktop-only lifecycle owner as its starting point:

- the current SDK accepts a caller-defined `AnyHarnessRuntime.cacheScopeKey`
  and includes it in its query keys; PR 0b makes Desktop supply the exact
  deployment + actor + authority-generation identity;
- current AnyHarness workspace query keys already include the logical
  workspace id;
- current AnyHarness runtime-level query keys still include `runtimeUrl`; PR 0c
  replaces that transport-address identity with target slot + generation so a
  gateway URL refresh neither aliases another target nor churns semantic data;
- materialization/runtime generation is currently observed by a
  Desktop-owned, Cloud-only materialization tracker. PR 0c replaces that
  narrow owner with a generic Cloud/local/SSH target-transition boundary.

Do not overload `cacheScopeKey` with workspace or materialization identity.
Credentials and expiring gateway URLs never participate in semantic cache
identity.

Current-main status:

- `bdd11aa5a` threads `cacheScopeKey` through SDK React query keys and derives
  a credential-free Desktop key from deployment + status/principal;
- it does not yet distinguish two login authorities for the same principal;
- SDK React still has a module-global AnyHarness client map whose key embeds
  raw runtime URL + bearer token and has no scope teardown;
- Cloud SDK React still publishes/falls back through a process-global client;
- it does not replace Desktop's module-global QueryClient or scope all Cloud
  queries/mutations.

PR 0b adds an in-memory authority generation and includes it in the existing
AnyHarness scope key. PR 0c replaces the global client map and generalizes
target transition ownership. PR 1 then creates the full ProductScopeBoundary
and a scope-owned QueryClient. None invents a product-client-only parallel SDK
scheme.

### 8.2 Provider order

The intended composition is:

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

The exact component split may differ, but these properties are mandatory:

- no module-global QueryClient in Desktop, Web, or product-client;
- no Cloud React provider write to, or hook fallback through, the Cloud SDK
  process-global client;
- no module-global AnyHarness client registry or credential-bearing client
  cache;
- bootstrapping/unreachable presentation state cannot churn a retained
  authority's scope key;
- a scope change cancels or makes unreachable old queries, streams, and
  connection completions;
- Cloud and AnyHarness consumers see the same scope;
- providers are not copied separately into each host;
- Web does not mount the Desktop local-runtime subtree;
- teardown runs once and removes every listener, timer, subscription, and
  stream owned by the prior scope.

### 8.3 Product state classes

Each state owner is explicit:

| State | Owner | Lifetime |
| --- | --- | --- |
| Server entities and remote results | Query cache / owning SDK | Product scope |
| Active AnyHarness connection/stream | AnyHarness SDK React plus scoped target/stream transition owner | Target slot + generation + product authority |
| Actor-sensitive selection, drafts, pending prompts, tabs | Product-client scoped store factories | Product authority; reset before replacement authority renders |
| Organization-sensitive client state | Product-client organization-scoped stores | Deployment + principal + organization |
| Workspace-local UI state | Product-client stores keyed by logical workspace id | Workspace within product authority |
| Non-sensitive device preferences | Product-client store + host persistence | Device |
| Auth secrets and pending OAuth state | Host auth transport | Host security rules |
| Native runtime/process state | Desktop host/bridge | Desktop process |
| Pure product decisions | `product-domain` or product-client `lib/domain` | Stateless |

PR 1 inventories every module-global store and classifies each field into one
of those lifetimes. Actor-sensitive stores are scope-owned factories
instantiated under `ProductScopeBoundary`; organization-sensitive stores are
factories under a nested organization boundary. A reset module-global
singleton is not sufficient because an old Promise can retain its setter and
write after rollover. Workspace-sensitive stores are likewise keyed/factored
so a delayed writer can reach only the old instance. Every asynchronous writer
also captures/checks the owning authority epoch before emitting external side
  effects. Preserve existing organization-aware query keys and repair any
  callsite whose key owner context differs from its request owner context. The
  authority QueryClient itself need not remount because it also owns the
  organization inventory used to select that id.

Persisted device-global keys preserve Desktop's existing backend, key, and
schema through PR 2; the Desktop adapter may dispatch per typed key.
Actor-, organization-, and workspace-sensitive persisted values are
credential-free but namespaced by their declared lifetime and removed/ignored
on rollover. PR 1 establishes the adapters and rollover behavior; PR 2 moves
the owning stores without changing it. Old Web stores receive no compatibility
migration.

## 9. Authentication and deployment flows

### 9.1 Shared product behavior

The product client owns:

- bootstrapping/anonymous/authenticated presentation;
- login-method presentation driven by server truth;
- password, OAuth, and SSO intent selection;
- signed-in shell readiness;
- common error and retry presentation;
- sign-out product behavior;
- organization invitation product flow after a host has decoded its entry
  point.

It does not know which credential storage mechanism was used.

`ProductClient` itself is the lightweight shared auth/product gate. It renders
the shared login/join presentation and route fallbacks, then route-lazily
imports `AuthenticatedProductClient` only after normalized auth is ready. The
hosts retain callback/entry decoders, not separate login product screens.

### 9.2 Desktop sequence

```text
1. Desktop boot reads/selects the deployment configuration.
2. Desktop auth transport restores the native credential state.
3. It publishes normalized auth state to ProductHost.
4. ProductClient renders login or the authenticated product.
5. OAuth/SSO opens the system browser.
6. The Desktop host receives the protocol deep link (or owning poll result),
   validates the pending transaction, compare-and-swap commits credentials
   only if it is still current, stores them natively, and advances auth scope.
7. ProductClient remounts remote providers under the new principal.
```

Self-host server connection remains Desktop-owned:

```text
enter server URL -> host validates server metadata/trust -> persist config ->
relaunch/rebootstrap -> authenticate to that deployment -> mount ProductClient
```

The shared login screen may expose this action only when the deployment group
provides semantic connect/switch capability; it does not check `desktop`.

### 9.3 Web sequence

```text
1. Web boot resolves its configured API deployment.
2. Web auth transport exchanges the HttpOnly refresh cookie using CSRF.
3. The short-lived access token stays in memory.
4. ProductClient renders login or the authenticated product.
5. Browser OAuth/SSO stores PKCE verifier/state in sessionStorage and redirects.
6. A Web-owned callback route validates/exchanges the response and
   compare-and-swap commits only the still-current sign-in transaction.
7. Auth state advances and ProductClient remounts its scope.
8. Refresh is scheduled or single-flighted on demand; gateway connections call
   the current ProductScope's bound authority handle rather than retaining a
   stale snapshot or calling an unscoped host token getter. A successful
   same-authority refresh advances `credentialRevision`, causing new/reconnect
   AnyHarness work to refresh connection material without remounting scope.
```

Production Web must not persist its bearer in localStorage. Any token-store
path retained for explicit dev/test injection is named and unavailable in the
normal production flow.

Web's product gate uses server-declared access/readiness. It must not equate
"GitHub connected" with "allowed to use the product," because password and SSO
users can be valid.

### 9.4 Self-hosted Web

The product-client contract permits a Web host to supply a different
deployment and password/SSO auth later. This migration does not ship the
runtime configuration, distribution, callback origins, or invitation flow
needed to claim self-hosted Web support.

No shared product code may assume the only Web deployment is the hosted
production origin; the current hosted Web host may.

## 10. Routing, callbacks, and deep links

There is one `BrowserRouter` per app and one shared product route tree. Host
callback/intent entrypoints sit beside one catch-all `ProductClient`; the
lightweight ProductClient root owns login/readiness and lazily loads the
authenticated route tree.

### 10.1 Host-owned entrypoints

Hosts own routes that terminate a transport protocol, such as:

- Web OAuth/PKCE callback;
- Web auth error callback;
- Web SSO-slug and organization-invitation entry decoders;
- Stripe/billing return decoder when required by the server contract;
- Desktop native protocol/deep-link ingress;
- development-only host diagnostics/playgrounds.

Those entrypoints decode/validate external input, update the owning transport,
and navigate to a canonical shared product location.

### 10.2 Product-owned routes

The product client owns Desktop's canonical product model:

- home/current workspace shell;
- workspaces list and workspace selection/deep link;
- workflows and workflow detail;
- settings with Desktop's existing typed query-string section selection;
- ordinary login and organization-join presentation after the host decodes
  any transport-specific entry intent;
- fallbacks into the canonical product home.

The warm `MainScreen`/workspace shell behavior is preserved: it stays mounted
across authenticated route changes, and Settings continues to overlay it. This
is a performance and transcript/stream-continuity invariant.

PR 2 must carry Desktop's current route semantics into product-client. It
must not redesign session URLs merely to match the old Web routes.

### 10.3 No old Web product compatibility layer

The following can be removed instead of aliased:

- old Web `/cloud/workspaces/**` paths;
- old Web automation route components/controllers (bounded Web edge redirects
  and Desktop's existing thin legacy redirects are disposed explicitly below);
- Web's separate settings-modal background-location convention;
- dead Desktop handoff routes.

Every producer of an inbound URL is audited and changes to the canonical route
unless this plan explicitly retains its host transport entrypoint:

- OAuth redirect configuration;
- Stripe return URLs;
- GitHub App authorization/installation returns;
- invitation/email links;
- any server-generated Web link;
- Desktop handoff URLs.

The deploy ordering is not a multi-system flag day. Web permanently retains
`/auth/callback`, `/auth/error`, `/join/:organizationId`, and the
`/settings/cloud` billing-return decoder, so browser OAuth, SSO, invitations,
and Desktop checkout/portal returns do not require a flag day. The billing
decoder handles `returnSurface=desktop` before navigating browser returns to
shared `/settings?section=billing`; it is a host transport entrypoint, not an
old settings page. Cutover release R adds a small Vercel 307 redirect set
**before** the SPA catch-all. This `redirects` array is new work: root
`vercel.json` currently has only the SPA `rewrites` rule.

```json
[
  {
    "source": "/cloud/workspaces/:workspaceId/chats/:chatId",
    "destination": "/workspaces/:workspaceId",
    "permanent": false
  },
  {
    "source": "/cloud/workspaces/:workspaceId",
    "destination": "/workspaces/:workspaceId",
    "permanent": false
  },
  {
    "source": "/workspaces/:workspaceId/chats/:chatId",
    "destination": "/workspaces/:workspaceId",
    "permanent": false
  },
  {
    "source": "/settings/account",
    "destination": "/settings?section=account",
    "permanent": false
  },
  {
    "source": "/settings/organization",
    "destination": "/settings?section=organization",
    "permanent": false
  },
  {
    "source": "/settings/organizations",
    "destination": "/settings?section=organization",
    "permanent": false
  },
  {
    "source": "/settings/environments",
    "destination": "/settings?section=environments",
    "permanent": false
  },
  {
    "source": "/auth",
    "destination": "/login",
    "permanent": false
  },
  {
    "source": "/automations/:path*",
    "destination": "/workflows/:path*",
    "permanent": false
  }
]
```

Vercel preserves query strings on the redirected routes. `/settings/cloud`
bypasses the edge redirect set and reaches its host decoder so Desktop Stripe
return state is handled before shared-product navigation. PR 4/release R
changes every repository-owned producer in the same landing as the new
handlers and redirects. After R smoke passes, dashboard and
deployed-environment registrations whose canonical destination changed are
updated one producer at a time per the rollout ledger's external-item schema
(source change → activation → live-consumption proof → smoke; mutation only
after the landing merges and the reviewed PRODUCTION surfaces deploy at the
exact merge SHA); Desktop-aware billing returns continue to use the retained
decoder. Keep the
redirects through R+1 and for at least seven days, then remove them only after
the producer ledger is rechecked. This is a bounded deploy-ordering shim, not
an old Web controller, route component, or feature flag.

### 10.4 Canonical route and producer ledger

PR 2 makes these the shared product routes:

```text
/login
/
/workflows
/workflows/:workflowId
/workspaces
/workspaces/:workspaceId
/settings?section=<sectionId>
```

This deliberately preserves Desktop's current URL/state semantics. Workspace
selection is reconciled from `/workspaces/:workspaceId`; active sessions remain
tab/store-owned, and Settings sections remain query-string state. The migration
does not introduce a second URL-owned session or settings store.

PR 2 also preserves these current Desktop host/legacy entrypoints explicitly;
they are not silently lost in the mechanical move:

| Current Desktop route | PR 2 disposition |
| --- | --- |
| `/index.html` | Thin Desktop host redirect to `/` |
| `/setup` | Existing authenticated redirect to `/` |
| `/settings/cloud` and `/settings/billing` | Retain the Desktop billing-return/deep-link decoder, then normalize to shared `/settings?section=billing` |
| `/automations` and `/automations/:workflowId` | Retain thin redirects to `/workflows` and `/workflows/:workflowId` through the Web R+1 redirect window; removal is a separate audited cleanup |
| `/playground/**` | Retain Desktop-only development host routes; never include them in the production Web product router |

These routes contain no second product UI or controller. The Desktop billing
decoder and protocol ingress remain host transport; the canonical destination
is always a shared product route.

Current Web declares `/settings`, generic `/settings/:sectionId`, and a
separate `/settings/cloud` transport route. The concrete settings URLs below
are known inbound/producer values handled through those declarations; they are
not all separately declared React routes.

PR 4 uses this concrete route disposition:

| Current Web inbound path/pattern | Target/disposition |
| --- | --- |
| `/auth` | Bounded edge redirect to shared `/login` |
| `/auth/callback` | Retain as Web host callback; OAuth/SSO registration need not churn |
| `/auth/error` | Retain as Web host callback/error entry |
| `/login` | Shared ProductClient login screen |
| `/login/:slug` | Retain as a thin Web auth entry decoder that renders the shared login screen with validated SSO intent |
| `/join/:organizationId` | Retain as a thin Web invitation entry decoder feeding the shared organization-join flow |
| `/connect-github` | Delete; shared onboarding/readiness renders the required GitHub action in place |
| `/auth/desktop/handoff` | Delete after proving no deployed producer remains; Desktop uses its protocol flow |
| `/settings/cloud` | Retain as Web host billing-return decoder: Desktop handoff for `returnSurface=desktop`, otherwise navigate to shared `/settings?section=billing` |
| `/settings/account` | Repository producers change to `/settings?section=account`; exact bounded edge redirect covers in-flight GitHub App state |
| `/settings/organization` and `/settings/organizations` | Repository producers/allowlist change to `/settings?section=organization`; exact bounded redirects cover in-flight callbacks |
| `/settings/environments` | Repository producers change to `/settings?section=environments`; exact bounded redirect covers in-flight callbacks |
| Other `/settings/:sectionId` | Intentionally unsupported; no generic redirect may shadow `/settings/cloud` billing transport |
| `/cloud/workspaces/:id` | Producers change to `/workspaces/:id` |
| `/cloud/workspaces/:id/chats/:chatId` | Producers change to `/workspaces/:id`; bounded redirect opens the owning workspace |
| `/workspaces/:id/chats/:chatId` | Bounded redirect opens `/workspaces/:id`; session selection remains shared store state |
| `/automations/**` | Current Web entries are already thin React redirects to `/workflows/**`; replace them with the bounded edge redirect for R/R+1, then remove the alias |
| `/support` | Delete as a route; shared Desktop support-modal behavior is canonical |

Before PR 4 is production-ready, its release packet contains a checked producer
ledger. At minimum it audits and updates:

| Producer/consumer | Concrete owner to inspect |
| --- | --- |
| Browser OAuth and SSO return | `apps/web/src/lib/access/cloud/auth/web-auth-flow.ts`, Web route config, provider registration, server redirect validation/tests |
| GitHub App installation/user authorization return | shared settings workflows plus `server/proliferate/server/cloud/github_app/service.py` and `FRONTEND_BASE_URL` behavior |
| Stripe checkout/portal returns | `STRIPE_CHECKOUT_SUCCESS_URL`, `STRIPE_CHECKOUT_CANCEL_URL`, `STRIPE_CUSTOMER_PORTAL_RETURN_URL`, `server/.env.example`, server billing tests, deployment secrets/config |
| Organization invitations | `server/proliferate/server/organizations/join_links.py`, email templates/tests, `/join/:organizationId` |
| Workspace/session links | Product link helpers, Desktop open-in-Web workflow/tests, notifications/email/Slack producers, Mobile associated-link declarations if they consume the hosted URL |
| Desktop handoff/deep links | Web handoff helper, Desktop protocol decoder/tests, local-dev scheme |
| Telemetry/scrubbing classifiers | Web telemetry path classifiers, product-domain URL scrub tests, worker/supervisor logging scrub tests |

The audit uses repository search plus deployed configuration review; a code-only
search cannot prove provider registrations and Stripe dashboard/env values
changed. Release R's smoke gate opens both old and canonical forms of each
redirected inbound class. PR 3 may delete the old route components because the
ordering shim lives at the Vercel edge.

## 11. AnyHarness and workspace resolution

### 11.1 One shared provider path

Normal product code never constructs `AnyHarnessClient`. It uses the shared
SDK React providers and hooks:

```text
logical workspace selection
  -> classify selected materialization
  -> resolve a connection for that target
  -> AnyHarnessWorkspace
  -> shared chat/transcript/files/terminal/subagent/config hooks
```

The product client owns logical workspace classification, materialization
selection, Cloud workspace records, and shared provider composition.

### 11.2 Target matrix

| Target | Desktop | Web | Resolution owner |
| --- | --- | --- | --- |
| Managed cloud sandbox | Commandable | Commandable | Shared Cloud gateway resolver |
| Desktop local runtime | Commandable | Unavailable | Desktop bridge |
| Direct SSH target | Commandable | Unavailable | Desktop bridge |
| Desktop-exposed local record | Commandable from owning Desktop rules | Read-only/handoff | Server metadata + Desktop bridge |
| Unmaterialized/pending cloud workspace | Shared pending UI | Shared pending UI | Product-client + Cloud SDK |

Cloud files, changes, terminals, chat, transcript streaming, plans,
integrations, and subagents are not Desktop-only merely because Desktop
implemented them first. If the selected managed-cloud AnyHarness exposes the
capability, Web uses the same product UI through the gateway.

### 11.3 Cloud gateway resolver

Both hosts use one product-client resolver for managed cloud. Conceptually it:

1. loads the selected cloud workspace/materialization through the shared Cloud
   cache, confirms it is Web-commandable, and derives its stable target slot
   plus logical workspace attachment;
2. asks that slot's connection-material coordinator for the current record.
   Normal concurrent callers share one in-flight resolution; a forced refresh
   allocates the next monotonic revision and supersedes an older attempt;
3. the winning attempt asks the current ProductScope's bound authority handle
   for one atomic fresh product-token + credential-revision snapshot;
4. it keeps the full Cloud connection record (including runtime generation) for
   lifecycle observation, while mapping only runtime URL, fresh access token,
   AnyHarness workspace id, WebSocket auth transport, target slot,
   target-generation identity, and connection-resolution revision into the SDK's
   `AnyHarnessResolvedConnection`;
5. installs the result only if its connection revision is still latest and its
   credential revision still equals the authority coordinator's current
   observed revision. A caller whose A result is superseded by B joins/adopts
   B's current record (or receives an internal retryable superseded result that
   the resolver immediately retries); stale A is never exposed to product code;
6. reports the accepted connection observation to the shared generic
   transition boundary so a changed AnyHarness workspace id or runtime
   generation evicts the prior target's attached caches and reconnects live
   work.

Expiring tokens and gateway URLs are connection material, not logical identity.
Connection-resolution revision is an in-memory ordering fence, not a query key
or persisted identity. If the latest attempt fails, the boundary retries; it
does not fall back to installing an older in-flight result.

Managed-gateway target records also remember the authority
`credentialRevision` with which their connection material was resolved. The
slot coordinator subscribes to the bound authority handle and marks that
material stale when the revision advances, without changing ProductScope,
target generation, or query identity. Every new AnyHarness operation and every
stream reconnect must first ensure current material; a stale revision or a
current-authority 401 forces the slot-owned refresh. Already-connected streams
are not torn down merely because the revision advanced. Local/direct targets
that do not depend on product auth ignore this signal.

PR 0c uses these collision-proof identities:

```text
target slot (stable owner)
  cloud:<deployment-key>:<logical-cloud-workspace-id>
  local:<desktop-runtime-slot-id>
  ssh:<deployment-key>:<ssh-target-id>

target generation (current incarnation within that slot)
  cloud:<anyharness-workspace-id>:<runtime-generation>
  local:<process-generation>
  ssh:<tunnel-generation>
```

The full credential-free connection identity is target slot + target
generation. Target kind and stable owner are mandatory: two SSH targets at
generation 1 must not collide, and neither may collide with a local process at
generation 1. Every workspace, session/feed stream, terminal stream, client,
and query owned by a target registers against its target slot and generation.
The Desktop runtime slot id is a stable logical profile/installation slot that
survives a sidecar process restart; it is never a PID or random process-instance
id. Each launched process is represented only by `process-generation`.

Connection material and workspace attachment are separate. One local sidecar
or SSH tunnel has one slot-owned URL/auth/transport record even when several
logical workspaces resolve to different AnyHarness workspace ids. Those
workspace callers share/adopt the winning target record; their attachment
records do not supersede one another. Cloud currently uses one logical Cloud
workspace per slot, so its AnyHarness workspace id participates in that slot's
generation.

The transition boundary serializes generation changes. It marks the old
generation closed and the new generation current before it enumerates cleanup.
Every async resource uses an atomic registration operation equivalent to
`register(authority, slot, generation, resource)`: a late old-generation
registration is rejected and immediately closed. Session/feed/terminal
callbacks and reconnect timers capture the returned lease and check that it is
current before publishing or reconnecting.

Client lookup also returns a lease. When accepted URL/token material rotates
within one generation, the old client is marked retired before the replacement
is published: it grants no new operations, already-started HTTP work may
settle, and its registry reference is disposed after its operation leases reach
zero. Existing separately registered streams may continue to drain; any
reconnect resolves the current material. Authority or target-generation
teardown force-closes every lease.

At the SDK boundary, the surrounding runtime owns product authority scope and
the workspace provider owns logical selection plus current connection
resolution:

```tsx
<AnyHarnessRuntime
  cacheScopeKey={productAuthorityScope}
>
  <AnyHarnessConnectionTransitionBoundary>
    <AnyHarnessWorkspace
      workspaceId={selectedLogicalWorkspaceId}
      resolveConnection={resolveCurrentConnection}
    >
      {children}
    </AnyHarnessWorkspace>
  </AnyHarnessConnectionTransitionBoundary>
</AnyHarnessRuntime>
```

- `cacheScopeKey` changes when deployment, actor, or authority generation
  changes;
- logical workspace identity remains in the SDK's workspace query keys;
- runtime-level SDK query keys use authority scope + credential-free target
  slot + generation, not `runtimeUrl`, token, or connection revision;
- PR 0c query helpers receive that target identity from the accepted resolved
  connection (or an explicit target descriptor for target-wide inventory),
  while `runtimeUrl` remains transport material used only to execute requests;
- materialization/runtime-generation replacement causes targeted cancellation,
  removal/reset, stream closure/reconnection, and connection re-resolution
  through the boundary;
- the scope-owned client registry holds at most one current client per
  credential-free target identity and is cleared on authority teardown;
- `resolveConnection` may return a refreshed token or gateway URL without
  changing logical workspace identity;
- logout/server switch still tears down the entire surrounding product scope;
- the implementation uses the merged SDK/query-scope primitive rather than
  inventing a product-client-only parallel key.

### 11.4 Desktop local resolver

Desktop additionally supplies local/SSH connection authority through its
bridge. The shared provider selects it only for a target whose product model
is local or direct SSH.

Desktop retains dynamic runtime resolution; it does not bake a local URL into
product-client. Its resolver supplies the sidecar/process generation; the SSH
resolver supplies tunnel generation. Restart/reconnect changes that generation
even when the URL is reused. A local sidecar or SSH tunnel may serve multiple
workspaces, so the generic transition boundary closes and reconnects **every**
workspace/session/feed/terminal resource attached to the old generation of
that stable target slot while leaving unrelated local, SSH, and Cloud slots
alone.

### 11.5 Web negative guarantees

On Web:

- `desktop` is `null`;
- no local runtime bootstrap executes;
- no global local workspace/repo/cowork inventory query executes;
- no local AnyHarness URL is constructed;
- no direct SSH connection is attempted;
- no raw AnyHarness client is created at a page or workflow callsite;
- selecting a server-visible local record renders an honest Desktop handoff,
  not an endlessly loading chat.

These are test assertions, not merely hidden controls.

## 12. Product capability policy

Capability checks have three sources:

1. **Host/device:** Desktop bridge present or absent.
2. **Deployment/server:** capabilities returned by the connected API.
3. **Selected resource:** what the workspace/runtime record can actually do.

Do not create one giant manually synchronized boolean capability object.
Derive user actions from these sources.

| Product action/surface | Desktop | Web |
| --- | --- | --- |
| Home, sidebar, account, organizations | Full | Same shared product |
| Managed-cloud workspace create/open/resume | Full | Same shared product |
| Managed-cloud chat/transcript/config | Full | Same shared product |
| Managed-cloud files/changes/terminal/subagents | Full when runtime supports it | Same when runtime supports it |
| Create/attach local repository/workspace | Full | Hidden; Desktop handoff may be offered |
| Create local worktree | Full | Hidden |
| Local chat/session/runtime inventory | Full | Not queried or rendered as commandable |
| Direct SSH target | Full | Read-only metadata/handoff at most |
| Native file picker/reveal/editor/terminal | Full | Native action hidden; Web-safe cloud action remains |
| Local agent credentials/reconcile/settings | Full | Hidden |
| API-key vs managed-gateway session configuration | Shared product where deployment/runtime supports it | Same for managed cloud |
| Cloud secrets/integrations/org policy | Shared | Shared |
| Local-only secrets/settings | Full | Hidden |
| Cloud workflow create/edit/run | Shared | Shared |
| Local workflow/automation execution/config | Full | Read-only server-visible summary + Desktop handoff |
| Local automation run metadata synced to server | Shared display | Read-only display/handoff |
| Billing/usage/plan settings | Shared, server-gated | Shared, server-gated |
| Native updater/version/restart | Full | Hidden |
| Self-host deployment switch | Full | Not in hosted Web migration |
| Native diagnostics/support attachments | Full | Web support without native collection |

Controls are either functional or absent/replaced with a truthful handoff. Do
not render dead disabled controls simply to make the layouts look identical.

### 12.1 Context menus

Menu content is product behavior and is shared where possible. Desktop
may use its native context-menu bridge. Web uses a DOM menu for Web-safe
actions. Native-only actions such as "Reveal in Finder" are omitted on Web;
product actions such as copy reference or operate on a cloud file remain.

This is a rendering adapter difference, not a separate Web controller.

## 13. Styling, assets, and selectors

Desktop's rendered product is the visual source of truth.

- Add `apps/packages/design/src/css/product.css` as the shared Desktop-derived
  product stylesheet. It imports the DOM foundation/fonts and receives the
  product selectors/tokens currently living in `desktop.css`.
- Reduce `desktop.css` to importing `product.css` plus genuinely native/Tauri
  window-chrome overrides.
- Preserve one defined cascade with no duplicate import: Desktop
  `apps/desktop/src/index.css` imports `@proliferate/design/desktop.css`, which
  imports `product.css` first and then native overrides; Web
  `apps/web/src/index.css` imports `@proliferate/design/product.css` directly
  and then browser-host CSS.
- Before rendering the product, each host preserves the existing root marker:

  ```ts
  document.documentElement.dataset.proliferateClient = "desktop"; // or "web"
  ```

  `product.css` exposes `desktop:`/`web:` Tailwind variants (or equivalent
  root selectors) from this marker for genuine visual differences. It is not
  used to hide controls whose hooks/queries would still execute.
- Add `@source "../../../product-client/src"` to the owning Tailwind source
  configuration. Without this, classes in moved JSX are silently omitted from
  both production bundles.
- Add the export map/build tests for `product.css` and prove the existing
  generic CSS copier emits it; change that copier only if the proof fails.
  Keep the CSS drift tests pointed at the new cascade.
- Product fonts and product assets move with product-client or remain in the
  lower shared design/UI packages.
- Appearance rules and CSS-token application move with product-client. It
  exposes a small synchronous pre-render appearance initializer that both host
  mains call, then its normal preference lifecycle hydrates persisted choices
  through `ProductPersistenceHost`.
- The CSS default must equal the product default so first paint remains
  correct before asynchronous preference hydration.
- no Web-specific restyling is performed during cutover.
- Tauri window chrome and macOS safe-area elements remain Desktop host UI.
- durable semantic test IDs/accessibility roles live with the shared product,
  so the same Playwright journey can drive both hosts.

### 13.1 Hosted Web performance budget

The current checked-out old-Web production artifact has an approximately 491
kB gzip initial JS+CSS closure and no emitted font assets. That number is
informational; the old Web product is not instrumented or retained merely to
serve as a migration harness.

The Desktop-derived product currently has a much larger static entry and
statically imports both login and authenticated roots. PR 1 therefore includes
a **feasibility build before the PR 2 freeze**: split the in-place candidate
root into a lightweight `ProductClient` auth gate and a lazy
`AuthenticatedProductClient`, mount it in a deterministic browser-safe host,
and measure `/login` and authenticated `/`. The candidate root stays at stable
Desktop-owned paths through PR 1 and consumes the package's host/provider/scope
primitives; the package itself exports no `ProductClient` until PR 2 moves the
proven root. The shared candidate root—not the throwaway old Web root—defines:

```text
data-product-ready="login"
data-product-ready="authenticated-home"
```

These are the desired acceptance targets for that feasibility build:

| Route/readiness point | Budget |
| --- | ---: |
| Shared `/login` JavaScript (gzip level 9) | 525,000 bytes |
| Shared `/login` CSS (gzip level 9) | 45,000 bytes |
| Shared `/login` fonts/images (emitted bytes) | 100,000 bytes |
| Shared `/login` total measured assets | 670,000 bytes |
| Authenticated `/` total measured assets | 1,750,000 bytes |
| Web-only overhead over the PR 2 ProductClient home fixture | 5% maximum |

The byte targets are not presented as already-proven facts. PR 1 must either
prove them or commit an evidence-backed replacement budget before PR 2 is
authorized; a replacement requires an explicit spec review and cannot silently
ratchet to whatever the build happens to emit. Independently of the exact
numbers, login/callback entries must exclude authenticated product roots,
Monaco, Shiki grammars/themes, xterm, editors, and non-entry routes.

Implementation requirements:

- enable Vite manifest generation and build a deterministic route-asset
  measurement command;
- in PR 1, define both readiness markers on the in-place Desktop-derived
  candidate shared root and run the feasibility build before scheduling the
  mechanical move;
- serve the production build, use a fresh-cache Playwright context with fixed
  auth fixtures, visit `/login` and authenticated `/`, and wait for a durable
  shared `data-product-ready` marker, `document.fonts.ready`, and a bounded
  network-idle settle before closing the request ledger;
- collect each unique same-origin script, stylesheet, font, image, and audio
  asset requested before readiness; map it to `dist`, gzip JS/CSS at level 9,
  and count already-compressed font/image/audio files by emitted bytes;
- run the feasibility check in PR 1 and the shipping Web check in the existing
  `web-frontend` CI job before Web cutover;
- count route-loaded dynamic chunks; exclude only chunks/assets that the
  measured route did not request and report them separately;
- preserve that root split when PR 2 mechanically moves it into
  product-client; the production Vite fixture then imports the moved
  ProductClient with the same deterministic browser-safe host and commits its
  measured asset ledger;
- in PR 4, run the same measurement against the actual Web host, enforcing the
  committed login/home budgets and at most 5% additional bytes over the PR 2
  ProductClient-only ledger.

The budget gates bytes needed to make each route usable, not total deploy
size. Total deploy size is misleading because language/theme/editor chunks are
intentionally lazy. Desktop font imports cannot silently enter Web's signup
critical path without fitting the font/asset and total budgets.

## 14. Lifecycle ownership

Moving `App.tsx` is not enough. Every existing root effect must be assigned an
owner.

### 14.1 Host bootstrap/process lifecycles

These remain app-owned when they do not require internal product state:

- API/deployment configuration bootstrap;
- Web cookie/PKCE transport installation;
- Desktop vault/protocol transport installation;
- Sentry/PostHog/native telemetry installation;
- renderer startup diagnostics and performance guards;
- Tauri reload/context-menu policies;
- local sidecar process bootstrap and raw health transport;
- window/process-level listeners.

### 14.2 Shared product lifecycles

These move with product-client:

- durable inbound-entry-intent queue coordination above ProductScope;
- organization selection;
- session/workspace selection and intent dispatch;
- query/stream-connected product behavior;
- preference hydration and persistence orchestration;
- home deferred launches;
- support UI/report workflow state;
- product command/shortcut interpretation;
- Cloud workspace and workflow orchestration.

### 14.3 Desktop-capability product lifecycles

Desktop-specific behavior that needs product state lives in product-client and
calls the optional bridge, for example:

- local agent reconcile/auth synchronization;
- local automation execution;
- Desktop worker enrollment tied to auth transitions;
- updater presentation/restart behavior;
- product-aware native menu dispatch;
- local worktree preference synchronization;
- native support/diagnostic collection initiated by the product.

The effect is not mounted when the bridge is absent.

Important invariants from the current Desktop root:

- auth bootstrap completes its initial decision before runtime-dependent
  product work assumes a principal;
- runtime bootstrap starts only after auth is no longer `bootstrapping`;
- worker enrollment observes the authenticated-to-anonymous transition so it
  can tear down correctly;
- preference hydration completes before default-sync effects write;
- updater, menu, deep-link, and global dispatch listeners mount once;
- every timer/listener/stream has deterministic cleanup;
- the workspace shell remains warm across routes;
- provider/scope teardown cannot let a stale completion mutate the next actor.

## 15. Source disposition

### 15.1 Desktop

| Current owner | Target |
| --- | --- |
| Most `components/**`, `pages/**`, product `hooks/**`, `stores/**` | Move to product-client |
| Product `lib/domain/**`, `lib/workflows/**`, config/copy/assets | Move to product-client |
| Shared half of `AppProviders` and authenticated route tree | Move to product-client |
| Cloud/AnyHarness product queries and orchestration | Move to product-client |
| `src-tauri/**` | Retain in Desktop |
| `lib/access/tauri/**` | Retain as raw Desktop implementation |
| Native auth/deployment transport | Retain in Desktop |
| Native telemetry/diagnostics bootstrap | Retain in Desktop |
| Native runtime/process/updater/SSH/shell primitives | Retain behind Desktop bridge |
| Tauri React wrappers that own product behavior | Move behavior; call Desktop bridge |
| Embedded browser/webview | Delete with its live workspace-panel/tab/action callers in the named pre-PR-2 cleanup; do not move or bridge it |
| Dev product playgrounds | Move only if they exercise shared product; host-native playgrounds stay Desktop |

### 15.2 Existing shared packages

| Current owner | Target |
| --- | --- |
| `product-surfaces` source | Move into product-client and remove old package name |
| `product-ui` | Keep as lower presentation package |
| `product-domain` | Keep as pure cross-platform rules package |
| `ui` | Keep as the only DOM primitive layer |
| `design` | Keep as token/assets foundation |

`product-client` becomes the sole connected shared DOM product owner. Existing
`product-surfaces` exports needed by the still-old Web app may be carried under
the new package for the short interval between PR 2 and the stacked PR 3/PR 4
cutover, then simplified.

### 15.3 Web

Retain/adapt:

- `main.tsx` as browser bootstrap;
- environment/deployment configuration;
- refresh-cookie, CSRF, in-memory bearer, and PKCE flow;
- browser auth/callback/error route controllers;
- browser credentialed Cloud transport factory;
- browser telemetry installation;
- host-only CSS.

Delete after cutover:

- Web application shell/navigation;
- Web Home, Chat, Settings, Workflows, and Support product pages;
- Web product components and controllers;
- Web home/chat/settings hooks;
- Web product-domain copies for chat/sidebar/home;
- Web cloud prompt/config/session draft stores;
- Web raw AnyHarness client and polling path;
- Web-specific pending-home-prompt and transient-recovery product owners;
- legacy product route aliases and settings-modal routing;
- `apps/web/src/lib/access/cloud/auth-token-store.ts` and every production
  read/write of its `proliferate.web.authToken` localStorage bearer. If a test
  injector remains useful, it is a separate test-only in-memory adapter that is
  excluded from production bundles.

Public callback code is retained only when a live external producer still
uses it.

## 16. Migration sequence

The cutover has an ordered runtime/authority prerequisite stack, two Desktop
checkpoints, and a stacked Web replacement. The sequence deliberately separates
behavioral refactoring from the repository-wide file move.

### 16.1 PR 0 — finish the runtime/cache-scope prerequisite

#### PR 0a — landed

Commit `bdd11aa5a` established the narrow AnyHarness foundation:

- SDK React query keys accept a credential-free `cacheScopeKey`;
- Desktop derives that key from deployment plus user id for authenticated
  state, and deployment plus raw auth status for non-authenticated states;
- tokens and other credentials stay out of cache identity;
- the Desktop provider supplies the scope to AnyHarness.

#### PR 0b — authority-generation correction

The landed authenticated branch is currently equivalent to
`deployment + user:<userId>`; its non-authenticated branch is
`deployment + <raw-auth-status>`. The authenticated key is insufficient when
the same user logs out and back in: the new authority would receive the same
key and a stale completion from the old authority could target the new cache.

Add one in-memory `authGeneration` to Desktop's normalized auth state:

- advance it when authority is replaced: interactive/persisted login,
  explicit logout, revocation, or transition to anonymous;
- do not advance it for ordinary token refresh or background recovery of the
  same authority; advance a separate non-identity `credentialRevision` when a
  current access token is replaced;
- change `buildAnyHarnessCacheScopeKey` to accept explicit authority
  (`user:<id>` or `anonymous`) plus generation. Remove raw auth status from the
  key; `bootstrapping`/`unreachable` are presentation/transport state. PR 0b
  introduces the normalized Desktop `unreachable` state (current Desktop auth
  has only bootstrapping/anonymous/authenticated). Retain principal+generation
  during a transient authenticated outage and do not mount remote providers
  before any authority is resolved;
- route every definitive refresh rejection/revocation through one normalized
  `invalidateAuthority` transition that compare-and-swaps both authority and
  the credential revision used by the failed request, clears stored
  credentials, advances the epoch, and publishes anonymous state; transient
  network failure may publish `unreachable` without invalidating the authority;
- explicitly replace the current raw storage write/clear paths in
  `loadValidSession`, `authMiddleware.onResponse`,
  `fetchDesktopCloudStream`, and transient-recovery refresh handling in
  `apps/desktop/src/lib/access/cloud/client.ts`, then inventory the rest of the
  repo for equivalent mutations. No refresh/401 path may mutate storage behind
  the auth store's back;
- fold the exact deployment + explicit authority + generation tuple into
  provider memoization;
- add the Desktop auth-coordinator ordering/CAS described in Section 7.2 so a
  late bootstrap, login callback, refresh, 401, or sign-out completion cannot
  write/clear a newer credential authority;
- test same-user generation N versus N+1, old credential revision A receiving
  a 401 after revision B commits, competing callback transactions A/B,
  bootstrap versus a live callback, refresh versus logout, and stale
  credential-changing operations;
- run the focused SDK/Desktop tests and one isolated Desktop profile.

#### PR 0c — AnyHarness client and target-generation lifecycle

The SDK React `clientCache` is currently a process-global map keyed by
`runtimeUrl + raw bearer token`, with no teardown. Replace it before Web token
rotation can use the shared product:

- introduce an SDK React client registry owned by the current authority
  `cacheScopeKey`; remove the module-global credential-keyed map;
- extend resolved target metadata with the exact credential-free target slot,
  target generation, and in-memory resolution revision defined in Section
  11.3. Key registry entries by full slot + generation, never by a token;
- change SDK React runtime-level query keys from `runtimeUrl` to authority scope
  + target slot + generation. Preserve logical workspace ids in workspace keys;
  URL/token/revision changes within a generation do not create semantic keys;
- implement one slot-owned connection-material coordinator. Normal concurrent
  workspace callers share its in-flight result; a forced refresh allocates a
  revision and supersedes the older attempt. If B installs before delayed A,
  A is discarded and A's waiters adopt/retry B. If latest B fails, retry rather
  than installing A;
- when accepted URL/token material changes within one target generation,
  replace the one current client and release the old registry reference rather
  than accumulating entries. Routine credential rotation does not alter query
  identity or target generation;
- record the bound authority's non-identity `credentialRevision` on managed
  connection material using the handle's atomic token+revision snapshot.
  Installation compare-and-swaps both connection revision and current observed
  credential revision. A revision change marks material stale; every new
  operation/reconnect and current-authority 401 ensures/forces a slot-owned
  refresh before using a client. Existing streams are not torn down solely for
  token rotation;
- generalize the current Desktop Cloud-only materialization tracker into one
  transition boundary. It indexes every attached workspace/query/client/live
  resource by target slot + generation and cancels/removes/resets all resources
  attached to the replaced generation;
- make target activation plus resource registration atomic. Mark the prior
  generation closed before cleanup; reject/close any late registration against
  it. Every resource callback/reconnect runner checks its current lease before
  publishing or reconnecting;
- explicitly adapt Desktop's current module-global
  `session-stream-handles.ts`, session reconnect timers/offline runners,
  `terminal-stream-registry.ts`, and feed-stream connection effects to consume
  that boundary. Authority teardown closes every handle/timer/runner; target
  rollover closes and lets mounted consumers reconnect every attached SSE/WS
  resource. Query/client eviction alone is not accepted as stream teardown;
- fan out a local-process or SSH-tunnel generation transition to every
  workspace attached to that stable target slot. Leave unrelated target slots
  alone;
- clear the registry and every registered live resource on authority teardown.
  Plain non-React callers receive an injected registry/transition owner or use
  an explicitly non-caching client factory;
- give registry clients operation leases. Same-generation connection-material
  replacement retires the old client (no new work), permits already-started
  operations to settle, and releases it at zero leases; separately registered
  streams may drain, but reconnect through current material;
- prove two concurrent SSH targets do not collide, a shared local runtime
  restart rolls all of its workspaces, token B cannot be replaced by delayed
  token A, credential revision forces new work/reconnect onto B without
  remounting queries or tearing a healthy stream, access-token rotation does
  not grow the registry, and
  deployment/logout/target-generation changes fence old clients, queries,
  streams, timers, and late completions.

PR 0 is complete only after PR 0b and PR 0c. These close the AnyHarness
prerequisite; they do not yet remove Desktop's module-global product
QueryClient or module-global product stores. Full product ownership belongs to
PR 1.

### 16.2 PR 1 — make Desktop host-aware in place

Goal: introduce and prove the complete host boundary without moving the hot
Desktop product tree. This is behavioral refactoring at stable paths and may
run alongside ordinary product UI work before the launch freeze. Root, auth,
telemetry, Cloud-access, and native-access slices use explicit ownership while
their corresponding PR 1 change is active.

Land it as a short stack of reviewable changes if that improves reviewability,
but preserve this order:

1. Create a source-consumed `@proliferate/product-client` skeleton and prove
   its package-private `#product/*` imports in TypeScript, Vite, and Vitest.
   The PR 1 export map exposes host/provider/scope/package-resolution
   primitives and their types only — no `ProductClient` export until PR 2.
2. Refine the canonical feature spec
   (`specs/codebase/features/web-desktop-client-unification.md`, promoted by
   the docs preflight before PR 0b) and the frontend structure docs with the
   implementation inventory; do not re-promote the contract.
3. Generalize both enforcement scripts for product-client immediately.
   `scripts/report_frontend_structure.py` adds product-client to every
   applicable hard-coded root collection and package map.
   `scripts/check_frontend_boundaries.py` replaces its single `DESKTOP_SRC`
   traversal and literal Desktop-path predicates with an explicit
   ownership-root/rule-applicability table covering Desktop and product-client
   (and Web only where a rule applies). Tests plant a violation for every
   intended root/rule pair and prove the script catches it, including package
   shape, hook/component shape, DOM primitives, raw Tauri/Cloud/AnyHarness
   access, query ownership, and package-import rules.
   Migrate `frontend_structure_allowlist.txt` and
   `frontend_boundaries_allowlist.txt` deliberately as paths move. Install the
   Tailwind source assertion and ProductClient performance-fixture check at the
   same loud-failure boundary.
4. Define the single composite `ProductHost`, its provider, the
   existing `data-proliferate-client` marker contract, and the narrow Desktop
   implementation.
5. Build a checked host-dependency ledger and adapt every future-moved Desktop
   product callsite while paths remain stable. The ledger covers raw Tauri;
   native auth/deployment and callback transport; the app Cloud client/global
   factory; direct `localStorage`/`sessionStorage`; host URL/deep-link encoding;
   persisted inbound entry intents; and vendor telemetry/bootstrap. Each
   becomes the declared ProductHost seam or remains in the thin host. Raw
   access remains under Desktop's access layer, and fail-closed import scans
   prove no future-moved file bypasses the seam. Prove the atomic replaying
   entry-intent queue cannot miss an intent between startup drain/live
   delivery, overwrite a second pending intent, cross deployment, or execute
   one `intentId` twice. Also prove bootstrap auth validation and a live auth
   callback are serialized correctly.
6. Split Desktop root composition into host bootstrap, shared product
   lifecycles, and optional Desktop-capability lifecycles.
7. Inventory every product store/persistence key, implement the
   authority/organization/workspace rollover and namespacing rules from
   Section 8.3, and prove same-renderer logout/re-login cannot expose drafts,
   prompts, tabs, or selection from the prior authority. A deliberately
   delayed Promise writing through an old setter must be unable to mutate the
   replacement scope.
8. Replace the module-global authenticated product QueryClient with a
   `ProductScopeBoundary`-owned client keyed by deployment, principal, and
   `authGeneration`. Bind and dispose the exact `ProductAuthorityHandle` at
   this boundary. Remove the Cloud React provider's process-global write and
   `useCloudClient()` global fallback; pass the scoped client explicitly to
   future-moved plain SDK calls. Preserve and audit existing organization-aware
   query keys, repairing mismatched callsites, and replace live
   selected-organization middleware with the same immutable per-operation owner
   context. Prove scope teardown
   fences stale queries, mutations, streams, and manual cache writes, and prove
   authority N's delayed request/rejection can neither obtain N+1's token nor
   invalidate or reach N+1's Cloud client after same-user re-login.
9. Build the in-place ProductClient split/fixture from Section 13.1 at stable
   Desktop-owned paths (the package exports no ProductClient in PR 1), define
   the readiness markers there, and prove or explicitly revise the byte
   targets before authorizing the mechanical move.
10. Prove Web-mode composition can exist with `desktop: null` and without
   local runtime discovery — a host/provider/capability composition proof, not
   a package-owned product mount — but do not migrate or embellish the old Web
   product here.
11. Run focused tests and a real isolated Desktop profile.

PR 1 moves no product pages, stores, or hooks. Desktop should render exactly
as it did before; it is simply ready to be moved mechanically. It is complete
only when the host-dependency and store-lifetime ledgers have no unclassified
future-moved callsite/state and both enforcement scripts fail on a deliberate
product-client boundary violation.

Before PR 2, land one separately reviewable embedded-browser removal. Delete
`WorkspaceBrowserPanel`, `BrowserSurfaces`, the native webview surface and raw
`lib/access/tauri/browser-webview.ts` path, their hooks/actions/tab state, and
the workspace-shell caller after a checked reference scan. This is an explicit
product deletion already chosen for the migration—not a host capability and
not part of the mechanical move. The ordinary workspace files/changes/terminal
surfaces remain.

### 16.3 PR 2 — mechanically move Desktop into product-client

Goal: Desktop imports and mounts the shared package one hundred percent, with
no duplicate connected product left under `apps/desktop/src`.

This lands in a one-to-two-day Desktop feature freeze after the July 22, 2026
launch window (or the equivalent first quiet window if that date changes).
The freeze gate is binding: it opens only on an explicit dated user signal
plus a merged PR-2 freeze ledger (timestamp, base SHA, owner, planned
duration, and a disposition for every live conflicting Desktop
branch/worktree) appended to the rollout ledger at
`specs/developing/deploying/web-desktop-unification-rollout.md`, and freeze
validity is revalidated at PR 2 launch, immediately before its
review-acceptance, and immediately before its merge. Before the freeze, merge
or explicitly park every live Desktop UI branch; announce the cutover commit
and do not accept new hot-surface changes until the gate is green.

Recommended commit order:

1. Rename/absorb `product-surfaces` into `product-client` and update workspace,
   package, build, test, structure/boundary enforcement, and allowlist
   configuration.
2. Move Desktop-owned product pages, components, hooks, stores, product rules,
   connected providers, route tree, and shared lifecycle owners with `git mv`
   where feasible.
3. Use an AST module-specifier codemod to rewrite moved `@/...` imports to
   `#product/...`. Do not use blind text replacement; strings such as regexes
   and generated content must remain untouched.
4. Move product assets and generated-path ownership, split shared
   `product.css` from native Desktop chrome, and update Tailwind scanning.
5. Make the thin Desktop app install its auth/telemetry/storage/link/Desktop
   host implementations and mount `ProductClient`.
6. Keep old Web buildable temporarily by pointing any required shared imports
   at `product-client`; do not change its product behavior.
7. Delete the old Desktop copies and `product-surfaces`. Do not leave forwarding
   wrappers, duplicate stores, or a second mutation owner.
8. Run every static/build/test gate, the native smoke, and a real isolated
   Desktop profile before ending the freeze.

PR 2 is a mechanical cutover, not a feature PR. Review it by ownership map,
codemod audit, deletions, and the verification gate rather than attempting to
manually re-review every moved line.

### 16.4 PR 3 — delete the old Web product, retain a thin browser host

Goal: remove the hand-built parallel Web product before wiring the replacement.

Delete Web's product pages, product controllers, chat/polling implementation,
product stores, raw AnyHarness callsites, and the production localStorage
bearer-token store. Retain a buildable thin browser host with:

- environment/deployment bootstrap;
- Web auth, PKCE callback, error, billing-return decoder, refresh, and
  telemetry ownership;
- host-only CSS and the Web bundle-budget measurement;
- the bounded Vercel redirects from the release ledger;
- a temporary authenticated holding shell if required for buildability.

PR 3 must pass Web build/typecheck/CI. It is a permanently review-only stacked
diff based on post-PR-2 `main` and is **never merged**; its reviewed commits
land only through the cutover landing branch's cherry-pick replay (see the
canonical spec §10.4 and the rollout ledger).

### 16.5 PR 4 — mount product-client from Web

Goal: Web installs browser implementations and renders the same connected
product for managed-cloud work.

1. Implement browser deployment, auth, persistence, links, telemetry, and the
   scoped credentialed Cloud transport in `ProductHost`. Managed-cloud
   workspace classification, gateway lookup, connection resolution, and
   materialization eviction remain shared product-client owners.
   Production bearer state is memory-only; no replacement localStorage token
   store is allowed.
2. Add refresh singleflight, real authority-bound atomic credential-snapshot
   semantics, auth-mutation transaction/CAS ordering, and the same in-memory
   authority-generation behavior used by Desktop. Refresh, callback, and
   sign-out work is keyed to the bound operation/authority: a late generation N
   result cannot publish into, clear, or invalidate same-user generation N+1.
3. Set `data-proliferate-client="web"`, supply `desktop: null`, and mount a
   lightweight `ProductClient` at the canonical product catch-all; it owns the
   shared auth gate and lazy-loads `AuthenticatedProductClient`.
4. Remove Web's module-global QueryClient; authenticated state is owned by the
   shared `ProductScopeBoundary`.
5. Retain `/auth/callback`, `/auth/error`, and the `/settings/cloud` billing
   return decoder; update the live inbound-link ledger, deploy one-release
   redirects, and keep old aliases out of the React product router.
6. Add only the capability absences and truthful Desktop handoffs named in the
   matrix above. Do not create Web-specific replacement controllers.
7. Remove temporary exports and any holding shell used only between PR 3 and
   PR 4.
8. Run both host lanes, shared Playwright journeys, Web negative-capability
   assertions, callback tests, and the evidence-backed committed bundle
   budgets.

PR 4 is complete only when Web has no independent chat, transcript, composer,
workspace, settings, or workflow controller. PR 4 stacks on reviewed PR 3;
neither PR ever merges. After both are review-accepted, a separate landing
branch created from fresh `main` cherry-picks exactly the recorded ordered
commit list from the PR 3 base through the accepted PR 4 head, proves
tree/range-diff equivalence from the preserved evidence branches, runs the
combined gate battery, and is the only merged Web-cutover PR; PR 3 and PR 4
then close as review-only records (canonical spec §10.4; rollout ledger §1.1).
CI rejects a production Web artifact that lacks the ProductClient mount. This
preserves separate review units without ever putting the holding host on
`main` or staging/production.

### 16.6 Follow-up — self-hosted Web

Hosted Web cutover does not silently invent self-hosted Web packaging. A
follow-up specifies configurable API origins, callback origins, BasicAuth/SSO
and invitation behavior, deployment selection, and installer/deployment
ownership before enabling that surface.

### 16.7 During and after cutover — use the shared client as the test harness

World provisioners, manifests, strict runner policy, and existing Desktop
collectors can be built in parallel with the structural cutover. Full shared
host collection becomes possible once PR 4 mounts hosted Web on the one product
client; scenario fanout then targets that client instead of maintaining two
product implementations.

The shared Playwright journeys become the harness used while deeper billing,
managed-cloud, self-hosting, agent, and upgrade scenarios are completed.

## 17. Landing window and parallel feature work

The migration is intentionally sequenced around the active launch work:

The initial 2026-07-13 snapshot and dispositions are recorded in
[web-desktop-unification-intake-ledger.md](web-desktop-unification-intake-ledger.md).
Refresh that ledger rather than treating its branch statuses as permanent.
The **binding** PR-1 intake snapshot and PR-2 freeze ledger are appended as
committed docs-only phases to the rollout ledger at
`specs/developing/deploying/web-desktop-unification-rollout.md`; the tbd
ledger is historical sweep input only.

- before PR 0b/0c or PR 1 starts, create the first intake ledger from **all**
  open PRs plus local dirty, detached, and unpushed worktrees—not only GitHub
  branches. Give each item `{owner, head SHA, touched slice,
  merge|salvage|retarget|supersede|cancel}`. Refresh status at execution time;
  the document does not permanently assume an item remains open;
- now through the July 22, 2026 launch window: land PR 0b, PR 0c, and the
  in-place PR 1 stack; ordinary Desktop product UI branches may continue
  because paths do not move, while PR 1's root/auth/telemetry/Cloud/native
  slices are temporarily owner-locked;
- land the separately reviewable embedded-browser removal before the PR 2
  freeze; it may proceed alongside PR 1 once its workspace-shell slice is
  owner-locked;
- immediately before PR 2: inventory every open PR/worktree touching Desktop,
  confirm the embedded-browser cleanup is merged, merge ready work, and
  explicitly park or retarget the rest — recorded as the binding PR-2 freeze
  ledger in the rollout ledger, gated on an explicit dated user signal;
- first quiet window after launch: freeze Desktop UI changes for one to two
  days, land PR 2, run its full gate, then reopen feature development at the
  new paths;
- after PR 2: all connected Desktop/Web DOM product work targets
  `product-client` directly;
- review PR 3 and PR 4 as a stack, then land their combined diff to `main` in
  one commit/landing PR after both are green.

The initial ledger explicitly includes current PRs #1143 (Workflow V1 product
work touching Desktop/Web/shared surfaces) and #1142 (release test foundation)
as merge-or-disposition-before-freeze work. It also includes the known local
migration/test branches `codex/anyharness-query-scope`,
`codex/wdu0-contract-ledger`, `codex/wdu2-scope-contract`,
`codex/wdu2-server-identity`, `codex/wdu2-native-vault`,
`codex/wdu2-desktop-query-scope`, `codex/wdu-harness-foundation`,
`codex/test-dual-host-mainline`, and `codex/test-foundation-combined`.
Main's `bdd11aa5a` may supersede part of `codex/anyharness-query-scope`, but the
ledger audits remaining commits instead of assuming the whole branch is dead.

Additional parallel-work rules:

- Workflow engine/contracts/server work is unaffected by the frontend move.
  Workflow product UI lands before the PR 2 freeze or rebases once onto
  `product-client` afterward.
- A branch intentionally parked across PR 2 replays only its functional diff
  at the new path; it must not restore deleted Desktop files.
- No parallel branch builds new product behavior in the old Web controllers.
- Any feature adding a genuinely host-specific operation extends the one host
  contract narrowly and adds both its positive and negative host tests.
- Before starting PR 1, use that initial ledger to cancel or retarget queued
  structure-alignment swarm work that assumes app-owned product pages or a
  separate Web controller.
  Audit `specs/tbd/frontend-structure-alignment-migration.md`,
  `specs/tbd/structure-alignment-coordinator-model.md`, their related swarm
  notes, and every live structure-alignment worktree. Superseded work is
  closed; still-useful checks are retargeted to PR 1/PR 2. No competing
  migration continues in parallel.

This freeze is intentionally attached only to the mechanical move. It avoids
turning ordinary host-boundary work into a launch-month repository-wide merge
conflict.

## 18. Verification plan

### 18.1 Static/package checks

Every checkpoint remains buildable and runs the checks relevant to its
ownership change:

| Checkpoint | Required static/build evidence |
| --- | --- |
| PR 0b/0c | SDK React + Desktop auth/cache-scope/client-registry/target-generation tests and typecheck |
| PR 1 | product-client import-map proof (primitives-only export map — no ProductClient export); Desktop and Web typecheck/build/tests; shared packages; structure and boundary scripts prove every relevant rule scanned product-client; in-place ProductClient split/readiness/performance feasibility build at Desktop-owned paths |
| Pre-PR-2 browser cleanup | Desktop build/tests and isolated profile; checked reference scan proves no embedded-browser/webview owner or caller remains |
| PR 2 | product-client, Desktop, Web, and shared package builds/tests; both Vite bundles resolve package imports/assets/CSS; structure/boundary scripts and allowlists; codemod/import scans; committed ProductClient authenticated-home performance fixture ledger |
| PR 3 | thin Web host typecheck/build/test; old Web product-owner absence scan; redirects and bundle-budget check |
| PR 4 | both app builds/tests; product-client tests; callback/route checks; login/home asset budgets and host-overhead comparison; shared browser journeys |

The final import/ownership scans prove:

- product-client contains no app, Tauri, browser-auth transport, or vendor
  telemetry imports;
- product-client contains no `@/...` Desktop aliases;
- neither app imports package-private `#product/...` paths;
- final bundles contain no unresolved `#product/...` text;
- no `@proliferate/product-surfaces` import or package remains after PR 2;
- no old Web product owner remains after PR 3;
- direct public export-map imports resolve in both Vite builds.

At minimum the move gate includes these literal scans, plus both frontend
structure and boundary scripts' AST/path checks so alternate quote styles
cannot evade enforcement:

```bash
rg -F '"@/' apps/packages/product-client/src
rg -F '"#product/' apps/desktop/src apps/web/src
rg -F '#product/' apps/desktop/dist apps/web/dist
rg -F '@proliferate/product-surfaces' apps package.json pnpm-lock.yaml
```

### 18.2 Unit/component tests

Move Desktop's existing tests with their owners. Add focused tests for:

- ProductHost capability derivation;
- Web negative actions;
- managed-cloud versus local target classification;
- host-independent product routing;
- normalized entry-intent FIFO replay/acknowledge behavior, including multiple
  queued intents, process-scope deduplication, idempotent handler acceptance,
  deployment binding, OAuth redirect, and Desktop relaunch;
- Desktop startup drain versus live deep-link arrival (including an arrival at
  the old `getCurrent()`/listener-registration gap) and auth bootstrap
  validation versus a live auth callback;
- auth state normalization;
- scope rollover on actor/deployment/auth-generation change;
- authority-bound token acquisition and compare-and-swap invalidation: delayed
  generation N work cannot receive or invalidate same-user generation N+1;
- auth-coordinator ordering: competing callback transactions A/B, bootstrap
  versus callback, refresh versus logout, and stale sign-out results cannot
  overwrite or clear a later authority/credential commit;
- request/stream credential revision A receiving a 401 after revision B or
  same-user authority N+1 commits cannot clear or overwrite storage/auth state;
- transient authenticated `unreachable` status retains principal, generation,
  and cache scope;
- actor/organization/workspace store rollover and persistence namespacing;
- delayed old-authority store/workflow writes cannot reach a replacement
  scope;
- organization-sensitive query-key/request-context ownership;
- an organization A operation keeps immutable A request context after a switch
  to B;
- provider teardown and stale-completion fencing;
- materialization-generation targeted eviction;
- scope-owned AnyHarness client replacement/teardown and bounded registry size
  across token rotation;
- runtime query keys use target slot/generation and stay stable across
  URL/token/revision-only refresh;
- managed credential-revision notification makes every new operation/reconnect
  refresh stale connection material while a healthy stream remains mounted;
- Cloud, local-restart, and SSH-reconnect target-generation transitions,
  including multi-workspace local/SSH fanout and two simultaneous SSH targets;
- connection-revision ordering where accepted B cannot be replaced by delayed
  A carrying stale URL/token material;
- atomic credential-snapshot installation where rotation between snapshot and
  install rejects token A instead of labeling it with revision B;
- session/feed/terminal stream handles and reconnect timers close on authority
  and target rollover;
- a late old-generation resource registration is rejected/closed, and retired
  clients grant no new operation leases;
- Cloud React hooks fail closed without their scoped provider and never publish
  or fall back to the process-global Cloud SDK client;
- Desktop bridge action mapping without raw Tauri in product code;
- retained Web billing-return decoding for Desktop versus browser;
- host route-instrumentation adapter preservation;
- Web-safe versus native context-menu items.

Avoid snapshotting entire screens. Assert product behavior and ownership seams.

### 18.3 Shared Playwright model

Use one journey body with host fixtures:

```text
journey
  + Desktop web-renderer fixture
  + hosted Web fixture
  + optional native Desktop fixture for Tauri-only assertions
```

The shared journey owns semantic product actions/selectors. Host fixtures own
only bootstrap/auth and unavailable capability expectations.

Initial shared journeys must cover:

- authenticate and enter the product;
- render the same home/sidebar/settings shell;
- open/create a managed-cloud workspace up to the available test seam;
- open a cloud session and exercise shared chat UI where the tier permits;
- change a shared setting and observe it persist;
- navigate away/back while the warm workspace shell preserves state;
- log out and prove prior actor state is unavailable.

Host-specific tests cover:

- Desktop local workspace/repository/runtime behavior;
- Desktop native updater, deep-link, and system actions;
- Web OAuth/PKCE/cookie refresh callbacks;
- Web absence of local-runtime requests and controls;
- Web Desktop-handoff encoding.

Browser-mode Desktop proves shared DOM behavior. It does not prove Tauri. A
native lane remains required for native operations.

### 18.4 Local profile gates

PR 0b, PR 0c, and PR 1 each run the focused Desktop profile relevant to their
state, runtime, or host-boundary change. PR 2 runs the complete Desktop cutover
profile:

```bash
make setup PROFILE=<migration-profile>
make build
make run PROFILE=<migration-profile>
```

Exercise real Desktop auth bootstrap, local runtime readiness, managed-cloud
navigation, a session/transcript, Settings, and restart. Use an isolated
profile as required by the local development spec.

PR 3 needs no product-flow profile because it is a buildable deletion
checkpoint and is not deployed alone. PR 4 additionally runs the Web host
against the same appropriate local/staging server configuration and executes
the shared Web-capable Playwright subset.

### 18.5 Tier ownership

This migration changes flows and must update the automated flow registry as
tests become enforceable:

- Tier 1 owns pure capability, routing, target, scope, and adapter rules.
- Tier 2 owns host-neutral product flows that do not require a real agent or
  sandbox, running common journeys on Desktop-web and hosted Web where host
  integration is itself part of the guarantee.
- Tier 3 proves Desktop against the real local AnyHarness world, Desktop and
  hosted Web against the real managed-cloud world, and packaged Desktop against
  the self-host world. Hosted Web never pretends it can reach local AnyHarness.
- Tier 4 remains the real N-1 to N updater/convergence suite.

The migration does not weaken an existing clean test. Existing tests continue
to run or are moved to the new owner.

### 18.6 Canonical release-world consumption

This document owns host structure, not the release-test inventory. The
canonical contracts live under
[`specs/developing/testing/`](../developing/testing/README.md) and are owned
by the release-testing program (their spec pack lands with that program, not
with this migration):

- `core-release-validation.md` for required guarantees, cell semantics, and
  fail-closed gates;
- `release-worlds-and-fixtures.md` for artifacts, topology, readiness, and
  fixture lifetime;
- `tier-3-scenario-contract.md` for exact local-runtime, managed-cloud,
  billing, and self-host journeys; and
- `tier-4-scenario-contract.md` for the two standing N-1→N journeys.

The migration consumes those worlds as follows:

| World | Host execution after cutover | Migration-owned proof |
| --- | --- | --- |
| Tier 2 deterministic | Desktop web renderer and hosted Web for shared host cells; one host for host-neutral domain behavior | Auth bootstrap, callback/deep-link ingress, capability differences, no Web local-runtime requests |
| Tier 3 local runtime | Desktop only; broad renderer lane plus native cells | `LOCAL-1` through `LOCAL-9` and `LOCAL-BILL-*`; no hosted-Web permutation |
| Tier 3 managed cloud | Heavy cloud effects once; `CLOUD-HOSTS-1` on Desktop, hosted Web, and cross-host | Both hosts reach the same commandable cloud product state and converge stream/replay once |
| Tier 3 self-host | Packaged Desktop plus server-rendered setup/register pages | Native server connect, relaunch/keychain, invitee login, and origin isolation |
| Tier 4 Desktop | Exact retained packaged Desktop N-1 | Real Tauri N update and bundled AnyHarness/native CLI/ACP convergence |
| Tier 4 managed cloud | Host-neutral controller plus a real N-1 E2B target | Heartbeat→Supervisor→AnyHarness convergence and preserved session |

The target manifest, collector metadata, and generated execution manifest own
which cells are required. This migration adds host metadata and collectors; it
does not copy scenario prose or hand-maintain pointer/status tables.

## 19. Failure and rollback rules

Each PR stays buildable at its boundary.

- PR 0b, PR 0c, and the in-place PR 1 stack are ordinary reversible refactors;
  paths remain stable and no repo-wide feature freeze is required. The active
  root/auth/telemetry/Cloud/native slice still has one declared owner.
- PR 2 may be reverted as one mechanical unit while the old Web product still
  exists. Do not accept Desktop feature work between its codemod and green
  cutover gate.
- PR 3 and PR 4 are never merged. They are reviewed as separate stacked
  diffs; a landing branch cherry-picks their exact recorded commit list, is
  equivalence-proven, and is the single merged Web-cutover unit; CI refuses
  any production Web build without the ProductClient mount.
- The Vercel redirects deploy with the cutover landing; external/deployed URL
  producers are then updated one producer at a time per the rollout ledger's
  external-item schema — only after the landing merges and the reviewed
  PRODUCTION surfaces deploy at the exact merge SHA. Retain the redirects
  through R+1 and at least seven days.
- Do not keep a permanent old/new runtime flag as rollback infrastructure.
- During a PR, temporary forwarding imports are allowed only in intermediate
  commits and are removed before review.
- If a Desktop behavior cannot be preserved through the proposed bridge, stop
  and model the missing narrow capability; do not move raw Tauri access into
  product-client.
- If Web cannot execute an action, show a truthful absence/handoff; do not add
  a Web-specific imitation with a second product owner.

## 20. Canonical docs and tooling changed during PR 1/PR 2

PR 1 promotes the host/package contract and installs loud structural checks.
PR 2 updates path-specific law as the source moves. Together they must
reconcile, not silently violate, at least:

- `specs/codebase/structures/frontend/README.md`;
- `specs/codebase/structures/frontend/packages/README.md`;
- the frontend component, hook, state, access, lib, config, styling, telemetry,
  and mental-model guides where their package/app ownership changes;
- `specs/codebase/structures/frontend/architecture.md`;
- `specs/codebase/structures/sdk/README.md` for the AnyHarness SDK React
  query/client/transition ownership changed by PR 0c;
- the frontend access/state guides explicitly for the scoped Cloud SDK React
  provider and immutable organization request-context contract changed by PR 1;
- `specs/codebase/features/web-cloud-local-parity.md` (replace/supersede the
  separate-controller model);
- `specs/tbd/frontend-structure-alignment-migration.md` (remove the obsolete
  separate Web chat decomposition and app-owned-page assumptions);
- relevant auth, chat, transcript, composer, workspace, workflow, and update
  feature docs as ownership paths move;
- `scripts/report_frontend_structure.py`;
- `scripts/check_frontend_boundaries.py`;
- `scripts/frontend_structure_allowlist.txt` and
  `scripts/frontend_boundaries_allowlist.txt`;
- `pnpm-workspace.yaml`, root/app package scripts and dependencies, and
  `.github/workflows/ci.yml` repo-shape, Desktop, Web, and shared-package job
  commands;
- `scripts/ci-cd/detect-deploy-surfaces.mjs`;
- the end-to-end flow registry for materially changed paths.

The promoted feature contract lives at
`specs/codebase/features/web-desktop-client-unification.md`. This TBD plan is
the reduced rollout-detail record; the binding execution/freeze ledger lives
at `specs/developing/deploying/web-desktop-unification-rollout.md`.

## 21. Definition of done

The migration is done when all of the following are true.

### Ownership

- `@proliferate/product-client` is the only connected shared DOM product.
- Desktop and Web import and mount the same `ProductClient`.
- `product-surfaces` no longer exists.
- Desktop app source contains native/bootstrap/transport ownership, not a
  duplicate product tree.
- Web app source contains browser/bootstrap/transport ownership, not a
  duplicate product tree.
- Mobile imports remain unchanged and DOM-free.

### Behavior

- Desktop visual and behavioral baseline is preserved.
- Desktop local, direct SSH, managed-cloud, native settings, updater, and
  self-host connection paths remain functional.
- Web exposes the same managed-cloud product experience.
- Web never attempts local runtime discovery or connection.
- unsupported Web actions are absent or truthfully hand off to Desktop.
- cloud chat/transcript/config/files/terminal behavior has one SDK React owner.
- the warm workspace shell and route continuity remain intact.

### Security and state isolation

- auth secrets remain host-owned;
- Web bearer tokens are memory-only in production;
- connection code requests fresh tokens through an authority-bound handle;
- delayed old-authority token/rejection/sign-in/sign-out work cannot read,
  overwrite, clear, or invalidate a replacement authority for the same
  principal;
- no cache, stream, draft, prompt, tab, or selection crosses deployment/actor/
  authority-generation scope;
- organization-sensitive state is keyed/reset by organization, and a replaced
  workspace materialization triggers targeted AnyHarness cache eviction;
- credentials are absent from query/cache identity;
- AnyHarness runtime query identity uses target slot/generation rather than
  transport URL, and credential revision refreshes new work without scope
  churn;
- no module-global QueryClient owns authenticated product state;
- Cloud React never publishes to or falls back through a process-global client;
- no module-global AnyHarness client map retains bearer-token-keyed clients.

### Deletion

- old Web polling/raw AnyHarness client is gone;
- old Web product stores/controllers/pages are gone;
- duplicate Desktop source copies are gone;
- the embedded Tauri browser panel, actions/state, raw webview access, and
  callers are gone before the mechanical move;
- no generic Tauri bridge exists;
- no permanent compatibility flag, wrapper forest, or duplicate mutation owner
  remains.

### Verification

- both apps build and typecheck;
- moved tests pass under product-client;
- Desktop's full relevant test suite passes;
- shared Playwright journeys pass in Desktop web-renderer and hosted Web lanes;
- native Desktop smoke covers Tauri-only boundaries;
- a real local Desktop profile has been exercised after PR 0b, PR 0c, PR 1,
  and the PR 2 mechanical cutover;
- Web's shared `/login` and authenticated `/` readiness paths remain within
  the evidence-backed JS/CSS/font/asset/total budgets committed after the PR 1
  feasibility build;
- Web adds no more than 5% host-only bytes over the committed PR 2
  ProductClient authenticated-home fixture ledger;
- relevant existing E2E tests remain registered and runnable.

## 22. Guarantees after completion

The completed migration gives us these practical guarantees:

1. A product behavior fixed in the shared connected client is fixed for both
   Desktop and Web unless a real host capability makes the behavior different.
2. Desktop remains the full-capability product; extraction does not make it a
   lowest-common-denominator Web app.
3. Web cloud chat is not a separately maintained approximation. It uses the
   same AnyHarness provider, stream, transcript, composer, configuration, and
   session logic as Desktop.
4. Web cannot accidentally probe a user's local runtime because that
   capability is structurally absent, not merely hidden with CSS.
5. Auth credentials and refresh behavior remain appropriate to each security
   environment while the product sees one normalized signed-in model.
6. A single shared Playwright journey can validate the common product surface;
   host fixtures test only the real differences.
7. Future workflow, billing, integration, agent, and cloud functionality gets
   one connected frontend owner and can be tested once per relevant world,
   rather than once per historical frontend implementation.

## 23. Named follow-ups that do not block this cutover

- self-hosted Web packaging, runtime API configuration, callback origins,
  password/SSO invitation flow, and deployment selection;
- deeper normalization of Desktop's moved folder structure;
- deciding whether additional lower presentation code should fold from
  `product-ui` into product-client;
- server-side synchronization of preferences that are currently device-local;
- full Tier 2/3/4 scenario implementation described by the testing program;
- richer read-only Web presentation for Desktop-local workflow/run metadata;
- any future support for commanding a Desktop-exposed runtime through Cloud;
- Mobile redesign/rebuild.

These follow-ups must not recreate a second Web product controller.
