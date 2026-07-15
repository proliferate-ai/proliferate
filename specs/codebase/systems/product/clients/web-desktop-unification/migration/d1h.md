# Move the Desktop Product into ProductClient (D1h)

Status: **current implementation slice — mechanical move landed; blocked at the
seam architecture pending three owner rulings (contract stop conditions).**

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
| move | 2069 | all landed exactly once (target present, source gone) |
| delete | 1 | removed |
| retain | 130 | intact under `apps/desktop/src` |
| split | 20 | 2 resolved; **18 pending (S2 seam step)** |

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

## Blocked: the S2 seam architecture (three owner rulings required)

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

## Verification matrix at this slice's head

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

## Inherited pre-existing test failures (do not attribute to the move)

The retained Desktop host tests carry the same base-identical failures the prior
slices waived under the founder-approved `pretest` waiver. The S4 repair pass
confirmed against a clean base worktree that `keyboard-resolution` (4) and
`navigation` (2) fail byte-identically at base `1d0043756`. One move-induced
**test-infra** failure exists (`AutomationRunLocationSelector` — jsdom render
duplication, passes at base; likely a second React instance across the package
boundary, resolvable with `resolve.dedupe: ["react","react-dom"]` in the package
vitest) — **not** a product-logic regression. (D1g recorded 15 failures / 8
files at its earlier base `f93afce81`; the set differs because the base moved to
`1d0043756`.)

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
