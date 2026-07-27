# Live validation results — the agents/auth re-cut

Run date: 2026-07-27. Base: `15098c21a` (main, VERSION 0.3.50), containing #1547,
#1548, #1551, #1552, #1553, #1556, #1558. Worktree:
`~/proliferate-worktrees/live-validation`, branch `agents/live-validation-runbook`.

Per the runbook, only the LIVE column was attempted; the sandbox-provable suites
were not re-run.

## The matrix

| # | Item | Verdict |
|---|------|---------|
| 1 | D4-live — org-only billing vs real LiteLLM staging | **PASS** |
| 2 | D6-live echo — the migration vs staging | **PASS** |
| 3a | D5 — unfunded fails closed (hand-driven, live) | **PASS** |
| 3b | D5/D4 release-scenario half — T3-BILL-4 | **BLOCKED** (staging runs 0.3.48, pre-re-cut) |
| 3c | C7 — grace/fails-closed, server half | **PASS** |
| 3d | C7 — release-scenario half | **SKIPPED** (T3-ONBOARD-1 is `deferred` in the manifest; hand-driven instead) |
| 4a | E2B — cloud delivery (state.json + ack) | **PASS** |
| 4b | E2B — composed observation upload | **BLOCKED** (sandbox runtime predates the re-cut) |
| 4c | E2B — AWAKE-sandbox observation lag | **CONFIRMED** (known/ruled, not filed) |
| 5a | A5 — typed keys, write gate + render (server half) | **PASS** |
| 5b | A5 — typed keys, runtime launch half | **BLOCKED** (no runtime binary; see §Blockers) |
| 5c | Bedrock live completion | **BLOCKED** (no dedicated Bedrock automation principal) |
| 5d | Azure × opencode live completion | **PASS** |
| 5e | Foundry (azure × claude) | **SKIPPED** (registry-`pending` by design; left pending) |
| 6 | Desktop QA | **HANDED OFF** — `DESKTOP-QA-CHECKLIST.md` |

Proof IDs closed live: **D4(live), D5, D6(live echo), C7(server half), A5(server
half), and B's cloud-copy delivery half**. Not closed: C7's release half, A5's
runtime half, B's observation-upload half, the Bedrock cell.

The one cause behind every remaining gap is that **no runtime binary containing
the re-cut exists yet** — not locally (Jul 4) and not in the E2B template
(Jul 26, with no composed-snapshot writer). Everything that does not need the
runtime is green.

## 1. D4-live — PASS

Fresh signup against staging LiteLLM produced exactly the contracted shape: team
alias `org-<org-uuid>`, LiteLLM user `org-<org>-user-<user-uuid>` (per-(org,
member), not the bare `user-<uuid>`), and exactly 4 harness keys —
claude/codex/opencode/grok, cursor absent — each key's `models` naming only its
own access group. Team `max_budget` mirrored the $5 free grant.

Attribution reconciles exactly. Five imported spend rows all resolved to the
right (user, org, harness) with `subject_kind=organization` and a billing
subject; `litellm_team_id` matched the enrollment. Team aggregate: proxy raw
spend `0.0005106` vs ledger implied raw `0.00051060` under the 15% importer
margin — equal to 8 decimals. **Zero** `needs_review` rows belonged to our
enrollments. (The 372 unresolved rows on the proxy are other sessions' keys on
shared staging; the importer correctly records rather than drops them, which is
the `needs_review` lane behaving as specified.)

## 2. D6-live echo — PASS

Seeded the genuine pre-D shape on staging: user `d99db06b-…`, personal
enrollment `e360d14e…`, old team `6e0defab…`, 4 old keys with
`vk-user-<uuid>-<harness>-<enr8>` aliases, and proved the old claude key
completed live first ("PRED6").

Backfill was run twice: **TICK1 = 1, TICK2 = 0** — the second pass is a genuine
no-op. Post-state: personal row revoked-not-deleted; org row
`org-39d58f28-…-user-d99db06b-…`; 4 fresh keys + 4 revoked; **exactly one** $5
`free_signup` grant, now on the org subject; allocation moved; **zero** grants or
allocations left on personal; all 4 old keys **404** on the proxy and the old key
**401** on a real completion; new team `max_budget=5.0`; the resolver lands on
the org enrollment; the new key completes live ("POSTD6").

