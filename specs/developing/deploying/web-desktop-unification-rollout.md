# Web/Desktop Unification Rollout

The canonical architecture is
[`../../codebase/systems/product/clients/web-desktop-unification/README.md`](../../codebase/systems/product/clients/web-desktop-unification/README.md).
This document owns only the remaining execution order and cutover gates.

## Current handoff

The ProductClient foundation, Desktop host boundary, shared identity,
navigation, persistence, telemetry, and extraction mechanics have landed. The
current migration step is the mechanical Desktop extraction:

1. Move the working Desktop product into ProductClient according to the
   checked [move ledger](../../codebase/systems/product/clients/web-desktop-unification/move-ledger.md).
2. Apply the proven import codemod and create the real application entry from
   the [entry contract](../../codebase/systems/product/clients/web-desktop-unification/entry-contract.md).
3. Delete the temporary qualification canary and every superseded Desktop
   product path; do not leave parallel implementations.
4. Leave Desktop as the thin native host while preserving its current visual
   and behavioral baseline.
5. Run the ProductClient package build, Desktop build, browser-host build,
   structure checks, and focused behavior tests before review.

The landed extraction proof and known follow-ups are recorded in
[`d1g.md`](../../codebase/systems/product/clients/web-desktop-unification/migration/d1g.md).
Refresh the live branch/worktree conflict inventory immediately before the
large source move and agree on its landing window.

## Remaining sequence

After the Desktop extraction:

1. Delete the duplicate Web product and mount the same ProductClient from a
   thin browser host with `desktop: null`.
2. Qualify Desktop and hosted Web, then cut over hosted Web.
3. Add self-hosted Web configuration, deployment, and documentation.

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
