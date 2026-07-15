# Replace Legacy Web with the Shared Product (D1i)

> **Status:** Landed on the slice branch
> `codex/replace-legacy-web-with-product-client`, pending review and merge. This
> is the historical record of the fifth migration slice: the legacy Web product
> was deleted and Web now mounts the compiled `@proliferate/product-client` from
> a thin browser host with `surface: "web"` and `desktop: null`.

- Contract: [`05 - Replace Legacy Web with the Shared Product`](../README.md)
  (centralized packet, exact base `c6e094b41`).
- Predecessor record: [`d1h.md`](d1h.md) (the Desktop move that created the
  `@proliferate/product-client` package this slice mounts).
- Binding cutover baseline artifact:
  [`web-bundle-baseline-c6e094b41.json`](web-bundle-baseline-c6e094b41.json).

## What landed and is verified

The old Web product (pages, chat implementation, stores, controllers, polling,
product hooks/domain, product copy/fixtures, AnyHarness access, and the
Web-specific route tree) is deleted in one buildable PR. `apps/web` is now a
thin browser host: it constructs one immutable `ProductHost`, mounts the
compiled ProductClient and shared product CSS, and terminates only browser
protocols (auth/billing/integration callbacks and the bounded GitHub-App
returns) in a narrow route envelope beside the ProductClient catch-all.

There is no checkpoint with a broken or empty Web app. Desktop and Web now
render the same ProductClient; Web owns browser transport only.

### Deletion / realization counts (base `c6e094b41` → slice head)

| Measure | Value |
| --- | --- |
| `apps/web/src` files, base → head | **111 → 33** |
| `apps/web/src` name-status | **100 deleted, 22 added, 4 modified** |
| `apps/web` diffstat | **129 files, +2,769 / −10,932** |
| Whole-PR file count (incl. lockfile + `scripts/verify-web-host-bundle.mjs` + spec docs) | 134 |

Removed subtrees (each verified absent post-slice): `apps/web/src/components/**`,
`hooks/**`, `stores/**`, `pages/**`, `lib/domain/{chat,home,sidebar}/**`,
`lib/access/anyharness/**`, `copy/**`, `lib/fixtures/**`, and
`lib/access/cloud/auth-token-store.ts` (production bearer-token persistence).

### Target Web tree — realized

All 18 target-tree `src` files from the contract exist. `apps/web/src` fails
closed: every one of the 33 surviving files is a target-tree file, an
explicitly ledger-retained browser-owned primitive, or a colocated adapter
test. Full enumeration in the final sweep section below.

### Package / build wiring

- `apps/web/package.json`: dropped the Web-only product dependencies
  (`@anyharness/sdk`, `@anyharness/sdk-react`, `@proliferate/product-surfaces`,
  `@proliferate/product-ui`, `@proliferate/ui`, `lucide-react`,
  `tailwind-merge`) and added `@proliferate/product-client`. `build`/`typecheck`
  now build only ProductClient before `tsc`/`vite`. Test-only deps added
  (`@testing-library/{dom,react}`, `jsdom`).
- `apps/web/vite.config.ts`: `resolve.dedupe: ["react", "react-dom"]` so
  React/React-DOM resolve to the single workspace runtime shared with the
  package; no product `@/` aliases remain.
- `apps/web/src/index.css`: reduced to an import-only shared entry
  (`@import "@proliferate/design/product.css"`); the Web host carries no bespoke
  CSS (previously imported `dom.css` and defined tokens locally).

## Host adapter inventory (`web-host.ts` → `ProductHost`)

`useWebProductHost()` mirrors Desktop's `DesktopProductHostProvider` shape: it
reads the reactive browser session (`WebCloudRoot`) plus the authenticated
viewer, derives the shared `AuthState`, and returns one immutable snapshot that
is replaced only when auth state, resolved readiness, or Cloud-client authority
changes. Static adapters keep stable identity across replacements.

