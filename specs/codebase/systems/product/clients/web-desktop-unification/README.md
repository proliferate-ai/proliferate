# Web/Desktop Client Unification

This spec defines the product boundary, host boundary, migration sequence, and
acceptance criteria. It intentionally does not redefine authentication,
billing, chat, workspace, workflow, or other feature behavior; the focused
feature specs remain authoritative for those behaviors.

Scope: `apps/desktop`, `apps/web`, and the shared DOM package/design owners under
`apps/packages/**`. Mobile is outside this DOM migration and remains native; it
may consume only concrete ProductClient `internal/domain/<file>` modules.

## Goal

Desktop and Web will mount the same connected product implementation:
`@proliferate/product-client`.

Desktop is the product baseline. We preserve its UI, behavior, hooks, stores,
and Cloud/AnyHarness behavior, move that product into a shared package, and
make Desktop and Web thin hosts around it. The old Web product is deleted
rather than reconciled with Desktop.

In plain language: make Desktop use the host boundary while its files stay
put, mechanically move that working product into ProductClient, delete the
duplicate Web product, and make a thin Web app mount the same ProductClient.
This is an extraction and host replacement, not a product rewrite.

```text
Desktop host ----\
                  +--> ProductHostProvider --> ProductClient --> Cloud API
Web host --------/                                      |
                                                        +--> Gateway
                                                        +--> AnyHarness

Desktop host --> DesktopBridge --> local AnyHarness / native operating system
Web host -----> desktop: null
```

At the end:

- Desktop and Web use the same pages, routes, components, hooks, stores,
  product workflows, Cloud SDK wiring, and AnyHarness SDK wiring.
- Desktop keeps local workspaces, local AnyHarness, SSH, and native behavior.
- Web exposes the same product for managed-cloud work and never pretends it can
  access the user's local machine.
- Host differences are passed through one typed `ProductHost`.
- Raw Tauri and browser-specific authentication code stay in the apps.
- The old Web pages, chat client, polling, stores, and controllers are gone.
- Shared connected Cloud surfaces follow ProductClient's standard component,
  access-hook, workflow-hook, and domain ownership layers.

## What ProductClient owns

`@proliferate/product-client` owns the connected product:

- Product pages and the authenticated route tree.
- Components and product UI.
- The canonical DOM component library under `src/primitives/**`.
- Hooks, stores, providers, and product lifecycles.
- Chat, transcript, workspaces, sessions, files, billing, integrations, and
  workflows.
- Shared authentication screens and the authentication gate.
- Cloud API queries and mutations.
- Managed-cloud gateway and AnyHarness behavior.
- Shared product telemetry events.

The host apps own only what genuinely depends on the environment:

- Desktop bootstrap, raw Tauri access, native auth transport, operating-system
  deep links, native process startup, and native telemetry installation.
- Web bootstrap, browser auth/cookies/PKCE, HTTPS callback entrypoints,
  browser URLs, and browser telemetry installation.

The host is not a second product service layer. It must not implement its own
workspace resolver, billing client, chat controller, gateway flow, or product
store.

## Target package and app shape

```text
apps/packages/product-client/
  src/
    ProductClient.tsx
    domain/                      # pure shared rules; Mobile-safe
    primitives/
      patterns/
      icons/
      utils/
      overlays/
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
      desktop-bridge.ts
      ProductHostProvider.tsx

apps/desktop/src/
  main.tsx
  providers/                    # Desktop host construction and mounting
  lib/access/tauri/             # raw Tauri/native implementation
  lib/integrations/             # Desktop vendor/auth adapters

apps/web/src/
  main.tsx
  WebHostApp.tsx
  web-host.ts
  index.css
  browser/                     # browser auth/callback implementation
```

The exact internal ProductClient folders follow the valid existing Desktop
organization. The move is an ownership extraction, not a redesign or a reason
to reorganize unrelated code.

## Package, build, and import boundary

ProductClient is a normal compiled workspace package.

- It builds TypeScript into `dist`.
- Desktop and Web consume its `dist` export-map subpaths.
- Its package manifest owns its dependencies, peer dependencies, scripts, and
  exports.
- React, React DOM, React Router, and React Query resolve to the same workspace
  runtime instances as the hosts; they are not bundled twice.