## 3. D5 and C7

**3a. D5 — PASS, full live cycle.** A synthetic debit drained the org → importer
reported `exhausted_subjects=1`, `budget_status=exhausted`, the key returned
**401 "Key is blocked"**, and the renderer withheld material (`sources: []`).
Then a top-up grant → `reactivate_subject_if_credited=1`, `budget_status=ok`,
balance 2.5, material returned, and **the same key completed live again**
("REACTIVATED"). That is "unfunded fails closed" and its reversal, end to end.

**3b. T3-BILL-4 — rewired, then BLOCKED on the deployment.** The rewire is
committed at `addd8877e` and typechecks clean (`tsc --noEmit` exit 0,
`check_max_lines.py` pass). It replaces the personal-subject free-grant assertion
with a positive on the default org's subject plus an org-scoped-enrollment
assertion, and adds a negative on personal LLM credit.

It cannot be green on staging, because **staging is not running the re-cut**:
`staging-app.proliferate.com/api/health` reports `0.3.48`, which is the
2026-07-25 release commit `38390cb1e`, and #1551's commit is not an ancestor of
it. The deployed server's durable-bot enrollment still reads
`{"subjectKind":"user", …}` — the exact pre-D shape #1551 removes. Re-run once
staging carries ≥0.3.50. Filed on #1551.

