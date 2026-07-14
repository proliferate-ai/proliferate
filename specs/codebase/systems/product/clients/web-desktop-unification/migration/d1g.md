# Prove ProductClient Extraction Mechanics (D1g)

Status: **current implementation scope**.

- Exact implementation base:
  `f93afce8190bba943277d588c9bfb0d051c615c9`
- Prior completed implementation: PR #1182 (D1f), merge
  `f93afce8190bba943277d588c9bfb0d051c615c9`
- Parent architecture:
  [`web-desktop-client-unification.md`](web-desktop-client-unification.md)
- Application-entry contract:
  [`web-desktop-product-client-entry-contract.md`](web-desktop-product-client-entry-contract.md)
- Move ledger:
  [`web-desktop-product-client-move-ledger.md`](web-desktop-product-client-move-ledger.md)
- Pipeline ledger:
  [`../../developing/deploying/web-desktop-unification-rollout.md`](../../developing/deploying/web-desktop-unification-rollout.md)
- Approved contract:
  `03 - Prove ProductClient Extraction Mechanics.md` (founder-approved r3;
  decisions 8–9 approved 2026-07-14)

This is the landed-mechanics record for proving that
`@proliferate/product-client`'s toolchain can compile and ship every import and
resource shape the Desktop product needs — from both a Desktop host and a
minimal browser host — and that the later source move can run from a checked,
deterministic ledger and codemod rather than agent judgment. **No Desktop
product source moves in this slice.** The two reserved real files
(`src/ProductClient.tsx`, `src/app/AuthenticatedProductClient.tsx`) are not
created; they are owned by the next slice (the mechanical move).

## Observable outcome

At this slice's head, on base `f93afce81`:

- the approved application-entry contract (signature, export subpath, provider
  envelope, package-private `#product/*` mechanism, public-shell/lazy-authenticated
  split) is recorded and qualified by a build-only canary;
- a Desktop qualification build and a minimal browser host (`surface: "web"`,
  `desktop: null`) both compile the representative canary — a lazy chunk,
  generated JSON/registry inputs, `?raw` text/SVG, image, audio, font, and
  product CSS — and the browser host serves every emitted resource URL at HTTP
  200;
- the complete `move`/`split`/`retain`/`delete` ledger of all current
  `apps/desktop/src` files exists, is checked by a script, and drives a
  deterministic, idempotent import codemod proven on a disposable copy;
- a deterministic legacy-Web bundle collector exists and a provisional baseline
  is recorded (not a budget); and
- structure checks reject ProductClient imports from either host, Tauri, or the
  Desktop `@/` alias.

## Entry contract (recorded, not implemented)

The full contract is in
[`web-desktop-product-client-entry-contract.md`](web-desktop-product-client-entry-contract.md).
Summary of what this slice locks:

- **Public entry:** `ProductClient({ RoutesComponent }): ReactElement`, exported
  only as `@proliferate/product-client/ProductClient`
  (`dist/ProductClient.{js,d.ts}`, emitted by the move PR). `RoutesComponent`
  is the single host-infrastructure prop; Desktop and Web pass their existing
  Sentry-instrumented `InstrumentedRoutes`, the browser fixture passes plain
  React Router `Routes`. It is not stored in `ProductHost` and defines no
  product routes.
- **Provider envelope:** `BrowserRouter -> QueryClientProvider ->
  CloudClientProvider -> ProductHostProvider -> ProductClient(RoutesComponent)`.
- **Package-private imports:** the package `imports` map resolves `#product/*`
  to compiled `dist/*.js` at runtime/host-build time (never back into `src`);
  in-package `tsc` resolves the `types` condition + mirrored tsconfig `paths` to
  `src`; Vitest resolves a `resolve.alias` to `src`. `tsc` emits `#product/*`
  specifiers verbatim — that is what proves the compiled mechanism.
- **Public-shell / lazy-authenticated split:** `ProductClient` is a lightweight
  public/auth shell; the authenticated root is internal and lazy-loaded via
  `#product/app/AuthenticatedProductClient`, so login/callback entrypoints do
  not eagerly pull editor/terminal/authenticated-only chunks.

