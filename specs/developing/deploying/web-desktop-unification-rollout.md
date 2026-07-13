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
  force-pushed, deleted only per the verification phase's branch index), with
  commit SHA, tree SHA (`git rev-parse <ref>^{tree}`), and stable patch hash
  (`git diff --binary --full-index A...B | git patch-id --stable`) recorded in
  the PR body or this ledger. Any consumer first runs `git fetch origin`,
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
- **reviewed staging-only** — Server, Web, E2B, and LiteLLM lanes are UNGATED
  and cannot be suppressed on the automatic path; an ungated detected surface
  excluded from PRODUCTION is explicitly reviewed as staging-only or the chain
  stops until an automatic exact-selection mechanism lands;
- **gate-suppressed** — only actually gated lanes: Mobile build
  (`MOBILE_DEPLOY_ENABLED`), Desktop (`DESKTOP_DEPLOY_ENABLED`), Workers
  (`WORKERS_DEPLOY_ENABLED`). `EAS_SUBMIT_ENABLED` gates TestFlight submission
  inside an enabled Mobile lane, not the Mobile build itself;
- **separate artifact-release disposition** — a detected Runtime surface has
  no hosted deploy lane in `deploy-staging.yml`; it goes through the canonical
  runtime release procedure or the chain hard-stops.

Gate values are not assumed verified live: the accessible environment scope
exposes only `DESKTOP_CHANNEL=beta`; other gate values may be inherited
org-level variables. Phase H either audits inheritance with sufficient read
access or plans explicit staging environment-level overrides regardless,
recording per gate whether an environment-level value previously existed
(restore by value) or not (restore prior absence by deletion). If Desktop is
in PRODUCTION, the ≥0.3.28 version bump covering every canonical owning
coordinate is a distinct reviewed release-prep commit inside the replay list;
the exact-SHA tag and a NEW draft GitHub Release are created and published
only at production promotion per the canonical desktop release procedure (the
pre-existing `desktop-v0.3.27` tag/feed/draft is not the migration release).

### 4.2 Landing order: quiescence, overrides, restore-before-promote

The landing ordering is binding and executes under an orchestrator-held
landing hold that explicitly blocks other main merges AND main-CI
reruns/manual dispatches:

1. **Pre-override quiescence is proven first.** A `deploy-staging`-idle check
   alone is insufficient: an already queued/running/re-run qualifying main CI
   run can complete after the overrides are set and emit an older
   `workflow_run` that consumes them. Therefore: drain every queued/running
   qualifying main CI run; for each run that completes successfully during the
   drain, wait for its corresponding Deploy Staging `workflow_run` to
   materialize AND complete; recheck both the source main-CI runs and the
   deploy-staging runs across a bounded event-propagation barrier until
   quiescence is proven. Unprovable correlation or quiescence ⇒ stop.
2. Record the prior staging gate state secret-safe (including whether each
   variable existed at the environment level at all); set the explicit
   reviewed staging environment-level overrides; read every override back and
   verify it.
3. Merge the landing PR. If the merge fails after overrides are set, restore
   the gates before releasing the hold.
4. Immediately verify the merge-SHA rule: merged-main tree SHA equals the
   reviewed landing head's tree SHA, plus fully green main CI on the exact
   merge SHA (the automatic path cannot wait for a full post-merge battery).
   Tree-equality failure ⇒ immediately cancel the exact-landing-SHA main CI
   run before it can complete, cancel any already-created staging run, restore
   the gates, halt. Exact-landing main CI failed/cancelled/timed out ⇒ restore
   the gates, halt.
5. Main CI success triggers the automatic staging run under the already-set
   gates. Capture proof it executed exactly EFFECTIVE_STAGING (plan-job
   outputs prove DETECTED; per-lane enabled/skipped evidence proves
   execution). Any other execution ⇒ stop, restore gates, return to review.
6. **Verify the automatic staging run, THEN restore the gates per the recorded
   restore steps (restoring prior absence by deletion), and ONLY THEN promote
   the exact landing merge SHA to production** with the exact PRODUCTION
   `only_surfaces` and `require_staging_success=true`. Record non-dry-run
   staging and production deploy-summary `headSha` evidence per surface;
   verify each surface's artifact/health; verify old and canonical inbound
   routes — all before any external mutation begins.

**Failure-handling invariant:** no failure path — failed merge, failed tree
equality, failed/cancelled/timed-out exact-landing main CI — may leave the
temporary overrides active or permit a later source CI completion to emit
staging.

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
- **Failed smoke ⇒ immediate recovery:** restore the source of truth,
  re-activate at the same landing SHA, prove the live rollback, run a recovery
  smoke, record both, halt — nothing further until resolved.
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
