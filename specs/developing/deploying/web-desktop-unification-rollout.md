# Web/Desktop Unification Rollout Ledger

Status: binding stage and freeze ledger for the Web/Desktop client unification
migration.

This document records the current reviewed slice for the migration defined by
[`../../codebase/features/web-desktop-client-unification.md`](../../codebase/features/web-desktop-client-unification.md)
(the canonical architecture; it wins any conflict). Each implementation slice
is reconciled against an exact base, frozen with the founder, implemented and
reviewed, then followed by reconciliation of the next slice. Superseded phase
names and rollout mechanics are not implicitly reusable.

Non-authoritative history: the original migration plan and the 2026-07-13
intake sweep remain under `specs/tbd/` as execution detail and sweep input
only.

Ledger rules:

- **No secrets in git.** Record identifiers, URLs, and non-secret
  configuration only; reference secrets by name/location, never value.
- **Exact bases.** Every frozen slice records its exact reconciled base SHA.
  If implementation starts from another base, reconcile before proceeding.
- **One current slice.** A prior freeze does not authorize later work. Each
  slice receives its own contract and acceptance proof.
- **Facts only.** Record verified merged/reviewed state and explicit founder
  decisions, not inferred dispositions from old branches or chats.

## 1. Pipeline state

The migration follows the repository PR pipeline: reconcile the next slice
against merged code, freeze one implementation-ready contract with the
founder, implement and review it, then reconcile the following slice. Chat is
working context; this ledger and the canonical feature spec are the durable
handoff.

Current handoff:

- Repository: `proliferate-ai/proliferate`.
- Canonical contract:
  `specs/codebase/features/web-desktop-client-unification.md`.
- Founder working drafts live outside the repository. They are editing
  surfaces only; promoted repository specs and this ledger are sufficient for
  any developer or CI consumer to reproduce the binding handoff.
- Desktop Host Adoption contract:
  `specs/codebase/features/web-desktop-client-unification-d1a.md`, revision
  `D1a-r2`, exact implementation base
  `2ec15eaf8cfc870cbdbb42c225a5f1428e5282b4`.
- Accepted implementation: PR #1157, head
  `90926523c3662067e02f8511db6c8e0058e119f1`, pending merge.
- Current role: finish authority promotion and merge, then reconcile Desktop
  Native UI Adoption against the exact merge SHA. That next slice remains
  provisional and is not authorized for implementation.

| Slice | Outcome | Final evidence | State |
| --- | --- | --- | --- |
| Contract promotion | Promote the simplified Web/Desktop contract and rollout authority. | PR #1149, merge `ff94b3db2` | Complete |
| Preparation: shared CSS | Establish `product.css`, Desktop-only CSS, and package source scanning. | PR #1151, merge `36d40c2c0` | Complete |
| Preparation: embedded browser | Delete the embedded workspace browser and its native child-WebView capability. | PR #1154, merge `4f7fe6ee5` | Complete |
| Preparation: ProductClient foundation | Add the compiled package, `ProductHost`, `DesktopBridge`, `ProductHostProvider`, tests, and enforcement. | PR #1153, merge `0b33e116d` | Complete |
| Desktop Host Adoption | Construct the concrete Desktop host, mount the provider, replace reactive snapshots, and gate running-agent export through one Desktop-only lifecycle root while product files remain in Desktop. | [`web-desktop-client-unification-d1a.md`](../../codebase/features/web-desktop-client-unification-d1a.md), `D1a-r2`; PR #1157 head `90926523c3662067e02f8511db6c8e0058e119f1` | Implementation accepted; pending merge |
| Desktop Native UI Adoption | Route native menus, native commands, Dock attention, and Desktop zoom through the mounted bridge while product files remain in Desktop. | Founder Vault draft; exact base assigned only after prior merge | Provisional; reconciling next |
| Later slices | Remaining in-place bridge adoption, ProductClient source movement, legacy Web deletion, thin Web host, deployability, and self-hosted Web follow-up. | Specify and reconcile one slice at a time. | Deferred |

