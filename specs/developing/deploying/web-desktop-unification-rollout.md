# Web/Desktop Unification Rollout Ledger

Status: binding execution and freeze ledger for the Web/Desktop client
unification chain.

This document is the readiness authority for the migration defined by
[`../../codebase/features/web-desktop-client-unification.md`](../../codebase/features/web-desktop-client-unification.md)
(the canonical contract; it wins any conflict). The intake phases append their
binding snapshots **here** — never under `specs/tbd/` — and the PR 1 and PR 2
writers verify readiness against the committed sections of this file, not
against transcripts. The docs-only post-cutover verification phase commits the
final immutable release record at
`specs/developing/deploying/web-desktop-unification-release-record.md`.

Non-authoritative history: the original migration plan and the 2026-07-13
intake sweep remain under `specs/tbd/` as execution detail and sweep input
only.

Ledger rules (binding):

- **No secrets in git.** Every entry records identifiers, URLs, and non-secret
  configuration values only; secret values are referenced by name/location
  (for example "SSM parameter X", "Stripe restricted key <name>"), never by
  value.
- **Durable evidence.** Reviewed states are preserved as evidence branches
  under `refs/heads/wdu-evidence/**` (pushed with
  `git push origin <sha>:refs/heads/wdu-evidence/<label>`, never
  force-pushed). Evidence branches are deleted only AFTER the Phase V
  docs-only post-cutover verification PR has merged, and only according to
  the branch index committed in its release record — never earlier. Each
  branch's commit SHA, tree SHA (`git rev-parse <ref>^{tree}`), and stable
  patch hash
  (`git diff --binary --full-index A...B | git patch-id --stable`) are
  recorded in the PR body or this ledger. Any consumer first runs
  `git fetch origin`,
  asserts the branch exists, and asserts its hashes equal the recorded values
  before comparing.
- **Facts only.** Snapshot sections record live state at their timestamp; they
  do not invent dispositions for items whose owner is unknown — those are
  marked `needs-owner-decision` and block the gated phase until resolved.

## 1. Chain state

The chain executes as a sliding two-PR stack: at most two PRs with active
writers at any time; one writer per phase; the orchestrator alone
review-accepts, merges, and marks ready. Children fork from immutable
review-accepted parent heads with `PARENT_AT_FORK` recorded and asserted;
restacks use `git rebase --onto <target> $PARENT_AT_FORK` with an equivalence
proof (identical base trees ⇒ child tree equality; changed base ⇒ range-diff
against the accepted evidence branch plus independently reviewed conflict
resolutions). Docs gates and the freeze gate collapse the stack to main.

