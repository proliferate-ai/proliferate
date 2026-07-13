# Web/Desktop Unification Intake Ledger

Status: historical execution snapshot, non-authoritative.

This ledger is history and sweep input only. The **binding** intake and freeze
snapshots for the migration are appended to the rollout ledger at
[`../developing/deploying/web-desktop-unification-rollout.md`](../developing/deploying/web-desktop-unification-rollout.md)
by the committed docs-only intake phases; the promoted contract is
[`../codebase/features/web-desktop-client-unification.md`](../codebase/features/web-desktop-client-unification.md).
Do not cite this file for code review or release readiness.

Snapshot: 2026-07-13, `main@bdd11aa5a7`. This ledger records the live intake
required by Section 17 of
[web-desktop-unification-migration.md](web-desktop-unification-migration.md).
It is a point-in-time execution aid, not a permanent claim that a PR or
worktree remains open. Items may already be resolved — for example, PR #1143
merged to `main` as `5e86a7faf` on 2026-07-13, satisfying its "merge before
PR 1" disposition below.

## 1. Outcome

The repository does not need a broad merge freeze before PR 0b/0c or the
in-place PR 1. It needs four concrete actions:

1. Fix the repository-shape failures in PR #1143, rebase it onto current
   `main`, and merge it before PR 1.
2. Do not merge PR #1142. Continue the clean test-only replacement on the
   `test-foundation/v2-*` branch family, selectively absorb the useful six
   commits from `codex/test-foundation-combined` and the test-only tail of
   #1142, then close #1142.
3. Protect the current uncommitted planning work, the detached support work,
   and the dirty UI/runtime programs named below. Each must land, be
   explicitly cancelled, or be retargeted before the mechanical PR 2 move.
4. Close the stale PR/worktree swarms instead of carrying them into the
   migration. Their still-valid guarantees belong in the test specification or
   a fresh implementation, not in old integration branches.

The only current product PR that blocks starting PR 1 is #1143. Resolving
#1142 means choosing and recording its replacement; the replacement test work
may continue alongside PR 0b/0c and PR 1 because those PRs do not move product
paths.

## 2. Disposition vocabulary

| Disposition | Meaning |
| --- | --- |
| Merge | Make the branch reviewable and land it before the named checkpoint. |
| Fresh-port | Move only reviewed behavior onto current `main`; never merge the old stack wholesale. |
| Protect | Preserve dirty or unique work until its owner explicitly lands, retargets, or cancels it. |
| Retarget | Continue the feature against the new canonical branch/path. |
| Supersede | Close the PR/branch because current code, specs, or a newer program replaces it. |
| Cleanup | Remove the local worktree only after confirming it is clean or contains disposable generated noise. |

No cleanup disposition authorizes discarding uncommitted work. A dirty
worktree remains protected until its diff is reviewed.

## 3. Open GitHub PRs

There were 46 open PRs at the snapshot. Every one is accounted for below.

### 3.1 Migration-path decisions