The superseded auth-generation, runtime-lifecycle, PR-1 intake, and
embedded-browser-after-D1 phases from the earlier chain are retired. They are
not prerequisites for the current migration sequence.

## 2. Desktop Host Adoption acceptance record

At the accepted PR #1157 head, the existing Desktop product runs beneath a
real Desktop-owned `ProductHostProvider`, with a concrete `DesktopBridge`, and
one product-aware Desktop lifecycle root that mounts only when `host.desktop`
exists. Product source remains under `apps/desktop`; this state enters main
only when the PR merges.

The founder accepted revision r2 on 2026-07-13 after review. The accepted
implementation is PR #1157 at head
`90926523c3662067e02f8511db6c8e0058e119f1`; record its actual merge SHA
before marking this slice complete.

The accepted r2 deviations are narrow and recorded in the complete contract:

- legacy route reconstruction preserves raw query bytes while new host-facing
  links use `ProductEntry`;
- the once-only deep-link bridge contains callback rejection without adding
  persistence, retry, replay, recovery, or a queue;
- the updater wrapper consumes the real Tauri event union;
- clean intent-stack boot builds ProductClient before Desktop; and
- the exact Desktop test command has one founder-approved waiver for
  base-identical pretest violations in unchanged files.

## 3. Desktop Native UI Adoption handoff

The next provisional slice adopts only `DesktopBridge.nativeUi` in existing
Desktop product consumers. It extends the already-mounted
`DesktopProductLifecycleRoot`; it does not create a second root or move source
into ProductClient.

Before freezing it:

1. record the exact Desktop Host Adoption merge SHA as the implementation base;
2. reconcile the exact landed symbols and file inventory;
3. settle browser-only Desktop context-menu fall-through behavior;
4. disposition the two Tauri access hooks whose final consumers move; and
5. have the founder confirm the representative control flow and failure path.

## 4. Later source-move and cutover gates

The current in-place slices keep Desktop source paths stable, so they do not
require a feature freeze or broad open-branch intake sweep. Before the later
Desktop-to-ProductClient source move, refresh the live PR/worktree conflict
inventory and agree on its landing window.

The former Phase H/L/V landing mechanics, evidence branches, phase-bound
external-configuration table, and release-record template are retired. Before
a later Web-cutover slice, reconcile current deployment workflows and external
configuration, then freeze a new slice-specific rollout contract with its own
exact base and acceptance proof. The durable external-configuration evidence
requirements in §5 remain binding. Do not reuse retired phase mechanics by
implication.

## 5. Later Web cutover external-configuration gate

The future Web cutover must inventory every external producer of a hosted Web
URL, including OAuth registrations, Stripe checkout/portal return URLs,
invitation links, server/frontend base URLs, and any additional producer found
at reconciliation time.

For each producer, the cutover contract records:

| Field | Required evidence |
| --- | --- |
| Producer | Stable name and the user flow it serves. |
| Source of truth | Dashboard, environment, parameter, or registration location; secrets only by name/location. |
| Current and required value | Non-secret route/origin values verbatim. |
| Activation | Redeploy, restart, rebuild, or other step that makes the running system consume the value. |
| Live proof | Secret-safe proof that the deployed process consumed the required value. |
| End-to-end smoke | The exact auth, billing, invitation, or return flow that proves it. |
| Rollback and recovery | Restore source, reactivate it, and rerun the mapped smoke. |

Inventory and verify current values before mutation. A source edit without its
activation and live-consumption proof is not complete. Apply producers one at
a time after the replacement Web host is live. If a write, activation, live
proof, or smoke fails or is unverifiable, restore the prior value, reactivate,
run the recovery smoke, record the evidence, and halt the cutover until the
failure is resolved. The Web cutover cannot complete until every inventoried
producer has its required value, activation proof, live proof, and mapped
smoke.