| # | Phase | Branch | Base → target | Merge disposition | Status |
| --- | --- | --- | --- | --- | --- |
| A | Workflows V1 merge-readiness | `codex/workflows-v1-pr1` (PR #1143) | main | Merged by orchestrator | **Merged 2026-07-13** (`5e86a7faf`) |
| A2 | Docs promotion + this ledger | `wdu/docs-migration-plan` | main | Merges (docs-only) | In review |
| B | PR 0b auth generation | `wdu/pr0b-auth-generation` | main | Merges after C is accepted | Pending |
| C | PR 0c runtime lifecycle | `wdu/pr0c-runtime-lifecycle` | accepted B head → B, restacks to main | Merges after I1 is reviewed | Pending |
| I1 | PR-1 intake snapshot (docs-only) | `wdu/intake-pr1` | accepted restacked C head → C, restacks to main | Merges; appends §2 here | Pending |
| D | PR 1 Desktop host boundary | `wdu/pr1-desktop-host-boundary` | post-I1 main | Merges after E is accepted | Pending |
| E | Embedded-browser removal | `wdu/embedded-browser-removal` | accepted D head → D, restacks to main | Merges to main | Pending |
| — | **Freeze gate** | — | — | Explicit dated user signal required | Closed |
| I2 | PR-2 freeze ledger (docs-only) | `wdu/intake-pr2-freeze` | main | Merges; appends §3 here | Pending |
| F | PR 2 product-client extraction | `wdu/pr2-product-client-extraction` | post-I2 main | Merges to main before G exists | Pending |
| G | PR 3 delete legacy Web | `wdu/pr3-delete-legacy-web` | fresh post-F main → main | **Review-only; never merges** | Pending |
| H | PR 4 Web ProductClient | `wdu/pr4-web-product-client` | G_HEAD → G | **Review-only; never merges** | Pending |
| L | Web cutover landing | `wdu/web-cutover-landing` | fresh main | The only merged Web-cutover PR | Pending |
| V | Post-cutover verification | `wdu/post-cutover-verification` | fresh post-L main | Merges (docs-only); the completion gate | Pending |
| I | Self-hosted Web | — | — | Follow-up; explicitly unplanned | — |

Recorded chain facts (append per event; each entry dated, with SHAs):

- 2026-07-13 — PR #1143 merged to main as `5e86a7faf`. Chain baseline for A2
  is `origin/main@5e86a7faf`.

Stop conditions that halt the chain: a gate the writer cannot make green; a
conflict with a protected branch lacking a recorded disposition; the PR 2
freeze signal absent; the committed intake-ledger evidence missing at PR 1 or
PR 2 launch; anything that would require a second writer on a live phase
branch.

### 1.1 Web cutover landing mechanics (G/H/L summary)

G branches only from post-F main; `G_BASE` and, at acceptance, `G_HEAD` are
preserved as `wdu-evidence/landing-g-base` / `landing-g-head`. H branches from
`G_HEAD`; at acceptance `H_HEAD` is preserved as
`wdu-evidence/landing-h-head` and the exact ordered commit list
`git rev-list --reverse G_BASE..H_HEAD` is recorded here. L is created from
fresh main (`L_BASE` preserved as `wdu-evidence/landing-l-base`) and
cherry-picks exactly that list. Equivalence proof before merge: if
`L_BASE == G_BASE`, exact tree equality between `landing-h-head` and the L
head; otherwise recorded stable patch hashes of both ranges plus a
`git range-diff G_BASE..H_HEAD L_BASE..<L>` manifest with independent review
of every non-identical hunk and conflict resolution. Accepted evidence heads
are never mutated: any return-to-H produces a new versioned evidence branch
(`landing-h-head-v2`, …), a recomputed commit list, and a mandatory L
rebuild/re-proof. Before any deployment from the merge commit, the merge-SHA
evidence rule applies: for the automatic staging path, merged-main tree
equality with the reviewed L head **plus** fully green main CI on that exact
SHA is required; on tree-equality failure the exact-L main CI run is cancelled
before it can complete, any created staging run is cancelled, gates are
restored, and the chain halts.

## 2. PR-1 intake snapshot (Phase I1 appends here)

Phase I1 appends a dated section below using this template. PR 1 may launch
only when the committed snapshot exists on main with zero
`needs-owner-decision` items.

```markdown
### PR-1 intake snapshot — <YYYY-MM-DD>

- Snapshot timestamp: <ISO-8601>
- origin/main SHA at snapshot: <sha> (docs baseline)
- Accepted wdu/pr0c-runtime-lifecycle head: <sha> (PR 1 code baseline)
- PR #1143: merged (<sha>); PR #1142: recorded superseded by <owning program>
- Competing structure-alignment migrations live: none / <list>

| Item (branch/worktree/PR) | Owner | Head SHA | Touched slice | Disposition |
| --- | --- | --- | --- | --- |
| <item> | <owner> | <sha> | Desktop root / auth / telemetry / Cloud access / native access | land-before-PR1 \| retarget \| park \| no-conflict \| needs-owner-decision |
```

Sweep inputs: `gh pr list`, `git branch -r`, and the protected set in the
historical intake ledger (`specs/tbd/web-desktop-unification-intake-ledger.md`
§4). Unknown-owner items are marked `needs-owner-decision` and listed
prominently; they block PR 1.

## 3. PR-2 freeze ledger (Phase I2 appends here)

The PR 2 freeze gate requires **both** an explicit dated user signal (quoted
verbatim below) and this merged ledger section. Freeze validity is revalidated
three times — at PR 2 launch, immediately before PR 2 review-acceptance, and
immediately before PR 2 merges — each time comparing timestamp + planned
duration against the current time and re-running the live Desktop conflict
inventory against the dispositions below. Any expiry or new undispositioned
conflict hard-stops PR 2 until a renewed user signal plus a committed
amendment to this section lands and the PR is re-reviewed.

```markdown
### PR-2 freeze ledger — <YYYY-MM-DD>

- Freeze timestamp: <ISO-8601>
- User signal (verbatim quote + date): "<quote>"
- Base SHA: <origin/main sha>
- Freeze owner: <who>
- Planned duration: <e.g. 48h, ending <ISO-8601>>

| Item (branch/worktree/PR) | Owner | Head SHA | Slice | Disposition |
| --- | --- | --- | --- | --- |
| <item> | <owner> | <sha> | <slice> | merged \| parked \| retargeted-to-product-client \| cancelled \| needs-owner-decision |

Amendments: <dated renewals/redispositions>
```

The sweep covers, at minimum, the historical intake ledger's §4.4 protected
dirty set, the subagent runtime program, `whale`, and every open Desktop UI
PR. `needs-owner-decision` items block PR 2.

## 4. Deployment selection and external-configuration items

### 4.1 Three reviewed selection sets

Automatic staging (`deploy-staging.yml` firing on main-CI success) has no
`only_surfaces`; detection plus GitHub `staging` environment gates decide what
executes. Selection for the cutover landing is therefore modeled as three
reviewed sets, produced during Phase H from the real last-successful staging
and production deploy-summary `headSha` bases (resolved per
[`ci-cd.md`](ci-cd.md)) and re-asserted by Phase L pre-merge:

| Set | Meaning | Proof |
| --- | --- | --- |
| DETECTED | `scripts/ci-cd/detect-deploy-surfaces.mjs` output over the real bases through the reviewed head | Plan-job `selection_mode`/`selected_surfaces` outputs (proves detection only, never lane execution) |
| EFFECTIVE_STAGING | Automatic lanes actually expected to execute after gates | Per-lane enabled/skipped evidence from the automatic run |
| PRODUCTION | Exact explicit `only_surfaces` set for the canonical promote workflow | The promote invocation + non-dry-run deploy-summary `headSha` evidence per surface |

Every DETECTED surface receives exactly one disposition, recorded here:

- **PRODUCTION** (therefore also EFFECTIVE_STAGING);
- **reviewed staging-only** — Server, Web, and E2B lanes are UNGATED and
  cannot be suppressed on the automatic path; an ungated detected surface
  excluded from PRODUCTION is explicitly reviewed as staging-only or the chain
  stops until an automatic exact-selection mechanism lands;
- **gate-suppressed** — only actually gated lanes: Mobile build
  (`MOBILE_DEPLOY_ENABLED`), Desktop (`DESKTOP_DEPLOY_ENABLED`), Workers
  (`WORKERS_DEPLOY_ENABLED`), and LiteLLM (`LITELLM_DEPLOY_ENABLED`, checked
  in `.github/workflows/_deploy-litellm.yml`; default `false` when unset).
  `EAS_SUBMIT_ENABLED` gates TestFlight submission inside an enabled Mobile
  lane, not the Mobile build itself. Gate lists are verified against the
  actual workflow files at each use, never assumed;
- **separate artifact-release disposition** — a detected Runtime surface has
  no hosted deploy lane in `deploy-staging.yml`; it goes through the canonical
  runtime release procedure or the chain hard-stops.

Gate values are point-in-time and must be re-audited live at Phase H and
re-verified at Phase L; recorded observations never substitute for a fresh
read. A 2026-07-13 read-only audit (`gh variable list --env <env>`) showed
these environment-level gate values — `staging`:
`MOBILE_DEPLOY_ENABLED=true`, `EAS_SUBMIT_ENABLED=true`,
`LITELLM_DEPLOY_ENABLED=true`, `WORKERS_DEPLOY_ENABLED=false`, and
`DESKTOP_CHANNEL=beta`, with NO environment-level `DESKTOP_DEPLOY_ENABLED`
(defaults `false` when unset); `Production`: `MOBILE_DEPLOY_ENABLED=true`,
`EAS_SUBMIT_ENABLED=true`, `LITELLM_DEPLOY_ENABLED=true`,
`WORKERS_DEPLOY_ENABLED=false`, and `DESKTOP_DEPLOY_ENABLED=true`. Restore
semantics follow prior existence: a gate that previously existed at the
environment level is restored BY VALUE (per this audit, staging
`WORKERS_DEPLOY_ENABLED` restores to `false`, not by deletion); only a gate
that previously did not exist at the environment level (per this audit, only
staging `DESKTOP_DEPLOY_ENABLED`) has its prior absence restored by deletion.
Phase H audits the then-current state (including any org-level inheritance)
with sufficient read access or plans explicit staging environment-level
overrides regardless, recording per gate whether an environment-level value
previously existed (restore by value) or not (restore prior absence by
deletion). If Desktop is
in PRODUCTION, the ≥0.3.28 version bump covering every canonical owning
coordinate is a distinct reviewed release-prep commit inside the replay list;
the exact-SHA tag and a NEW draft GitHub Release are created and published
only at production promotion per the canonical desktop release procedure (the
pre-existing `desktop-v0.3.27` tag/feed/draft is not the migration release).

### 4.2 Landing order: quiescence, overrides, restore-before-promote

The landing ordering is binding and executes under an orchestrator-held
landing hold that explicitly blocks other main merges, main-CI reruns/manual
dispatches, AND manual `deploy-staging.yml` `workflow_dispatch` runs — the
workflow exposes an independent `workflow_dispatch` trigger in addition to
its `workflow_run` path, so blocking main CI alone is insufficient:

1. **Pre-override quiescence is proven first.** A `deploy-staging`-idle check
   alone is insufficient: an already queued/running/re-run qualifying main CI
   run can complete after the overrides are set and emit an older
   `workflow_run` that consumes them, and a manual dispatch can start a Deploy
   Staging run with no main-CI source at all. Therefore: drain every
   queued/running Deploy Staging run REGARDLESS of trigger source (automatic
   `workflow_run` or manual `workflow_dispatch`); drain every queued/running
   qualifying main CI run; for each main-CI run that completes successfully
   during the drain, wait for its corresponding Deploy Staging `workflow_run`
   to materialize AND complete; recheck the source main-CI runs and ALL
   deploy-staging runs (both trigger sources) across a bounded
   event-propagation barrier until quiescence is proven. Unprovable
   correlation or quiescence ⇒ stop.
2. Record the prior staging gate state secret-safe (including whether each
   variable existed at the environment level at all); set the explicit
   reviewed staging environment-level overrides; read every override back and
   verify it. From the FIRST override mutation onward, the cleanup invariant
   below is armed — a partial override write or a failed read-back is itself a
   failure that enters cleanup.
3. Merge the landing PR. A failed merge enters cleanup.
4. Immediately verify the merge-SHA rule: merged-main tree SHA equals the
   reviewed landing head's tree SHA, plus fully green main CI on the exact
   merge SHA (the automatic path cannot wait for a full post-merge battery).
   Tree-equality failure ⇒ immediately cancel the exact-landing-SHA main CI
   run before it can complete and cancel any already-created staging run, then
   enter cleanup. Exact-landing main CI failed/cancelled/timed out ⇒ enter
   cleanup.
5. Main CI success triggers the automatic staging run under the already-set
   gates. Capture proof it executed exactly EFFECTIVE_STAGING (plan-job
   outputs prove DETECTED; per-lane enabled/skipped evidence proves
   execution). Automatic staging failure/cancellation/timeout, an unexpected
   lane execution, or inability to verify what executed ⇒ enter cleanup and
   return to review.
6. **Verify the automatic staging run, THEN restore the gates per the recorded
   restore steps (restoring prior absence by deletion) and read the
   restoration back to verify it, and ONLY THEN promote the exact landing
   merge SHA to production** with the exact PRODUCTION `only_surfaces` and
   `require_staging_success=true`. Only verified automatic staging success
   plus verified gate restoration may proceed to production. Record
   non-dry-run staging and production deploy-summary `headSha` evidence per
   surface; verify each surface's artifact/health; verify old and canonical
   inbound routes — all before any external mutation begins.

**Override cleanup invariant (finally-style, armed at the first override
mutation):** on every failure, non-success, or unverifiable outcome — partial
override write/read-back failure, failed merge, merge-SHA tree mismatch,
exact-landing-SHA main CI failure/cancellation/timeout, automatic staging
failure/cancellation/timeout, unexpected lane execution, an unexpected Deploy
Staging run from ANY trigger source (a manual `workflow_dispatch` or any run
other than the expected exact-landing-SHA automatic run — request its
cancellation immediately, then enter cleanup under the unexpected-run rule
below), or any state that cannot be verified — restore EVERY gate to its
recorded prior value or prior absence, read the restoration back and verify
it, then release the landing hold and halt; for an unexpected Deploy Staging
run, the hold is released only per the unexpected-run rule below. No failure
path may leave the temporary overrides active or permit a later source CI
completion to emit staging. If restoration itself fails or cannot be
verified, production promotion is hard-stopped and the landing hold REMAINS
in place while the failure is escalated; the hold is never released over
unrestored or unverified gates.

**Unexpected-run rule (cancellation is not terminal proof):** a cancellation
request does not prove the run stopped, and a cancelled Deploy Staging run
may already have partially deployed. On any unexpected Deploy Staging run
after the first override mutation: request cancellation and restore/read back
the gate state promptly, but KEEP the landing hold until BOTH (a) the run is
confirmed terminal, and (b) its per-lane enabled/skipped evidence,
deploy-summary artifacts, and logs prove it produced no side effects — or,
where side effects occurred or cannot be ruled out, every possibly affected
staging surface is restored to its recorded pre-landing staging baseline and
its artifact/health/routes are re-verified. If terminality, the side-effect
assessment, or that recovery cannot be proven, the hold remains and
production stays hard-stopped and escalated. Only after confirmed
terminality, absent-or-recovered side effects, and verified gate restoration
may the hold release — the chain is still halted for review and never
proceeds directly to promotion. The failure and recovery evidence is retained
per the standing failure-evidence requirements (§5.2 item 6 / a
non-completing incident record).

### 4.3 External-configuration item schema

Phase H inventories every deployed configuration value the producers touch —
Stripe dashboard settings and `STRIPE_CHECKOUT_*`/portal return URLs wherever
they are deployed (GitHub environments, SSM/ECS task config, Vercel env, per
the deployment docs), OAuth registrations, `FRONTEND_BASE_URL`/front-end
origins, and every other discovered producer. Phase L completes and verifies
the schema pre-merge. Each item records:

| Field | Meaning |
| --- | --- |
| Item id | Stable identifier for the configuration value |
| Source-of-truth location | Secret-safe: where the deployed value lives (GitHub environment X, SSM parameter name, Vercel project env, Stripe dashboard setting, OAuth app registration) |
| Affected surface/process | Which deployed surface or process consumes it |
| Current / required value | Non-secret values verbatim; secrets by name/location only |
| Activation mechanism | redeploy \| service restart \| rebuild \| task-definition rollout — what makes the running artifact consume the new value |
| Live-proof method | How consumption is proven from the running artifact/task without exposing secret values |
| Smoke procedure | The end-to-end flow that exercises this producer (mapped explicitly; a shared smoke covers multiple items only via a recorded item→smoke mapping) |
| Rollback source restore | Exact steps to restore the previous value |
| Rollback activation | Re-activation steps at the same landing SHA |
| Recovery smoke | The flow that proves the rollback restored the old behavior |

Application rules (binding):

- **Before the landing merges:** inventory, verify current live values,
  classify, and record only. Mutate nothing that depends on new production
  routes.
- **After the landing merges, the PRODUCTION surfaces deploy at the exact
  merge SHA, and routes verify:** apply items one producer at a time — source
  change → activation → live-consumption proof → smoke. A source edit without
  activation is never an update.
- **Any failure after a source-of-truth mutation ⇒ immediate recovery.** Not
  only a failed smoke: a failed or unverifiable activation and a failed or
  unverifiable live-consumption proof trigger the same recovery. Restore the
  source of truth, re-activate at the same landing SHA, prove the live
  rollback, run the item's mapped recovery smoke, record both the failure and
  the recovery, halt — nothing further until resolved. If the recovery itself
  cannot be proven (rollback activation or live rollback proof fails), the
  sequence remains halted until it is.
- **An uncertain source-write outcome is treated as a possible mutation.** A
  source-of-truth write that fails, times out, or returns an unverifiable
  result may nevertheless have applied — and a single re-read cannot rule out
  a late asynchronous apply. Proven-unchanged requires either (a) an
  authoritative terminal status for the write operation PLUS a confirming
  authoritative read, or (b) a bounded settling barrier with repeated
  authoritative reads proving the prior value remained stable throughout.
  With that proof, record the evidence and halt before continuing the
  sequence. Without it, treat the item as changed/unverifiable and run the
  full recovery while halted: restore the recorded prior value, re-activate
  at the same landing SHA, prove the live rollback, run the item's mapped
  recovery smoke, record everything, halt. A failed recovery remains halted.
- **Unchanged items are not exempt:** each closes as verified-correct only
  with secret-safe live proof plus its mapped smoke executed.
- The sequence completes only when every item is verified-correct-with-proof
  +smoke or updated+activated+proved+smoked. There is no recovered-stable
  completion: a halt blocks the verification phase, evidence-branch cleanup,
  and migration completion until resolved (incident evidence may live in a
  non-completing docs incident record, which does not substitute).

### 4.4 Item table (Phase H creates; Phase L completes; Phase V seals)

*Empty until Phase H. Entries follow the §4.3 schema; outcomes are recorded
per item as `verified-correct+proved+smoked`,
`updated+activated+proved+smoked`, or `failed+recovered+halted` with evidence
links.*

## 5. Release-surface closure and Phase V release record

### 5.1 Release-surface closure (Phase H produces; carried into L and V)

Before the accepted PR 4 head freezes, Phase H inventories and dispositions
EVERY required user-facing release surface — the landing page, public docs,
changelog/release notes, in-app release notes/copy, install/download
surfaces, support/runbook surfaces, and any further release surface the sweep
discovers — each into exactly one of:

| Disposition | Meaning |
| --- | --- |
| update-in-this-landing | The change enters the exact replay list |
| update-post-landing | Named owner + deadline recorded |
| no-change-needed | Reason recorded |

If Desktop ships, closure additionally covers creation/review/publication of
the exact-SHA tag and the NEW draft GitHub Release at production promotion per
the canonical desktop release procedure, and explicit stable updater-manifest
verification at the exact released version/SHA.

### 5.2 Phase V release record (the completion gate)

Phase V launches only after the §4.3 external sequence fully completes. It
commits the immutable release record at
`specs/developing/deploying/web-desktop-unification-release-record.md`
(indexed in [`README.md`](README.md)), sealing at least:

1. the exact landing merge SHA and per-surface deployed SHAs, with the
   reviewed DETECTED / EFFECTIVE_STAGING / PRODUCTION sets and per-surface
   dispositions (reviewed staging-only surfaces recorded as such);
2. the landing-ordering evidence: quiescence proof, recorded prior gate
   state, override set/read-back, merge-SHA tree-equality + green-main-CI
   proof, EFFECTIVE_STAGING per-lane execution proof, verified gate
   restoration, and the production promotion record with non-dry-run staging
   and production deploy-summary `headSha` evidence per surface AND the
   deploy-run links for every staging and production run cited;
3. per-surface artifact/health verification and old + canonical inbound route
   verification;
4. each release-surface disposition and its outcome/evidence (if Desktop
   shipped: released version, exact SHA, exact-SHA tag, published GitHub
   Release, and stable updater-manifest verification);
5. the complete external-item table per §4.3 — for EVERY item, changed or
   unchanged: its secret-safe source-of-truth location, the actual before
   value, the actual after value (secrets redacted by name/location, never by
   value), the required-change classification, the activation mechanism used,
   the secret-safe live-consumption proof, and who applied the change and
   when; plus, for every mapped smoke: the flow that was run, the result, and
   the timestamp (with the explicit item→smoke mapping wherever a shared
   smoke covers multiple items);
6. all failure and recovery evidence: what failed, the source restore, the
   re-activation at the same landing SHA, the live rollback proof, the
   recovery smoke, and the resolution;
7. the requirement-by-requirement audit against the canonical spec's
   definition of done, each with an evidence pointer;
8. the index of every `wdu-evidence/**` branch (name + recorded commit/tree/
   patch hashes) authorizing their cleanup.

No `wdu-evidence/**` branch is deleted before Phase V merges; deletion follows
only the committed branch index. Completion requires Phase V merged.
