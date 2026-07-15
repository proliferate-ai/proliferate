# Move the Desktop Product into ProductClient (D1h)

Status: **complete — merged.** PR #1215, merge `c6e094b41`. The mechanical
move and the full seam architecture landed across three owner-ruling rounds
(R1–R5 + G1–G7 + 9 ratified ledger amendments), plus a post-merge
reconciliation against `origin/main` (see "Post-merge reconciliation" below).
Package `tsc` **315 → 0**; `PRODUCT_CLIENT_FORBIDDEN_IMPORT` **272 → 0**.
Package typecheck/build, the Desktop build (verified lazy authenticated
split), desktop + package vitest, the qualification proof, and every
boundary/structure/max-lines/docs/ledger scan pass. The only red is **12
base-proven pre-existing test failures across 6 files** (inherited, not
move-caused — see "Inherited pre-existing test failures"). Rounds 1–2
(§F1–F4 below) and the F3/F4 STOP analyses are retained as a historical
record; the authoritative final state is **"Round 3 (G1–G7) + green — final"**,
as carried across the merge.

## Post-merge reconciliation

This slice's branch was cut before four unrelated feature PRs landed on
`origin/main` — goals relight (#1206), the workspace status card + Codex
publish dialog (#1210), git review v2 (#1214), and per-subagent identicon
avatars (#847). Landing the move required reconciling the slice against all
four rather than rebasing them away:

- **34 content conflicts** resolved to main's logic plus the move's plumbing
  (import paths, `#product/*` specifiers, ProductHost/DesktopBridge threading)
  — main's feature behavior is preserved verbatim; only ownership/import shape
  changed.
- **27 new files** (added by the four feature PRs after this slice's branch
  point) re-homed into `apps/packages/product-client/src` alongside the rest
  of the move.
- **5 delete amendments** — files the git-review-v2 and status-card PRs
  removed on `main` after this slice's branch point (`GitReviewFileTree`,
  `GitReviewStageAction`, `GitReviewStatusBadge`,
  `use-composer-ultra-emphasis`, `git-file-status-presentation`) — recorded as
  `move -> delete` ledger amendments rather than silently dropped, bringing the
  amendments total to **23** (18 `retain -> move` + 5 `move -> delete`; see
  `../move-ledger.md#amendments-ratified-during-the-move`).
- Landed via a **fast-gate merge per founder directive**: the founder
  authorized merging ahead of a full independent re-review given the
  mechanical nature of the reconciliation (import-path and ledger-classification
  changes only, no product-behavior delta), on the condition that the
  post-merge battery (package build/typecheck, Desktop build, both vitest
  lanes, qualification proof, all boundary/structure/max-lines/docs/ledger
  scans) reran green against the merged tree before this doc records
  completion. It did.

The slice is complete and closed at `c6e094b41`. No further work is owed
against this contract; the next contract is the legacy Web replacement (see
the [rollout procedure](../../../../../../developing/deploying/web-desktop-unification-rollout.md)).

- Exact implementation base:
  `1d00437565d4cdce47cf4dc41f2ea19eb2f31f28`
- Prior completed implementation: PR #1195 (D1g, Prove ProductClient Extraction
  Mechanics), merge `9757e86de`, plus doc link-fix `1d0043756` (this base).
- Parent architecture: [`../README.md`](../README.md)
- Application-entry contract: [`../entry-contract.md`](../entry-contract.md)
- Move ledger: [`../move-ledger.md`](../move-ledger.md)
- Pipeline ledger:
  [`../../../../../../developing/deploying/web-desktop-unification-rollout.md`](../../../../../../developing/deploying/web-desktop-unification-rollout.md)
- Approved contract:
  `04 - Move the Desktop Product into ProductClient.md` (founder-approved).

This slice executes the checked ledger and codemod from D1g to move the working
Desktop product into `@proliferate/product-client` and leave Desktop a thin
native host. **It changes ownership and import paths, not behavior.**

## What landed and is verified

The pure mechanical move (S1) is complete and proven exactly once per the
ledger. A post-move completion proof
(`scripts/check-product-client-move-ledger-postmove.py`, added this slice — the
sibling pre-move `check-product-client-move-ledger.py` necessarily fails once
the `git mv`s land because its source paths stop existing) reports:

| Classification | Ledger rows | Post-move state |
| --- | --- | --- |
| move | 2087 | all landed exactly once (target present, source gone) |
| delete | 1 | removed |
| retain | 112 | intact under `apps/desktop/src` |
| split | 20 | **all 20 resolved** (product target present) |

(Counts are the final post-round-3 state, after the 18 ratified `retain → move`
amendments were applied by the checker — see G6. The earlier "2069 move / 130
retain / 18 split pending" figures reflect the F1 head and are superseded.)

Additional verified facts at this slice's head:

- **Codemod second run is empty:** `node scripts/migrate-desktop-product-client.mjs --check`
  reports `0 specifier rewrite(s) across 0 file(s)` (1985 move modules scanned).
- **`apps/desktop/src` is host-only:** 149 files — `lib/**` host access
  (Tauri, telemetry, auth transport, `infra/measurement`), `hooks/access/tauri`
  + auth workflows, host `providers/**`, the retained `stores/auth/auth-store.ts`,
  `main.tsx`, and the host `assets.d.ts`. No product pages, no product route
  tree, no product stores beyond the retained auth store.
- **Temporary qualification canary is gone:** no `ProductClientBuildCanary`
  reference remains in `apps/packages/product-client` (package export or source).
  The browser fixture, Desktop qualification entry, and
  `verify-product-client-qualification.mjs` retarget to the real
  `src/ProductClient.tsx` entry (S3).
- **Thin Desktop host wired (S3):** `main.tsx` mounts `ProductClient` from the
  package with `RoutesComponent = InstrumentedRoutes` (Sentry stays host).
- `git diff --check` is clean; `scripts/check_docs.py` and
  `scripts/check_max_lines.py` pass (see "Move-caused reference fixes").

## Applied owner rulings (reversible; recorded per the stage brief)

- **Assets:** the ledger `assets.d.ts` split landed as a package-owned
  `src/vite-env.d.ts` carrying the product `ImportMetaEnv` (the 9 product
  `VITE_*` flags + `DEV` that moved product code reads) plus `vite/client`;
  host-only Sentry/PostHog `VITE_*` decls stay in Desktop's `assets.d.ts`. The
  ~78 `@/assets/*` specifiers in moved files were rewritten to package-relative
  paths (the codemod deliberately leaves asset specifiers alone).
- **Moved dependencies:** `lucide-react`, `@proliferate/product-surfaces`
  (declared a package *dependency* — depending on it does not violate the
  "keep product-surfaces separate" non-goal; Desktop depends on it too), and
  `@testing-library/user-event` added to the package; the cross-package
  `design/src/tokens` and `design/src/css` reaches were corrected for the
  one-level-deeper `apps/packages/product-client` location.
- **Test lane:** the 377 `vi.mock`/`vi.importActual` string arguments the AST
  codemod skips were rewritten `@/X` → `#product/X` across 103 test files so
  mocks intercept the codemod-rewritten import ids (idempotent).

## F1 stage — forward seams (moved product → retained host)

Two forward seams landed and are verified at package typecheck level. The
forbidden-import count (`check_frontend_boundaries.py`
`PRODUCT_CLIENT_FORBIDDEN_IMPORT`) fell **272 → 77**; package `tsc` errors fell
**315 → 79** (all remaining are unresolved seams, 0 non-seam).

### R1 measurement port (landed) — ~172 seam imports

`src/lib/infra/measurement/measurement-port.ts` is a single product-owned barrel
that re-exposes exactly the retained measurement functions/types the moved tree
calls (identical names), routing every call through a swappable `MeasurementSink`
whose default is a **type-safe no-op**. All `@/lib/infra/measurement/*` call
sites were rewritten to `#product/lib/infra/measurement/measurement-port`
(import-path-only). Design choice: everything (including the pure helpers) goes
through the sink so there is **zero measurement logic duplicated** from the
retained engine — no drift.

- **Desktop injection (byte-identical):** `apps/desktop/.../measurement/
  measurement-port-sink.ts` assembles the retained functions into a
  `MeasurementSink`; `DesktopHostProviders` calls `setMeasurementSink(...)` at
  **module scope** (runs when `main.tsx` imports it, before `ProductClient`
  renders). Package gains a `./infra/measurement` export for `setMeasurementSink`
  + `MeasurementSink`.
- **Web (later):** the no-op default = measurement off (explicitly acceptable).
- **`MeasurementDebugDump`** is typed as the subset the moved tests read
  (`recentMetrics` / `activeOperations` / `recentDebugActivities`); the retained
  full dump remains assignable.
- **Test-lane injection is BLOCKED and coupled to R3 (reverse seam).** The
  handful of package tests that assert *real* measurement recording (e.g.
  `lib/access/cloud/timing.test.ts` expects `console.table` with `requestCount`)
  need the retained engine injected as the sink in a vitest setup. The retained
  engine is **not** self-contained: `debug-measurement-dump.ts` /
  `boot-stall-diagnostics.ts` reach `@/lib/access/tauri/diagnostics` (raw Tauri),
  and — a genuine reverse-seam item — `typing-latency-probe.ts` (RETAINED)
  imports `@/lib/domain/telemetry/debug-measurement-catalog`, which **moved into
  the package**. So injecting the real engine into the package test lane requires
  the R3 reverse-seam export lane (and a Tauri test double) first. F2 owns this:
  add the vitest measurement setup once R3 lands. Until then those measurement-
  asserting tests run against the no-op and will not pass. (A byte-safe gotcha:
  `src/lib/infra/editor/highlighting.ts` is detected as binary by `rg`/`grep` —
  use the Python boundary checker or `perl` for measurement-seam scans/rewrites.)

### Cloud-client seam (landed) — 34 files

`getProliferateClient()` is **never called** by moved product code, so **no
client threading was needed** (contrary to the stage brief's assumption). Every
`@/lib/access/cloud/client` import is a cloud-sdk type (the module does
`export type * from "@proliferate/cloud-sdk/types"`), a cloud-sdk runtime value
(`isCloudAgentKind` / `ProliferateClientError`), or `getDesktopCloudAccessToken`.
Redirected all type imports → `@proliferate/cloud-sdk/types` and the two runtime
values → `@proliferate/cloud-sdk` (import-path-only, types erased). **Holdout:**
`getDesktopCloudAccessToken` (host access-token transport) is used by
`lib/access/cloud/cloud-sandbox-gateway.ts` (+ test) only and stays on the host
client module — it belongs to the auth-transport reroute (F2).

## F2 stage — reverse seam (R3) + build emission (R4) + desktop sanity

Landed this stage (commits `a9c4f078e` R3, `1204fb2a8` R4, `08acd07df` sanity):

- **R3 reverse seam (complete).** The package gained the public `./internal/*`
  export lane (`types → ./src/*`, `default → ./dist/*.js`). All retained-desktop
  host imports of moved modules — ~123 specifiers across 51 host files (auth /
  telemetry domain, stores, config, test fixtures) — now use
  `@proliferate/product-client/internal/<path>`. Also rewired 4 host hooks whose
  `./query-keys` sibling moved into the package, and `main.tsx`'s pre-render
  `initializeTheme()` (config/theme moved). **Zero** retained host files now
  import a moved-only module via `@/` or a relative path (verified by desktop
  `tsc`: 0 `Cannot find module '@/…'`/`'./…'` for moved paths). A desktop vitest
  alias `internal/ → package src` was added for the test lane.
  - **Resolution mechanism (important for the next stage):** `internal/*`
    resolves through the package's **built dist `.d.ts`** (the `default` target
    with `.js→.d.ts` substitution), whose `#product/*` self-imports resolve
    against product-client's own `package.json` `imports` field. A desktop
    tsconfig `paths` entry `internal/* → ../packages/product-client/src/*` was
    tried and **reverted**: pointing at package *source* drags the package's
    `#product/*` self-imports into desktop's tsconfig, which does not know
    `#product`, surfacing ~100 spurious errors. Desktop `tsc` is therefore
    correctly gated on the package build (dist), not independently green.
- **R4 build emission (wired; dist copy verifiable once the build is green).**
  New `scripts/copy-product-client-assets.mjs`: (1) syncs repo-root
  `catalogs/agents/catalog.json` → gitignored
  `src/generated/agent-catalog.json` (verified: file lands, `git check-ignore`
  confirms ignored), (2) `--dist` mirrors the 85 non-TS resources under `src`
  (index.css, 78 svg + png/jpeg/mp3, config + generated JSON) into `dist`. Wired
  into the package `build` (pre-tsc sync + post-tsc `--dist`), `typecheck`,
  `prepare`, and a `sync-assets` script. `bundled-agent-catalog.ts` now imports
  the package-relative generated copy (`../../../generated/agent-catalog.json?raw`)
  instead of reaching six levels up into the repo root at the wrong post-move
  depth. No checked-in catalog duplicate.
- **Desktop thin-host sanity (verified).** `main.tsx` mounts the package
  `ProductClient` with `RoutesComponent=InstrumentedRoutes` inside
  `BrowserRouter > DesktopHostProviders`; `DesktopHostProviders` calls
  `setMeasurementSink(desktopMeasurementSink)` at module scope; Sentry +
  measurement-sink injection stay host; no desktop path still targets a moved
  module.

### Verification at this stage's head

| Command | Result |
| --- | --- |
| `pnpm --filter @proliferate/product-client typecheck` | 79 (unchanged — R3/R4/sanity are host-side + build-wiring; forward seams untouched) |
| `python3 scripts/check_frontend_boundaries.py` (`PRODUCT_CLIENT_FORBIDDEN_IMPORT`) | 77 (unchanged — reverse seam does not touch product→host forbidden imports) |
| desktop `tsc --noEmit` | 184; **0 reverse-seam breaks**; all 184 are downstream of the missing package dist (151 direct `@proliferate/product-client` resolution, 33 cascading implicit-any/null in host files whose moved-type imports are `any` while dist is absent) |
| `node scripts/copy-product-client-assets.mjs` | catalog synced to gitignored `src/generated/`; import resolves |
| `python3 scripts/check_docs.py` / `git diff --check` | PASS / clean |

### DEFERRED this stage — auth-probe promotion (finding, owner may overrule)

The round-2 brief authorized promoting `getDesktopAuthMethods` /
`discoverDesktopSso` / `getGitHubDesktopAuthAvailability` into product-owned
package code, with the stop clause "STOP only if a fetcher touches secret
transport." The fetchers do **not** touch secret transport, but a
behavior-identical, no-dual-ownership promotion is **not** independently
landable:

1. **Bound to the proliferate-api / host.deployment seam.** Each probe builds
   its URL via `buildUrl → buildProliferateApiUrl` and defaults `apiBaseUrl` to
   `getProliferateApiBaseUrl()` (`@/lib/infra/proliferate-api`, a separate
   unresolved forward seam). The consuming hooks always pass
   `useProductHost().deployment.apiBaseUrl`, so a package copy *could* inline the
   join — but the public fetcher's default-baseUrl behavior is host-deployment
   config; reproducing it in the package either drops the default (behavior
   change) or duplicates the deployment seam.
2. **Shares `AuthRequestError` / `fetchAuthResponse` / `parseAuthError`** with
   the host password + OAuth flows (which do `instanceof AuthRequestError`).
   Moving the generic transport pulls the proliferate-api seam too; duplicating
   the error class risks `instanceof` divergence — a forbidden behavior change.
   (No probe *consumer* does `instanceof`, but the shared class is used broadly
   host-side.)

Both routes converge on the `@/lib/infra/proliferate-api` → `host.deployment`
and auth-transport seams. The correct landing is **atomic with those seams**
(move `buildUrl`/transport once, not duplicate), analogous to F1 deferring the
`getDesktopCloudAccessToken` holdout to the auth-transport reroute. The 3 probe
hooks stay host for now (their `./query-keys` import was repointed to the
internal lane so the reverse seam is internally consistent); their forward-seam
`tsc` errors (`use-auth-methods`/`use-sso-discovery`/`use-github-auth-availability`,
4 of the 79) remain until that cohort lands.

### NOT in this stage's named scope (remainder for the next F2 sub-stage)

R2 bridge ports (`use-connect-server`, `use-dev-desktop-handoff`), the updater
hook move (`use-updater`/`use-app-version`/`updater-dev-mock`, 16), the
`proliferate-api → host.deployment` threading (7), auth transport → `host.auth`
(`proliferate-auth`/`proliferate-sso-auth`/`auth-store`, ~14),
`use-github-sign-in` (4), telemetry seams, and the remaining split rows
(`use-automations`, `use-cloud-*-workspaces`, `use-auth-viewer`,
`use-agent-run-configs`, `use-organization-join-invitation-flow`,
`DesktopProductLifecycleRoot`). These are the 79 package forward-seam errors;
resolving them unblocks the package build → dist → desktop `tsc`/build green.

### Remaining forward seams (F2) — 60 import lines / ~77 checker hits

These are **not** import-path swaps: each is a rich host hook that must *move*
into the package (rewired onto a bridge/host capability + its own telemetry /
store / persistence seams) or a host-threading change. Precise distinct
specifiers:

```text
11  @/hooks/access/tauri/use-updater            updater hook (moves; needs telemetry-client
 4  @/hooks/access/tauri/app/use-app-version    + updater-store + persistence seams resolved)
 1  @/hooks/access/tauri/updater-dev-mock
 7  @/lib/infra/proliferate-api                 getProliferateApiBaseUrl / getRuntimeDesktopAppConfig
                                                → host.deployment (threading in lib fns)
 5  @/lib/integrations/auth/proliferate-auth    auth transport → host.auth (F2/R3)
 1  @/lib/integrations/auth/proliferate-sso-auth
 4  @/hooks/auth/workflows/use-github-sign-in   auth workflow hook move (split row)
 3  @/hooks/auth/workflows/use-connect-server   R2a: new connect-server meta bridge port +
 1  @/hooks/app/lifecycle/use-dev-desktop-handoff  R2b: new window bridge port; both hook-moves
 3  @/stores/auth/auth-store                    auth state → host.auth
 2  @/lib/integrations/telemetry/anonymous-storage  telemetry seams → host.telemetry (R3-adjacent)
 1  @/lib/integrations/telemetry/client
 1  @/lib/integrations/telemetry/native-diagnostics
 2  @/lib/access/cloud/client                   getDesktopCloudAccessToken holdout (auth transport)
 2  @/hooks/access/cloud/auth/use-github-auth-availability  auth-probe promotion (F2 + R3)
 1  @/hooks/access/cloud/auth/use-sso-discovery
 1  @/hooks/access/cloud/auth/use-auth-methods
 1  @/hooks/access/cloud/auth/use-auth-viewer
 1  @/hooks/access/cloud/automations/use-automations        split rows
 1  @/hooks/access/cloud/agent-run-configs/use-agent-run-configs
 1  @/hooks/access/tauri/credentials/use-local-agent-credentials  → host.desktop.localCredentials
 1  @/hooks/access/tauri/shell/use-available-editors              → host.desktop.files
 1  @/hooks/access/tauri/use-window-actions                       → host.desktop.nativeUi
 1  @/hooks/access/tauri/workspace-scratch/use-workspace-scratch-pad          → host.desktop.scratch
 1  @/hooks/access/tauri/workspace-scratch/use-workspace-scratch-pad-mutations
 1  @/providers/DesktopProductLifecycleRoot     ledger split row
 1  @/hooks/organizations/workflows/use-organization-join-invitation-flow  split row
```

R2 (the two new bridge ports) is entangled: `use-connect-server` also pulls the
`proliferate-api` seam (`getRuntimeDesktopAppConfig`) and `@/copy/*`; both hooks
pull moved `@/lib/domain/*` + cloud-access modules. They are cheapest to land
alongside the proliferate-api / auth-transport reroutes, not in isolation.

## F3 stage — repair to green (forward-seam resolution)

F3 resolved the mechanically-clean forward-seam cohorts. Package `tsc` errors
fell **79 → 47** (all 47 remaining are unresolved seams; 0 non-seam);
`check_frontend_boundaries.py` `PRODUCT_CLIENT_FORBIDDEN_IMPORT` fell **77 → 50**.
Five commits on top of the F2 head (`2ebc787f2`):

1. `473ba5a7c` **cloud client-factory side-effect hooks** — moved the 5 split
   hooks (`use-automations`, `use-agent-run-configs`, `use-auth-viewer`,
   `use-cloud-exposed-workspaces`, `use-cloud-visible-workspaces`) into the
   package; dropped the bare `@/lib/access/cloud/client` side-effect (host
   bootstraps the Cloud client via `ProductHost.cloud.client`); agent-run-config
   type import → `@proliferate/cloud-sdk/types`.
2. `08d296b5a` **auth-probe promotion + auth workflow seams** — promoted the 3
   public probes (`getDesktopAuthMethods` / `discoverDesktopSso` /
   `getGitHubDesktopAuthAvailability`) into product-owned cloud access
   (`src/lib/access/cloud/auth-probes.ts`) with all callers passing the
   deployment base URL explicitly; moved the 3 probe hooks + `use-github-sign-in`
   into the package. Relocated the pure auth transport primitives
   (`AuthRequestError`, `isAbortError`, `fetchAuthResponse`, `parseAuthError`,
   `isDefinitiveAuthRejection`, …) to `src/lib/access/cloud/auth-transport.ts` so
   host and product share one instanceof-stable `AuthRequestError` (host
   `proliferate-auth-transport` keeps only `buildAuthUrl` and re-exports the rest
   via `internal/*`). Relocated `GitHubDesktopSignInOptions` /
   `DesktopSsoSignInOptions` (`src/lib/domain/auth/sign-in-options.ts`, host
   re-exports) and the product-only `buildGitHubOAuthAppSettingsUrl`.
3. `be6537a30` **proliferate-api deployment seam** — product-owned pure
   `src/lib/infra/proliferate-api.ts` (URL/origin/official-host helpers, base URL
   required); moved consumers source it from `host.deployment.apiBaseUrl`; host
   orchestration callers pass `getProliferateApiBaseUrl()` explicitly. Runtime
   bootstrap + default resolution stay in the retained host module.
4. `027d1f891` **bridge-based tauri-access hooks** — relocated the
   `shell` / `credentials` / `workspace-scratch` subtrees (`use-available-editors`,
   `use-local-agent-credentials`, `use-workspace-scratch-pad` + mutations +
   query-keys/tests). These were **already** bridge-based
   (`host.desktop.files/.localCredentials/.scratch`); their `retain` was a stale
   bucket default. Pure relocation, no host consumers, no behavior change.

Every resolution routes through an **existing** ProductHost/DesktopBridge
capability or a ledger-named seam — **no new capability was introduced.** All
promoted fetchers/URL helpers were made base-URL-explicit (no host-config
default in the package); host callers pass `getProliferateApiBaseUrl()`,
behavior-identical to the prior default.

### F3 STOP — the remaining 47 seams need owner rulings (green is unreachable without them)

Round-2's R1/R2/R3 resolved the three prior STOP items (measurement, two bridge
ports, reverse seam). The **remaining** package `tsc` errors resolve to files
that are `retain` in the ledger yet product-consumed, or that need a **new host
capability** — decisions absent from BOTH the ledger and rounds 1–2. Per the
contract's stop conditions ("ownership decision absent from the ledger → STOP";
"the move requires a new ProductHost capability → STOP"), these are surfaced
rather than resolved by inventing capabilities or changing behavior:

