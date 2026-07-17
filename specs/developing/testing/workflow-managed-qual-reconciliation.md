# Managed Workflow Qualification — Spec Reconciliation Note

Status: **Reconciliation of a PROVISIONAL release-tail spec (draft 0.5, NOT
frozen RC1.0). Not merge-ready. Founder review required.**

This note reconciles the provisional spec *7 - Managed Workflow Qualification
and Controlled Rollout* (draft 0.5) against merged foundation reality and the
concurrent 5/6 contracts, and records what the `WORKFLOW-MANAGED-QUAL-1`
test/evidence harness scaffolding does and does not prove. It is the companion
to the harness commits on `codex/downstream-qual-harness`.

## Base and provenance

- Branch base: current `main` `1c690d9ae`, which contains the merged Managed
  Workflow **Product Experience** PR #1303 at `0a155125afa7c9a8c39302b5eef52b6d27163a33`
  (verified ancestor of the base).
- Predecessors #1227 / #1244 / #1246: MERGED.
- Managed Cloud Execution (slice 5) and Workflow UI (slice 6): being implemented
  in sibling lanes concurrently and **NOT merged**. This lane does not depend on
  their unmerged code; it consumes only merged seams.
- The provisional spec's own status line ("Provisional release-tail draft 0.5;
  reconciled to the merged Product Experience") is preserved: this is a harness
  scaffolding lane, not a frozen-RC implementation.

## Settled against merged reality (no decision needed)

