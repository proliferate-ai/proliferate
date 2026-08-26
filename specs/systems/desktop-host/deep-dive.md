# Desktop Host

> Ownership: this document is the depth reference for the **desktop-host** system spec ([README.md](README.md)). Laws, owned state, fences and the checked code map are authoritative there; flow-level detail stays here.

Read before touching: `apps/desktop/`, `apps/packages/product-client/`, `apps/packages/product-client/src/host/`, `apps/packages/product-client/src/app/ProductClient.tsx`

This doc owns the web bundle ↔ native shell ↔ sidecar seam. It does not own native-only product standards (supervisor/worker convergence ownership, native-specific build/release/test mechanics) → `specs/systems/desktop-host/desktop-native.md`. It does not own cross-plane managed-runtime orchestration or deployment → `specs/systems/harnesses/managed-runtime.md`.

## Mental model

Desktop and Web mount the same compiled product implementation through a typed host boundary. The Desktop host is a thin native shell that provides Desktop-specific capabilities through `DesktopBridge` while the Web host passes `desktop: null`. The boundary keeps raw Tauri, browser auth, vendor SDKs, and native process management out of the shared product while preserving Desktop-only product lifecycles behind the optional bridge.

```text
Desktop host ----\
                  +--> ProductHostProvider --> ProductClient --> Cloud API
Web host --------/                                      |
                                                        +--> Gateway
                                                        +--> AnyHarness

Desktop host --> DesktopBridge --> local AnyHarness / native operating system
Web host -----> desktop: null
```

## How it works

### The one host contract

Desktop and Web each construct one immutable `ProductHost` value and pass it to one `ProductHostProvider`:

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

`cloud.client` is the host's current Cloud client. It may make anonymous requests before login and authenticated requests after the host resolves an authority; `null` means the host cannot currently construct a usable client.

There is not a provider tree for each capability. Product code normally checks the capability it needs, especially `host.desktop !== null`, rather than scattering `surface === "desktop"` checks through the product.

The host value is a reactive snapshot. When authentication, deployment, or the Cloud client changes, the host app provides a new `ProductHost` object so ordinary React context consumers update. `ProductHostProvider` preserves the identity it is given; it does not clone a host or hide host mutations.

Each thin app owns the environment infrastructure needed to mount the shared product: its React root, router transport, Query client, Cloud-client construction/provider, and `ProductHostProvider`. ProductClient owns product providers, product routes, stores, and product lifecycles. This distinction does not give either host a second copy of product behavior.

### DesktopBridge

`DesktopBridge` is a typed set of product-level native capabilities. It is implemented in `apps/desktop` and consumed by ProductClient. It does not expose raw Tauri command names, generic `invoke`, generic process execution, or a general filesystem API.

The bridge groups are:

| Group | Why ProductClient needs it |
| --- | --- |
| `runtime` | Discover or restart the local AnyHarness runtime and return its base URL/token connection. |
| `files` | Pick a local directory, inspect basic path availability, recover absolute paths for the drag session just dropped onto the webview, list/open editor/finder/terminal/copy targets, reveal paths, and open terminals. |
| `localCredentials` | Read and update local agent/provider credentials; never Proliferate login credentials. |
| `nativeUi` | Render native context menus, receive native commands, set running-agent quit protection, update Dock attention, and control WebView zoom. |
| `updater` | Report updater support/version, check, download with progress, install, and relaunch while preserving the opaque native update handle. |
| `worker` | Read the install id and ensure or stop the Desktop worker process. |
| `scratch` | Preserve current local file-backed workspace scratch reads and writes. |
| `diagnostics` | Hand an ownership-checked bounded renderer batch to native collector ingest, acknowledge root render-error admission, collect support bundles, save reports, and stage/read/delete support attachments. ProductClient producers use the platform-neutral renderer diagnostics port rather than the bridge directly. |

Repo inspection, git, worktrees, workspaces, sessions, chat, and transcript are not bridge operations; they continue through AnyHarness. Product auth, deployment selection, links, storage, clipboard, telemetry, and Cloud behavior use their normal ProductHost groups rather than being duplicated in the Desktop bridge.

Desktop-local path inspection is one narrow typed bridge operation. The host accepts an absolute candidate and returns exactly `file`, `directory`, `missing`, or `unavailable` with the bounded reason `invalid_path`, `permission_denied`, `unsupported_type`, or `io_error`. The renderer adapter validates that exact path-free union from an unknown native payload; malformed payloads reject with fixed protocol copy, and native transport failures remain rejections. Inspection follows the final filesystem link and reports metadata at that moment. It neither establishes that a reference belongs to the local machine nor guarantees that a later open will succeed.

Home-directory lookup is also fail closed. Desktop caches a successful native lookup, but rejection remains rejection; there is no development or browser fallback path.

The initial DesktopBridge may implement methods for the known inventoried consumers before those call sites migrate, as Desktop Host Adoption did. New methods beyond that inventory remain demand-driven: add one only when an actual consumer needs it, and preserve the concrete Desktop behavior and return shape at that boundary. The embedded browser is removed, not bridged.

