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
