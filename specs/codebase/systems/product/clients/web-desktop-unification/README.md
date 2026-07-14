# Web/Desktop Client Unification

Status: authoritative for the Web/Desktop client unification migration.

This spec defines the product boundary, host boundary, migration sequence, and
acceptance criteria. It intentionally does not redefine authentication,
billing, chat, workspace, workflow, or other feature behavior; the focused
feature specs remain authoritative for those behaviors.

Scope: `apps/desktop`, `apps/web`, and the shared DOM packages under
`apps/packages/**`. Mobile is outside this migration and must remain DOM-free.

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
- `@proliferate/product-surfaces` remains a separate package. ProductClient may
  consume it; absorbing it is an optional later cleanup.

## What ProductClient owns

`@proliferate/product-client` owns the connected product:

- Product pages and the authenticated route tree.
- Components and product UI.
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

apps/packages/product-surfaces/
  src/                         # remains a separate connected-surfaces package

apps/desktop/src/
  main.tsx
  desktop-host.ts
  index.css
  native/                      # raw Tauri/native implementation

apps/web/src/
  main.tsx
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
- ProductClient may import `product-surfaces`, `product-ui`, `product-domain`,
  `ui`, `design`, and the Cloud/AnyHarness SDKs in the allowed direction.
- ProductClient never imports `apps/desktop`, `apps/web`, `@tauri-apps/**`, raw
  Tauri `invoke`, or a Desktop-relative `@/` path.
- Hosts import public `@proliferate/product-client/<entrypoint>` subpaths and do
  not reach into the package's internal hooks or stores.

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
to one `ProductHostProvider`:

```ts
interface ProductHost {
  surface: "desktop" | "web";
  deployment: ProductDeploymentHost;
  auth: ProductAuthHost;
  cloud: { client: ProliferateCloudClient | null };
  storage: ProductStorage;
  links: ProductLinks;
  clipboard: ProductClipboard;
  telemetry: ProductTelemetry;
  desktop: DesktopBridge | null;
}
```

`cloud.client` is the host's current Cloud client. It may make anonymous
requests before login and authenticated requests after the host resolves an
authority; `null` means the host cannot currently construct a usable client.

There is not a provider tree for each capability. Product code normally checks
the capability it needs, especially `host.desktop !== null`, rather than
scattering `surface === "desktop"` checks through the product.

The host value is a reactive snapshot. When authentication, deployment, or
the Cloud client changes, the host app provides a new `ProductHost` object so
ordinary React context consumers update. `ProductHostProvider` preserves the
identity it is given; it does not clone a host or hide host mutations.

Each thin app owns the environment infrastructure needed to mount the shared
product: its React root, router transport, Query client, Cloud-client
construction/provider, and `ProductHostProvider`. ProductClient owns product
providers, product routes, stores, and product lifecycles. This distinction
does not give either host a second copy of product behavior.

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

Raw native startup remains app-owned: Tauri initialization, native window
setup, sidecar/process startup, operating-system deep-link registration, and
vendor installation run from the Desktop host.

Product-aware Desktop behavior may live in ProductClient behind the optional
bridge. It mounts only when a Desktop bridge exists:

```tsx
function ProductLifecycleRoot() {
  const host = useProductHost();

  return (
    <>
      <SharedProductLifecycles />
      {host.desktop ? (
        <DesktopProductLifecycles desktop={host.desktop} />
      ) : null}
    </>
  );
}
```

Because Web passes `desktop: null`, Desktop-only hooks, effects, queries, and
listeners never mount there. Presentation-only differences may use the surface
marker; CSS hiding is not a substitute for not mounting native behavior.

Desktop-only product lifecycles include local runtime UI, local automation,
worker enrollment tied to product auth, updater watching/presentation, native
menu command handling, local-agent credential synchronization, SSH/tunnel UI,
and native support/diagnostic collection.

## DesktopBridge

`DesktopBridge` is a typed set of product-level native capabilities. It is
implemented in `apps/desktop` and consumed by ProductClient. It does not expose
raw Tauri command names, generic `invoke`, generic process execution, or a
general filesystem API.

The bridge groups are:

| Group | Why ProductClient needs it |
| --- | --- |
| `runtime` | Discover or restart the local AnyHarness runtime and return its base URL/token connection. |
| `files` | Pick a local directory, inspect basic path availability, list/open editor/finder/terminal/copy targets, reveal paths, and open terminals. |
| `localCredentials` | Read and update local agent/provider credentials; never Proliferate login credentials. |
| `nativeUi` | Render native context menus, receive native commands, set running-agent quit protection, update Dock attention, and control WebView zoom. |
| `updater` | Report updater support/version, check, download with progress, install, and relaunch while preserving the opaque native update handle. |
| `worker` | Read the install id and ensure or stop the Desktop worker process. |
| `ssh` | Persist SSH profiles and establish a tunnel that yields a normal AnyHarness connection. |
| `scratch` | Preserve current local file-backed workspace scratch reads and writes. |
| `diagnostics` | Write narrow renderer events, collect support bundles, save reports, and stage/read/delete support attachments. |