The reserved-file rule holds: `src/ProductClient.tsx` and
`src/app/AuthenticatedProductClient.tsx` do not exist in this slice, and
`./ProductClient` is not exported. The slice carries a **temporary** public
canary export `@proliferate/product-client/qualification/ProductClientBuildCanary`
that the move PR deletes.

## Canary shape

```text
apps/packages/product-client/src/qualification/
  ProductClientBuildCanary.tsx              # public/auth shell; props mirror ProductClientProps
  AuthenticatedProductClientBuildCanary.tsx # lazy-loaded via #product/qualification/...
  canary-lazy-chunk.tsx                     # additional on-demand chunk
  assets/**                                 # png, svg (url + ?raw), json (?raw + normal), mp3
apps/packages/product-client/src/assets.d.ts                       # ambient resource/CSS/font decls
apps/packages/product-client/scripts/copy-qualification-assets.mjs # tsc-only asset copy into dist
```

Because plain `tsc` cannot transform `?raw`, asset-URL, CSS, or font imports,
the ambient declarations keep the package's declaration-level build passing
while the two Vite host builds resolve and emit the real resource URLs; the
post-build copy script mirrors the resource inputs into
`dist/qualification/assets/**` for dist consumers. The canary's prop shape is
typed locally (`ProductClientBuildCanaryProps`) and is deleted with the canary
when the real entry lands.

## Qualification outputs (verified this slice)

`node scripts/verify-product-client-qualification.mjs` builds the package, the
Desktop qualification app, and the browser host, inspects both manifests, then
serves the browser host and fetches every emitted asset. Result: **pass**.

- **Desktop qualification build** ->
  `apps/desktop/dist-product-client-qualification/` (entry `index.html`,
  `.vite/manifest.json`). Lazy authenticated split verified.
- **Browser host build** ->
  `apps/packages/product-client/qualification/browser-host/dist/` (entry
  `index.html`, `.vite/manifest.json`, `surface: "web"`, `desktop: null`). Lazy
  authenticated split verified.
- **Chunk split proof (both hosts, byte-identical hashes):** entry `index-*.js`
  = 272.92 kB (gzip 87.42 kB); `AuthenticatedProductClientBuildCanary-*.js` =
  1.52 kB (gzip 0.84 kB) is a **separate lazy chunk**, not in the entry;
  `canary-lazy-chunk-*.js` = 0.16 kB is a further on-demand chunk;
  `AuthenticatedProductClientBuildCanary-*.css` = 95.97 kB (gzip 17.78 kB). The
  authenticated canary and its CSS are emitted as dynamically-reached chunks, so
  the unauthenticated shell does not eagerly include them.
- **Served-asset check:** browser host served **21 asset URLs, all HTTP 200**,
  including a CSS asset, a font (`.woff2`), a PNG, an MP3, and an asset-URL SVG.
  `?raw` SVG/JSON and the generated JSON/registry inputs compile through both
  hosts.

The `@import must precede…` PostCSS notice and the two Geist `.woff2`
"resolved at runtime" notices are non-fatal Vite warnings (the Geist font URLs
are intentionally left for runtime; the notice does not fail the build).

## Collector + provisional legacy-Web baseline

Tool: `scripts/collect-web-bundle-baseline.mjs`. Command:
`PROLIFERATE_WEB_BUNDLE_MANIFEST=1 pnpm --filter @proliferate/web build`, then
walk `apps/web/dist/.vite/manifest.json`. The manifest opt-in is an env flag off
in normal builds, so the normal `@proliferate/web build` output is byte-identical
(same hashed chunks; only the extra manifest file differs). Compression metric:
gzip (Node `zlib`, level 9). Deterministic: no timestamps, stable-sorted, exact
byte counts.

Provisional baseline (base `f93afce81`):

| Segment | gzip | raw | Composition |
| --- | --- | --- | --- |
| Unauthenticated `/login` entry | 487,569 B (476.1 KiB) | 1,670,977 B | 1 JS chunk 470,427 B gzip + 1 CSS chunk 17,142 B gzip; 0 fonts, 0 images |
| Per-route lazy chunks | — | — | none (route splitting: `none`) |
| Authenticated total | 487,569 B (476.1 KiB) | 1,670,977 B | identical to entry |