- Desktop and Web build, typecheck, and test ProductClient before bundling.
- CI and frontend structure checks scan the package root.
- ProductClient's connected tier may import concrete `#product/domain/<file>`
  modules, `design`, and the Cloud/AnyHarness SDKs in the allowed direction.
- ProductClient's nested `primitives/**` owner is a lower layer: it may import
  `design`, React/DOM-safe libraries, and itself, but not `#product/domain/*`,
  SDK/query clients, host code, or higher ProductClient layers.
- ProductClient's nested `domain/**` owner is pure and may not import React,
  DOM/RN code, SDK clients, access/query/store code, primitives, or higher
  ProductClient layers.
- ProductClient never imports `apps/desktop`, `apps/web`, `@tauri-apps/**`, raw
  Tauri `invoke`, or a Desktop-relative `@/` path.
- Hosts mount the product through public
  `@proliferate/product-client/<entrypoint>` subpaths and do not reach into
  internal primitives. Desktop and Web retain explicitly named `internal/*`
  seams where host assembly, authentication, or native/browser adapters depend
  on connected ProductClient owners; this contract does not broaden or narrow
  those established paths. A host adapter may also import a concrete
  `@proliferate/product-client/internal/domain/<file>` rule. Mobile is different:
  it may import only those concrete domain modules, never another internal
  subtree, the package root, or a domain barrel.

When the Desktop source moves, internal package imports use one package-local
mapping, `#product/*`, configured in ProductClient's package, TypeScript,
Vite, and Vitest setup. Existing Desktop `@/...` imports are mechanically
rewritten only for files that move. Retained Desktop host files keep their
Desktop-local imports. Direct imports remain the rule; this does not create a
barrel.

Assets and generated inputs move with their owner. Images, fonts, audio, raw
SVG/text imports, JSON catalogs, and generated registry imports must resolve
from ProductClient after the move. Native application resources remain in
Desktop. Both production host builds must prove that representative shared
assets are emitted and loadable.

## The one host contract

Desktop and Web each construct one immutable `ProductHost` value and pass it
to one `ProductHostProvider`. See [specs/FEATURE_DOCS/DESKTOP_HOST.md](../../../../../FEATURE_DOCS/DESKTOP_HOST.md)
for the host contract, DesktopBridge, and application-entry details.

## Deployment, Cloud, and AnyHarness

Both hosts use the same Cloud SDK and managed-cloud product behavior.

- Hosted Web receives one configured API base URL.
- Desktop may switch to another API URL for self-hosting and reset to its
  default deployment.
- Each host supplies the current Cloud client appropriate to its auth
  transport, replacing the host snapshot when that client or its authority
  changes.
- ProductClient owns Cloud queries, mutations, billing, workspace resolution,
  gateway lookup, and managed-cloud connection behavior.
- Both hosts use the same shared AnyHarness React providers and hooks for cloud
  workspaces.

API deployment selection is separate from local AnyHarness. Desktop must
always be able to discover its local runtime, list local workspaces and
sessions, create local work, and resume it. Desktop obtains the local runtime
connection through `DesktopBridge`; ProductClient then uses the normal
AnyHarness SDK. Web passes `desktop: null`, performs no local discovery, and
only uses runtimes available through the Cloud API and gateway.

This migration preserves the existing SDK cache and runtime lifecycle
behavior. A separate cache, authentication, client-lifecycle, or stream
hardening program is not a prerequisite for moving the product. If a concrete
existing lifecycle bug blocks the port, fix that bug narrowly and verify it;
do not turn the migration into a separate hardening program.

## Authentication

The visible authentication experience is shared. ProductClient owns the auth
gate, method selection, password forms, provider/SSO buttons, callback status
presentation, and transition into the product.

The hosts expose the same product-level operations: restore a session, start
a login, finish a host-decoded callback, cancel an in-flight provider login,
and log out. Only their transport implementations differ.

```text
Shared login screen
  -> auth.startLogin(...)
  -> host performs the transport-specific operation
  -> host publishes a new ProductHost/AuthState snapshot
  -> ProductClient renders the authenticated product
```

For Desktop provider login:

```text
ProductClient starts login
  -> Desktop opens the system browser
  -> provider redirects to proliferate://auth/callback
  -> Tauri receives and decodes the callback
  -> Desktop calls auth.finishLogin(...)
```