Repo inspection, git, worktrees, workspaces, sessions, chat, and transcript are
not bridge operations; they continue through AnyHarness. Product auth,
deployment selection, links, storage, clipboard, telemetry, and Cloud behavior
use their normal ProductHost groups rather than being duplicated in the
Desktop bridge.

The initial DesktopBridge may implement methods for the known inventoried
consumers before those call sites migrate, as Desktop Host Adoption did. New
methods beyond that inventory remain demand-driven: add one only when an
actual consumer needs it, and preserve the concrete Desktop behavior and
return shape at that boundary. The embedded browser is removed, not bridged.

## Styling and assets

Web renders the Desktop product visual system. The shared CSS boundary is:

```text
apps/packages/design/src/css/
  dom.css       Tailwind setup, reset, tokens, and package source scanning
  product.css   shared product theme and global product styling
  desktop.css   genuine Desktop/native presentation overrides only

apps/desktop/src/index.css
  imports product.css, desktop.css, and required third-party CSS

apps/web/src/index.css
  imports product.css and required third-party CSS
```

The Tailwind entry explicitly scans every DOM package that emits classes:

```css
@source "../../../ui/src";
@source "../../../product-ui/src";
@source "../../../product-surfaces/src";
@source "../../../product-client/src";
```

The ProductClient source line is required before JSX moves. Without it, both
apps can compile while Tailwind silently omits classes from the moved product.

Each host sets its surface before React renders:

```ts
document.documentElement.dataset.proliferateClient = "desktop";
```

or:

```ts
document.documentElement.dataset.proliferateClient = "web";
```

The marker may drive genuine styling differences. Capability behavior remains
controlled by ProductHost and the optional Desktop bridge.

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

### 5. Replace the legacy Web product

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
- ProductClient contains no raw Tauri access, browser auth transport, or
  vendor-specific host implementation.
- Product-surfaces remains a separate package unless deliberately consolidated
  in a later change.
- The old Web product implementation and embedded browser are gone.
- Both hosts build, test, and deploy cleanly with the shared CSS and assets.

## Current state and related docs

The ProductClient foundation currently provides the compiled package, typed
host/bridge contracts, provider, focused tests, build/CI wiring, and structure
enforcement. Shared `product.css`, Desktop-only CSS, and ProductClient Tailwind
scanning are established separately. The embedded workspace browser and its
native child-WebView capability have been removed.

Desktop Host Adoption revision r2 is complete at PR #1157 merge
`a76ab5911e2af39593b4b31530535f0811a3558b`. It constructs the real
Desktop-owned host and complete inventoried bridge, mounts the existing
Desktop product beneath `ProductHostProvider`, replaces the immutable host
snapshot when its documented reactive inputs change, and gates running-agent
export through one Desktop-only product-lifecycle root. The complete contract
and acceptance record is
[`web-desktop-client-unification-d1a.md`](migration/d1a.md).

Desktop Native UI Adoption is complete at PR #1165 merge
`736d181575e4d81389d19ba7a78afd14566e1fda`. It routes existing native menus,
native menu commands, Dock attention, and Desktop zoom through the merged
`host.desktop.nativeUi` boundary while product files stay under
`apps/desktop`. The complete contract is
[`web-desktop-client-unification-d1b.md`](migration/d1b.md).

Desktop Local Runtime Adoption is the current implementation slice. It routes
product-owned local AnyHarness discovery, restart, readiness, and connection
through `host.desktop.runtime`, moves initial bootstrap under the existing
Desktop-only product-lifecycle root, and leaves raw sidecar process ownership
in Desktop. The complete living contract is
[`web-desktop-client-unification-d1c.md`](migration/d1c.md).

Related authoritative docs:

- Frontend structure:
  [`../../../../structures/frontend/README.md`](../../../../structures/frontend/README.md)
- Frontend packages:
  [`../../../../structures/frontend/packages/README.md`](../../../../structures/frontend/packages/README.md)
- Styling:
  [`../../../../structures/frontend/guides/styling.md`](../../../../structures/frontend/guides/styling.md)
- Telemetry:
  [`../../../../structures/frontend/guides/telemetry.md`](../../../../structures/frontend/guides/telemetry.md)
- CI/CD and release:
  [`../../../../../developing/deploying/ci-cd.md`](../../../../../developing/deploying/ci-cd.md)
- Testing:
  [`../../../../../developing/testing/README.md`](../../../../../developing/testing/README.md)

The older documents under `specs/tbd/` are planning history. This spec wins
when they disagree with the simplified migration above.