Root render-error reporting is one diagnostics operation with an acknowledged result: Desktop resolves success only after a coherent collector receipt proves the indexed record accepted-or-duplicate, or an identical fingerprint has that same proof in the preceding three seconds. It is not a persistence, upload, fallback, or current-health guarantee. ProductClient keeps neutral sending copy until that result, reports failure or absence honestly, and contains reporter throws/rejections so the recovery surface cannot recursively fail.

The collector handoff is deliberately narrow: only the main window may submit accepted `desktop_renderer`/`renderer` schema-v1.1 records and receive an ingest receipt. It does not expose collector health, queries, endpoint, capability, or export to the bridge. Desktop owns one filtered, bounded renderer sink; the old renderer diagnostics file receives no new writes. An eligible error returned directly before authenticated dispatch may retain the already-filtered records through the native fallback pipeline while preserving the original error. Once dispatch begins, every transport, receipt, replacement, deadline, and protocol failure remains a renderer delivery loss and never falls back.

### Desktop-only product behavior

Raw native startup remains app-owned: Tauri initialization, native window setup, diagnostics collector supervision and query brokering, the protected child diagnostics bridge carried by owned AnyHarness/Worker launches on supported macOS targets, sidecar/process startup, operating-system deep-link registration, and vendor installation run from the Desktop host. On supported Desktop builds the collector startup barrier resolves before owned AnyHarness starts; Worker ensure observes that same barrier. A degraded observability path releases product startup.

Product-aware Desktop behavior may live in ProductClient behind the optional bridge. It mounts only when a Desktop bridge exists:

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

Because Web passes `desktop: null`, Desktop-only hooks, effects, queries, and listeners never mount there. Presentation-only differences may use the surface marker; CSS hiding is not a substitute for not mounting native behavior.

Desktop-only product lifecycles include local runtime UI, local automation, worker enrollment tied to product auth, updater watching/presentation, native menu command handling, local-agent credential synchronization, and native support/diagnostic collection. Host-owned window-lifetime behavior, including native appearance synchronization, is installed by the Desktop entry instead of crossing the product bridge. Native appearance follows the hydrated selected color mode: explicit light or dark modes set an AppKit override, while system mode clears the override so AppKit continues following the OS.

### Application-entry contract

This is the required application-entry shape for the mechanical extraction of the Desktop product into `@proliferate/product-client`.

#### Reserved source paths

```text
apps/packages/product-client/src/ProductClient.tsx
apps/packages/product-client/src/app/AuthenticatedProductClient.tsx
```

- `ProductClient.tsx` is the only public product entry.
- `AuthenticatedProductClient.tsx` is internal and lazy-loaded from
  `#product/app/AuthenticatedProductClient`.
- Neither file exists in the landed mechanics proof. The mechanical extraction
  creates both from the existing Desktop product.

#### Public export subpath

The only public product entry is exported as `@proliferate/product-client/ProductClient`:

```json
{
  "./ProductClient": {
    "types": "./dist/ProductClient.d.ts",
    "import": "./dist/ProductClient.js"
  }
}
```

The mechanical extraction emits `dist/ProductClient.{js,d.ts}` and adds this export. Until then, the package carries a **temporary** public canary export that stands in for it and is deleted when the real entry lands:

```json
{
  "./qualification/ProductClientBuildCanary": {
    "types": "./dist/qualification/ProductClientBuildCanary.d.ts",
    "import": "./dist/qualification/ProductClientBuildCanary.js"
  }
}
```

#### Mount signature

```ts
export type ProductRoutesComponent = ComponentType<RoutesProps>

export interface ProductClientProps {
  RoutesComponent: ProductRoutesComponent
}

export function ProductClient({
  RoutesComponent,
}: ProductClientProps): ReactElement
```

- `ProductClient` receives exactly one host-infrastructure prop,
  `RoutesComponent`.
- Desktop and Web pass their existing Sentry-instrumented `InstrumentedRoutes`;
  the qualification browser host passes plain React Router `Routes`.
- `RoutesComponent` carries the host's Sentry instrumentation so ProductClient
  never imports Sentry. It is **not** stored in `ProductHost` and does **not**
  define product routes.
- ProductClient owns the product provider root, product route declarations, and
  product lifecycles beneath the envelope below.

#### Provider envelope

```text
BrowserRouter
  -> QueryClientProvider
  -> CloudClientProvider
  -> ProductHostProvider
  -> ProductClient(RoutesComponent = host InstrumentedRoutes)
```

The browser qualification fixture passes `surface: "web"` and `desktop: null`; any local/native lifecycle fails closed by not mounting.

#### Package-private `#product/*` import mechanism

Moved modules resolve package-private imports through the compiled package:

```json
{
  "imports": {
    "#product/*": {
      "types": "./src/*",
      "default": "./dist/*.js"
    }
  }
}
```

- Runtime/host-build resolution (`default`) resolves `#product/*` to compiled
  `dist/*.js` and must **never** resolve back into `src`.
- In-package TypeScript resolves `#product/*` types to `src` via the `types`
  condition and a mirrored tsconfig `paths` entry
  (`"#product/*": ["./src/*"]`).
