Description: Make target-observed launch options and session live state the executable authorities
Date: 2026-08-19

# Target-observed harness launch options

## Context

Model and mode availability previously emerged from several authorities: the
shipped catalog, runtime model snapshots, trial exceptions, user visibility
overrides, server-side catalog composition, and live ACP configuration. Those
paths could disagree. A picker could offer a value the selected target did not
support, an unknown value could be hidden, and a running session could be
affected by later target/catalog state.

Harnesses already expose the only relevant facts at their execution boundary:
the models and configuration values a no-override launch currently advertises,
and the models/configuration values a specific live session advertises.

## Decision

Before launch, one runtime-owned `HarnessLaunchOptions` state per harness is the
sole executable authority. Its basis is the installed harness plus product-owned
auth/route state. It is probed without workspace or session overrides, handles
empty/failure/basis changes explicitly, and preserves unknown identifiers.

Session create reloads and exactly validates that state, then atomically stores
the complete `ResolvedLaunchIntent` with the session. Actor startup applies and
positively confirms every explicit value before readiness.

After launch, the session's full, monotonic `SessionLiveConfigSnapshot` is the
sole executable authority. Active mutations validate, apply, confirm, and
replace that snapshot. Target observations cannot affect a running session.

The Worker and server copy target state verbatim by cloud sandbox and harness.
Product clients map the exact response for presentation only. Static data is
limited to registry, distribution, presentation, and reviewed compatibility;
it cannot define executable membership, defaults, filtering, or fallback.

The only compatibility path is a stateless N-1 HTTP decoder that converts
`modeId` to `controlValues.mode` before domain validation.

The later
[model-scoped controls decision](2026-08-20-model-scoped-harness-launch-controls.md)
extends this one target observation with exact per-model control statements;
it does not change the authority boundary established here.

## Consequences

- Empty and unobserved targets show no explicit executable choices.
- Unknown upstream IDs remain reachable immediately.
- Saved/background intent can become invalid and must fail typed or ask for
  review at execution time.
- A same-basis failed refresh can serve matching last-good state; a basis
  change cannot.
- Cloud state isolation is by target, not owner.
- Codex collaboration Mode and execution Access remain independent end to end.
- Releases require deterministic seam tests plus an honest real-profile proof;
  missing installation or auth is incomplete, never a pass.

## Alternatives rejected

- Catalog seed or first-model fallback: it can authorize values not observed on
  the selected target.
- Observation/catalog union or intersection: either invents availability or
  drops unknown executable values.
- Projection IDs: they make a derived object another authority and complicate
  race handling; complete raw selections can be revalidated directly.
- Post-create best-effort defaults: sessions may become ready before explicit
  intent is applied and confirmed.
- Owner+harness cloud storage: two targets owned by one user can overwrite each
  other's authority.
- Keeping model snapshots beside launch options: duplicate reachable authority
  makes drift a normal state rather than a detectable defect.

## Verification

Contract/runtime tests cover state transitions, exact validation, persisted
intent, actor confirmation, live mutation, Codex independent controls, and
target-isolated cloud copy. Product tests prove presentation equality and that
active UI ignores target state. `scripts/verify-harness-launch-options.mjs`
attaches to one running profile and proves the real observation → picker →
intent → ready snapshot → mutation chain without printing secrets.