| ProductHost group | Web implementation | Notes |
| --- | --- | --- |
| `surface` | `"web"` | `document.documentElement.dataset.proliferateClient = "web"` at bootstrap. |
| `desktop` | **always `null`** | No local runtime, workspace, SSH, updater, worker, native menu, or native filesystem lifecycle mounts. Proven by `web-host.test.tsx`. |
| `auth` | `createWebAuthOperations` (`browser/auth/web-auth-transport.ts`) | `startLogin`/`finishLogin`/`restoreSession`/`logout`/`cancel`; consolidates `web-auth-flow.ts` + `pkce.ts` (PKCE/cookie/CSRF/session stay browser-owned). Anonymous methods: `github`, `google`, `sso`. |
| `cloud.client` | `createWebCloudClient` + `getWebSandboxGatewayAccessToken` | Reuses the exact client `WebCloudRoot` built; arms the sandbox-gateway token provider with the web session accessor. Constructs no second client. |
| `deployment` | `webEnv.apiBaseUrl` | No `switchDeployment` on Web. |
| `storage` | `webProductStorage` (`browser/storage`) | `localStorage`-backed `ProductStorage`; non-secret device-local state only. |
| `links` | `webProductLinks` (`browser/links`) | Decodes HTTPS locations into normalized `ProductEntry`; `initial + live`; `openInDesktop` for local-only work. |
| `clipboard` | `webProductClipboard` | `navigator.clipboard.writeText`. |
| `telemetry` | `webProductTelemetry` + `install-web-telemetry.ts` | PostHog/Sentry vendor transport implementing `ProductTelemetry` (incl. `routeChanged`, `getAnonymousInstallId → null`); measurement sink not armed (no-op default is the Web behavior). Web passes its Sentry-instrumented `InstrumentedRoutes` as the required `RoutesComponent`. |

Mount envelope (`WebHostApp.tsx`): `BrowserRouter → WebCloudRoot
(QueryClientProvider → CloudClientProvider → session) → ProductHostProvider →
{ narrow host routes, ProductClient catch-all }`.

## Host entry-route / producer contracts (covered by tests)

Each route is a narrow decoder beside the ProductClient catch-all; it does not
form a second product router.

| Route / producer | Host decoder | Test |
| --- | --- | --- |
| `/auth/callback` | `AuthCallbackRoute` | `AuthCallbackRoute.test.tsx` (exactly-once) |
| `/auth/error` | `AuthErrorRoute` | `auth-entry-routes.test.tsx` |
| `/login/:slug` | `SsoLoginEntryRoute` (seeds shared SSO login intent) | `auth-entry-routes.test.tsx` |
| `/join/:orgId` | `OrganizationJoinRoute` (org SSO on Web; non-SSO falls back to `proliferate://join/<orgId>`, `proliferate-local://` on loopback) | `link-routes.test.tsx` |
| `/settings/cloud` | `BillingReturnRoute` (Stripe return; `returnSurface=desktop` → Desktop handoff + manual retry; else billing-return entry) | `link-routes.test.tsx` |
| `/plugins/connect/complete` | `IntegrationConnectCompleteRoute` (validates `source`/`flowId`/`status`/`failureCode`/`finalSurface`; Web vs Desktop routing; never exposes tokens) | `link-routes.test.tsx` |
| `/?source=github_app_*_callback` and `/settings*?source=github_app_*_callback` | `WebGithubAppReturnBridge` + `decodeWebGithubApp{HomeSource,SettingsReturn}` (bounded external-return decoders, not a generic legacy settings router) | `web-product-links.test.ts` |
| host snapshot / `desktop: null` / auth-state derivation | `useWebProductHost` | `web-host.test.tsx` |
| transport auth mapping (bootstrapping→loading; beta denial→access_denied; dev-unreachable→deployment_unreachable; `githubConnected:false`→action_required) | `web-auth-transport.ts`, `web-auth-errors.ts`, `session-bootstrap-failure.ts` | `web-auth-transport.test.ts`, `web-auth-errors.test.ts`, `session-bootstrap-failure.test.ts` |

Ordinary old Web product URLs (`/connect-github`, `/auth/desktop/handoff`, Web
chat paths, Web-specific settings pages) are **not** retained; the GitHub-App
returns above are the only known live external producers and their producers are
left untouched for the phase-6 cutover to update one at a time.

## Exactly-once callback proof

`AuthCallbackRoute` guarantees at most one code exchange per document, proven by
`AuthCallbackRoute.test.tsx` (2 tests):

1. A module-instance `startedRef` single-flights the effect so React Strict
   Mode's mount/unmount/mount does not start a second exchange; the in-flight
   navigation is deliberately not cancelled on the synthetic unmount.
2. `completeWebAuthFlow` consumes and clears the single pending PKCE record, so
   any repeated call (reload, back-button, malformed/mismatched state) fails
   visibly through the shared anonymous auth-error surface rather than
   silently re-exchanging.

No persistence, replay, durable queue, or background retry was added.

## Binding cutover baseline (phase 6 gate)

