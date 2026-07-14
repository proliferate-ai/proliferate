# Web/Desktop Unification Rollout Ledger

Status: binding stage and implementation ledger for the Web/Desktop client unification
migration.

This document records the current reviewed slice for the migration defined by
[`../../codebase/features/web-desktop-client-unification.md`](../../codebase/features/web-desktop-client-unification.md)
(the canonical architecture; it wins any conflict). The founder and
implementation agent control one current slice together, keep its contract
current as evidence changes, review it, and then select the next slice.
Superseded phase names and rollout mechanics are not implicitly reusable.

Non-authoritative history: the original migration plan and the 2026-07-13
intake sweep remain under `specs/tbd/` as execution detail and sweep input
only.

Ledger rules:

- **No secrets in git.** Record identifiers, URLs, and non-secret
  configuration only; reference secrets by name/location, never value.
- **Exact bases.** Every current slice records its exact starting base SHA.
  If implementation starts from another base, reconcile before proceeding.
- **One current slice.** Work stays inside the named current PR until it is
  reviewed. The next PR remains queued, not concurrently authorized.
- **Living contract.** Material scope decisions are recorded with the founder
  before implementation broadens. No separate freeze or promotion ceremony is
  required.
- **Facts only.** Record verified merged/reviewed state and explicit founder
  decisions, not inferred dispositions from old branches or chats.

## 1. Pipeline state

The migration proceeds one PR at a time. The founder and implementation agent
shape the current scope directly, implement and review it, then update this
ledger when moving to the next PR. Chat is working context; this ledger and the
canonical feature spec are the durable handoff.

Current handoff:

- Current PR: Desktop Local Runtime Adoption — implementing.
- Next PR: not yet selected — not started.

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
- Final implementation: PR #1157, merge
  `a76ab5911e2af39593b4b31530535f0811a3558b`, from accepted head
  `90926523c3662067e02f8511db6c8e0058e119f1`.
- Desktop Native UI Adoption contract:
  `specs/codebase/features/web-desktop-client-unification-d1b.md`, revision
  `D1b-r2`, final PR #1165 reviewed head
  `32632bd487e9be28592579728b87f0c18d73ee9c`, merge
  `736d181575e4d81389d19ba7a78afd14566e1fda`.
- Desktop Local Runtime Adoption contract:
  `specs/codebase/features/web-desktop-client-unification-d1c.md`, exact
  implementation base `736d181575e4d81389d19ba7a78afd14566e1fda`.
- Current role: implementation. Material scope changes are decided with the
  founder and recorded before the slice broadens.

| Slice | Outcome | Final evidence | State |
| --- | --- | --- | --- |
| Contract promotion | Promote the simplified Web/Desktop contract and rollout authority. | PR #1149, merge `ff94b3db2` | Complete |
| Preparation: shared CSS | Establish `product.css`, Desktop-only CSS, and package source scanning. | PR #1151, merge `36d40c2c0` | Complete |
| Preparation: embedded browser | Delete the embedded workspace browser and its native child-WebView capability. | PR #1154, merge `4f7fe6ee5` | Complete |
| Preparation: ProductClient foundation | Add the compiled package, `ProductHost`, `DesktopBridge`, `ProductHostProvider`, tests, and enforcement. | PR #1153, merge `0b33e116d` | Complete |
| Desktop Host Adoption | Construct the concrete Desktop host, mount the provider, replace reactive snapshots, and gate running-agent export through one Desktop-only lifecycle root while product files remain in Desktop. | [`web-desktop-client-unification-d1a.md`](../../codebase/features/web-desktop-client-unification-d1a.md), `D1a-r2`; PR #1157 merge `a76ab5911e2af39593b4b31530535f0811a3558b` | Complete |
| Desktop Native UI Adoption | Route native menus, native commands, Dock attention, and Desktop zoom through the mounted bridge while product files remain in Desktop. | [`web-desktop-client-unification-d1b.md`](../../codebase/features/web-desktop-client-unification-d1b.md); PR #1165 merge `736d181575e4d81389d19ba7a78afd14566e1fda` | Complete |
| Desktop Local Runtime Adoption | Route product-owned local AnyHarness discovery, restart, readiness, and connection through the Desktop bridge while raw sidecar/process startup remains Desktop-owned. | [`web-desktop-client-unification-d1c.md`](../../codebase/features/web-desktop-client-unification-d1c.md), base `736d181575e4d81389d19ba7a78afd14566e1fda` | Implementing |
| Remaining Desktop capability adoption | Route only real remaining product consumers through coherent bridge slices while paths remain stable. | Specify only from current consumers; no bridge-completeness work for its own sake. | Directional |
| Shared-client extraction readiness | Prove the host mount envelope, compiled assets/builds, move ledger/codemod, minimal browser host, and fail-closed boundaries. | Shape the focused checklist together before the source move. | Directional |
| Mechanical Desktop extraction | Move the working Desktop product into ProductClient and leave Desktop as a thin native host. | Exact file ledger, landing window, codemod, builds, and behavior proof required. | Directional |
| Legacy Web replacement | Delete the duplicate Web product and mount the same ProductClient from a thin browser host with `desktop: null`. | Browser host/auth contract and shared-product proof required. | Directional |
| Hosted Web qualification and cutover | Qualify both hosts, Web performance, managed-cloud flows, and every external callback/return producer. | §5 external-configuration gate applies. | Directional |
| Self-hosted Web | Add self-hosted Web configuration, deployment, and documentation after hosted Web is clean. | Separate follow-up contract. | Deferred follow-up |

