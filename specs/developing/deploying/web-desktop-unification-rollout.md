# Web/Desktop Unification Rollout

The canonical architecture is
[`../../codebase/systems/product/clients/web-desktop-unification/README.md`](../../codebase/systems/product/clients/web-desktop-unification/README.md).
This document owns only the remaining execution order and cutover gates.

## Current handoff

The ProductClient foundation, Desktop host boundary, shared identity,
navigation, persistence, telemetry, extraction mechanics, the mechanical
Desktop extraction, and the legacy Web replacement have all landed. Desktop is a
thin native host and `apps/web` is a thin browser host that mounts the same
compiled ProductClient with `desktop: null`.

- Desktop product move (thin native host):
  [`d1h.md`](../../codebase/systems/product/clients/web-desktop-unification/migration/d1h.md).
- Legacy Web replacement (thin browser host, `desktop: null`) — **complete,
  pending review; cutover next**:
  [`d1i.md`](../../codebase/systems/product/clients/web-desktop-unification/migration/d1i.md).

The current migration step is to **qualify and cut over hosted Web**. Before
mutating any external producer, complete the cutover gate below against the
binding legacy-Web bundle baseline recorded here.

## Remaining sequence

1. Qualify Desktop and hosted Web against the shared implementation, enforce the
   recorded first-load budget against the binding baseline below, then cut over
   hosted Web one external producer at a time.
2. Add self-hosted Web configuration, deployment, and documentation.

Desktop remains the behavioral baseline throughout. There is no intermediate
state in which two product implementations are maintained.

## Binding legacy-Web bundle baseline (phase 6 cutover gate)

This is the **binding** cutover baseline required before hosted Web cutover
(phase 6). It supersedes the provisional d1g baseline (base `f93afce81`): it was
captured with the same deterministic collector
(`scripts/collect-web-bundle-baseline.mjs`, `gzip` via Node `zlib` level 9) on
the **exact Legacy-Web-replacement base** `c6e094b41` immediately before the
Web deletions, per the contract's ordered mechanics step 2. The committed
artifact is
[`web-bundle-baseline-c6e094b41.json`](../../codebase/systems/product/clients/web-desktop-unification/migration/web-bundle-baseline-c6e094b41.json).

| Segment | gzip | raw | Composition |
| --- | --- | --- | --- |
| Unauthenticated `/login` entry | 495,438 B (483.8 KiB) | 1,730,429 B | 1 JS chunk 471,212 B gzip + 1 CSS chunk 24,226 B gzip; 0 fonts, 0 images |
| Per-route lazy chunks | — | — | none (route splitting: `none`) |
| Authenticated total | 495,438 B (483.8 KiB) | 1,730,429 B | identical to entry |

Legacy Web still performs **no route-level code splitting** (`apps/web/src/App.tsx`
statically imports every page, so `/login` eagerly loads the whole authenticated
product) and emits **no separate font/image assets** (`index.css` imports only
`@proliferate/design/dom.css`). These are the numbers phase 6 compares the
replacement browser-host build against.

## Phase-6 first-load budget measurement (optimized candidate)

The replacement browser host was measured against the binding baseline with a
runtime `/login` request collector (headless Chromium, fresh cache, ProductClient
readiness marker, `document.fonts.ready`, bounded network-idle settle; gzip
level 9 for JS/CSS, emitted bytes for pre-compressed assets — the contract's
metric). Two eager-shell regressions were root-caused and fixed on
`codex/wdu-login-budget`:

- **Turn-end audio** (`use-turn-end-sound.ts`): eager `new Audio(ding)` above
  the auth gate fetched 58.8 KB on the public login shell. Fixed by
  lazy-constructing the clip on first turn-end.
- **xterm terminal CSS** (`product-client/src/index.css` → `use-xterm-surface.ts`):
  the eager ProductClient entry pulled `@xterm/xterm/css/xterm.css` (~1.9 KB
  gzip) into the login bundle — a named contract violation (login/callback must
  not eagerly load xterm/terminal CSS). Fixed by co-locating the stylesheet with
  the lazily imported xterm runtime so it rides the `AuthenticatedProductClient`
  chunk. Verified against the built manifest: eager entry CSS has zero xterm
  rules.