For Web provider login:

```text
ProductClient starts login
  -> Web redirects the browser
  -> provider redirects to the Web HTTPS callback
  -> the thin Web callback entry decodes it
  -> Web calls auth.finishLogin(...)
```

Raw callback URLs, cookies, PKCE values, native vault values, and credential
storage remain host-owned. ProductClient receives normalized auth state and
operations, not those transport details. Desktop and Web may render the same
shared callback status UI even though their entry mechanisms differ.

Before the Web host replaces the legacy app, a narrow browser-auth fixture
must prove callback cold load, repeated callback completion, provider error,
logout, and return to the intended shared product destination. This is a
transport contract, not a generalized callback queue or auth redesign.

## Storage, links, clipboard, and telemetry

### Storage

`ProductStorage` provides async `getItem`, `setItem`, and `removeItem` for
small, non-secret device-local product state such as appearance, drafts, and
recent selections.

The migration does not require preserving old Web storage or migrating
existing preference values between storage backends. Login credentials,
provider keys, SSH credentials, and PKCE secrets never use this interface.
Desktop-native persisted state such as SSH profiles or updater state remains
inside its Desktop owner.

### Links and routing

Internal product routing is shared and owned by ProductClient. Host-specific
link transport stays outside it:

- Web opens external links through the browser; Desktop asks the native shell
  to open the system browser.
- Web receives HTTPS locations; Desktop receives operating-system
  `proliferate://` deep links.
- Each host decodes raw input into a normalized `ProductEntry` and exposes
  initial and live entries through `ProductLinks`.
- Web may provide an `openInDesktop` action for local-only work.

The normalized entry must preserve every route field and query value needed by
the shared product, including repeated query values where current behavior
depends on them. Hosts decode transport; ProductClient owns product route
taxonomy, destination mapping, and route/screen telemetry.

The migration requires reliable initial-plus-live delivery and unsubscribe
cleanup. “Initial + live” means the host's current location/native snapshot
when a listener subscribes, followed by entries arriving while that listener
is active. Hosts do not retain and replay arbitrary earlier live entries.
Persistent delivery, retry, recovery, and generalized queues are not migration
prerequisites; add one only if a later focused product flow explicitly
requires and specifies it.

The thin Web host retains the real callback entrypoints required by its auth
and billing integrations. Old ordinary Web product URLs and presentation do
not have a backwards-compatibility requirement. OAuth, Stripe, invitation,
and other external URL producers are updated and smoke-tested as part of the
Web cutover.

### Clipboard

ProductClient calls one `writeText` operation. Web implements it with the
browser clipboard; Desktop implements it through its native/Tauri access.

### Telemetry

ProductClient emits the same product events and errors on both surfaces. Each
host constructs the telemetry implementation because release/runtime identity
and vendor initialization differ. ProductClient imports no Sentry, PostHog,
or Tauri telemetry SDK directly. Existing privacy, replay-masking, and payload
rules remain in force.

The host transports events to its vendor implementation; it does not define
product event names or decide which product route is active.

## Desktop-only behavior

See [specs/FEATURE_DOCS/DESKTOP_HOST.md](../../../../../FEATURE_DOCS/DESKTOP_HOST.md)
for Desktop-only product behavior, DesktopBridge groups, and the fail-closed mounting pattern.

## Styling and assets

See [specs/FEATURE_DOCS/DESKTOP_HOST.md](../../../../../FEATURE_DOCS/DESKTOP_HOST.md)
for the shared CSS boundary, Tailwind scanning contract, and surface marker setup.

## Migration preparation

Preparation is migration-specific:

1. Inventory existing product consumers of native Desktop functions.
2. Map each consumer to the narrow bridge operation it needs.
3. Classify root lifecycles as shared, Desktop product behavior behind the
   bridge, or raw Desktop host startup.
4. Create the compiled ProductClient package, host contract, provider, build,
   tests, and structure enforcement.
5. Establish shared CSS exports and ProductClient Tailwind scanning.
6. Remove the embedded browser rather than moving or bridging it.
7. Prove Desktop can use ProductHost while its source paths are still stable.

We do not pause this migration for unrelated existing bugs or speculative
hardening. Fix only an issue that concretely blocks extraction or causes a
behavior regression in a migration checkpoint.