**(A) Genuine capability / ownership gaps — need a ruling (23 errors):**

- **Updater cluster** (`use-updater` 11, `use-app-version` 4, `updater-dev-mock`
  1 = 16). `hooks/access/tauri/**` = `retain`, but these are product-consumed
  **stateful** hooks (the store already moved to the package). Unlike the bridge
  hooks above, they still reach raw host **telemetry** (`trackProductEvent` /
  `captureTelemetryException` from `@/lib/integrations/telemetry/client`) and
  **persistence** (`persistValue` / `readPersistedValue` from
  `@/lib/infra/persistence/preferences-persistence`) from **module-level**
  functions (the auto-check scheduler), not from a hook. Resolution needs a
  ruling to move them + a mechanism for the telemetry→`host.telemetry` and
  persistence→`host.storage` seams through the module-level scheduler (DI). Both
  target capabilities exist; the risk is behavior-sensitive (event names, metadata
  keys, check-interval scheduler state) and unverifiable without running the app.
- **Anonymous-telemetry install id** (`anonymous-storage` 2:
  `use-repository-settings`, `use-add-repo`). They send
  `loadAnonymousTelemetryBootstrap().installId` as `desktopInstallId`. This id is
  a `crypto.randomUUID()` persisted via the Tauri `bootstrap_anonymous_telemetry`
  command (or `localStorage`) — **provably distinct** from the worker install id
  (`get_desktop_install_id`, exposed as `host.desktop.worker.getInstallId()`), so
  the bridge is not a behavior-safe substitute. Needs a **new host capability**
  (an anonymous-telemetry-id accessor).