| Readiness point | Legacy baseline (gzip-9) | Optimized candidate (gzip-9) | Delta | Rule | Result |
| --- | ---: | ---: | ---: | --- | --- |
| `/login` requested JS | 471,212 B | 482,329 B | +11,117 B (+2.4%) | No regression | **Over** |
| `/login` requested CSS | 24,226 B | 65,097 B | +40,871 B (+169%) | No regression | **Over** |
| `/login` fonts/images/audio | 0 B | 0 B | 0 | No regression | Pass |
| `/login` total | 495,438 B | 547,426 B | +51,988 B (+10.5%) | No regression | **Over** |

**Why the residual gap is structural, not an unshipped optimization.** The
legacy `/login` numbers are those of a small standalone app that did no code
splitting; the candidate `/login` numbers are the *shell* of the unified shared
product (the full authenticated app is lazy-split into a separate
`AuthenticatedProductClient` chunk, ~746 KB gzip, not requested on `/login`).

- **CSS floor probe.** Tailwind v4 emits utilities from `@source` scanning all
  four shared package trees (`ui`, `product-ui`, `product-surfaces`,
  `product-client`) into one eager stylesheet. Re-scoping `@source` to only the
  login/auth shell sources and rebuilding floors the eager CSS at **35.4 KB
  gzip — still +46% over the 24.2 KB baseline.** The residual is the shared
  design-system token + base + login-utility layer, which is inherently larger
  than legacy Web's minimal standalone login stylesheet. Reaching no-regression
  would require a second parallel Tailwind pipeline for the login surface,
  duplicating tokens and risking cross-host visual drift.
- **JS.** The eager entry is the shared shell (React, router, query, cloud SDK,
  product providers, login, telemetry). Login-only modules were verified absent
  of authenticated-only editor/terminal/Monaco/Shiki code; the +2.4% is the
  richer shared shell, not stray authenticated chunks.

**Founder budget decision required.** The pre-approved contract formula for
`/login` is *no regression vs the legacy baseline*, and the contract forbids
silently raising a ceiling. The smallest verified split still materially exceeds
that ceiling for reasons intrinsic to unifying onto one shared design system and
one shared app shell — the intended, already-accepted cost of the program, but a
specific byte ceiling that was never explicitly waived. This is the single
evidence-backed founder gate for phase 6: either accept a revised `/login`
ceiling that reflects the shared shell (recommended: CSS ≤ ~66 KB gzip, JS
≤ ~485 KB gzip, one-time and browser-cacheable) or direct further optimization
before cutover. Qualification does not mutate any production producer until this
gate is resolved.

## Hosted Web cutover gate

Before hosted Web cutover, inventory every external producer of a hosted Web
URL, including OAuth registrations, Stripe checkout and portal returns,
invitation links, server/frontend base URLs, and any additional producer found
during reconciliation.

For each producer, record:

| Field | Required evidence |
| --- | --- |
| Producer | Stable name and the user flow it serves. |
| Source of truth | Dashboard, environment, parameter, or registration location; secrets only by name or location. |
| Current and required value | Non-secret route or origin values verbatim. |
| Activation | Redeploy, restart, rebuild, or other step that makes the running system consume the value. |
| Live proof | Secret-safe proof that the deployed process consumed the required value. |
| End-to-end smoke | The exact auth, billing, invitation, or return flow that proves it. |
| Rollback and recovery | Restore the source, reactivate it, and rerun the mapped smoke. |

Inventory and verify current values before mutation. Apply producers one at a
time after the replacement Web host is live. A source edit without activation
and live-consumption proof is incomplete. If a write, activation, live proof,
or smoke fails or cannot be verified, restore the prior value, reactivate it,
run the recovery smoke, and halt the cutover until the failure is resolved.