## Migration sequence

Desktop remains the working baseline throughout. Each implementation PR owns
one coherent checkpoint, but the migration itself is this straightforward
sequence.

### 1. Establish the shared boundary — complete

- Create the compiled ProductClient package, shared CSS boundary,
  `ProductHost`, `DesktopBridge`, and `ProductHostProvider`.
- Remove the embedded browser instead of carrying it into the shared product.
- Construct and mount the real Desktop host while product files remain in
  `apps/desktop`.
- Prove one Desktop-only lifecycle mounts only behind `host.desktop`.

### 2. Route Desktop-only product behavior through the boundary

- Keep product source in `apps/desktop` while replacing product-facing direct
  Tauri/native access with the already-mounted bridge.
- Adopt native UI first, then local AnyHarness runtime access. Local runtime
  adoption proves the most important optional capability: Desktop can list,
  create, open, and resume local work while Web will mount none of it.
- Adopt remaining bridge consumers only in coherent, demand-driven slices.
  Do not create work merely to exercise every bridge group.
- Keep raw Tauri startup, sidecar/process startup, native auth transport, and
  vendor installation in the Desktop host.

### 3. Prove extraction readiness

Before the large source move, close only the mechanics that make that move
safe and scriptable:

- fix the final host mounting envelope described above;
- prove the compiled ProductClient preserves dynamic imports, generated
  inputs, CSS, fonts, and representative assets in both a Desktop build and a
  browser-host build;
- make any narrow route/query/auth/telemetry contract corrections required by
  the real consumers, without starting a general lifecycle-hardening program;
- finish the move/split/retain/delete file ledger and the `@/` to `#product/`
  import codemod; and
- prove a minimal browser host can mount the provider contract with
  `desktop: null` and that migration-boundary checks fail closed.

### 4. Mechanically move Desktop into ProductClient

- Move Desktop's product pages, routes, components, hooks, stores, product
  providers, product logic, tests, assets, and shared lifecycles into
  ProductClient.
- Rewrite moved internal imports with the verified codemod and move each
  dependency or asset with its owner.
- Have Desktop import and mount the compiled ProductClient completely.
- Leave only the thin native host, native implementations, bootstrap, and
  host-specific CSS in `apps/desktop`.
- Do not redesign the product or leave duplicate old/new ownership paths.

### 5. Replace the legacy Web product — complete (pending review)

- Delete the duplicate Web pages, chat implementation, polling, stores,
  controllers, and product-specific logic.
- Keep only the thin browser bootstrap and raw browser-owned auth/callback,
  storage, link, clipboard, telemetry, deployment, and Cloud-client adapters.
- Pass `desktop: null` and mount the same compiled ProductClient and shared
  product CSS used by Desktop.

### 6. Qualify and cut over hosted Web

- Build and test both production hosts and prove their bundles contain the
  expected ProductClient chunks, CSS, fonts, and assets.
- Verify managed-cloud workspaces and gateway AnyHarness behavior through the
  same shared implementation on Desktop and Web.
- Verify Desktop still supports local work and Web contains no Tauri/native
  imports and starts no local-runtime, local-workspace, or SSH behavior.
- Verify auth start/callback/logout, inbound links, billing returns, and the
  external URL/configuration producers used by hosted Web.
- Enforce the recorded Web first-load performance budget before cutover.

### 7. Follow up with self-hosted Web

After hosted Web cleanly mounts ProductClient, add the configuration,
deployment, and documentation needed to point Web at a self-hosted server.
The common host contract must support this direction, but self-hosted Web is
not a hosted-Web cutover requirement.

## Verification by checkpoint

### Foundation

- ProductClient builds cleanly from a fresh dependency build and emits `dist`.
- Its exported host types/provider resolve through the package export map.
- ProductClient tests run in CI.
- Frontend enforcement scans ProductClient and rejects host imports, Tauri,
  raw `invoke`, and Desktop-relative `@/` imports.
- A provider test proves a host is observable and Web can pass
  `desktop: null`.
- The Tailwind source assertion fails loudly if ProductClient scanning is
  removed.

### Desktop adoption and move