- Vitest resolves `#product/*` to `src` via a `resolve.alias` entry so tests run
  against source.
- Plain `tsc` does not rewrite the `#product/*` specifiers; it emits them
  verbatim, and Node/Vite resolve them through the package `imports` map at
  runtime/host-build time. This is what proves the compiled mechanism.

#### Public-shell / lazy-authenticated split

`ProductClient` is a lightweight public/auth shell. The authenticated product root is internal and lazy-loaded via `#product/app/AuthenticatedProductClient`, so Web login and callback entrypoints do not eagerly load editor, terminal, or other authenticated-only chunks. Connected repository/workspace action hosts also mount inside that authenticated root; they must not be imported by the public `App` shell. The mechanical move applies this exact shape to the real Desktop product.

#### Reserved-file rule

- `src/ProductClient.tsx` and `src/app/AuthenticatedProductClient.tsx` are
  reserved names owned by the mechanical move.
- The landed mechanics proof does not create them, export `./ProductClient`,
  or import Desktop source into the package.

#### Landed qualification canary

The contract is qualified — without moving the product — by:

```text
apps/packages/product-client/src/qualification/
  ProductClientBuildCanary.tsx              # public/auth shell; props mirror ProductClientProps
  AuthenticatedProductClientBuildCanary.tsx # lazy-loaded via #product/qualification/...
  canary-lazy-chunk.tsx                     # additional on-demand chunk
  assets/**                                 # png, svg (url + ?raw), json (?raw + normal), mp3
apps/packages/product-client/src/assets.d.ts  # ambient resource/CSS/font declarations
apps/packages/product-client/scripts/copy-qualification-assets.mjs  # tsc-only asset copy into dist
```

The canary's prop shape is typed locally (`ProductClientBuildCanaryProps`); it is a stand-in for `ProductClientProps` and is deleted with the rest of the canary when the real entry lands. Because plain `tsc` cannot transform `?raw`, asset-URL, CSS, or font imports, the ambient declarations keep the canary's declaration-level build passing while the Vite host builds resolve and emit the real resource URLs; the post-build copy script mirrors the resource inputs into `dist/qualification/assets/**` for dist consumers.

### Styling and assets

```text
BrowserRouter
  -> QueryClientProvider
  -> CloudClientProvider
  -> ProductHostProvider
  -> ProductClient(RoutesComponent = host InstrumentedRoutes)
```

The browser qualification fixture passes `surface: "web"` and `desktop: null`; any local/native lifecycle fails closed by not mounting.

#### Package-private `#product/*` import mechanism

Moved modules resolve package-private imports through the compiled package:

```json
{
  "imports": {
    "#product/*": {
      "types": "./src/*",
      "default": "./dist/*.js"
    }
  }
}
```

- Runtime/host-build resolution (`default`) resolves `#product/*` to compiled
  `dist/*.js` and must **never** resolve back into `src`.
- In-package TypeScript resolves `#product/*` types to `src` via the `types`
  condition and a mirrored tsconfig `paths` entry
  (`"#product/*": ["./src/*"]`).
- Vitest resolves `#product/*` to `src` via a `resolve.alias` entry so tests run
  against source.
- Plain `tsc` does not rewrite the `#product/*` specifiers; it emits them
  verbatim, and Node/Vite resolve them through the package `imports` map at
  runtime/host-build time. This is what proves the compiled mechanism.

#### Public-shell / lazy-authenticated split

`ProductClient` is a lightweight public/auth shell. The authenticated product root is internal and lazy-loaded via `#product/app/AuthenticatedProductClient`, so Web login and callback entrypoints do not eagerly load editor, terminal, or other authenticated-only chunks. Connected repository/workspace action hosts also mount inside that authenticated root; they must not be imported by the public `App` shell. The mechanical move applies this exact shape to the real Desktop product.

### Styling and assets

Web renders the Desktop product visual system. The shared CSS boundary is:

```text
apps/packages/design/src/css/
  product.css   Tailwind setup, reset, package source scanning, shared product
                theme and global product styling
  desktop.css   genuine Desktop/native presentation overrides only

apps/packages/product-client/src/index.css
  imports product.css (rides with the eager ProductClient entry; xterm CSS
  loads lazily with the terminal chunk)

apps/desktop/src/main.tsx
  imports desktop.css

apps/web/src/index.css
  imports product.css (import-only; the Web host carries no bespoke CSS)
```

The Tailwind entry explicitly scans ProductClient, the single DOM product source root:

```css
@source "../../../product-client/src";
```

The ProductClient source line covers all product JSX. Without it, both apps can compile while Tailwind silently omits product classes.

Each host sets its surface before React renders:

```ts
document.documentElement.dataset.proliferateClient = "desktop";
```

or:

```ts
document.documentElement.dataset.proliferateClient = "web";
```

The marker may drive genuine styling differences. Capability behavior remains controlled by ProductHost and the optional Desktop bridge.

## Laws

None yet. The boundary is structural, not a source of runtime invariants that can be violated.

## Tried and rejected

None yet. This is the first-generation design.

## Gaps

None known. The extraction is complete and both hosts mount the same compiled ProductClient.