Findings: legacy Web performs **no route-level code splitting** (`apps/web/src/App.tsx`
statically imports every page, so `/login` eagerly loads the whole authenticated
product — exactly the eager-load problem founder decision 4 fixes); it emits
**no separate font/image assets** (`index.css` imports only
`@proliferate/design/dom.css`, which has no `@font-face`/`url()`/`data:` font
refs — the zeros are by construction, not omission).

These numbers are a **provisional historical baseline, not a budget** (founder
decision 7). The Legacy-Web-replacement PR reruns this exact collector on its
own exact base immediately before deletion; those later numbers are the binding
cutover baseline.

## Move ledger summary counts

Full ledger:
[`web-desktop-product-client-move-ledger.md`](web-desktop-product-client-move-ledger.md).
Source root `apps/desktop/src` = **2220 files at base**. Checked by
`scripts/check-product-client-move-ledger.py` (every disk path has exactly one
classification, no target collisions, no unclassified product file):

| Classification | Count |
| --- | --- |
| move | 2069 |
| split | 20 |
| retain | 130 |
| delete | 1 |
| **total** | **2220** |

`retain` = the Desktop host buckets (main/providers composition, `lib/access/tauri/**`,
telemetry/auth transport, auth store + named auth-workflow/bootstrap hooks,
`proliferate-api.ts`, `cloud/client.ts`, `lib/infra/measurement/**`,
`hooks/access/tauri/**`) plus a small set of audited retain exceptions recorded
with evidence in the ledger. `delete` = the one provably-dead asset
(`lib/infra/hf-logo.svg`, no repo-wide importer). `split` = files with both host
and product responsibilities, each with named split parts/targets. Everything
else is `move` to `apps/packages/product-client/src/<same relative path>`.

## Codemod proof evidence