1. **The merged Product Experience (#1303) input seams all exist at base.** The
   spec's "Merged input seams consumed by this slice" list
   (`tests/intent/specs/workflow-definitions.spec.ts`,
   `.../workflow-runs.spec.ts`, `cloud/sdk-react/src/hooks/workflows.ts`,
   `apps/packages/product-domain/src/workflows/{arguments,run-presentation}.ts`,
   `apps/packages/product-surfaces/src/workflows/WorkflowRunsSurface.tsx`,
   `apps/packages/product-ui/src/workflows/WorkflowRun{Form,Detail,List}.tsx`,
   `specs/codebase/systems/product/workflows/managed-cloud-execution.md`) is
   present at `1c690d9ae`. Verified by existence check.
2. **The runner/report/evidence/selection contracts the spec says to REUSE
   exist and are unchanged.** Report V4 (`tests/release/src/evidence/schema.ts`),
   the exact-cell planner (`runner/plan.ts`), the diagnostic/strict verdict
   (`runner/result.ts`), the matrix scenario contract (`scenarios/types.ts`),
   the `qualification-managed-cloud` Make target + `release-e2e.yml` caller
   (selecting only `CLOUD-PROVISION-1` today), and the append-only evidence
   extension contract. The scaffolding extends these append-only, exactly as the
   spec's "Use the existing runner… Do not create a second Workflow test CLI"
   directive requires.
3. **Report V4 had no managed-Workflow evidence kind and the registry had none
   of the three cells** (spec "Current runner and manifest state"). Both are now
   added append-only (`workflow_managed_run` kind + `WORKFLOW-MANAGED-QUAL-1`).
4. **The stale `T2-WF-1` deferred reason is now false and is corrected.** The
   manifest previously said "run engine is not merged"; #1303 merged it. The row
   is reconciled to name the merged `T2-WFDEF-1` + `T2-WF-RUN` composition
   (exercised in `tests/intent`, not by a release-runner collector) and **stays
   deferred** here — no fabricated release-runner Tier-2 coverage.
5. **`T3-WF-1..10` are NOT reused.** Per the spec, those ids already mean the
   future branching/Functions/grants/polling/schedules/takeover/Slack Workflow
   system (Part II) and remain deferred; the managed one-prompt vertical uses the
   distinct `WORKFLOW-MANAGED-QUAL-1` id with three plain-English cells.

## Open — founder decisions still required (NOT settled here)

These are the provisional spec's own "Founder decisions before freeze"
(recommendations only). The scaffolding encodes the recommended defaults as
structure but does NOT treat them as ruled:

1. **The three strict cell ids / internal ids.** The spec says "choose
   collision-free internal IDs during repo-spec promotion." The scaffolding uses
   plain-English cell dimensions (`WF-MANAGED-COMPLETION` / `-CONTROL` /
   `-CUSTODY`) under scenario id `WORKFLOW-MANAGED-QUAL-1`. If repo-spec
   promotion assigns different internal ids, they rename here.
2. **Scratch + repository real-agent completion** (decision 2) — encoded as the
   `placement` evidence field; needs founder approval.
3. **The destructive disposable execution-store replacement drill** (decision 3)
   — encoded as `custody.disposable_qualification_gated` (green-required true);
   needs founder approval that it runs only against disposable Qualification
   state.
4. **Six-hour / 30-minute canary bake shape** (decision 4) — NOT scaffolded as
   code (it is an operational-evidence phase, not a runner cell); noted as debt.
5. **Operational budgets** (decision 5), including the accepted
   `TaskBrokerResidenceLatencySeconds` + `MessageCount` pair replacing the
   untruthful "current oldest queued-task age" — NOT scaffolded; dashboards/
   alarms are external infra, noted as debt.
6. **Retention decision required before production** (decision 6) — this lane
   cleans only its own disposable fixtures (`workflow_managed_run.cleanup`), and
   explicitly does NOT define product retention. Production stays disabled.
7. **Hard stop before production enablement** (decision 7) — preserved: this
   lane does no deployment/provisioning/promotion.

## Contradictions surfaced (raise, do not silently resolve)

- **C1 — The spec is provisional (0.5), so the "merged Tier 2" naming and the
  eventual candidate SHA are not yet frozen.** The Handoff table lists the
  candidate SHA as "TBD after the release-tail code PR is reviewed and merged."
  The scaffolding therefore commits to the evidence *shape* and fail-closed
  *structure*, not to a candidate identity. No contradiction with merged code,
  but the repo-spec is "Not promoted" — do not treat this harness as RC.
- **C2 — Concurrent 5/6 lanes are unmerged.** The spec's operational readiness
  (worker/Beat digests, broker/RedBeat health, Amazon MQ metrics) and the
  "External hosted prerequisite" depend on background-plane deployment this lane
  does not own and that is not live in staging (`WORKERS_DEPLOY_ENABLED=false`,
  `ECS_WORKER_SERVICE`/`ECS_BEAT_SERVICE` absent, `WORKFLOW_MANAGED_RUNS_ENABLED`
  absent → false). The cells fail closed accordingly; this is the honest
  boundary, escalated rather than papered over.
- **C3 — `CLOUD-PROVISION-1` baseline defect.** The spec notes the latest strict
  `CLOUD-PROVISION-1` run failed because "the composer send control never
  enabled." That is a focused baseline defect/flake to resolve before using the
  managed-cloud world as green predecessor evidence; it is out of scope for this
  test/evidence lane and returns to a focused fix PR.

## What the scaffolding proves — and what remains live-acceptance debt

**Proven offline now (runnable):**
- The `workflow_managed_run` Report V4 evidence kind: types, kind-scoped
  validator (safe-token/hash discipline, exactly-one proof block bound to
  `evidence.cell`, cell-appropriate green terminal state, green-requires-clean
  cleanup), sanitizer, and cross-field cell binding.
- `WORKFLOW-MANAGED-QUAL-1` registration, planning (three sandbox-lane cells;
  `RELEASE_E2E_WORKFLOW_MANAGED_PLANE` read-optional so absence is a fail-closed
  red, not a blocked cell; not dragged onto `--lane local`).
- Fail-closed production driver (WFR-F01 / WFR-F02, bounded secret-free reasons,
  no evidence on a non-green cell → no false-green).
- The green path + orchestration (evidence completeness, cleanup-downgrade,
  unexpected-cell rejection) exercised via an offline fake driver and validated
  end-to-end through the real `validateReportV4`.

**Live-acceptance debt (NOT proven, explicitly non-green until owned elsewhere):**
- Any real managed completion / replay-loss / cancellation / same-store restart
  / broker-worker recovery / execution-store-loss journey against exact staging
  artifacts with real Cloud infra, worker/Beat, AnyHarness, and a cheap real
  agent.
- Staging background-plane provisioning (RabbitMQ/Valkey/RedBeat/worker/Beat),
  the same-image smoke, the relay-heartbeat + exact-ID execution proof, and
  setting `WORKFLOW_MANAGED_RUNS_ENABLED=true` in staging.
- Workflow operational dashboards/alarms (the invariant-conflict alert; the
  residence-latency + `MessageCount` budget pair).
- The six-hour bake, the disable-new-launches rollback drill, and the founder
  production-readiness packet.
- The missing managed-Workflow alarm mappings (a separate focused prerequisite
  code PR, per the spec's "Code-delivery recommendation").

No production enablement, deployment, provisioning, or promotion is performed or
implied by this lane. One PR; draft; not merge-ready.