- **Native render diagnostics** (`native-diagnostics` 1: `AppErrorBoundary`).
  `reportReactRenderError` writes to the raw-Tauri renderer diagnostic log with
  dedup/fingerprint (`@/lib/access/tauri/diagnostics`). `host.telemetry.captureException`
  would send render errors to Sentry instead of the native log — a behavior
  change. `host.desktop.diagnostics.logEvent` is a narrow lifecycle marker, not
  the full error diagnostic. Needs a capability or a ruling accepting the delta.
- **Cloud access-token holdout** (`@/lib/access/cloud/client` 3:
  `cloud-sandbox-gateway` + test). `getDesktopCloudAccessToken` is host
  access-token transport (F1 deferred it to the auth-transport reroute). Needs a
  `host.auth` access-token accessor or a bridge method.
- **`use-window-actions`** (1: `MacWindowControlsSafeArea`). Raw
  `apply_macos_window_chrome` Tauri op; no `DesktopNativeUiBridge` method covers
  it. Needs a new `nativeUi` bridge method (or a ruling to no-op it off-Desktop).

**(B) Landable without new rulings, but behavior-sensitive + coupled — deferred
to land as a coherent unit with the (A) rulings (24 errors incl. cascades):**

- **R2 bridge ports** (`use-connect-server` 3, `use-dev-desktop-handoff` 1,
  `lib/access/cloud/dev-desktop-handoff` 1). Ruled (R2): add the connect-server
  meta + dev-handoff window bridge ports, move the hooks, thread `apiBaseUrl` into
  `dev-desktop-handoff`. Entangled (connect-server also pulls proliferate-api +
  `@/copy/*`).