`scripts/migrate-desktop-product-client.mjs` is the ledger-driven import codemod.
It parses this ledger with the same semantics as the checker (fenced
` ```ledger ` block, tab-split rows, >=4 fields, valid classification). For every
`move`-classified JS/TS module it locates import/export/dynamic-import/require/
import-type/import-equals specifier string literals with the **TypeScript
parser** and splices only that token, rewriting Desktop-local `@/...` and
relative specifiers that resolve to another `move`-classified JS/TS module into
package-private `#product/*`. `--check` prints a stable-sorted plan (no writes);
`--apply` writes. No fallback text replacement.

Scope (justified): the `imports` map resolves `#product/*` only to
`./dist/*.js`, so only compiled JS/TS modules are eligible. Local specifiers
resolving to a `retain`/`split`/`delete` target, to an asset/CSS/JSON file
(`@/assets/...svg?raw`), or **outside** `apps/desktop/src` (the six-level
`catalogs/agents/catalog.json?raw` reach) are left untouched — a co-moved
relative asset import stays valid post-move, and an aliased asset/external
import cannot be expressed as `#product/*`. Seam imports (product files reading
`lib/infra/measurement/**`, which is `retain`) resolve to `retain` rows and are
correctly left as `@/...` here, to be rerouted through host facades by the move
PR.

Proof on a disposable copy of `apps/desktop/src` (the real working tree is never
written — verified `git status --porcelain apps/desktop/src` = 0 after):

- `--check` -> **5653 planned rewrites across 1601 files** (1985 move modules
  scanned).
- `--apply` -> 5653 applied; plan byte-identical to `--check`.
- `--check` after apply -> 0 (empty).
- `--apply` second run -> 0 (idempotent).
- Two independent full `--apply` runs produce byte-identical trees (stable sort
  by source path then in-file position, no timestamps).
- Applied diffs touch only import/export specifier tokens (line counts
  preserved; every rewritten specifier is `#product/*`).
- Refuses (exit nonzero) on: a 3-field row, an unterminated ` ```ledger `
  block, an unknown classification, a `move` source importing a path with no
  ledger row, and a missing mode.

Running `--check` twice against the current (unmoved) tree is byte-identical and
leaves the working tree unchanged; check mode against the current tree reports
the future rewrites deterministically, it is not expected to be empty.

## Non-goals

This slice moves/deletes no Desktop product source, replaces/deletes no legacy
Web, changes no product behavior/routes/auth policy/caching/runtime lifecycles,
does not absorb `product-surfaces`, and sets no final hosted-Web performance
budget. It creates neither reserved real file and imports no Desktop source into
the package.

## Recorded deviations and follow-ups (carried to the move PR)

- **Application-entry contract recorded in a dedicated doc.** The required
  "application-entry contract" artifact has no mandated filename; it is recorded
  in `web-desktop-product-client-entry-contract.md` and may be folded into the
  move-ledger doc when the move lands (delete, do not leave a forwarding stub).
- **Codemod proves specifier mechanics only.** It intentionally does not rewrite
  the ~76 `@/assets/*` imports, the `catalogs/agents/catalog.json?raw` external
  reach, or seam/`split`/host-facade imports. Those `@/...` specifiers remain in
  the moved files and need bespoke handling (asset re-aliasing, host-facade
  reroutes, split resolution) before `check_frontend_boundaries.py` passes
  post-move. They are recorded in the ledger's "Known wrinkles".
- **Codemod resolves via disk.** It must run on the exact tree the ledger
  classifies; run `check-product-client-move-ledger.py` first as a precondition.
- **`typescript` resolved from `apps/desktop` node_modules** (via `createRequire`),
  not repo root; the script depends on that install being present.
- **Duplicate-named `product-storage.ts`** exists at
  `lib/access/browser/product-storage.ts` and
  `lib/infra/persistence/product-storage.ts` (distinct modules, distinct
  targets); the ledger keeps them separate.

## Acceptance proof

Verification run at this slice's head (base `f93afce81`):

| Command | Result |
| --- | --- |
| `pnpm --filter @proliferate/product-client test` | pass |
| `pnpm --filter @proliferate/product-client typecheck` | pass |
| `pnpm --filter @proliferate/product-client build` | pass |
| `pnpm --filter proliferate build` (desktop) | pass |
| `pnpm --filter @proliferate/web build` | pass |
| `python3 scripts/check_frontend_boundaries.py` | pass |
| `python3 scripts/report_frontend_structure.py --strict --summary-only` | pass (TOTAL 0) |
| `python3 scripts/check_max_lines.py` | pass |
| `git diff --check` | clean |
| `python3 scripts/check-product-client-move-ledger.py` | OK (2220 files; move=2069, split=20, retain=130, delete=1) |
| `node scripts/verify-product-client-qualification.mjs` | pass (21 served asset URLs HTTP 200; lazy split verified on both hosts) |
| `node scripts/migrate-desktop-product-client.mjs --check` (×2) | byte-identical (5653 rewrites / 1601 files); working tree unchanged |
| `pnpm --dir apps/desktop exec vitest run` (full) | 3098 pass; 15 failures across 8 files, base-identical (see below) |

The full `vitest run` is invoked directly (not the `test` script) under the same
founder-approved waiver as prior slices: the `pretest` design-system check flags
base-identical arbitrary-utility violations in unchanged files. The 15 failures
(8 files: automations location selector, `FileChangeCall` clipboard mock,
playground fixtures, `use-workspace-entry-flow`, workspace-bootstrap, settings
navigation, keyboard-resolution, markdown highlighting) are **pre-existing at
base `f93afce81`**: this slice changes zero files in the desktop test resolution
graph (`git diff f93afce81 HEAD -- apps/desktop/src
apps/packages/product-client/src/host <shared packages> apps/desktop/vitest.config.ts`
is empty), so the resolved test code — and therefore the failing set — is
identical to base. The delta from the D1f record's 13/7 (measured at the earlier
base `06bf880a1`) is the `use-workspace-entry-flow.test.ts` pair, which entered
between `06bf880a1` and our base `f93afce81` and predates this slice.