- Desktop typechecks, tests, and builds at each checkpoint.
- Focused native-boundary tests cover every bridge group that has a consumer.
- Desktop rendering and product behavior remain unchanged.
- Local and cloud workspaces both function.
- Moved tests run from ProductClient; no duplicate product path remains.
- ProductClient contains no raw Tauri or host-auth implementation.

### Web cutover

- Web typechecks, tests, and production-builds with ProductClient.
- Shared Playwright journeys run against both host renderers where the feature
  exists on both; native-only flows retain a Desktop lane.
- Web login and callback routes load without eagerly pulling large editor,
  terminal, or authenticated-only chunks.
- Route-level splitting keeps the hosted Web first load within an explicitly
  recorded budget measured before and after cutover; a material regression
  requires review rather than a silent budget increase.
- Cloud create/open/resume, chat, transcript, files, settings, billing,
  integrations, and workflows use the shared implementation.
- Web has no local AnyHarness discovery or direct SSH behavior.
- External auth/billing return URLs are verified against the deployed host.

## Completion criteria

The migration is complete when:

- Desktop and Web import and mount the same compiled ProductClient.
- Desktop preserves its current visual and behavioral product baseline.
- Desktop retains local AnyHarness, local workspace, SSH, updater, worker,
  local automation, and native support behavior through the typed bridge.
- Web receives the same managed-cloud product experience and exposes no fake
  local capability.
- ProductClient owns the product pages, routes, UI, hooks, stores, Cloud,
  gateway, and AnyHarness behavior.
- ProductClient's nested `src/domain/**` owns pure rules shared with Mobile;
  connected Desktop/Web-only rules remain in `src/lib/domain/**`.
- ProductClient contains no raw Tauri access, browser auth transport, or
  vendor-specific host implementation.
- Connected Cloud billing, organization SSO, cloud-environment, and workflow
  surfaces live in ProductClient's component, access, workflow, and domain
  owners rather than a separate package.
- The old Web product implementation and embedded browser are gone.
- Both hosts build, test, and deploy cleanly with the shared CSS and assets.

## Current state and related docs

The ProductClient foundation currently provides the compiled package, typed
host/bridge contracts, provider, focused tests, build/CI wiring, and structure
enforcement. Shared `product.css`, Desktop-only CSS, and ProductClient Tailwind
scanning are established separately. The embedded workspace browser and its
native child-WebView capability have been removed.

Desktop now mounts the product through the typed host boundary and, after the
mechanical extraction, is a thin native host: the working product source moved
into `@proliferate/product-client` while native UI, local runtime, files,
credentials, SSH, updater, support, shared identity, navigation, storage, and
telemetry all route through that boundary (the Desktop product move — PR
#1215, merge `c6e094b41`).

The legacy Web replacement has also landed. The duplicate Web product is
deleted and `apps/web` is now a thin browser host that mounts the same
compiled ProductClient with `desktop: null`, keeping only browser-owned
auth/callback, storage, links, clipboard, telemetry, deployment, and
Cloud-client adapters (the legacy Web replacement — PR #1229, merge
`d8ceabb4e`).

Desktop and hosted Web were qualified against the shared implementation and
cut over. The phase-6 first-load budget caps come from founder decision
WDU-1247-D1 (2026-07-15) and are enforced by
`scripts/measure-login-runtime-budget.mjs`. The migration's slice-level
evidence records and bundle-baseline ledgers lived under `migration/` in this
directory and are retained in git history; the durable application-entry
contract remains
[`specs/FEATURE_DOCS/DESKTOP_HOST.md`](../../../../../FEATURE_DOCS/DESKTOP_HOST.md).

Related authoritative docs:

- Frontend structure:
  [`specs/frontend/README.md`](../../../../../frontend/README.md)
- Frontend packages:
  [`specs/frontend/packages.md`](../../../../../frontend/packages.md)
- Styling:
  [`specs/frontend/styling.md`](../../../../../frontend/styling.md)
- Telemetry:
  [`specs/frontend/telemetry.md`](../../../../../frontend/telemetry.md)
- CI/CD and release:
  [`../../../../../../guides/deploying/README.md`](../../../../../../guides/deploying/README.md)
- Testing:
  [`specs/TESTING.md`](../../../../../TESTING.md)

Older planning notes are history. This spec wins when they disagree with the
simplified migration above.