- **`use-organization-join-invitation-flow`** (1: `AccountPane`). Split row; move
  the product part (its host copy's promoted-fetcher call was already fixed in F3
  commit 2).
- **`DesktopProductLifecycleRoot`** (1: `ProductLifecycleRoot`). Ledger split —
  the capability-gated product subtree moves; residual raw-tauri stays host.
- **`ensure-desktop-worker`** (`telemetry/client` 1). DI a `captureException` into
  `EnsureDesktopWorkerDeps` + `teardownDesktopWorker`, caller passes
  `useProductTelemetry().captureException` (established DI pattern, but touches 2
  callers).
- **auth-store test doubles** (`@/stores/auth/auth-store` 6: `AuthGate.test`,
  `use-organization-join-auth-launch.test`, `WorkflowsPage.test`). `auth-store` is
  correctly `retain` (host-only at runtime); the 3 package tests import it to seed
  auth state. The ledger row names the fix — "a host-store test double at the
  package boundary" — and a partial `authStoreBridgedHost` fixture already exists.
  R5 test-infra: build a product auth-store double + rewrite the 3 tests. Behavior
  -sensitive (auth-gate assertions).

### Build/test matrix at the F3 head

| Command | Result |
| --- | --- |
| `pnpm --filter @proliferate/product-client typecheck` | **RED 47** (was 79; all unresolved seams, 0 non-seam) |
| `python3 scripts/check_frontend_boundaries.py` (`PRODUCT_CLIENT_FORBIDDEN_IMPORT`) | **50** (was 77) |
| `pnpm --filter @proliferate/product-client build` / `test` | RED — gated on the 47 seams (no dist) |
| `pnpm --filter proliferate build` (desktop) | RED — gated on package dist |
| `pnpm --dir apps/desktop exec vitest run` | not run — gated on package dist + R5 test infra |
| `node scripts/verify-product-client-qualification.mjs` | RED — gated on package dist |
| `git diff --check` | clean |

