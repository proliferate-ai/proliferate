# Managed Workflow Product Experience — visual mock

Fixture-driven playground for the future PR 6 ("Managed Workflow Product
Experience"). DEV-only route: `/playground/workflows`. No production APIs,
routes, stores, or SDK contracts are touched; everything renders from
`fixtures.ts`.

## The design concept (founder-approved direction)

**A Core V1 workflow is a parameterized prompt.** The UI renders exactly that
object, once:

- **The prompt document is the hero.** Each harness gets a quiet byline
  (`✳ Claude · model · reasoning` — Linear-style property pickers) over a
  barely-tinted document block. `{{inputs.*}}` tokens are highlighted inline
  (`TokenTextarea`: transparent textarea over a token-styled mirror with
  identical metrics).
- **One always-editable view.** No edit mode. Title, description, prompts,
  goals, and pickers edit in place (ghost fields: invisible at rest, hairline
  on hover, real field on focus).
- **Inputs are the derived signature.** Typing `{{inputs.foo}}` in the prompt
  materializes the parameter in the Run section (`collectParams`). One aligned
  row per parameter: mono name (type/required/remove behind a click), an
  underlined value field, faint `type · required` suffix. Run in Cloud sits at
  the end of the signature.
- **Chaining reads as prose.** A second harness is `then` + another byline +
  document. Goals are `◎ until` lines inside the document.
- **Eligibility is computed live** (`computeEligibility`) from the edited
  definition: stage-count / step-count / goal blockers appear as muted mono
  lines at their exact paths, and the Run action swaps to
  "Not runnable · N blockers". No static eligible/ineligible page split.

## Status honesty (frozen contracts)

Lifecycle enums come from run-control.md: run
`accepted|running|completed|failed|cancelled|interrupted`, step
`pending|running|completed|failed|cancelled|interrupted`, `stateVersion`,
`cancelRequestedAt` (durable intent, never a claim of success),
`interruptionCode: runtime_restarted`.

The **delivery / desired / execution / freshness** dimensions are the
PROVISIONAL doc-6 (draft 0.8) presentation model — labeled as such in the UI.
Do not treat their names or shapes as wire truth; they freeze in the Managed
Cloud execution PR.

Presentation rules (`presentation.ts`):

- run rows compress to one headline + quiet freshness suffix
  (`runHeadline`): delivery word before execution exists, execution word after,
  "Cancellation requested" while intent is pending and execution nonterminal,
  "Target lost" as absorbing unknown;
- status is strictly monochrome — shape and motion carry state (hollow /
  filled / pulsing / ✕), never color;
- terminal states never age into stale; unreachable-before-first-observation
  fabricates nothing;
- run detail always shows the four dimensions separately (`dimensionRows`)
  plus one contextual honesty sentence (`ContextNote`).

## Screens

- `MockWorkflowDetail` — the document page (byline + prompt + signature + runs).
- `MockRunsHistory` — definition-scoped flat run list.
- `MockRunDetail` — headline, actions, State properties, Session, collapsed
  Inputs/Details disclosures.
- `MockStatesGallery` — "All states" audit: every headline as a row, the
  interrupted-dot A/B/C strip, every scenario's state properties.

Scenario switching: dropdown in the playground bar (15 required scenarios from
the founder brief). `WorkflowsCoreV1Playground` owns navigation.

## Open founder decisions

- interrupted-dot treatment (A hollow / B dashed ring / C ring + center dot);
- byline wording when reasoning unset ("default reasoning" vs nothing);
- whether the signature pre-fills last-used values for previously run
  workflows.

## Mapping to the real PR 6

- `presentation.ts` → `product-domain` pure view models;
- `atoms.tsx` / screens → `product-ui` presentational components (props in,
  callbacks out) composed by a `product-surfaces` connected surface;
- fixtures → Cloud SDK React Query resources;
- `TokenTextarea`, `PropertyMenu`, ghost-field skin → candidates for
  `apps/packages/ui` promotion if reused.