Two stale staging fixtures found on the way, both in
`~/.proliferate-local/dev/release-e2e.env`: `RELEASE_E2E_DURABLE_ORG_ID` 404s
(the bot's real org is `aded64b4-f3e4-49b3-85a0-efd5ffcb0460`), and
`RELEASE_E2E_SERVER_URL` points at localhost, so `--lane staging` needs it
overridden — the lane flag does not redirect the URL.

**3c. C7 server half — PASS.** With `AGENT_GATEWAY_LITELLM_BASE_URL` pointed at a
dead port, signup completed in **102 ms**; the enrollment row went
`sync_status=failed` / `last_error_code=litellm_request_failed` without raising;
`/capabilities` returned HTTP 200 with `enrollmentStatus:"failed"`; the
selections PUT returned 200 with `applied:false`; and the state doc rendered
`{"version":2,…,"harnesses":[{"harness_kind":"claude","sources":[]}]}`. Fails
closed, no error surface anywhere. What remains is whether the *card* behaves —
that is item 7 of the desktop checklist.

**3d. C7 release half — SKIPPED.** There is no scenario to run:
`T3-ONBOARD-1` is marked `deferred` in
`specs/developing/testing/core-release-scenario-manifest.json`. Hand-driven
instead, as 3c.

## 4. E2B — cloud delivery + composed observation

Sandbox `inc8wykyzzrz7y4161h67` (row `36208ba7`), reached `ready` at 21:07:24,
destroyed at the end of the run.

**4a. Cloud delivery — PASS, with the ack matched byte-for-byte.** The state
document landed at `/home/user/.proliferate/anyharness/agent-auth/state.json`,
mode **600**, owner `user:user`, 583 bytes, containing exactly the selected
gateway sources (claude + codex, each with the staging gateway base URL and its
own key). The sidecar manifest at
`/home/user/.proliferate/agent-auth/state.manifest.json` is also 0600 and names
the path, revision, and fingerprint.

The pending→applied flip is a real ack, not an inferred one. The
`agent_auth_delivery_ack` row carried
`acked_revision = 1785186437904` and
`acked_fingerprint = 5d25a04e…e64a5e1`, and `GET /agent-auth/state?surface=cloud`
returned that same revision and the identical fingerprint — which is what makes
`GET selections` report `applied: true`. Cloud ack is the materialization op
completing; there is no `POST /state/ack` counterpart on this path, as specified.

**Ensure-on-switch, re-proven on an awake box.** Flipping opencode's cloud
selection to gateway returned `applied: false` (pending) immediately, the state
doc was rewritten **one second later** (21:16:53) at revision `1785187012261`
with a new fingerprint `c4a88ae6…`, still 0600, and the selection re-converged to
`applied: true` inside the first 20 s poll. The rewritten doc contains codex and
opencode but not claude — correct, because claude's cloud selection is
`enabled: false`; the delivered document tracks enabled sources, not rows.

**4b. Composed observation upload — BLOCKED, same root cause as A5's runtime
half.** No `model-snapshot.json` was ever produced, and the sandbox's runtime is
why: `/home/user/anyharness` is dated **Jul 26**, and `strings` on it finds
**zero** occurrences of `model-snapshot` while it still carries the assertion
`"schemaVersion must be exactly 1"`. That binary has no composed-snapshot writer
at all. Main's
`anyharness-lib/src/domains/agents/model_snapshot/document.rs:30` sets
`MODEL_SNAPSHOT_SCHEMA_VERSION = 2`. So the upload path cannot be exercised until
the E2B template ships a runtime built from a tree containing `15098c21a`.

What could be verified without it: the server-side read contract holds. `GET
/v1/cloud/agent-models/{harness}` takes no `authContextId` and no `surface`
(one composed observation per harness), and returned a well-formed payload for
all five harnesses — claude 25 models, codex 17, opencode 172, grok 14, cursor 33
— every one `origin: "catalog"`, `snapshotId: null`, `probedAt: null`, and **no
`entries` key**. That is the honest unverified-seed state: the catalog serving as
the read-time seed because no snapshot exists. The `schemaVersion 2` / no-`entries`
shape is fixed by the Rust type itself, whose module doc calls the per-context
`entries` map exactly the mismatch it removed.

**4c. AWAKE-sandbox observation lag — CONFIRMED, not filed.** Directly observed
in the flip above: delivery re-converged within 20 s while
`GET /agent-models/opencode` stayed at `origin: catalog` / `probedAt: null` across
120 s of polling. The awake sandbox's probe engine gets no auth-applied poke, so
the observation waits for the next wake or startup. Bounded and exactly as ruled
in agent-auth.md's gap list, so per the runbook it is recorded, not reported as a
bug. Note this run cannot distinguish "no poke" from "no snapshot writer in the
binary" as the proximate cause, since 4b means no snapshot could appear either
way — but the delivery-vs-observation asymmetry is visible regardless.

## 5. Typed keys live

**5a. Write gate and render — PASS.** The registry-driven gate admits
bedrock×claude, bedrock×codex, and azure×opencode, and refuses azure×codex with
`400 invalid_agent_auth_selection` naming "not a declared, non-pending registry
providerConfig kind". Ruling R5 is enforced: a `deployment` field → 422, as does
a missing required field.

Render is byte-exact against the spec's env list: claude gets
`CLAUDE_CODE_USE_BEDROCK=1` plus token and region; codex gets token and region
only, with no flag; opencode gets `AZURE_API_KEY` plus
`AZURE_RESOURCE_NAME=proliferate-gw-aoai`.

**5b. Runtime launch half — BLOCKED.** The only prebuilt `anyharness` on disk is
dated Jul 4 and predates the re-cut, so it cannot exercise the new render path.
Building one means a cargo build, and swap sat at 19.4–20.2 GB of 20.5–21.5 GB
with `kern.memorystatus_vm_pressure_level: 2` for the whole run. Per the machine
limits I did not start it. Needs a runtime built from a tree containing
`15098c21a`, on a machine that can afford it.

**5c. Bedrock live completion — BLOCKED on credentials.** No Bedrock bearer token
is available locally. I did not mint one on the general `pablo-cli` IAM user:
`specs/developing/operating/catalog-probe.md` requires a dedicated
budget-enforced automation principal, and minting on a founder's general-purpose
user would violate that. The Azure half below covers the typed-config path
end-to-end with a real provider.

**5d. Azure × opencode — PASS.** The credential was verified live and
independently; one incidental provider quirk, not a stack defect: the Azure model
rejects `max_tokens` and requires `max_completion_tokens`.

**5e. Foundry — SKIPPED, deliberately.** It is registry-`pending`, so the write
gate refuses it by design. Un-pending it means editing
`catalogs/agents/registry.json`, which implies the Rust rebuild ruled out above.
Left pending exactly as the runbook instructs.

One further upstream gate, not a defect: the codex live completion is blocked by
OpenAI org-verification on `gpt-5-mini`.

## Observation, filed as an asymmetry rather than a bug

On **runtime** exhaustion the team-budget mirror is not rewritten downward — it
stayed at `5.0` rather than being floored to `$0.01`. Root cause:
`integrations/litellm/client.py:144 ensure_team` returns early when a `team_id` is
supplied, so it never updates an existing team's budget, and `update_team_budget`
is called from only two places (`topups.py:293`, `migration.py:172`).

I am not filing this as a bug, for two reasons. `model-gateway.md:276-279` says
the team budget is "a backstop against importer lag, not the meter"; and the
enforcement that matters did fire — the key was disabled and returned 401. The
floor is also proven live at creation time. The asymmetry is worth a sanity-check
by whoever owns the mechanism, since the two enforcement paths differ by
construction. Filed on #1551.

The **AWAKE-sandbox observation lag** was confirmed to exist and to be bounded,
and per the runbook is recorded as the known ruled gap, not a bug.

## Blockers, restated plainly

1. **No runtime binary containing the re-cut, anywhere.** Locally the only
   prebuilt `anyharness` is dated Jul 4; the E2B template's is dated Jul 26 and
   has no composed-snapshot writer at all (zero `model-snapshot` strings, still
   asserting `schemaVersion must be exactly 1`). This single cause blocks both
   A5's launch half and E2B's observation-upload half. Resolving it requires a
   cargo build this machine could not safely run, plus an E2B template rebuild.
2. **Staging is a pre-re-cut deployment (0.3.48).** Blocks the T3-BILL-4 harness
   half regardless of the rewire.
3. **No Bedrock automation principal.** Blocks the Bedrock live completion.
4. **Harness code still requires the pre-D `user-<uuid>` identity** in three
   places outside T3-BILL-4 — `tests/intent/stack/billing-usage-import.ts:295`,
   `worlds/managed-cloud/actor-enrollment-custody.ts:75,206-213`, and
   `worlds/selfhost/gateway.ts:538`. Each is another workstream's frozen
   contract, so they are reported, not rewritten. Filed on #1551.

## Uncleaned staging resources

**None.** All five LiteLLM teams minted by this run are deleted, with every key
and every `org-<org>-user-<user>` / `user-<uuid>` identity they owned:
`886ddc64…`, `3535c4ea…`, `6e0defab…`, `bd0d205b…`, `c8060671…` — each
re-queried afterward and confirmed gone. (My first pass identified only four; a
fifth, `bd0d205b…`, surfaced from the enrollment table and was cleaned too.)
The E2B sandbox `inc8wykyzzrz7y4161h67` is destroyed and confirmed unreachable.

## Filed PR comments

- #1551 — D4/D6/D5 evidence and the team-budget asymmetry
  (`issuecomment-5096752811`, since corrected for the cleanup claim); the
  staging-deployment blocker (`-5096848290`); the three harness blockers plus the
  `scenarios.md:720-723` spec contradiction and the `ownerScope=personal`
  boundary question (`-5096852974`).
- #1558 — typed-key write-gate and render evidence (`issuecomment-5096757219`).
- #1553 — delivery / fails-closed evidence (`issuecomment-5096760290`); the E2B
  cloud-delivery PASS with the byte-exact ack (`-5096949985`).
- #1552 — the E2B observation-upload blocker with the `strings`-level root cause,
  the five-harness read-contract table, and the confirmed AWAKE lag
  (`-5096971006`).

## What is not merged

Nothing was merged. The rewire sits committed on
`agents/live-validation-runbook` at `addd8877e`, pushed and ready for Pablo's
review; this report and the desktop checklist follow it on the same branch.