R5 (`vitest resolve.dedupe`, 18-file allowlist re-scope) and the desktop/vitest/
qualification matrix are downstream of the package build, which is gated on the
(A) rulings. The `AutomationRunLocationSelector` dedupe fix and the documented
6 pre-existing failures (`keyboard-resolution` 4, `navigation` 2 at base
`1d0043756`) are recorded for that pass but unverifiable until dist emits.

## F4 stage — R5 gate config, battery, scans, docs

F4 executed the round-2 R5 mechanical items, ran the full contract battery and
scans against the F3 head, recorded the divergences, and finalized the docs. No
product behavior changed; the only code edits are gate configuration.

### Round-2 ruling records (owner rulings, reversible — consolidated)

Recorded here as executed against the tree, with rationale:

- **R1 measurement port** — landed F1 (`src/lib/infra/measurement/measurement-port.ts`,
  swappable no-op sink, host injects the retained engine at module scope). No
  ProductHost interface change; Web later = no-op. See "F1 stage".
- **R2 bridge ports** — **NOT executed.** F3 found the two hook moves
  (`use-connect-server`, `use-dev-desktop-handoff`) are entangled with the (A)
  capability gaps and behavior-sensitive; deferred to land as a unit with the (A)
  rulings. Recorded, not implemented.
- **R3 reverse seam** — landed F2 (public `./internal/*` export lane; ~123
  specifiers across 51 host files rewritten). Host-only surface, to be narrowed
  after the Web replacement.
- **R4 build emission** — landed F2 (`scripts/copy-product-client-assets.mjs`:
  catalog → gitignored `src/generated/`, asset/CSS mirror to `dist`). Verifiable
  only once `tsc` emits.