| PR | Owner / head | Touched slice | Disposition |
| --- | --- | --- | --- |
| [#1143](https://github.com/proliferate-ai/proliferate/pull/1143) Workflow definition authoring V1 | `pablonyx`; `codex/workflows-v1-pr1@d24fb7348f` | Server 18, shared packages 12, Cloud SDK 9, Desktop 6, Web 4, specs 4 | **Merge before PR 1.** Fix one forbidden raw Cloud SDK import and two over-limit files, rebase, run its gates, and merge. |
| [#1142](https://github.com/proliferate-ai/proliferate/pull/1142) strict core-flow qualification | `pablonyx`; `codex/test-foundation-integration@f8aecfe260` | 589 files / about 105k additions across old Workflow V1, server, runtime, Desktop, packages, tests, CI, and specs | **Supersede.** It is conflicting and not a test-only PR. Port only reviewed test/runtime pieces to the V2 test foundation after #1143, then close it. |

### 3.2 Independent current work

These do not block PR 0b/0c or PR 1. They should be resolved before the PR 2
freeze so the mechanical move starts from a quiet `main`.

| PR | Owner / head | Disposition |
| --- | --- | --- |
| [#1141](https://github.com/proliferate-ai/proliferate/pull/1141) dead server config | `Rahul-Ganesan`; `838a474129` | Add required labels, resolve metadata/Vercel noise, and merge independently. |
| [#1140](https://github.com/proliferate-ai/proliferate/pull/1140) local-development docs | `Rahul-Ganesan`; `adbc7da2c3` | Add required labels, resolve metadata/Vercel noise, and merge independently. |
| [#1114](https://github.com/proliferate-ai/proliferate/pull/1114) GitHub Actions dependencies | Dependabot; `3a2fa152f2` | Merge as part of the dependency batch, then rebase the V2 test foundation's CI changes. |
| [#1104](https://github.com/proliferate-ai/proliferate/pull/1104) Cargo dependencies | Dependabot; `1e839a48a9` | Merge as part of the dependency batch. |
| [#807](https://github.com/proliferate-ai/proliferate/pull/807) Python dependencies | Dependabot; `b6a7a64eab` | Merge as part of the dependency batch after #1141. |
| [#1105](https://github.com/proliferate-ai/proliferate/pull/1105) README product layout | `pablonyx`; `a1f914afa0` | Product-review the clean draft and either merge it or close it; it supersedes #839. |

### 3.3 Explicit product decisions

| PR | Owner / head | Disposition |
| --- | --- | --- |
| [#825](https://github.com/proliferate-ai/proliferate/pull/825) LiteLLM agent-auth spec | `pablonyx`; `6afcad9e1d` | It correctly removes Bifrost but predates the finalized free/paid per-seat billing policy. Reconcile useful architecture into current specs, then close or replace it; do not adopt it verbatim. |
| [#772](https://github.com/proliferate-ai/proliferate/pull/772) native Linux Desktop | `VAIBHAVSING`; `2c646df2e1` | Decide whether Linux is in the supported Tier 4 matrix. If yes, reimplement/rebase as an independent current PR; otherwise close and retain a named backlog item. |

### 3.4 Supersede or close

The five-day rule applies here: old work is not merged because it happens to
exist. A valid guarantee is retained in current specs/tests and the behavior is
reimplemented from current `main` only if qualification proves it missing.

| PRs | Reason |
| --- | --- |
| #1055 | Broad npm batch currently fails Desktop; close and let Dependabot regenerate after the structural migration. |
| #998 | Current authoritative spec work supersedes the old architecture-doc consolidation. |
| #964, #965 | Stale pre-Workflow automation branches; rederive any still-visible behavior after the current Workflow stack lands. |
| #941, #952 | Old repository-shape fixes target superseded file layouts. |
| #890, #943, #945, #946, #947, #948, #949, #950 | Preserve first-run, wake/resume, revoke cleanup, fail-closed auth, pre-clone, stalled materialization, recovery, and destroy guarantees in Tier 3 tests; close the stale implementations. |
| #942 | Current catalog probing and gateway tests, not the old open-model branch, define routing behavior. |
| #944 | Obsolete shared-sandbox profile direction conflicts with the user-per-sandbox model. |
| #938, #939 | Current self-host/Tier 3–4 contracts supersede the old installer and optional BYO-certificate drafts. |
| #892 | Targets an intermediate Mobile layout and Mobile is outside this migration. |
| #881, #882, #883, #884, #885, #886 | Close the entire obsolete agent-auth stack; PR 0b/0c rederive only the accepted authority and lifecycle contracts. |
| #847, #850 | Superseded subagent visual stack; current subagent work is tracked as one local program below. |
| #839 | Superseded by the newer #1105 README choice. |
| #802 | Stale integration-catalog gateway stack; Tier 3 integration qualification defines current missing work. |
| #800 | Defer the local skills marketplace as fresh post-migration work. |
| #791 | Reimplement native plan decisions only if current harness qualification shows the behavior is absent. |
| #769 | Conflicts with the canonical profile-based Make workflow. |
| #662, #745, #746 | Superseded by the current chat continuity/composer baseline. |
| #729 | Abandoned isolated plugin/eval work; reopen fresh if it becomes a current priority. |

This table accounts for 36 supersede/close PRs; together with the ten PRs in
Sections 3.1–3.3, it accounts for all 46 open PRs.

## 4. Local worktree programs

The live repository had 158 worktrees: 45 dirty, five detached, and 125 whose
heads were not ancestors of `main`. Most are duplicated swarm snapshots. The
following program ledger is the controlling classification; PR-attached
worktrees inherit their PR's disposition above.

### 4.1 Canonical testing line

| Work | Owner / head | Touched slice | Disposition |
| --- | --- | --- | --- |
| Current primary worktree | current session; `main@bdd11aa5a7`; 34 dirty/untracked entries at final snapshot | Testing specs/manifests plus this migration plan | **Protect.** The same intended spec set is committed on the V2 foundation branch; do not lose either copy while reconciling. |
| `test-foundation/v2-{contracts,artifacts,runner,local,cloud,selfhost,t4-cloud,t4-desktop,tier2}` | active test-foundation agents; all at `2dbe4f302` | Two current commits: shared contracts and the authoritative testing/migration spec pack | **Canonical active line.** Continue sharded implementation here, integrate through one reviewed branch, and rebase after #1143. |
| `codex/test-foundation-combined@6594a7d463` | prior test-foundation agent | Six cohesive fail-closed Tier 2/local/self-host/dual-host commits; nine dirty spec files | **Fresh-port source.** Preserve the unique self-update status correction, prefer the newer V2 specs, and port the six reviewed behaviors into V2. Do not create a competing final PR. |
| `codex/test-foundation-integration@f8aecfe260` | PR #1142 | Entire obsolete Workflow integration plus test tail | **Supersede.** Salvage only test-only evidence missing from V2, notably Tier 4 cloud evidence, dependency-contract checks, and current Workflow scenario adaptations. |
| `codex/{wdu-harness-foundation,test-dual-host-mainline,test-foundation-mainline}` | historical test agents | Earlier versions of the dual-host/foundation work | **Supersede/cleanup** after V2 contains the accepted tests. |
| `codex/t3-{local-runner,ci-wiring}` and `codex/recover-{test-hardening,billing-release,desktop-tier1}` | old Workflow/test swarm | Tier 2/3/release runner source material on the obsolete integration base | **Reference only.** Port a missing test deliberately; never merge these stacks. |

### 4.2 WDU prerequisite branches

| Work | Owner / head | Disposition |
| --- | --- | --- |
| `codex/anyharness-query-scope@c3690a787a` | historical WDU agent | **Cleanup.** Its committed tree is exactly represented by merged PR #1144 / `bdd11aa5a`; only generated `Cargo.lock` drift remains locally. |
| `codex/wdu0-contract-ledger@f0a1da3f97` | historical WDU agent | **Supersede.** The final migration plan replaces its old host/deployment model. Retain only any guarantee not already present in the final plan. |
| `codex/wdu2-scope-contract@6d68b472fa` | historical WDU agent | **Supersede and rewrite in PR 0b.** Its persistent deployment UUID, `dpk1_`, and old epoch model are rejected. Tests may inform the current normalized deployment + host-owned `authGeneration` design. |
| `codex/wdu2-server-identity@ea99ef3e9d` | historical WDU agent | **Cancel.** The new deployment UUID and `/meta` protocol are explicitly outside the aligned design. |
| `codex/wdu2-native-vault@ba761189b9` | historical WDU agent | **Fresh-port selected security ideas only.** Reuse atomic file, private-permission, symlink, corruption, and temp-directory tests under the current PR 0b credential design; do not port `dpk1_`. |
| `codex/wdu2-desktop-query-scope@46c36ff395` | historical WDU agent | **Fresh-port tests only.** PR #1144 supersedes most code; PR 0b/0c still needs same-user re-login and live-resource teardown fencing. |

### 4.3 Workflow and subagent programs

| Program | Owner / heads | Dirty/unique state | Disposition |
| --- | --- | --- | --- |
| Workflow V1 authoring | `codex/workflows-v1-pr1@d24fb7348f`; PR #1143 | Clean | Merge before PR 1. |
| Workflow V1 PR 2 design | `codex/workflows-v1-pr2-design@d24fb7348f` | Two dirty design specs | Protect; continue after #1143. |
| Workflow execution reference | `codex/workflows-simple-integration@dbd34ac39c` | Clean, seven commits over current base but 339 files | Do not merge wholesale. Split the accepted execution work into the post-#1143 Workflow PR sequence. |
| Old Workflow/recovery swarm | `codex/recover-*`, `codex/workflows-*`, `workflows/completion-*`, `workflows/feat-*`, `workflows/ux-mocks` | About 30 overlapping heads from July 9–11 | Reference only, then supersede after a commit/parity check against the sequential Workflow stack. |
| Dirty Workflow shards | `codex/workflows-v1-foundations-integration`, `codex/workflows-wf-poll-net-fable`, `codex/workflows-wf-outbox`, `codex/workflows-v1-integration-recovery` | Respectively 99, 21, 6, and 5 dirty entries at snapshot | Protect until the unique AnyHarness, network, outbox, and spec diffs are extracted or explicitly cancelled. |
| Subagent runtime program | `codex/subagents-{close-api,mcp-contract,runtime-recovery,turn-context}` plus `codex/workspace-activity-snapshot` | `close-api` has 40 dirty entries; siblings are clean overlapping stacks | Treat as one program. Port accepted slices onto current `main`; do not merge the shared obsolete stack. Resolve before PR 2 or retarget once to `product-client`. |
| Old combined chat baseline | `codex/chat-baseline-integration@4c8d1ae154` | Clean but 204 commits over an obsolete integration base | Cancel; current chat PRs and the protected UI diffs below are the only sources to review. |

### 4.4 Protected dirty product work

These branches do not prevent in-place PR 1. They must receive a named owner
and a land/cancel/retarget decision before PR 2 moves Desktop paths.

| Work | Head / dirty state | Touched slice | Required decision |
| --- | --- | --- | --- |
| Detached support work at `.codex/worktrees/385e/proliferate` | `bdd11aa5a7`; 36 dirty entries at final snapshot | Support reporting, PR metadata, CI, server infrastructure, Desktop and shared packages | Create a named branch. Land a focused PR before PR 2 or explicitly retarget it. |
| `whale` | ancestor `af5b002d00`; 63 dirty entries | Transcript/tool-call polish, Desktop, product UI/domain, CSS, specs | Compare visually with the current chat baseline; extract a focused PR or cancel explicitly. |
| `codex/composer-agent-ux` | ancestor `23d63162b5`; 89 dirty entries | Composer/agent settings plus mixed billing, GitHub auth, catalog, CI, and server changes | Audit by feature. Never merge as one unit; separately preserve any real billing/auth fixes. |
| `codex/subagents-close-api` | `c502b22bc4`; 40 dirty entries | AnyHarness, Desktop, shared packages | Resolve as part of the one subagent runtime program above. |
| `codex/transactional-empty-chat-switch-source` | `2be625e68b`; 125 dirty entries | Mixed scratch state after PR #1128 merged | Treat as protected scratch until its owner confirms no unique diff remains. |
| `feat/pr-clarity` and `worktree-git-status-panel` | ancestor heads; 45 and 38 dirty entries | Git status / PR clarity UI | Presumed superseded by current Git-status UI under the five-day rule; perform one targeted visual comparison before cancellation. |
| `tests/intent-sso` | `0fd0c3060b`; 263 dirty entries | Old intent/SSO test integration | Protect long enough to extract any unique fixture or scenario into V2, then supersede. |
| `worktree-v1` | `5c13d0a55b`; 41 dirty entries | Very old server/auth work | Stale, but do not delete until the uncommitted diff is explicitly reviewed. |

### 4.5 Detached and stale local state

The five detached worktrees were:

- `.codex/worktrees/385e/proliferate@bdd11aa5a7` — protected above;
- `.codex/worktrees/9314/proliferate@53e761e00f` — old runtime-config
  work with two dirty entries; review, then supersede;
- `.claude/worktrees/wf_bb868f20-e6e-10@2f3efc43f4` — obsolete
  repo-shape work; supersede;
- `.claude/worktrees/wf_bb868f20-e6e-12@08023596e6` — obsolete
  gateway-open-model work; supersede;
- `.claude/worktrees/wf_c2e8588c-e8e-11@c413cd16e0` — obsolete auth
  cleanup work; preserve the guarantee in tests, then supersede.

Other stale local stacks—`agent-auth/*`, old self-hosting branches,
`repo-environment-flows-*`, `goals*`, `catalog-fence-*`, old integration
branches, and open-PR worktrees from Section 3—inherit the corresponding
supersede/fresh-port decision. Merged bug-fix branches
`fix/{billing-reconciler,org-compute-budget-attribution,invitations-admin-only,
sandbox-proxy-product-gate,seat-adjustment-multisub}` are cleanup candidates;
their PRs are already on `main` and their remaining dirt is generated noise.

Clean duplicate animal-agent worktrees whose heads are already ancestors of
`main` are cleanup candidates, except dirty `whale`. Clean worktrees for merged
PRs #1128, #1130, #1131, #1133, #1136–#1139, and #1144 are also cleanup
candidates. Actual removal is a separate housekeeping action after this ledger
is accepted.

## 5. Execution order

1. Fix/rebase/merge #1143.
2. Resolve the small independent merge batch (#1140, #1141, #807, #1104,
   #1114, and the #1105 product decision).
3. Keep `test-foundation/v2-*` as the only active test-foundation line. Port
   accepted behavior from `test-foundation-combined` and the test-only tail of
   #1142, validate it, open a clean PR, and close #1142.
4. Implement PR 0b/0c and in-place PR 1. Fresh-port only the accepted WDU
   security/lifecycle tests; do not merge the obsolete WDU branches.
5. In parallel, split current Workflow work into reviewable slices and audit
   the protected dirty product work.
6. Immediately before PR 2, refresh this ledger, require every hot-surface
   item to be merged/cancelled/retargeted, remove the embedded browser, and
   begin the one-to-two-day Desktop path freeze.

## 6. Gate to start PR 1

PR 1 may start when:

- #1143 is merged;
- #1142 is recorded as superseded and V2 is the single canonical test line;
- PR 0b/0c owners do not use the rejected WDU deployment-UUID design;
- all dirty worktrees in Section 4 are protected from cleanup; and
- queued structure-alignment work that assumes app-owned product pages or a
  separate Web product is cancelled or retargeted.

The dirty product programs do not all need to land before PR 1 because PR 1
does not move their files. They do need final dispositions before PR 2.

## 7. Raw active-worktree snapshot

This appendix makes the grouped ledger auditable. It includes every worktree
that was dirty, detached, or ahead of `main` at the snapshot. Repeated swarm
heads are intentionally visible here. “Protect” means no destructive cleanup;
it does not mean the old branch should ultimately merge.

<details>
<summary>133 dirty, detached, or unmerged worktree entries</summary>

| Branch / head | Owner | State | Slice | Disposition | Path |
| --- | --- | --- | --- | --- | --- |
| `main@bdd11aa5a7` | Pablo/local | 2026-07-12; −0/+0; dirty 34 | Testing/migration specs | Protect current planning work | `~/proliferate` |
| `codex/clean-sidebar-icons@8fda102145` | Codex session | 2026-07-11; −15/+1; dirty 0 | Merged product PR | Cleanup | `~/.codex/worktrees/255b/proliferate` |
| `DETACHED@bdd11aa5a7` | Codex session | 2026-07-12; −0/+0; dirty 36; detached | Support/CI/product | Protect; name branch before PR 2 | `~/.codex/worktrees/385e/proliferate` |
| `codex/repo-environment-flows-parked-4dd6@1cd8696762` | Codex session | 2026-06-29; −298/+44; dirty 9 | Historical product stack | Review dirt, then supersede | `~/.codex/worktrees/4dd6/proliferate` |
| `codex/transactional-empty-chat-switch-source@2be625e68b` | Codex session | 2026-07-11; −18/+1; dirty 125 | Chat scratch | Protect pending owner confirmation | `~/.codex/worktrees/4df1/proliferate` |
| `DETACHED@53e761e00f` | Codex session | 2026-06-28; −298/+43; dirty 2; detached | Historical detached work | Review dirt, then supersede | `~/.codex/worktrees/9314/proliferate` |
| `codex/composer-agent-ux@23d63162b5` | Codex session | 2026-07-11; −18/+0; dirty 89 | Composer/agent/billing | Protect; split by feature | `~/.codex/worktrees/composer-agent-ux/proliferate` |
| `codex/desktop-release-notices@2c788deab9` | Codex session | 2026-07-11; −13/+2; dirty 0 | Merged product PR | Cleanup | `~/.codex/worktrees/desktop-release-notices` |
| `codex/transactional-empty-chat-switch@b2ce0606f0` | Codex session | 2026-07-11; −16/+1; dirty 0 | Merged product PR | Cleanup | `~/.codex/worktrees/empty-chat-switch-pr/proliferate` |
| `codex/remove-runtime-config@53e761e00f` | Codex session | 2026-06-28; −298/+43; dirty 0 | Historical product stack | Supersede | `~/.codex/worktrees/f746/proliferate` |
| `codex/repo-environment-flows-hardcut@0b6f2fff4c` | Codex session | 2026-06-30; −298/+48; dirty 0 | Historical product stack | Supersede | `~/.codex/worktrees/repo-env-flow-hardcut/proliferate` |
| `codex/subagents-close-api@c502b22bc4` | Codex session | 2026-07-11; −20/+159; dirty 40 | Subagent runtime | Protect unique dirt; port as one program | `~/.codex/worktrees/subagents-close-api/proliferate` |
| `codex/subagents-mcp-contract@d13da01522` | Codex session | 2026-07-11; −20/+161; dirty 0 | Subagent runtime | Reference within one current program | `~/.codex/worktrees/subagents-mcp-contract/proliferate` |
| `codex/subagents-runtime-recovery@7b831e5ed4` | Codex session | 2026-07-11; −20/+159; dirty 0 | Subagent runtime | Reference within one current program | `~/.codex/worktrees/subagents-runtime-recovery/proliferate` |
| `codex/subagents-turn-context@65b0702f43` | Codex session | 2026-07-11; −20/+158; dirty 0 | Subagent runtime | Reference within one current program | `~/.codex/worktrees/subagents-turn-context/proliferate` |
| `codex/subagents-ux-mocks@abb56e3bb5` | Codex session | 2026-07-11; −13/+1; dirty 0 | Subagent runtime | Reference within one current program | `~/.codex/worktrees/subagents-ux-mocks/proliferate` |
| `codex/wdu-harness-foundation@14e005756e` | Codex session | 2026-07-11; −11/+1; dirty 0 | Test foundation | Supersede after V2 parity | `~/.codex/worktrees/wdu-harness-foundation` |
| `codex/workflows-v1-pr1@d24fb7348f` | Codex session | 2026-07-12; −1/+3; dirty 0 | PR-attached | Merge PR #1143 before PR 1 | `~/.codex/worktrees/workflows-v1-pr1/proliferate` |
| `codex/workflows-v1-pr2-design@d24fb7348f` | Codex session | 2026-07-12; −1/+3; dirty 2 | Workflow | Protect design; continue after #1143 | `~/.codex/worktrees/workflows-v1-pr2-design/proliferate` |
| `codex/workspace-activity-snapshot@a2e8599e61` | Codex session | 2026-07-11; −20/+158; dirty 0 | Subagent runtime | Reference within one current program | `~/.codex/worktrees/workspace-activity/proliferate` |
| `agent-auth/00-spec@c0d6b57c0e` | local agent | 2026-07-01; −291/+2; dirty 0 | PR-attached | Reconcile then close/replace PR #825 | `~/.proliferate/worktrees/proliferate/agent-auth-00-spec` |
| `agent-auth/16-catalog-probe@da0890709e` | local agent | 2026-07-02; −279/+9; dirty 0 | Old agent-auth | Supersede; PR 0b/0c owns accepted model | `~/.proliferate/worktrees/proliferate/agent-auth-16-catalog-probe` |
| `agent-auth/full-integration@8ab0a6bde2` | local agent | 2026-07-01; −282/+17; dirty 1 | Old agent-auth | Supersede; PR 0b/0c owns accepted model | `~/.proliferate/worktrees/proliferate/agent-auth-full` |
| `agent-auth/fix-missing-selection-native@6c5457df83` | local agent | 2026-07-02; −199/+1; dirty 1 | Old agent-auth | Supersede; PR 0b/0c owns accepted model | `~/.proliferate/worktrees/proliferate/agent-auth-hotfix` |
| `fennec@60016bc392` | local agent | 2026-07-04; −158/+1; dirty 0 | PR-attached | Supersede with PR #998 | `~/.proliferate/worktrees/proliferate/fennec` |
| `whale@af5b002d00` | local agent | 2026-07-09; −32/+0; dirty 63 | Chat/transcript UI | Protect; visual audit before PR 2 | `~/.proliferate/worktrees/proliferate/whale` |
| `feat/composer-queue@2549dd9747` | Pablo/local | 2026-07-07; −129/+6; dirty 0 | Closed PR #1003 | Cleanup; superseded | `~/proliferate-composerq` |
| `cursor-model-variant-switch@4098104337` | Pablo/local | 2026-06-16; −355/+3; dirty 0 | Cursor variants | Cleanup; superseded by #1137 | `~/proliferate-cursor-model-switch` |
| `ux/wave-1-settings-system@61b4ff6ecf` | Pablo/local | 2026-07-01; −291/+6; dirty 4 | Older local program | Protect until targeted review | `~/proliferate-ds-chat-restyle` |
| `codex/integration-catalog-gateway@7d6ecbb57b` | Pablo/local | 2026-06-30; −293/+8; dirty 0 | PR-attached | Supersede with PR #802 | `~/proliferate-integration-catalog-gateway` |
| `feat/pr-clarity@acf162fe9d` | Pablo/local | 2026-07-07; −129/+0; dirty 45 | Git-status UI | Visual audit, then likely supersede | `~/proliferate-prstatus` |
| `codex/workflow-positioning-readme@a1f914afa0` | Pablo/local | 2026-07-09; −46/+5; dirty 0 | PR-attached | Review/merge-or-close PR #1105 | `~/proliferate-readme-workflows` |
| `seed/remove-cloudflare-docs@12fc4e22d4` | Pablo/local | 2026-07-07; −129/+1; dirty 3 | Older local program | Protect until targeted review | `~/proliferate-seedclean` |
| `ui/combined-preview@80dee15f94` | Pablo/local | 2026-07-03; −189/+27; dirty 0 | Older local program | Review, then supersede | `~/proliferate-ui-combined` |
| `fix/billing-reconciler@b5942f73bf` | Pablo/local | 2026-07-08; −108/+7; dirty 1 | Merged bug fix | Cleanup after generated dirt check | `~/proliferate-worktrees/reconciler-port` |
| `workflows/ux-mocks@0e44f558c9` | Pablo/local | 2026-07-08; −189/+89; dirty 0 | Workflow | Reference only; supersede after parity | `~/proliferate-worktrees/workflows-ux` |
| `codex/anyharness-query-scope@c3690a787a` | test/workflow agent | 2026-07-12; −1/+4; dirty 1 | WDU prerequisite | Cleanup; merged as #1144 | `~/proliferate-wt/anyharness-query-scope` |
| `ux/environments-settings@b6997f2c02` | test/workflow agent | 2026-07-01; −279/+3; dirty 5 | Older local program | Protect until targeted review | `~/proliferate-wt/env-settings` |
| `codex/cloud-worker-integrations-full@b88a3e8bfb` | test/workflow agent | 2026-07-02; −275/+18; dirty 3 | Older local program | Protect until targeted review | `~/proliferate-wt/full` |
| `integration/agents-plus-convergence@6d4deca55d` | test/workflow agent | 2026-07-06; −145/+31; dirty 2 | Older local program | Protect until targeted review | `~/proliferate-wt/integration` |
| `readme-revamp@76e3d95fcb` | test/workflow agent | 2026-07-01; −290/+6; dirty 0 | PR-attached | Supersede with PR #839 | `~/proliferate-wt/readme-revamp` |
| `codex/recover-alerting@0344180153` | test/workflow agent | 2026-07-11; −20/+167; dirty 0 | Workflow | Reference only; supersede after parity | `~/proliferate-wt/recover-alerting` |
| `codex/recover-billing-release@31afee08d3` | test/workflow agent | 2026-07-11; −20/+161; dirty 0 | Workflow | Reference only; supersede after parity | `~/proliferate-wt/recover-billing-release` |
| `codex/recover-desktop-tier1@815b72b081` | test/workflow agent | 2026-07-11; −20/+161; dirty 0 | Workflow | Reference only; supersede after parity | `~/proliferate-wt/recover-desktop-tier1` |
| `codex/recover-pending-prompts@7f3ba92ddc` | test/workflow agent | 2026-07-11; −20/+160; dirty 0 | Workflow | Reference only; supersede after parity | `~/proliferate-wt/recover-pending-prompts` |
| `codex/recover-platform-architecture-docs@1086aa4c3d` | test/workflow agent | 2026-07-11; −20/+160; dirty 0 | Workflow | Reference only; supersede after parity | `~/proliferate-wt/recover-platform-architecture-docs` |
| `codex/recover-test-hardening@1e792d1f34` | test/workflow agent | 2026-07-11; −20/+160; dirty 0 | Workflow | Reference only; supersede after parity | `~/proliferate-wt/recover-test-hardening` |
| `codex/recover-transcript-ui@4b4139a2c8` | test/workflow agent | 2026-07-11; −20/+160; dirty 0 | Workflow | Reference only; supersede after parity | `~/proliferate-wt/recover-transcript-ui` |
| `codex/recover-workflow-run-args-ui@3a11429003` | test/workflow agent | 2026-07-11; −20/+160; dirty 0 | Workflow | Reference only; supersede after parity | `~/proliferate-wt/recover-workflow-run-args-ui` |
| `codex/recover-workflow-structure@007278e20b` | test/workflow agent | 2026-07-11; −20/+160; dirty 0 | Workflow | Reference only; supersede after parity | `~/proliferate-wt/recover-workflow-structure` |
| `self-hosting/v1@82677b12b8` | test/workflow agent | 2026-07-02; −212/+0; dirty 2 | Old self-host | Supersede after V2 scenario parity | `~/proliferate-wt/self-hosting` |
| `self-hosting/integration@71ad361904` | test/workflow agent | 2026-07-02; −280/+27; dirty 0 | Old self-host | Supersede after V2 scenario parity | `~/proliferate-wt/sh-integration` |
| `codex/t3-ci-wiring@ac0a437403` | test/workflow agent | 2026-07-11; −11/+175; dirty 0 | Test foundation | Reference only; port missing CI behavior into V2 | `~/proliferate-wt/t3-ci-wiring` |
| `codex/t3-local-runner@fd83ea9c7c` | test/workflow agent | 2026-07-11; −11/+176; dirty 1 | Test foundation | Review dirt, then port missing local-runner behavior into V2 | `~/proliferate-wt/t3-local-runner` |
| `codex/test-dual-host-mainline@f0ff35c053` | test/workflow agent | 2026-07-11; −2/+1; dirty 0 | Test foundation | Supersede after V2 parity | `~/proliferate-wt/test-dual-host-mainline` |
| `codex/test-foundation-combined@6594a7d463` | test/workflow agent | 2026-07-12; −2/+6; dirty 9 | Test foundation | Fresh-port source into V2 | `~/proliferate-wt/test-foundation-combined` |
| `codex/test-foundation-integration@f8aecfe260` | test/workflow agent | 2026-07-11; −11/+186; dirty 0 | PR-attached | Supersede PR #1142 | `~/proliferate-wt/test-foundation-integration` |
| `codex/test-foundation-mainline@6a4ec858f4` | test/workflow agent | 2026-07-11; −2/+1; dirty 0 | Test foundation | Supersede after V2 parity | `~/proliferate-wt/test-foundation-mainline` |
| `test-foundation/v2-artifacts@2dbe4f3021` | test/workflow agent | 2026-07-13; −0/+2; dirty 0 | Test foundation | Canonical V2 shard | `~/proliferate-wt/tf-artifacts` |
| `test-foundation/v2-cloud@2dbe4f3021` | test/workflow agent | 2026-07-13; −0/+2; dirty 0 | Test foundation | Canonical V2 shard | `~/proliferate-wt/tf-cloud` |
| `test-foundation/v2-contracts@2dbe4f3021` | test/workflow agent | 2026-07-13; −0/+2; dirty 0 | Test foundation | Canonical V2 shard | `~/proliferate-wt/tf-foundation` |
| `test-foundation/v2-local@2dbe4f3021` | test/workflow agent | 2026-07-13; −0/+2; dirty 0 | Test foundation | Canonical V2 shard | `~/proliferate-wt/tf-local` |
| `test-foundation/v2-runner@2dbe4f3021` | test/workflow agent | 2026-07-13; −0/+2; dirty 2 | Test foundation | Canonical V2 shard | `~/proliferate-wt/tf-runner` |
| `test-foundation/v2-selfhost@2dbe4f3021` | test/workflow agent | 2026-07-13; −0/+2; dirty 0 | Test foundation | Canonical V2 shard | `~/proliferate-wt/tf-selfhost` |
| `test-foundation/v2-t4-cloud@2dbe4f3021` | test/workflow agent | 2026-07-13; −0/+2; dirty 0 | Test foundation | Canonical V2 shard | `~/proliferate-wt/tf-t4-cloud` |
| `test-foundation/v2-t4-desktop@2dbe4f3021` | test/workflow agent | 2026-07-13; −0/+2; dirty 0 | Test foundation | Canonical V2 shard | `~/proliferate-wt/tf-t4-desktop` |
| `test-foundation/v2-tier2@2dbe4f3021` | test/workflow agent | 2026-07-13; −0/+2; dirty 0 | Test foundation | Canonical V2 shard | `~/proliferate-wt/tf-tier2` |
| `codex/composer-ultra-alignment@5444091fa1` | test/workflow agent | 2026-07-11; −7/+4; dirty 0 | Chat/transcript UI | Compare with the current chat baseline; merge or supersede before PR 2 | `~/proliferate-wt/transcript-continuity` |
| `codex/wdu0-contract-ledger@f0a1da3f97` | test/workflow agent | 2026-07-12; −2/+3; dirty 0 | WDU prerequisite | Supersede with final plan | `~/proliferate-wt/wdu0-contract-ledger` |
| `codex/wdu2-desktop-query-scope@46c36ff395` | test/workflow agent | 2026-07-12; −2/+5; dirty 0 | WDU prerequisite | Port missing lifecycle tests | `~/proliferate-wt/wdu2-desktop-query-scope` |
| `codex/wdu2-native-vault@ba761189b9` | test/workflow agent | 2026-07-12; −2/+6; dirty 0 | WDU prerequisite | Port selected security tests | `~/proliferate-wt/wdu2-native-vault` |
| `codex/wdu2-scope-contract@6d68b472fa` | test/workflow agent | 2026-07-12; −2/+4; dirty 0 | WDU prerequisite | Rewrite current design in PR 0b | `~/proliferate-wt/wdu2-scope-contract` |
| `codex/wdu2-server-identity@ea99ef3e9d` | test/workflow agent | 2026-07-12; −2/+5; dirty 0 | WDU prerequisite | Cancel rejected UUID protocol | `~/proliferate-wt/wdu2-server-identity` |
| `workflows/feat-2a-desktop-executor@f54c854114` | test/workflow agent | 2026-07-09; −189/+94; dirty 0 | Workflow | Reference only; supersede after parity | `~/proliferate-wt/wf-2a` |
| `workflows/feat-3a-parallel-lanes@cd26a69fa8` | test/workflow agent | 2026-07-10; −189/+96; dirty 0 | Workflow | Reference only; supersede after parity | `~/proliferate-wt/wf-3a` |
| `codex/workflows-broker-iso@0651b82b8b` | test/workflow agent | 2026-07-11; −17/+168; dirty 0 | Workflow | Reference only; supersede after parity | `~/proliferate-wt/workflows-broker-iso` |
| `codex/workflows-v1-foundations-integration@ed877352d9` | test/workflow agent | 2026-07-11; −17/+179; dirty 99 | Workflow | Protect unique dirt, then port/cancel | `~/proliferate-wt/workflows-foundations-integration` |
| `codex/workflows-wf-outbox@32c97186d1` | test/workflow agent | 2026-07-11; −17/+176; dirty 6 | Workflow | Protect unique dirt, then port/cancel | `~/proliferate-wt/workflows-outbox` |
| `codex/workflows-wf-poll-net-fable@ff5fb6060c` | test/workflow agent | 2026-07-11; −17/+177; dirty 21 | Workflow | Protect unique dirt, then port/cancel | `~/proliferate-wt/workflows-poll-net` |
| `codex/workflows-simple-integration@dbd34ac39c` | test/workflow agent | 2026-07-12; −2/+7; dirty 0 | Workflow | Reference; split into current PRs | `~/proliferate-wt/workflows-simple-integration` |
| `codex/workflows-v1-clean-integration@0826992477` | test/workflow agent | 2026-07-11; −11/+177; dirty 0 | Workflow | Reference only; supersede after parity | `~/proliferate-wt/workflows-v1-clean-integration` |
| `codex/workflows-v1-integration-recovery@32c97186d1` | test/workflow agent | 2026-07-11; −17/+176; dirty 5 | Workflow | Protect unique dirt, then port/cancel | `~/proliferate-wt/workflows-v1-integration-recovery` |
| `codex/workflows-wf-id@46777561fd` | test/workflow agent | 2026-07-11; −17/+167; dirty 0 | Workflow | Reference only; supersede after parity | `~/proliferate-wt/workflows-wf-id` |
| `workflows/completion-delivery@979724a704` | test/workflow agent | 2026-07-10; −20/+153; dirty 0 | Workflow | Reference only; supersede after parity | `~/proliferate-wt/wsc-ws2c` |
| `workflows/completion-audiences@4b64e26922` | test/workflow agent | 2026-07-10; −20/+151; dirty 0 | Workflow | Reference only; supersede after parity | `~/proliferate-wt/wsc-ws3b` |
| `workflows/completion-receipts@ba57b40697` | test/workflow agent | 2026-07-11; −20/+154; dirty 0 | Workflow | Reference only; supersede after parity | `~/proliferate-wt/wsc-ws3c` |
| `workflows/completion-background@9687cc59fc` | test/workflow agent | 2026-07-10; −20/+152; dirty 0 | Workflow | Reference only; supersede after parity | `~/proliferate-wt/wsc-ws4a` |
| `workflows/completion-polling@7b3fe6106b` | test/workflow agent | 2026-07-11; −20/+154; dirty 0 | Workflow | Reference only; supersede after parity | `~/proliferate-wt/wsc-ws4b` |
| `worktree-agent-a07e0f65663d7ac44@bbf580db3a` | Claude session | 2026-07-04; −158/+4; dirty 0 | Historical agent swarm | Supersede | `repo/.claude/worktrees/agent-a07e0f65663d7ac44` |
| `goals-loops/anyharness@c2b029e41b` | Claude session | 2026-07-02; −201/+0; dirty 36 | Historical swarm | Review dirt, then supersede | `repo/.claude/worktrees/agent-a5305e54cf3d9f20e` |
| `fix/org-compute-budget-attribution@ad866c12ca` | Claude session | 2026-07-08; −107/+1; dirty 1 | Merged bug fix | Cleanup after generated dirt check | `repo/.claude/worktrees/agent-a7628b8ebba7f5276` |
| `fix/invitations-admin-only@772e976568` | Claude session | 2026-07-08; −107/+1; dirty 1 | Merged bug fix | Cleanup after generated dirt check | `repo/.claude/worktrees/agent-a8d4b5fb96440225b` |
| `goals-loops/desktop-ui@6e72ef9e5a` | Claude session | 2026-07-02; −204/+4; dirty 0 | Historical swarm | Supersede | `repo/.claude/worktrees/agent-a9d643ae673c8ae82` |
| `agents/opencode-gateway-native-union@9cb3fe6806` | Claude session | 2026-07-04; −158/+7; dirty 1 | Historical agent swarm | Review dirt, then supersede | `repo/.claude/worktrees/agent-ad6e0cb4c0f780257` |
| `catalog-fence-seam2@84e42cc5f9` | Claude session | 2026-06-16; −355/+6; dirty 3 | Historical swarm | Review dirt, then supersede | `repo/.claude/worktrees/catalog-lockfile-pins` |
| `worktree-chat-snappiness@cd46168483` | Claude session | 2026-06-13; −398/+1; dirty 1 | PR-attached | Supersede with PR #662 | `repo/.claude/worktrees/chat-snappiness` |
| `worktree-cloud-sandbox-model-spec@d342edbf42` | Claude session | 2026-07-02; −259/+2; dirty 0 | PR-attached | Supersede with PR #890 | `repo/.claude/worktrees/cloud-sandbox-model-spec` |
| `worktree-git-status-panel@2803dfbb4d` | Claude session | 2026-07-03; −175/+0; dirty 38 | Git-status UI | Visual audit, then likely supersede | `repo/.claude/worktrees/git-status-panel` |
| `worktree-pr809-cleanup@fc11feb273` | Claude session | 2026-07-01; −292/+30; dirty 1 | Older local program | Protect until targeted review | `repo/.claude/worktrees/pr809-cleanup` |
| `agent-auth/21-direct-runtime-ui@739157349e` | Claude session | 2026-07-05; −204/+15; dirty 0 | PR-attached | Supersede auth stack #886 | `repo/.claude/worktrees/ssh-direct-stack` |
| `worktree-transcript-scroll-fix@480376452a` | Claude session | 2026-06-13; −398/+1; dirty 1 | Old transcript UI | Supersede after confirming the dirty entry is disposable noise | `repo/.claude/worktrees/transcript-scroll-fix` |
| `automations/archive@656366d1f2` | Claude session | 2026-07-05; −158/+1; dirty 0 | PR-attached | Supersede with PR #965 | `repo/.claude/worktrees/wf_020c8caf-6ff-1` |
| `automations/editor-config-dedupe@7ab0d7232a` | Claude session | 2026-07-05; −158/+1; dirty 0 | PR-attached | Supersede with PR #964 | `repo/.claude/worktrees/wf_020c8caf-6ff-2` |
| `overnight/fix-preclone-typeerror@75bb7f7b1c` | Claude session | 2026-07-04; −165/+1; dirty 0 | PR-attached | Supersede; retain scenario from #948 | `repo/.claude/worktrees/wf_0c9796e3-528-1` |
| `overnight/fix-orphan-materializing@e707ac3df6` | Claude session | 2026-07-04; −165/+1; dirty 0 | PR-attached | Supersede; retain scenario from #949 | `repo/.claude/worktrees/wf_0c9796e3-528-2` |
| `overnight/fix-sandbox-wedge@93bb46f9b5` | Claude session | 2026-07-04; −165/+1; dirty 0 | PR-attached | Supersede; retain scenario from #950 | `repo/.claude/worktrees/wf_0c9796e3-528-3` |
| `worktree-wf_22541b0f-ba4-1@9cb3fe6806` | Claude session | 2026-07-04; −158/+7; dirty 0 | Historical swarm | Supersede | `repo/.claude/worktrees/wf_22541b0f-ba4-1` |
| `worktree-wf_25798819-f44-2@125ae77731` | Claude session | 2026-07-04; −158/+3; dirty 0 | Historical swarm | Supersede | `repo/.claude/worktrees/wf_25798819-f44-2` |
| `goals/anyharness@bc33ed759a` | Claude session | 2026-07-02; −192/+1; dirty 1 | Historical swarm | Review dirt, then supersede | `repo/.claude/worktrees/wf_6136a8d3-4fd-3` |
| `goals/ui@5943929ed2` | Claude session | 2026-07-02; −192/+1; dirty 0 | Historical swarm | Supersede | `repo/.claude/worktrees/wf_6136a8d3-4fd-4` |
| `overnight/gateway-open-models@08023596e6` | Claude session | 2026-07-04; −167/+1; dirty 0 | PR-attached | Supersede with PR #942 | `repo/.claude/worktrees/wf_bb868f20-e6e-1` |
| `DETACHED@2f3efc43f4` | Claude session | 2026-07-04; −167/+1; dirty 1; detached | Historical detached work | Review dirt, then supersede | `repo/.claude/worktrees/wf_bb868f20-e6e-10` |
| `DETACHED@08023596e6` | Claude session | 2026-07-04; −167/+1; dirty 1; detached | Historical detached work | Review dirt, then supersede | `repo/.claude/worktrees/wf_bb868f20-e6e-12` |
| `overnight/repo-shape-render-tests@2f3efc43f4` | Claude session | 2026-07-04; −167/+1; dirty 1 | PR-attached | Supersede with PR #941 | `repo/.claude/worktrees/wf_bb868f20-e6e-2` |
| `overnight/b7-installer@aed7677a6f` | Claude session | 2026-07-04; −167/+1; dirty 0 | PR-attached | Supersede with PR #938 | `repo/.claude/worktrees/wf_bb868f20-e6e-3` |
| `overnight/b8-byo-cert@0fd8565072` | Claude session | 2026-07-04; −167/+1; dirty 0 | PR-attached | Supersede with PR #939 | `repo/.claude/worktrees/wf_bb868f20-e6e-4` |
| `overnight/org-profiles-v0@d374d15dbb` | Claude session | 2026-07-04; −167/+1; dirty 0 | PR-attached | Cancel obsolete direction from #944 | `repo/.claude/worktrees/wf_bb868f20-e6e-6` |
| `DETACHED@c413cd16e0` | Claude session | 2026-07-04; −166/+1; dirty 1; detached | Historical detached work | Review dirt, then supersede | `repo/.claude/worktrees/wf_c2e8588c-e8e-11` |
| `overnight/fix-desktop-first-run@e39f7181cb` | Claude session | 2026-07-04; −166/+1; dirty 0 | PR-attached | Supersede; retain scenario from #943 | `repo/.claude/worktrees/wf_c2e8588c-e8e-6` |
| `overnight/fix-cleanup-on-revoke@c413cd16e0` | Claude session | 2026-07-04; −166/+1; dirty 0 | PR-attached | Supersede; retain scenario from #946 | `repo/.claude/worktrees/wf_c2e8588c-e8e-7` |
| `overnight/fix-scoped-auth-chain@338bb6a959` | Claude session | 2026-07-04; −166/+1; dirty 0 | PR-attached | Supersede; retain guarantee from #947 | `repo/.claude/worktrees/wf_c2e8588c-e8e-8` |
| `worktree-wf_d29beb68-9d0-1@0072cac041` | Claude session | 2026-07-04; −158/+2; dirty 0 | Historical swarm | Supersede | `repo/.claude/worktrees/wf_d29beb68-9d0-1` |
| `worktree-wf_d29beb68-9d0-2@f6fbace9a1` | Claude session | 2026-07-04; −158/+3; dirty 0 | Historical swarm | Supersede | `repo/.claude/worktrees/wf_d29beb68-9d0-2` |
| `codex/chat-baseline-integration@4c8d1ae154` | Codex session | 2026-07-11; −11/+204; dirty 0 | Chat | Cancel obsolete combined baseline | `repo/.codex/worktrees/chat-baseline-integration` |
| `codex/fix-main-schema-snapshot@d83b365b3d` | Codex session | 2026-07-11; −7/+1; dirty 0 | Recent recovery port | Verify merged-equivalence, then cleanup | `repo/.codex/worktrees/fix-main-schema-snapshot` |
| `codex/fix-main-shape-baseline@226e7bb521` | Codex session | 2026-07-11; −5/+1; dirty 0 | Recent recovery port | Verify merged-equivalence, then cleanup | `repo/.codex/worktrees/fix-main-shape-baseline` |
| `codex/fresh-port-cursor-variants@8c890a1f5d` | Codex session | 2026-07-11; −4/+1; dirty 0 | Recent recovery port | Verify merged-equivalence, then cleanup | `repo/.codex/worktrees/fresh-port-cursor-variants` |
| `codex/fresh-port-desktop-worker@78be06b589` | Codex session | 2026-07-11; −3/+2; dirty 0 | Recent recovery port | Verify merged-equivalence, then cleanup | `repo/.codex/worktrees/fresh-port-desktop-worker` |
| `worktree-v1@5c13d0a55b` | Pablo/local | 2026-06-04; −556/+18; dirty 41 | Legacy server/auth | Protect dirty diff; then supersede | `~/worktree-v1` |
| `fix/email-validation-mismatch@b3d13259dc` | Pablo/local | 2026-07-07; −112/+1; dirty 1 | Server bug fix | Manual compare with current main | `~/worktrees/fix-email-tld` |
| `fix/sandbox-proxy-product-gate@1e8901e33c` | Pablo/local | 2026-07-09; −104/+1; dirty 1 | Merged bug fix | Cleanup after generated dirt check | `~/worktrees/fix-proxy-gates` |
| `fix/seat-adjustment-multisub@86aff0dfeb` | Pablo/local | 2026-07-09; −106/+1; dirty 1 | Merged bug fix | Cleanup after generated dirt check | `~/worktrees/fix-seat-adjustment` |
| `tests/intent-sso@0fd0c3060b` | Pablo/local | 2026-07-09; −77/+6; dirty 263 | Intent/SSO tests | Protect fixture salvage into V2 | `~/worktrees/tier2-sso` |

</details>