The superseded auth-generation, runtime-lifecycle, PR-1 intake, and
embedded-browser-after-D1 phases from the earlier chain are retired. They are
not prerequisites for the current migration sequence.

## 2. Desktop Host Adoption acceptance record

The existing Desktop product runs beneath a real Desktop-owned
`ProductHostProvider`, with a concrete `DesktopBridge`, and one product-aware
Desktop lifecycle root that mounts only when `host.desktop` exists. Product
source remains under `apps/desktop`.

The founder accepted revision r2 on 2026-07-13 after review. Authority was
promoted through PR #1160 at
`00f92b86c90bdcff288908b158e654c3bdbb543b`; implementation merged through
PR #1157 at `a76ab5911e2af39593b4b31530535f0811a3558b` from reviewed head
`90926523c3662067e02f8511db6c8e0058e119f1`.

The accepted r2 deviations are narrow and recorded in the complete contract:

- legacy route reconstruction preserves raw query bytes while new host-facing
  links use `ProductEntry`;
- the once-only deep-link bridge contains callback rejection without adding
  persistence, retry, replay, recovery, or a queue;
- the updater wrapper consumes the real Tauri event union;
- clean intent-stack boot builds ProductClient before Desktop; and
- the exact Desktop test command has one founder-approved waiver for
  base-identical pretest violations in unchanged files.

## 3. Desktop Native UI Adoption acceptance record

Desktop Native UI Adoption has one observable outcome: every product-owned
native menu, native menu-command subscription, Dock attention export, and
Desktop zoom export reaches the existing concrete
`DesktopBridge.nativeUi`. It extends the already-mounted
`DesktopProductLifecycleRoot`; it creates no second host, bridge, or lifecycle
root and moves no product source into ProductClient.

Reconciliation against PR #1157 was Yellow/targeted. The merged host/provider,
stable concrete bridge, lifecycle root, native-UI signatures, and tests all
support the slice without a ProductClient contract change. The exact
implementation base is
`2ec6907391f57a3e449b5b77c43c18600f64fdaa`.

The founder approved the goal, non-goals, material decisions, exact ownership
plan, acceptance proof, control flow, and representative failure path on
2026-07-13. In browser-only Desktop development, one unavailable native-menu
attempt returns `false`, redispatches the existing DOM fallback in the next
microtask, and disables later native attempts for that hook instance. This
adds no availability capability, retry, persistence, queue, or nullable
Desktop host.

The implementation merged in PR #1165 from reviewed head
`32632bd487e9be28592579728b87f0c18d73ee9c` at merge
`736d181575e4d81389d19ba7a78afd14566e1fda`. The complete contract is
[`web-desktop-client-unification-d1b.md`](../../codebase/features/web-desktop-client-unification-d1b.md).

## 4. Desktop Local Runtime Adoption working record

Desktop Local Runtime Adoption routes local runtime discovery, restart,
readiness, and connection through `host.desktop.runtime`. Raw Tauri commands
and sidecar/process ownership remain Desktop-native; resolved workspace and
session operations continue through the AnyHarness SDK.

The exact implementation base is
`736d181575e4d81389d19ba7a78afd14566e1fda`. The contract preserves native
runtime status so a failed sidecar remains an immediate failure, moves initial
bootstrap beneath the existing Desktop-only lifecycle root, starts the shared
runtime scope empty/fail-closed, and explicitly keeps cloud and SSH-target
flows independent of local discovery.

The complete living contract is
[`web-desktop-client-unification-d1c.md`](../../codebase/features/web-desktop-client-unification-d1c.md).

## 5. Remaining migration map and gates

The plain sequence after the current PR is:

1. adopt local runtime and any other genuinely required Desktop-only product
   consumers through the mounted bridge while files remain in Desktop;
2. prove extraction mechanics: the host mount envelope, compiled assets,
   narrow consumer-driven contract corrections, the file ledger/import
   codemod, and a minimal browser-host conformance fixture;
3. mechanically move the working Desktop product into ProductClient;
4. delete the legacy Web product and mount ProductClient from a thin Web host;
5. qualify and cut over hosted Web; then
6. add self-hosted Web as a follow-up.

Desktop is the baseline throughout. There is never an intermediate target in
which two product implementations are maintained.

The current in-place slices keep Desktop source paths stable, so they do not
require a feature freeze or broad open-branch intake sweep. Before the later
Desktop-to-ProductClient source move, refresh the live PR/worktree conflict
inventory and agree on its landing window.

The former Phase H/L/V landing mechanics, evidence branches, phase-bound
external-configuration table, and release-record template are retired. Before
a later Web-cutover slice, reconcile current deployment workflows and external
configuration, then shape a slice-specific rollout checklist with its own
exact base and acceptance proof. The durable external-configuration evidence
requirements in §5 remain binding. Do not reuse retired phase mechanics by
implication.

## 6. Later Web cutover external-configuration gate

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