- **R5 test infra + gate scope** — landed F4:
  - **vitest `resolve.dedupe: ["react","react-dom"]`** added to the package
    vitest config. **Correction to R5's premise:** an A/B run proved the dedupe
    does **not** resolve the `AutomationRunLocationSelector` failure — with and
    without it the result is identical (2 passed / 1 failed). That test's real
    failure is `TestingLibraryElementError: Found multiple elements with the text
    "Organization cloud"` inside a single render (the file already has explicit
    `afterEach(cleanup)`), **not** a duplicate-React instance. Root cause is a
    test-lane rendering/mock-resolution difference, unresolved and gated behind
    the package build + the full test-infra port. The dedupe is retained as
    correct package-boundary hygiene, not as the fix for this test.
  - **`frontend_structure_allowlist.txt`** — the 8 stale `apps/desktop/src`
    entries (files that moved) removed; the 11 flagged `product-client/src` files
    re-allowlisted at their new paths (relocation, same counts/reasons). Includes
    two entries that were max-lines (component-cap) debt at Desktop and are now
    structure-report debt at the deeper package path (`ChatDiffViewer` 622,
    `SplitDiffViewer` 540), plus the new R1 `measurement-port.ts` (734, a barrel
    mirroring the retained surface). `LARGE_FRONTEND_FILE` → **0**.
  - **`check_max_lines.py`** — added `apps/packages/product-client/src` to
    `CHECK_ROOTS` (mirroring `apps/desktop/src`, per R5), and relocated the 5
    still-violating removed Desktop entries + the R1 port into
    `max_lines_allowlist.txt` (6 entries). `SplitDiffViewer` (540) and
    `HomeNextScreen.test` (530) fall under the 600 general cap at the deeper path
    (Desktop's component cap was 500) so were dropped, not moved. Check **passes**.
  - **structure scan root** — `report_frontend_structure.py` already listed
    `product-client/src` in `FRONTEND_ROOTS`/`APP_ROOTS`/`DOM_APP_AND_PACKAGE_ROOTS`
    (added when the package was created); no change needed.

### Battery / scan matrix at the F4 head

| Command | Result |
| --- | --- |
| `pnpm --filter @proliferate/product-client typecheck` | **RED 47** (all unresolved seams; 0 non-seam) |
| `pnpm --filter @proliferate/product-client build` | **RED** — same 47 seams (`tsc` errors; no fresh dist; existing `dist/` is stale) |
| `pnpm --filter @proliferate/product-client test` (full) | **BLOCKED** — 167 test files fail at collection on seam imports (gated on the build) |
| `pnpm --filter @proliferate/web build` | **GREEN** (exit 0 — Web untouched, confirmed) |
| `pnpm --filter proliferate build` (desktop) | **RED (gated)** — deterministic from the absent package dist; not re-run |
| `pnpm --dir apps/desktop exec vitest run` | **BLOCKED (gated)** — package dist + full test-infra port |
| `node scripts/verify-product-client-qualification.mjs` | **RED (gated)** — package dist |
| `python3 scripts/check_frontend_boundaries.py` (`PRODUCT_CLIENT_FORBIDDEN_IMPORT`) | **50** (gated on the 5 rulings) |
| `python3 scripts/report_frontend_structure.py --strict --summary-only` | **TOTAL 26** — `FORBIDDEN_SHARED_PACKAGE_IMPORT` 26, `LARGE_FRONTEND_FILE` **0** |
| `python3 scripts/check_max_lines.py` | **PASS** (product-client root added) |
| `python3 scripts/check_docs.py` | **PASS** |
| `git diff --check` | **clean** |
| `node scripts/migrate-desktop-product-client.mjs --check` | **0 rewrites** (second run empty) |
| `python3 scripts/check-product-client-move-ledger-postmove.py` | **FAIL** — see divergence below |

### Scan results

- **No product leakage in `apps/desktop/src`** (131 files): `pages/` and
  `components/` are **empty**; remainder = host `lib` (101), `hooks` (18),
  `providers` (9), the retained `stores/auth/auth-store.ts` (1), `main.tsx`,
  `assets.d.ts`. No product pages, route tree, or non-auth stores.
- **No dual code ownership.** Two files share a relative path across the two
  trees, both intended splits (verified non-identical): `assets.d.ts` (host keeps
  Sentry/PostHog env + asset-module decls; package split env into `vite-env.d.ts`
  and kept asset-module decls in `assets.d.ts`) and `lib/infra/proliferate-api.ts`
  (host bootstrap/default 63 lines vs package pure helpers 32 lines). Minor: the
  package `assets.d.ts` header still carries the retired-canary comment (stale
  wording, no effect) — cosmetic cleanup for the seam pass.
- **Canary gone:** no `ProductClientBuildCanary` reference in the package or host.
- **`internal/*` lane** present in `package.json` exports (host-only reverse-seam
  surface; documented in "F2 stage").
- **Desktop production-build asset proof** (ProductClient lazy chunks / CSS /
  fonts, public-shell manifest not eagerly loading the authenticated root):
  **UNVERIFIABLE** — gated on the package dist + Desktop build. Deferred to the
  post-ruling green pass.
- **Working-tree cruft:** the `git mv`s left many empty directories under
  `apps/desktop/src` (git does not track empty dirs, so they are not staged and
  will not ship). Left in place; removable with `find … -type d -empty -delete`
  at the seam pass.

### DIVERGENCE — postmove ledger checker fails on 9 rows (F3 relocation vs binding ledger)

`check-product-client-move-ledger-postmove.py` **FAILS** with 9
`retain source missing` violations. F3 commit `027d1f891` relocated the
`hooks/access/tauri/{credentials,shell,workspace-scratch}/**` subtrees (9 files)
into the package, arguing they were already bridge-based (`host.desktop.*`) and
their `retain` was a "stale bucket default" of `hooks/access/tauri/**`. The
**binding move-ledger (from main) still classifies these rows `retain`**, so the
checker correctly reports tree ≠ ledger.

Per the stage rule "binding inputs on main — do not reinterpret" and "an
ownership decision absent from the ledger → STOP and report," F4 does **not**
unilaterally rewrite the ledger classifications to paper over the checker. This
is surfaced as an **owner-ratification item**: either bless the reclassification
(retain → move for those 9 rows, then the checker passes) or revert F3's
relocation. It is recorded, not resolved. (The 18 `split` rows remain pending as
expected — the checker also lists those, blocked on the (A) rulings.)

## Round 3 (G1–G7) + green — final (authoritative)

Round 3 ruled the five NEW capability/ownership gaps the F3 STOP surfaced plus
the coupled behavior-sensitive items, and all of it landed. The F1–F4 narrative
above (and the F3/F4 STOP analyses and RED matrices) is retained as a historical
record; **this section is the authoritative final state.** Package `tsc`
**47 → 0** and `PRODUCT_CLIENT_FORBIDDEN_IMPORT` **50 → 0**. No product behavior
changed — every resolution routes through an existing or newly-ruled
ProductHost/DesktopBridge capability, and all promoted fetchers/URL helpers are
base-URL-explicit (no host-config default in the package).

### Round-3 rulings, as executed (with rationale)

- **G1 Updater cluster** (`use-updater`, `use-app-version`, `updater-dev-mock`,
  `use-update-restart-watcher` + their tests + `app/query-keys`). Moved into the
  package (ratified `retain → move`; their `retain` was the coarse
  `hooks/access/tauri/**` bucket default — they are `host.desktop.updater` bridge
  consumers, not raw-Tauri). Hook-level telemetry goes through the typed product
  facade; the **module-level auto-check scheduler** receives an injected
  `{track, captureException}` armed from the hook (same DI pattern as the
  measurement sink), so no raw host telemetry import survives in product. Updater
  metadata (`lastCheckedAt` etc.) persists through the injected `ProductStorage`
  with **identical keys** — the Desktop adapter is the same Tauri preferences
  store, so existing values keep working byte-compatibly. `updater-dev-mock`'s dev
  flag also via `ProductStorage` (dev-only key). Event names/payloads/intervals
  byte-identical.
- **G2 Anonymous install id.** New narrow `ProductTelemetry.getAnonymousInstallId():
  Promise<string | null>` (`host/product-host.ts`). Desktop reads the existing
  anonymous-telemetry bootstrap; returns `null` when unavailable/off-Desktop; the
  two consumer hooks omit the `desktopInstallId` field on `null` (preserving the
  current bootstrap-failure behavior). Rationale: this id is a `crypto.randomUUID()`
  provably distinct from the worker install id, so the worker bridge is not a
  behavior-safe substitute — it needs its own accessor.
- **G3 Native render diagnostics.** New `DesktopDiagnosticsBridge.reportRenderError(report)`
  (`host/desktop-bridge.ts`); the dedup/fingerprint semantics moved into the
  Desktop impl (not product). `AppErrorBoundary` calls
  `host.desktop?.diagnostics.reportRenderError`, skipping when `desktop` is null.
  **Not** diverted to `host.telemetry.captureException` (that would send render
  errors to Sentry instead of the native renderer log — a behavior change).
- **G4 Cloud gateway token.** New `host.cloud.getSandboxGatewayAccessToken():
  Promise<string>` (`host/product-host.ts`), armed in the package via
  `lib/access/cloud/sandbox-gateway-access.ts`. Rationale: this is a scoped
  sandbox-gateway resource token the product already carried to the connection
  layer pre-move — **not** the auth session/refresh credential barred by slice-01;
  acquisition/refresh stays host-owned. Replaces the `getDesktopCloudAccessToken`
  holdout that F1 deferred.
- **G5 Window chrome.** New `nativeUi.applyMacosWindowChrome` bridge port; no-op
  off-Desktop; `use-window-actions` moved with it (replacing the raw
  `apply_macos_window_chrome` Tauri op).
- **G6 Ledger amendments.** An "Amendments (ratified during the move)" section was
  appended to `move-ledger.md` — the binding rows are **not** rewritten. It carries
  a fenced ` ```ledger-amendments ` block of **18 `retain → move` overrides** (the
  9 credentials/shell/workspace-scratch subtree files from F3 + the G1 updater
  cluster + `use-window-actions` + `use-update-restart-watcher`), each with
  evidence that the original `retain` was a stale bucket default.
  `check-product-client-move-ledger-postmove.py` reads that block and applies the
  overrides before checking, so the completion proof is green without silently
  editing the binding ledger.
- **G7 remaining deferred.** R2 bridge ports landed —
  `DesktopConnectServerBridge.fetchServerMeta(url)` (connect-server meta probe) and
  the dev-handoff window port (`isMainWebviewAvailable()` + `revealCurrentWindow()`,
  dev-only) — with `use-connect-server` and `use-dev-desktop-handoff` moved onto
  them. The `use-organization-join-invitation-flow` split, the
  `DesktopProductLifecycleRoot` split (capability-gated product subtree moves;
  residual raw-tauri stays host), the `ensure-desktop-worker` `captureException` DI,
  and the auth-store test doubles all landed. `desktop: null` fails these paths
  closed by not mounting (both hooks already gate on `desktop`).

### New host / bridge capabilities added (for the PR description)

| Capability | Surface | Gap |
| --- | --- | --- |
| `ProductTelemetry.getAnonymousInstallId(): Promise<string \| null>` | `host.telemetry` | G2 |
| `DesktopDiagnosticsBridge.reportRenderError(report)` | `host.desktop.diagnostics` | G3 |
| `host.cloud.getSandboxGatewayAccessToken(): Promise<string>` | `host.cloud` | G4 |
| `nativeUi.applyMacosWindowChrome(...)` | `host.desktop.nativeUi` | G5 |
| `DesktopConnectServerBridge.fetchServerMeta(url): Promise<ServerMetaProbeResult>` | `host.desktop` (connect-server) | R2a / G7 |
| dev-handoff window port: `isMainWebviewAvailable(): boolean` + `revealCurrentWindow(): Promise<void>` | `host.desktop` (dev-only) | R2b / G7 |
| Injected updater facades: module-scheduler `{track, captureException}` + updater metadata via `ProductStorage` (identical keys) | DI, not a new interface | G1 |
| Measurement port: swappable `MeasurementSink` (no-op default; host injects retained engine) | `./infra/measurement` export | R1 |
| Reverse seam: public `./internal/*` export lane (host-only, to be narrowed after Web) | package exports | R3 |

### Final battery / scan matrix (this slice's head)

| Command | Result |
| --- | --- |
| `pnpm --filter @proliferate/product-client typecheck` | **GREEN** (exit 0; `tsc` 315 → 0) |
| `pnpm --filter @proliferate/product-client build` | **GREEN** (exit 0; dist + 85 non-code assets mirrored) |
| `pnpm --filter @proliferate/product-client test` | 503/509 files, 2946/2958 tests pass; **6 files / 12 tests fail — all base-proven pre-existing** |
| `pnpm --filter proliferate build` (desktop) | **GREEN** (exit 0; `AuthenticatedProductClient-*.js` emitted as a separate lazy chunk) |
| `pnpm --dir apps/desktop exec vitest run` | **GREEN** (exit 0; 23 files / 162 tests) |
| `pnpm --filter @proliferate/web build` | **GREEN** (exit 0; Web untouched) |
| `python3 scripts/check_frontend_boundaries.py` | **GREEN** (`PRODUCT_CLIENT_FORBIDDEN_IMPORT` 272 → 0) |
| `python3 scripts/report_frontend_structure.py --strict --summary-only` | **GREEN** (TOTAL 0; `LARGE_FRONTEND_FILE` 0) |
| `python3 scripts/check_max_lines.py` | **PASS** |
| `python3 scripts/check_docs.py` | **PASS** (216 Markdown files) |
| `git diff --check` | **clean** |
| `node scripts/migrate-desktop-product-client.mjs --check` | **0 rewrites** (second run empty; 1985 move modules scanned) |
| `python3 scripts/check-product-client-move-ledger-postmove.py` | **GREEN** (move=2087 split=20 resolved=20 pending=0 retain=112 delete=1; 18 amendments applied) |
| `node scripts/verify-product-client-qualification.mjs` | **GREEN** (lazy authenticated split verified desktop + browser; 335 served asset URLs all HTTP 200 incl. CSS/font/png/mp3/svg) |

### Scan results

- **`apps/desktop/src` is host-only** (114 files): `lib` (101), `hooks` (3),
  `providers` (7), the retained `stores/auth/auth-store.ts` (1), `main.tsx`,
  `assets.d.ts`. `pages/` and `components/` are **empty**; no product route tree
  or non-auth stores.
- **No dual code ownership.** Only two files share a relative path across the two
  trees, both intended splits (verified non-identical): `assets.d.ts` (host keeps
  Sentry/PostHog env + asset decls; package split env into `vite-env.d.ts`) and
  `lib/infra/proliferate-api.ts` (host bootstrap/default vs package pure helpers).
- **Canary gone:** no `ProductClientBuildCanary` reference in package or host
  (source or exports).
- **Desktop prod-build lazy-split proof:** `apps/desktop/dist/index.html` does
  **not** reference `AuthenticatedProductClient-*.js` (public shell does not
  eagerly load the authenticated root); the chunk, `index-*.css`, and the font
  set (Geist/GeistMono/Inter/Manrope `.woff2`) are all emitted under
  `dist/assets`.

### Inherited pre-existing test failures — final (do NOT attribute to the move)

12 tests across 6 files fail; **all fail byte-identically at the clean base**
`1d0043756` (verified in H1 via a fresh base worktree with `make shared-build` +
product-client built), so they are inherited, not move-caused:

| File | Fail | Root cause (base-identical) |
| --- | --- | --- |
| `lib/domain/shortcuts/keyboard-resolution.test.ts` | 4 | documented pre-existing |
| `config/playground.test.ts` | 3 | stale `2200ms` default (component is `2400ms`) + composer surface renders `useNavigate` with no Router |
| `lib/domain/settings/navigation.test.ts` | 2 | documented pre-existing |
| `lib/infra/editor/highlighting.test.ts` | 1 | test asserts `#FF678D` vs the theme's shipped `#F22C3D` (since PR #927) |
| `hooks/workspaces/workflows/workspace-bootstrap-empty-session.test.ts` | 1 | `.catch()` on a bare `vi.fn()` (test/code logic mismatch) |
| `components/automations/controls/AutomationRunLocationSelector.test.tsx` | 1 | see resolution below |

The brief's "6" pre-existing count referred only to `keyboard-resolution` (4) +
`navigation` (2); the other 6 (highlighting 1, playground 3, workspace-bootstrap
1, AutomationRunLocationSelector 1) were masked in prior stages that never ran the
suite on a clean shared-build (stale dist) — consistent with D1g seeing 15 at its
earlier base. All 12 are base-proven.

### AutomationRunLocationSelector — final resolution (round-3 ruling)

The round-2 R5 premise (duplicate-React, fix via `resolve.dedupe`) was **wrong**:
an A/B run proved the `resolve.dedupe: ["react","react-dom"]` change (kept as
correct package-boundary hygiene) does not affect this test. Root-caused per the
round-3 ruling: it is **not** a package-lane duplicate-render/config diff — it
fails identically at the clean base because the component inherently renders
"Organization cloud" **4×** through the shared `PopoverButton`, so
`getByText` finding >1 element is correct behavior. It is therefore
**unfixable via test-lane config without weakening the assertion**, and the ruling
forbids quarantine and any component/test weakening → reported and left as-is
(the only honest resolution). This is the one previously "move-induced test-infra"
suspect now retired to the inherited/base-proven bucket.

## Blocked: the S2 seam architecture (three owner rulings required)

> **HISTORICAL — RESOLVED.** The three stop conditions below (measurement facade,
> new DesktopBridge ports, host-facing public export surface) were ruled in
> rounds 1–2 (R1/R2/R3) and the 18 split rows + five NEW gaps were ruled and
> landed in round 3 (G1–G7). See "Round 3 (G1–G7) + green — final" above for the
> authoritative state. The text below is preserved as the record of the STOP.

The 18 pending split rows are the entire remaining seam. Green (package
typecheck/build, Desktop build, full test suites, qualification) is
**unreachable** until the seam is designed, and three items are **contract stop
conditions** — a file needing an ownership decision absent from the ledger, or a
move requiring a new ProductHost/DesktopBridge capability. They were not
pre-authorized by the stage-brief owner rulings and must be ruled before
implementation:

1. **Measurement facade mechanism (174 of the forward-seam imports).** The
   ledger classifies `lib/infra/measurement/**`-consuming product files as
   `move`+seam and states they "must be rerouted through a host-supplied
   measurement facade," while also stating measurement is host-retained and
   **not** a ProductHost capability. The concrete mechanism by which moved
   product reaches host measurement without a new capability is undefined.
2. **New DesktopBridge ports.** `hooks/auth/workflows/use-connect-server.ts`
   (host `fetchServerMeta` raw-Tauri HTTP probe) and
   `hooks/app/lifecycle/use-dev-desktop-handoff.ts` (raw `tauri/window`) each
   need a **new** DesktopBridge port per their ledger split rows — the contract's
   explicit "the move requires a new ProductHost capability → STOP".
3. **Package host-facing public export surface (the reverse seam).** 56
   specifiers across ~51 retained Desktop host files
   (`DesktopProductHostProvider`, auth orchestration, the telemetry client,
   `auth-store`, `proliferate-api`) import moved auth/telemetry **domain**,
   stores, and config. The package currently exports only `./host/*` and
   `./ProductClient`; a host-facing public export surface is an architecture
   decision absent from the ledger. This breaks the Desktop build and the
   retained Desktop host tests.

**Owner-authorized but coupled to (3), therefore deferred to the seam ruling:**
the auth-probe promotion (`getDesktopAuthMethods` / `discoverDesktopSso` /
`getGitHubDesktopAuthAvailability` and their hooks `use-auth-methods` /
`use-sso-discovery` / `use-github-auth-availability`). The stage brief authorizes
promoting these plain unauthenticated HTTP probes into product-owned cloud access
with no new ProductHost capability, but the fetchers currently live host-side and
are consumed by both host and product, so their promotion is part of the same
reverse-seam export-surface decision and is executed with it — not in isolation.

### Pending split rows (18)

```text
hooks/access/cloud/agent-run-configs/use-agent-run-configs.ts
hooks/access/cloud/auth/use-auth-methods.ts        (+ .test.tsx)
hooks/access/cloud/auth/use-auth-viewer.ts
hooks/access/cloud/auth/use-github-auth-availability.ts
hooks/access/cloud/auth/use-sso-discovery.ts
hooks/access/cloud/automations/use-automations.ts
hooks/access/cloud/workspaces/use-cloud-exposed-workspaces.ts
hooks/access/cloud/workspaces/use-cloud-visible-workspaces.ts
hooks/app/lifecycle/use-dev-desktop-handoff.ts     (+ .test.tsx)   [window port]
hooks/auth/workflows/use-connect-server.ts         (+ .test.tsx)   [connect-server port]
hooks/auth/workflows/use-github-sign-in.ts
hooks/organizations/workflows/use-organization-join-invitation-flow.ts (+ .test.tsx)
providers/DesktopProductLifecycleRoot.tsx          (+ .test.tsx)
```

## Owed build-time work (owner-ruled, verifiable only after the build is green)

- **`catalog.json` `?raw`.** `lib/domain/agents/bundled-agent-catalog.ts` still
  reaches `../../../../../../catalogs/agents/catalog.json?raw`, broken by the
  depth change and masked from `tsc` by the ambient `*?raw` decl (it will fail
  Vite). Per the stage-brief ruling it needs a build-time copy of repo-root
  `catalogs/agents/catalog.json` into a gitignored `src/generated/` (+ dist
  copy) and a package-relative import — no checked-in duplicate.
- **Asset / CSS / catalog dist emission.** After the seams resolve the two Vite
  host builds still need a copy step wired into the package build (the D1g
  qualification-asset copy script was removed with the canary), or the emitted
  asset/catalog URLs 404.

## Verification matrix (F1 head — SUPERSEDED)

> **HISTORICAL.** This is the F1-head matrix. The authoritative final matrix is in
> "Round 3 (G1–G7) + green — final" above (everything green except the 12
> base-proven inherited failures). Preserved to show the seam-resolution arc.

| Command | Result |
| --- | --- |
| `node scripts/migrate-desktop-product-client.mjs --check` | 0 rewrites (second run empty) |
| `python3 scripts/check-product-client-move-ledger-postmove.py` | move/delete/retain all landed once; 18 splits pending |
| `git diff --check` | clean |
| `python3 scripts/check_docs.py` | pass |
| `python3 scripts/check_max_lines.py` | pass |
| `python3 scripts/check_frontend_boundaries.py` | **RED** — was 272 `PRODUCT_CLIENT_FORBIDDEN_IMPORT`; **77 after F1** (measurement + cloud-client landed) |
| `python3 scripts/report_frontend_structure.py --strict --summary-only` | **RED** — TOTAL 266 (248 forbidden-shared-package + 18 large-file) |
| `pnpm --filter @proliferate/product-client typecheck` | **RED** — was ~315; **79 after F1** (all remaining are unresolved seams; 0 non-seam) |
| `pnpm --filter @proliferate/product-client build` | **RED** — same seams; no `dist` emitted |
| `pnpm --filter @proliferate/product-client test` | 2010/2017 tests pass; 167 files fail at collection (seam imports) |
| `pnpm --filter proliferate build` (desktop) | **RED** — reverse seam + missing package dist |
| `pnpm --filter @proliferate/web build` | untouched by this slice |
| `node scripts/verify-product-client-qualification.mjs` | **RED** — depends on package dist |

Forward-seam breakdown (272 forbidden `@/` imports, 267 lines / 181 files):
`@/lib/infra` 179 (measurement bulk), `@/lib/access` 37, `@/hooks/access` 28,
`@/lib/integrations` 10, `@/hooks/auth` 7, `@/stores/auth` 3, and one each of
`DesktopProductLifecycleRoot` / `hooks/organizations` / `hooks/app`.

## Inherited pre-existing test failures (F1-era note — SUPERSEDED)

> **HISTORICAL.** This F1-era note misattributed `AutomationRunLocationSelector`
> as move-induced test-infra. Round 3 root-caused it as base-identical (see
> "AutomationRunLocationSelector — final resolution" above). The authoritative
> inherited-failures list (12 tests / 6 files, all base-proven at `1d0043756`) is
> in "Round 3 (G1–G7) + green — final".

The retained Desktop host tests carry the same base-identical failures the prior
slices waived under the founder-approved `pretest` waiver. The S4 repair pass
confirmed against a clean base worktree that `keyboard-resolution` (4) and
`navigation` (2) fail byte-identically at base `1d0043756`. (D1g recorded 15
failures / 8 files at its earlier base `f93afce81`; the set differs because the
base moved to `1d0043756`.)

## Move-caused reference fixes (this slice)

Pure path-reference updates caused by `move` rows relocating their files
(stable and final — those files are gone from `apps/desktop/src` permanently):

- `specs/codebase/platforms/product/billing.md` — three Markdown links repointed
  from `apps/desktop/src/...` to the `apps/packages/product-client/src/...`
  targets (`OrganizationBudgetsPane`, `OrganizationLimitsEditor`,
  `SidebarConsumptionCard`); `check_docs.py` passes.
- `scripts/max_lines_allowlist.txt` — seven now-orphaned entries removed
  (`check_max_lines.py` scans only `apps/desktop/src`, so moved files fell out
  of scope). Follow-up owned by the seam/package-config resolution: when
  `apps/packages/product-client/src` enters the max-lines / structure scan roots,
  the 18 large product files `report_frontend_structure.py` flags need
  re-allowlisting under their new paths.

## Non-goals (unchanged from the contract)

No product redesign/cleanup/renames beyond the ledger; no forwarding modules or
dual ownership; ProductClient imports no app, Tauri, Sentry/PostHog, or raw host
transport; `product-surfaces` stays separate; Web is untouched.
