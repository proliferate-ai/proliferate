Description: Extend target-observed launch options with exact model-scoped control statements
Date: 2026-08-20

# Model-scoped harness launch controls

## Orientation

The target-observed launch-options decision remains the executable authority,
but one flat control statement is not sufficient for harnesses whose control
set changes with the selected model. This decision extends the single target
observation with optional exact per-model control statements. It does not
restore static catalogs or create a second authority.

Requirements:

1. A picker must not render or submit a control that the selected model's
   observed statement omits.
2. Session create must validate against the same model-scoped statement the
   picker consumed.
3. An unavailable matrix must remain distinguishable from an observed empty
   control set.
4. Actor startup must keep entirely absent control IDs fail-closed.
5. Cloud copy must preserve the target statement verbatim.

## Current context and external evidence

Claude exposes its model menu as an ACP configuration option. An override-free
session reports `mode`, `effort`, and `fast` under Opus, `mode` and `effort`
under Fable and Sonnet, and only `mode` under Haiku. The old runtime probe
stored only the initial Opus statement, so the Fable picker rendered and sent
`fast: off`; live Fable omitted the entire `fast` row and startup correctly
refused the vocabulary mismatch.

The probe implementation can already switch a model configuration option and
capture the returned configuration statement without sending a prompt. Runtime
probing had disabled that path because some harnesses expose very large model
menus, so model enumeration must be enabled only where its cost is bounded and
its setter/read-back is authoritative.

## Decision

`HarnessLaunchOptions` keeps its flat no-override `controls` and `defaults` for
wire compatibility and harnesses without an observable matrix. It adds ordered
`modelControls` rows containing a raw `modelId`, exact raw controls and values,
and the no-override current values observed after selecting that model.

A present row is authoritative for that model, including a present empty
control list. An absent row means the matrix was not observed and retains the
flat compatibility behavior. A harness configured to publish model rows must
produce a complete matrix; a partial switch/read-back fails the probe and
retains matching last-good state.

Runtime validation, Product pickers, workflows, reviews, Cowork, and Cloud
composer surfaces select the exact model row when present. Model changes
replace rendered/default controls and discard stale values outside the new
row. The actor still rejects an intent control ID absent from the live session;
model-scoped admission prevents first-party clients from authoring that intent.

The observation basis version advances so persisted flat-only Claude state is
re-probed after upgrade. Worker/server storage remains a verbatim JSON copy and
needs no database migration.

## Alternatives rejected

- Silently drop any absent non-posture control at actor startup: this would
  make explicit `fast: on`, typos, and future unknown controls silent no-ops.
- Hide `fast` by recognizing Fable IDs in the client: static executable
  membership would drift from the target and hide unknown upstream behavior.
- Intersect controls across all models: Opus would lose a control the target
  explicitly supports.
- Probe every model for every harness: large dynamic menus make the cost
  unbounded and can exceed the probe timeout.

## Flows, failures, and verification

On observation, the runtime starts one override-free probe session, records the
flat statement, switches each bounded model through ACP, requires exact
read-back, and atomically stores the complete result. On selection, clients use
the matching row and send only its rendered values. Session create reloads the
same current-basis row and rejects any non-member before committing. Actor
startup then applies and confirms the persisted intent against the live
session as before.

Tier-1 coverage pins projection, complete-matrix failure, model-scoped create
validation, unknown identifiers, SDK/cloud copy, picker rendering, model-change
cleanup, and actor fail-closed behavior. The live local proof selects Fable and
establishes that `fast` is absent from both the composer and persisted intent
while the session starts successfully.