The legacy Web bundle baseline was captured with the deterministic collector
`scripts/collect-web-bundle-baseline.mjs` (gzip via Node `zlib` level 9) on the
**untouched base `c6e094b41`** immediately before the Web deletions (contract
ordered-mechanics step 2), and stored at
[`web-bundle-baseline-c6e094b41.json`](web-bundle-baseline-c6e094b41.json)
(`binding: true`). It supersedes the provisional d1g baseline (base
`f93afce81`).

| Segment | gzip | raw | Composition |
| --- | --- | --- | --- |
| Unauthenticated `/login` entry | **495,438 B** (483.8 KiB) | 1,730,429 B | 1 JS 471,212 B + 1 CSS 24,226 B gzip; 0 fonts, 0 images |
| Per-route lazy chunks | — | — | none (route splitting: `none`) |
| Authenticated total | **495,438 B** (483.8 KiB) | 1,730,429 B | identical to entry |

Legacy Web performed **no route-level code splitting** (`App.tsx` statically
imported every page, so `/login` eagerly loaded the whole authenticated
product). The replacement browser-host build **does** split: the `/login` entry
is `index-*.js` (~482.55 KiB gzip) and the authenticated product loads lazily as
`AuthenticatedProductClient-*.js` (~743.62 KiB gzip), so the unauthenticated
entry no longer eagerly pulls the authenticated bundle. Those replacement
numbers are informational only; the gated no-regression comparison under the
approved formula is phase-6 (cutover) work, not this slice.

## Final battery (re-run end-to-end at the slice head `47ffe5869` + docs)

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | up to date |
| `make cloud-sdk-react-build shared-build` + `pnpm --filter @proliferate/product-client build` | **exit 0** (85 non-code assets mirrored) |
| `pnpm --filter @proliferate/product-client test` | 6 files / 12 tests fail — **all base-proven pre-existing** (see deviations); 511 files / 2,996 tests pass |
| `pnpm --filter @proliferate/web test` | **8 files / 53 tests pass** |
| `pnpm web:typecheck` (`tsc --noEmit`) | **exit 0** |
| `pnpm web:build` (`PROLIFERATE_WEB_BUNDLE_MANIFEST=1`) | **exit 0**; entry `index-*.js` + lazy `AuthenticatedProductClient-*.js` |
| `python3 scripts/check_frontend_boundaries.py` | **passed** |
| `python3 scripts/report_frontend_structure.py --strict --summary-only` | **TOTAL 0** |
| `python3 scripts/check_max_lines.py` | **passed** |
| `python3 scripts/check_docs.py` | **passed** |
| `git diff --check` | clean |
| Absence battery (no `components`/`hooks`/`stores`; no `AnyHarnessClient`/`setInterval`; no `@tauri-apps`/`invoke(`; no `auth-token-store.ts`; no `proliferate.web.authToken`; main/WebHostApp import product-client) | **all pass** |
| `node scripts/verify-web-host-bundle.mjs` (served/manifest proof) | **passed** — 5 shared ProductClient chunks; lazy authenticated split verified; 324 served asset URLs all HTTP 200; JS/CSS(`--radius-composer`)/font/image emitted + served |

## Final sweep — `apps/web/src` enumeration vs the contract target tree

33 files. 18 are the contract target tree; the remaining 15 are 7
ledger-authorized browser-owned primitives + 8 colocated adapter tests. **No
extra file is unjustified; nothing to delete.**

**Target tree (18):** `main.tsx`, `WebHostApp.tsx`, `web-host.ts`,
`config/env.ts`, `index.css`, `browser/auth/{web-auth-transport.ts,
AuthCallbackRoute.tsx, AuthErrorRoute.tsx, SsoLoginEntryRoute.tsx}`,
`browser/cloud/{create-web-cloud-client.ts, WebCloudRoot.tsx}`,
`browser/storage/web-product-storage.ts`, `browser/links/{web-product-links.ts,
OrganizationJoinRoute.tsx, BillingReturnRoute.tsx,
IntegrationConnectCompleteRoute.tsx}`, `browser/clipboard/web-product-clipboard.ts`,
`browser/telemetry/web-telemetry.ts`.

**Authorized beyond the compact target-tree diagram (7):**

