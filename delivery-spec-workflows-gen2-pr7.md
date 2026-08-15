# Delivery Spec — PR7 of workflows-gen2 — builder v2, main page, templates, flag ON, intent/t3 specs

Parent ADR: Workflows ADR §UX flows (main page, builder, journeys 1+5), §Tests tier 2/3, §Sequencing PR7.
Base: codex/workflows-gen2-pr6-run-view
Branch: codex/workflows-gen2-pr7-builder-launch
Status: FROZEN before implementation.

## Scope

1. MINIMAL-VIABLE builder v2 (replaces gen-1 editor for v2 definitions): vertical chain of node cards
   (title field, agent/human_in_loop toggle, prompt editor rendering @input:/@doc: tokens as chips via
   domain parsePromptTokens, optional model pick reusing the existing model-selection primitives), add/remove/
   reorder nodes (up/down buttons — NO drag/drop/canvas fanciness, journaled as post-merge follow-up), an
   inputs panel (name/description/required rows), a doc-templates panel (slug, producing node select, body
   textarea). Live validation via validateDefinitionV2: unknown refs render as error chips and BLOCK save,
   mirroring server validation. States: draft-dirty, saving, saved, inline per-node errors.
2. Workflows main page v2: definition list (title, description, updated-at) with Run + Edit per row, New
   workflow, starter templates as the empty state's content AND a "new from template" path. Run opens PR5b's
   trigger dialog; a definition with declared inputs cannot run without them (dialog enforces).
3. Starter templates (client-side seed constants in config/workflows/ or copy/workflows/ per what-goes-where):
   (a) "Agent-engineering process" — the flagship: condensed but real multi-node chain
   (research questions → research → design → implement → review) with human gates at judgment points, doc
   templates with human-first headings, prompts using @input:/@doc: correctly;
   (b) "Research and review" — the two-node reference (agent research node + human gate) that mirrors t3-wf-1.
4. Gen-1 surface supersession: WorkflowsPage routes to the v2 main page/builder/run surfaces when
   isWorkflowsV2Enabled(); gen-1 components (WorkflowDefinitionsSurface, PersistedWorkflowEditor,
   WorkflowDefinitionEditor, WorkflowStageEditor, WorkflowInputEditor, WorkflowRunsSurface, WorkflowRunForm,
   WorkflowRunList, WorkflowRunDetail, WorkflowsBetaGateModal + beta sessionStorage key) are DELETED along
   with their tests; the v2 surfaces fully replace them. workflow-run-status-dot adapter survives (reused by
   run view). Routes and sidebar nav stay as-is.
5. Intent specs (tier 2, authored + typechecked, NOT run locally — mock-IdP stack is CI's):
   - workflow-definitions.spec.ts evolved to drive the v2 builder (create v2 definition with nodes/inputs/
     docTemplates, invalid @doc ref blocks save, reload persistence, delete).
   - workflow-runs.spec.ts REPLACED by workflow-trigger-seam.spec.ts: main page → Run → trigger dialog →
     assert exactly one PUT /v1/workflow-invocations fires with frozen definition + placement, STOP at the
     runtime seam (AnyHarness absent in tier 2 by standard).
   - tests/intent/stack/workflows-beta-gate.ts DELETED with the modal; all callers updated.
6. t3-wf-1 authored, registered, NEVER run: tests/release/src/scenarios/t3-wf-1.ts as a
   MatrixScenarioDefinition (imitate t3-chat-1.ts: id, title, registryFlowRef → scenarios.md#T3-WF-1,
   lanes ["local"], requiredEnv, expandCells, planCell) — two-node reference workflow on the cheapest
   cataloged model: wrapped preamble honored, doc written into .proliferate/context/, gate holds, approve
   advances, run completes. Registered in scenarios/registry.ts.
7. Registry upkeep: specs/TESTING/scenarios.md — T2-WFDEF-1 updated for v2; T2-WF-1 marked superseded by the
   seam spec (new narrative entry); T2-WF-2 stays parked (triggers follow-up); NEW T3-WF-1 narrative entry.
   specs/TESTING/core-release-validation.md manifest rows updated to match.
8. THE FLAG FLIP — the FINAL commit of the branch, ISOLATED, exactly one line's semantic change
   (WORKFLOWS_V2_DEFAULT false → true) + its test expectation, so Pablo can drop the commit to ship dark.
   No other commit in the chain touches the default.

## Non-goals
Graph-canvas builder, drag-drop, AI generation, promotion-to-definition affordances, doc history. Any
runtime-plane behavior change.

## Structure
components/workflows/builder-v2/*, components/workflows/main/*, config/workflows/starter-templates.ts,
hooks/workflows/{workflows,facade}/* for builder draft state (Zustand only if shared across subtrees;
prefer local state + a facade hook). Composes existing primitives exclusively.

## Tests
Vitest: builder validation gating (invalid ref blocks save + negative control), chip rendering from tokens,
reorder correctness (edges rebuilt linearly from card order), template instantiation produces
validateDefinitionV2-clean definitions (both templates), main-page states. Intent specs typecheck via the
tests/intent package's own tsc/lint path. Flag-flip commit: workflows-v2.test.ts default expectation flips in
the SAME isolated commit.

## Revert
Drop the final commit → surface ships dark. Full revert restores gen-1 surfaces.

## Acceptance proof
Scoped vitest + full product-client typecheck + web/desktop typecheck green; structure/boundary gates green;
UI-conformance checklist pass; intent package typecheck green; release package `pnpm -C tests/release test`
green (unit tier of the scenario file only — the scenario itself is never executed).