| File | Justification |
| --- | --- |
| `browser/telemetry/install-web-telemetry.ts` | Vendor (PostHog/Sentry) install split of the telemetry adapter authorized by the `WebTelemetryProvider`/`telemetry/{config,posthog,sentry}` ledger row and target-flow step "install browser telemetry". |
| `lib/access/cloud/auth/web-auth-flow.ts` | Ledger **keep** ("consolidate behind `host.auth`; PKCE/cookie/session browser-owned"). |
| `lib/infra/auth/pkce.ts` | Ledger **keep** (PKCE browser-owned). |
| `lib/access/cloud/client.ts` | Ledger **keep** ("retain as the browser Cloud-client constructor"). |
| `lib/access/cloud/dev-desktop-handoff.ts` | Ledger **keep** ("existing development Desktop-handoff transport"). |
| `lib/access/cloud/session-bootstrap-failure.ts` | Browser-auth bootstrap-failure decode extracted from the old `WebCloudProvider` bootstrap machine; consumed by `host.auth`. Not a product page/store/hook. |
| `lib/domain/auth/web-auth-errors.ts` | Browser-auth error taxonomy (beta denial / dev-unreachable → shared `AuthState`). `lib/domain/auth` is **not** in the delete list (only `chat`/`home`/`sidebar`). |

**Colocated adapter tests (8):** `web-host.test.tsx`,
`browser/auth/{auth-entry-routes.test.tsx, AuthCallbackRoute.test.tsx,
web-auth-transport.test.ts}`, `browser/links/{link-routes.test.tsx,
web-product-links.test.ts}`, `lib/access/cloud/session-bootstrap-failure.test.ts`,
`lib/domain/auth/web-auth-errors.test.ts`.

## Deviations / UNRESOLVED (for reviewer + phase 6)

1. **`@proliferate/product-client/internal/*` imports on the Web host (package-export decision).**
   The Web host reaches four moved auth/telemetry **domain** symbols through the
   package's `./internal/*` export lane:
   - `web-host.ts` → `internal/lib/domain/auth/auth-mode` (`isProductAuthRequired`)
   - `browser/links/web-product-links.ts` → `internal/lib/domain/auth/desktop-navigation-codec`
   - `browser/auth/web-auth-transport.ts` → `internal/lib/domain/telemetry/errors` (`markLoginNotAttempted`)
   - `browser/auth/web-auth-transport.test.ts` → same (`isLoginNotAttempted`)

   The contract's global rule reserves `internal/*` for the Desktop host and
   says a symbol reachable only via `internal/*` is a package-export decision to
   escalate. In practice `internal/*` is the host-facing reverse-seam export
   lane created in d1h ("host-only, to be narrowed after Web"), and these are
   the same shared domain primitives both hosts need. No narrower public export
   exists yet, and `check_frontend_boundaries.py` does not forbid the Web→
   `internal/*` direction (it passes). Resolution — promoting these four symbols
   to a narrow public export and narrowing the `internal/*` lane — is a
   package-export change that touches `@proliferate/product-client` (and the
   Desktop host), i.e. outside this slice's `apps/web`-only scope. **Left
   UNRESOLVED for the reviewer / phase-6 export-narrowing pass; not silently
   worked around, and no boundary check was weakened.**

2. **`@proliferate/product-client` is not test-green at the base.** 12 tests
   across 6 files fail (`editor/highlighting`, `shortcuts/keyboard-resolution`,
   `settings/navigation`, `config/playground`, `AutomationRunLocationSelector`,
   `workspace-bootstrap-empty-session`). All fail byte-identically at base
   `c6e094b41` (documented in [`d1h.md`](d1h.md)); this slice's diff touches no
   product-client file, so they are inherited, not slice-caused. Fixing them
   would require editing product-client, leaving the `apps/web`-only scope.

3. **`scripts/verify-web-host-bundle.mjs` is new repo tooling** beside its
   qualification sibling `scripts/verify-product-client-qualification.mjs`; it is
   the checked-in served/manifest proof the contract asks for and is outside the
   `apps/web` target tree by design (`apps/web/dist` stays git-ignored).

4. The served proof asserts JS/CSS/font/**image**; the Web dist emits **no
   `.svg`** asset (unlike the throwaway qualification fixture), so svg is
   deliberately not asserted (that would test the fixture, not the real host).

5. The manifest proof uses the existing `PROLIFERATE_WEB_BUNDLE_MANIFEST=1`
   opt-in (vite emits `dist/.vite/manifest.json` only under it); per the vite
   config comment this adds no app code and changes no chunking, so the shipped
   bundle bytes match a plain `web:build`.

## Non-goals (unchanged from the contract)

Operational production cutover, external dashboard/config changes, self-hosted
Web, product redesign, Web-specific product fixes, auth/cache/stream hardening
beyond the exact callback contract, and preference migration are all out of
scope. This slice stops at a reviewable, buildable draft; hosted qualification
and cutover are the next (gated) slice.
</content>
</invoke>
