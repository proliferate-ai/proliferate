# Scenario Definitions

Status: DRAFT for Pablo's ruling. Once blessed, this is the contract the test
agents implement against — a scenario's steps and assertions define what
"works" means for its registry row in `flows.md`. Grounded in a code survey
2026-07-07; endpoints/tables cited are as-built, not aspirational.

Conventions:
- Every tier-2 scenario runs against the stack-boot fixture: seeded Postgres,
  server + desktop web build (`pnpm dev` on `PROLIFERATE_WEB_PORT`) driven by
  Playwright. Desktop-web fallback behavior applies: auth persists to
  localStorage; `open_external` becomes `window.open` (handle popups).
- **Do not touch** flows routed through `lib/access/tauri/credentials.ts`
  (env-var secret storage, `restartRuntime`) in tier 2 — no web fallback
  exists; they throw outside Tauri.
- Seeding uses the layer-B auth story (`SINGLE_ORG_MODE` where noted,
  password accounts) per `specs/developing/local/feature-worktree-auth.md`.
- IDs in brackets map to `flows.md` rows.

---

## Tier 2 — auth

### T2-AUTH-1: setup claim + password login lifecycle
Preconditions: fresh DB, `SINGLE_ORG_MODE=true`.
Steps: visit `/setup` → claim instance, set password → logout → log back in
via `POST /auth/web/password/login` through the UI.
Assert: claim succeeds once; re-visiting `/setup` shows already-claimed;
post-login the app shell renders with the seeded user.
Negatives: wrong password rejected; second claim attempt rejected.

### T2-AUTH-2: session revocation
Steps: log in in context A; revoke the session (settings UI or API); context A
performs any authenticated call.
Assert: the call fails and the UI returns to signed-out state.

### T2-AUTH-3: SSO OIDC round-trip (mock IdP)
Preconditions: mock OIDC container (e.g. dex) running; org admin creates an
`sso_connection` (scope `organization`, protocol `oidc`, `jit_policy:
create_member`, `default_role: member`) via
`POST /organizations/{id}/sso/connections` → `.../enable`.
Note (survey): SSO config is **admin-role gated only — no plan/billing gate
exists in code**. No Stripe precondition.
Steps: signed-out browser → `GET /sso/discover` path via the login UI →
`POST /web/sso/start` → mock IdP auto-approves identity
`newuser@allowed.test` → callback.
Assert: `sso_identity` row created; user lands signed-in; membership created
with `default_role`; re-login with the same identity reuses the user (no dup).
Negatives: identity with email on a non-configured domain → discover finds no
connection; `jit_policy: disabled` + unknown user → enumerated error, not 500;
tampered `state` on callback → rejected.

### T2-AUTH-4: login-method availability seam
Assert: with Google/GitHub client env unset, `provider_enabled()` hides those
buttons; with env set, buttons render. (Real Google/GitHub round-trips are
tier 3 — their endpoints are not overridable, so they cannot be mocked
without product changes we are not making.)

---

## Tier 2 — organization

### T2-ORG-1: roles and gating
Preconditions: org with one `owner`, one `admin`, one `member` (seeded
password accounts).
Steps/Assert, per role via UI:
- member cannot see admin settings surfaces; direct API call to an
  admin endpoint (e.g. list invitations) → 403.
- admin can invite `member`/`admin` but **not** `owner`
  (`required_roles_for_invitation_role`); owner can invite owner.
- promote member→admin via membership update; the promoted user gains admin
  surfaces without re-login (or after refresh — assert whichever the product
  does, then pin it).
- remove a member → their next authenticated org-scoped call fails; membership
  row status `removed`.

### T2-INV-1: invitation happy path
Survey fact that shapes this test: **there is no secret invite token — the
invitation UUID is the reference, and acceptance is authorized by the
authenticated user's email matching `invitation.email`** (normalized). Email
delivery via Resend is skipped locally and recorded as
`delivery_status=skipped`. So: no email capture needed; drive accept through
the product's own path.
Steps: admin invites `invitee@test.local` (role member) → assert invitation
row `pending`, `delivery_status` ∈ {sent, skipped} → log in as
`invitee@test.local` (seeded password account) → desktop-web settings shows
the pending invitation (`GET /organizations/invitations/current`) → accept via
the UI (`POST /organizations/invitations/current/{id}/accept`).
Assert: membership `active` with invited role; invitation `accepted` with
`accepted_by_user_id`; org appears in the invitee's org list.
Negatives (each its own case):
- expired: seed `expires_at` in the past → accept → enumerated error; list
  endpoint lazily marks `expired`.
- revoked: admin revokes → accept fails.
- wrong email: login as `other@test.local` → invitation not listed; direct
  accept call with the known UUID → rejected (email mismatch).
- duplicate invite for same (org, email) is NOT rejected: re-inviting rotates
  — `create_or_rotate_organization_invitation` expires the old pending row
  (`status=expired`) and inserts a fresh pending row (new id, new
  `expires_at`) inside one transaction. Assert: accept with the **old**
  invitation id → `invalid_invitation` (enumerated error, same as expired);
  accept with the **new** id → succeeds normally with invited role.

### T2-INV-2: single-org register-via-invite path
Preconditions: `SINGLE_ORG_MODE=true`.
Steps: create invite → build `/register?token={invitation_id}&email=...`
(the URL the email would carry) → open signed-out → complete
`POST /password/register`.
Assert: account created AND membership active in one flow.

Deferred, named: the hosted `/join/{org_id}` deep-link page hands off to the
OS protocol handler (`proliferate://`). Web-mode testing would use the
dev-handoff polling fallback; this is a tier-3/nightly concern, not tier 2.

---

## Tier 2 — secrets (CRUD + seam)

### T2-SEC-1: secrets CRUD, all three scopes
Steps: via UI (and API assertions underneath): set/update/delete a personal
env-var secret (`PUT /secrets/personal/env-vars/{name}`), an org env-var
secret, a workspace env-var secret, and a personal file secret (text upload).
Assert: values never echoed back in list responses; `version` bumps on PUT;
`materialization.status` transitions to `pending` (the seam — actual
materialization is tier 3); binary file upload rejected with
`invalid_secret_file_upload`.
Negatives: member setting org-scope secret → 403.

---

## Tier 2 — integrations (connect + toggle, faked provider)

### T2-INT-1: api_key connect + org policy toggle
Preconditions: a stub MCP integration definition seeded (api_key kind) —
this reuses the tier-2 stub-server slot, not a real provider.
Steps: user connects via `POST /integrations/authentications`
(authKind api_key) → account created. Org admin toggles
`PATCH /integrations/admin/organizations/{id}/definitions/{id}/enabled` off.
Assert: `effective_enabled` reflects all three layers (org policy override >
definition default, AND account enabled) — assert the composed value the UI
shows, off then on again.
Negatives: OAuth-kind connect is asserted only to the seam: flow row created,
`authorizationUrl` returned (no real provider round-trip in tier 2).

---

## Tier 2 — workspaces (to the seam)

### T2-WS-1: cloud workspace create request path
Preconditions: repo environment configured (else the API correctly returns
`cloud_repo_environment_not_found` — that's a negative case).
Steps: drive Add-Repo flow → cloud kind → `POST /cloud/workspaces`.
Assert (the seam, per `use-create-cloud-workspace.ts`): 200 with workspace id,
status `pending|materializing`; UI enters `awaiting-cloud-ready` pending-entry
state. **Stop here.** No sandbox, no readiness wait.
Negatives: no repo environment → enumerated error surfaced in UI; billing
block (see T2-BILL-2) → blocked message, no workspace row.

### T2-WS-2: local + worktree create (desktop-web limits apply)
Local/worktree creation drive the local AnyHarness runtime and OS file
pickers — partially Tauri-bound. Tier 2 asserts only what web mode can reach:
the Add-Repo flow branches (`add-repo-flow-store.ts`) render and validate
inputs. Full local/worktree creation is asserted in tier 3's desktop lane.
[If this proves too thin, the fallback is a runtime-API-level test against a
locally booted anyharness — decide when building.]

---

## Tier 2 — billing

Expanded 2026-07-08 after a full billing-surface survey (Pablo: "billing is
the thing I'm least confident in — every scenario must be tested"). All
tier-2 billing runs on Stripe **test mode** (`sk_test_`) + webhook forwarding
+ test clocks per `specs/developing/local/stripe-local-testing.md` — real
Stripe, not a mock. Two independent config axes define the matrix and both
branches of each must be covered where marked: `CLOUD_BILLING_MODE`
(`off|observe|enforce`) and `PRO_BILLING_ENABLED` (pro plans vs legacy flat).
Survey correction baked in: `authorize_sandbox_start` is **dead code** — the
live start gate is `assert_cloud_sandbox_resume_allowed` on the resume/connect
path (`server/proliferate/server/billing/authorization.py:193`); assert
against that, never the dead function.

### T2-BILL-1: checkout → grants → consumption → cut-off → reactivate
The core loop, per the manual pass verified 2026-07-04 on the `billing`
profile, now automated: checkout completes → subscription synced, plan
reflects paid; `invoice.paid` issues the period grant (`pro_period` hours =
seats, or `cloud_monthly` on legacy); drive credits to zero via test clock +
seeded usage segments.
Assert: resume/connect blocked with the enumerated decision
(`CloudSandboxResumeBlockedError`, 402) and the UI shows the
credits-exhausted blocked state (`WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED`
via `start_block_reason`); refill (legacy: `refill_10h` checkout; pro: top-up
grant) → resume allowed again. Grant consumption **order** asserted: grants
drain earliest-expiring-first within type priority
(`ordered_accounting_grants`).

### T2-BILL-2: plan limits + policy gates
Assert: free-plan repo limit enforced (`repo_limit_for_billing_snapshot` →
`repo_limit_exceeded` on scheduling past the cap); agent-gateway policy edit
gated by `agent_gateway_policy_min_plan` (`org_agent_policy_plan_required`,
403, on a free org when min plan is `pro`).
Survey flag for the registry row "plan gates the model list": **no
plan-conditioned model list exists in code today.** Row stays in `flows.md`
only if that behavior is planned product work; otherwise it should be
deleted. [PABLO TO RULE]

### T2-BILL-3: seats — invite/remove/re-invite on a Pro org
Pro billing is seat-based; every membership change must reconcile Stripe seat
quantity and grants (`maybe_create_organization_seat_adjustment` →
`process_pending_seat_adjustments`).
Steps/Assert on a Pro-subscribed org with a test clock:
- invite + accept a member → `BillingSeatAdjustment` row created; Stripe
  subscription-item quantity bumped; a prorated `pro_seat_proration` grant
  issued (capped +1 seat per adjustment).
- remove the member → quantity synced down; **no** refund/grant issued.
- re-invite + accept the **same** member within the same billing period →
  quantity back up, but **no second proration grant** (the same-period
  decrease marker suppresses it — the double-grant race is the risk).
- adjustment retry: simulate a failing Stripe call → retries up to 3 then
  `failed_terminal`; a subsequent adjustment still converges quantity.
- negative: same flows on a free org and with `PRO_BILLING_ENABLED=false` →
  billing untouched (no adjustment rows).

### T2-BILL-4: team checkout — the second, independent org-creation path
`team_checkout` (create a brand-new org gated on checkout) has its own
activation/failure state machine, separate from adding billing to an existing
org — test it separately.
Steps: create team checkout session → org exists as `pending_checkout` (not
joinable); complete checkout in Stripe test mode → `checkout.session.completed`
webhook with `purpose=team_subscription` activates the org, staged invites
send, gateway enrollment scheduled.
Negatives: subscription not `active|trialing` at webhook time → intent
`failed_billing_state`, org never activates; expired (24h) intent → same
terminal, no orphan active org; replayed activation webhook → idempotent.

### T2-BILL-5: compute overage — bill up to cap, write off past it, then block
On a subject with `overage_enabled` and a per-seat cap: exhaust grants, keep
consuming.
Assert: uncovered seconds convert to cents and export as Stripe metered usage
events (`BillingUsageExport` billable rows) — sandbox **not** paused while
under cap; fractional-cent remainder carried (`BillingOverageRemainder`);
once `cap_used_cents` ≥ cap → further usage written off
(`writeoff_reason='overage_cap_exhausted'`) and snapshot flips to
`cap_exhausted` → hard-blocked. Overage settings API: cap validation
(`invalid_overage_cap` outside 0..1,000,000).
Negative: `overage_enabled=false` → cutoff is immediate at grant exhaustion,
zero export rows.

### T2-BILL-6: LLM credits — exhaustion, admin caps, top-ups (incl. failure)
Three distinct gate states that must not bleed into each other:
- **exhaustion**: drive `remaining_usd` ≤ 0 on a granted subject → virtual key
  disabled, `budget_status='exhausted'`; top-up grant → key reactivated.
- **admin cap** (`billing_budget_limit` kind=`llm`, org-wide and per-user
  independently): over cap → `budget_status='limit_reached'`; credit refill
  does **not** clear it (deliberate); raising/disabling the cap does, even
  with zero new spend (the quiet-tick sweep).
- **auto top-up overage**: overage-enabled subject drops below threshold →
  one-off Stripe invoice item charged, `topup` grant issued, exactly one
  top-up per tick. **Failure path is mandatory**: declined test card / no
  Stripe customer / `agent_gateway_llm_topup_price_id` unset → fail-closed:
  key disabled at zero like a capped org (the "overage promise quietly
  evaporates" risk).
Also assert `is_gateway_budget_available` flips correctly for launch gating.

### T2-BILL-7: webhook robustness — idempotency, replay, ordering
Against the Stripe webhook receiver (`claim_webhook_event` semantics):
- exact duplicate delivery of a processed event → silent ack, no double grant
  (assert grant count unchanged after replaying `invoice.paid`).
- concurrent duplicate while first is in-flight → `409 stripe_webhook_in_progress`.
- handler exception → receipt `failed`, retry (redelivery) succeeds and
  processes exactly once.
- out-of-order: deliver `invoice.paid` before `customer.subscription.updated`
  for the same subscription → grants still issued safely, final state
  converges.
- Slack billing notifications fire exactly once per real transition, not on
  replays.

### T2-BILL-8: subscription edge states
- payment failure: `invoice.payment_failed` → hold applied; resume blocked
  with the payment-failed decision; `invoice.paid` clears the hold.
- cancellation mid-period: `cancel_at_period_end=true` synced; access
  continues through period end; 24h rollover grace honored after
  `current_period_end`; then hard cutoff.
- `customer.subscription.deleted` after a **clean voluntary cancellation**:
  pin the CURRENT behavior (unconditional `payment_failed` hold — survey
  2026-07-08 confirmed the reason-sensitive refinement was never shipped) as
  an expected-fail/known-bug test until the product fix lands. [FILED AS
  FINDING — Pablo to rule fix-now vs post-release.]
- billing modes: `CLOUD_BILLING_MODE=off` → all enforcement inert, product
  fully usable; `observe` → accounting/exports happen, nothing ever blocked;
  `enforce` → gates live. One smoke per mode.
- free trial: `free_trial_v2` granted lazily on snapshot for a GitHub-linked
  account, exactly once per GitHub identity ever (constant period key);
  account without GitHub identity → **no trial, no error** (pin current
  silent behavior; UX finding noted).

### T2-BILL-9: usage surfaces tell the truth
Seed known usage (segments + LLM events with fixed amounts) → assert
`/billing/usage/summary`, `/billing/usage/timeseries`,
`/organizations/{id}/usage/by-user`, and `/billing/llm-balance` return exactly
the seeded totals, attributed to the right users; sidebar consumption card and
Usage & Limits pane render those numbers (Playwright).

---

## Tier 2 — workflows (to the seam)

### T2-WF-1: definition lifecycle + run-to-delivery-seam
Steps: create workflow in editor (steps incl. one invalid ref to assert live
validation) → save version → trigger manually with args.
Assert: `workflow_run` row created, status `pending_delivery`,
`resolved_plan_json` populated with interpolated args; local-lane delivery
attempt recorded. **Stop at the seam** — no runtime execution.

### T2-WF-2: poll trigger against stub feed
The PR-B validation script (workflows-architecture §10) productionized:
replaying stub feed with one schema-invalid item.
Assert: exactly one `workflow_trigger_item` per unique id (`spawned`), the
invalid item recorded `invalid` with the schema error, cursor persisted,
`last_poll_error` null; stub killed → `last_poll_error` populated, trigger
stays enabled.

---

## Tier 3 — first wave (release-critical)

Conventions: the runner points a desktop at the target server by writing
`{"apiBaseUrl": "<staging>"}` into the profile's `~/.proliferate` config file
before launch (the supported runtime override — resolution order in
`apps/desktop/src/lib/infra/proliferate-api.ts`; read once at boot, relaunch
to apply). The web-port lane uses `VITE_PROLIFERATE_API_BASE_URL` instead.
Tests never drive a server-picker UI to configure themselves, even after the
sign-in-screen server entry (self-hosting-v1 §3.5, B4-desktop) ships.

### T3-FIXTURE: shared identity + lanes (infrastructure, not a test)
Two identities the runner mints/uses, so no scenario reimplements auth:
- **fresh user**: created per run (registration API), used by new-user
  scenarios, torn down after.
- **durable user**: one seeded `e2e-tests` account/org on the target server,
  used by existing-user scenarios; its sandbox intentionally persists between
  runs.
Two lanes every agent/workspace scenario runs in, unless marked otherwise:
- **local lane**: desktop (web-port mode) + local AnyHarness runtime.
- **sandbox lane**: cloud workspace on real E2B.

Identity per target (ruled 2026-07-08): the **fresh user** is mintable only
where a registration API exists — the local/self-hosted target. On staging
(hosted, OAuth-only signup) there is deliberately no test-only registration
escape hatch; fresh-user cold-path scenarios run fully on the local target
(still a real from-zero E2B provision), and staging approximates cold with
"fresh workspace for the durable user."

GitHub fixture: a dedicated test GitHub org with the Proliferate GitHub App
installed once, durably (dev app for local, staging app for staging).
Scenarios use repos the installation already covers; the install/OAuth dance
itself is not automated (real-provider-handshake posture: add on first
production break).

### T3-PROV-1: provision — new user (cold path)
As the **fresh user**: first-ever cloud workspace → personal sandbox created
from zero (enrollment, worker boot, materialization).
Assert: `ready` within [BUDGET — Pablo to set; suggest p95 ≤ 5 min fail,
warn at 3]; connect and run one shell command.
Trigger under test (ruled 2026-07-08): the personal sandbox is created by the
**GitHub App authorization callback**
(`complete_github_app_user_authorization_callback` →
`ensure_personal_cloud_sandbox_exists` + `schedule_materialize_sandbox`), with
`ensure_personal_cloud_sandbox_exists` also reachable via repo-add and secret
materialization. The cold path must be exercised **through the GitHub App
auth path, not by calling the sandbox service directly** — no mock: the test
GitHub org has the App pre-installed, and the fresh user completes real App
authorization against it. If driving the real GitHub authorize redirect
headlessly proves infeasible, the fallback seam is invoking the
post-authorization service call the callback makes — never a faked GitHub.

### T3-PROV-2: access — existing user (warm path)
As the **durable user**, whose sandbox already exists: reopen the workspace;
pause → `paused` (and inaccessible); resume → `running`; connect again.
Assert: wake within budget; prior workspace state intact. New-user and
existing-user paths fail differently — both must be green.

### T3-WT-1: worktree workspaces, both lanes
Create a worktree workspace locally (off a local repo) AND inside a cloud
sandbox (off the sandbox's repo checkout). Assert: worktree created on the
right base branch, session opens in it, edits isolated from the base tree.
Budget (ruled 2026-07-08): on an already-running sandbox, worktree creation
completes in **≤ 1 s** measured at the runtime operation (sandbox wake time,
if any, is T3-PROV-2's budget, not this one).

### T3-CHAT-1: every harness × its cheapest model, via the gateway
For **each cataloged harness**, in **both lanes**, using the harness's
cheapest model served through the gateway (dedicated test key; model set
below): create session, send one message, await turn end.
Assert (outcomes, not transcripts):
- non-empty assistant reply arrives;
- **installed harness CLI version == catalog pin, asserted before the chat**
  (local runtime home and inside the sandbox — "right harness, right
  version" is its own assertion, not implied by the chat working);
- session persists and reopens.
Per-harness failure = per-harness red (feeds the catalog-bump gate), not
whole-suite red.

Gateway test-model set — one cheapest model per provider family the harnesses
need, pinned in the test key's allowlist (exact IDs resolved against the
catalog at build time):
- Anthropic: Haiku-class (Claude Code; also OpenCode's default lane)
- OpenAI: the cheapest Codex-supported tier (Codex)
- Google: Flash-class (Gemini CLI)
- xAI: the cheap code tier (Grok, if cataloged for the release)
- One OSS/aggregator lane if OpenCode is asserted beyond Anthropic (e.g. GLM)
Everything flows through the gateway — no direct provider keys in scenarios.
Same env var names locally and in CI (`env-vars.yaml`), keys in GH Actions
secrets and the local credentials file respectively.

### T3-UPDATE-1: harness convergence, both lanes (pre-verification of tier 4)
The catalog-convergence chain (tier-4 registry rows) is asserted in both
lanes as part of this wave, not deferred: bump the served catalog version on
the target server → heartbeat → worker pushes catalog → runtime reconciles →
**agent CLI reinstalled at the new pin**, verified in the sandbox AND on the
desktop-local runtime. This is the "they update the way we described, not
just locally but in the sandbox" requirement.

### T3-CFG-1: live config options apply in an existing session
Added 2026-07-08 (Pablo: "occasionally this breaks"). In an **existing** chat
session (not a fresh one), per harness: enumerate the harness's exposed
configuration options from the catalog/harness contract and cycle each one —
every selectable model (switch → send a message → the reply is attributed to
the switched model), every mode/approval-policy-style enum (switch → the
session accepts it and behaves accordingly, asserted at the harness-contract
level, e.g. the option readback/state event — not by interpreting prose).
Assert: each option value round-trips (set → readback matches) and the session
survives every switch. Options are **enumerated from the catalog at build
time, never hardcoded**, so a new option is automatically in scope.
Per-harness × per-option red. Runs in the local lane by default (cheap);
sandbox lane on the release train.

### T3-SEC-MAT-1: secrets materialize
Steps: set personal + org env-var secret and a workspace file secret → create
a fresh cloud workspace → poll `materialization.status` to `ready`.
Budget (ruled 2026-07-08): on an already-running sandbox, a secret PUT reaches
`ready` and the sandbox file is updated within **≤ 60 s** ("roughly
immediate"); adjust with evidence if the mechanism is legitimately slower.
Assert in-sandbox: `{PROLIFERATE_HOME}/secrets/global.env` contains both
merged env vars (org secrets materialize into **each member's personal
sandbox** — that's the mechanism, assert it as such);
`{repo}/.proliferate/env/workspace.env` present; manifest sha256s match.
Update propagation: PUT a new value → status returns to `pending` → `ready` →
sandbox file updated.

### T3-INT-1: real integration through the gateway — every harness, both lanes
Steps: connect one real low-stakes integration (test Slack workspace) once;
then for **each cataloged harness, in both lanes** (piggybacking T3-CHAT-1's
session matrix): the agent session calls a tool through the integrations
gateway.
Assert: tool call succeeds per harness × lane (per-harness red, like
T3-CHAT-1); audit row written; org-policy toggle off → same call returns
enumerated scope/policy error (toggle asserted once, not per harness).

### T3-REPO-1: repo settings take effect — both lanes
Steps: configure default branch + environment vars/scripts on the repo
environment → fresh workspace, **locally AND in a cloud sandbox** (ruled
2026-07-08: setup scripts are a local mechanism too, not sandbox-only).
Assert, per lane: checkout is on the configured branch; setup/env script ran
(marker file); env vars present in session shell.

### T3-BILL-1: real consumption is metered — LLM and compute
Added 2026-07-08. As the durable user, run a real agent session (reuse a
T3-CHAT-1 run) and keep a sandbox running for a known interval.
Assert, against the billing surfaces (usage UI/API + underlying meter
records): (a) **LLM consumption** — the session produced
`agent_llm_usage_event` rows whose tokens/cost match the gateway's recorded
usage for the test key, and the credit balance decremented accordingly;
(b) **compute consumption** — sandbox runtime for the interval produced a
closed `usage_segment` (opened/closed by the E2B webhooks, not a timer) and
the accounting pass drained the corresponding grant seconds. Both sides must
attribute to the right org/user — note the known attribution gap: compute
segments bill the workspace owner's **personal** subject; LLM events bill the
**org** subject where enrolled. Assert current behavior as-built; the org
compute-attribution fix has its own finding. Staging lane additionally
asserts the Stripe webhook path is live: meter events delivered (no
stuck/undelivered webhook backlog for the test org).

### T3-BILL-2: exhaustion gates — compute and LLM independently, no bypasses
Drive the test org's credits to exhaustion (smallest real mechanism available;
test-clock/grant manipulation is allowed as *setup*, but the enforcement under
test is real).
Assert, compute side: running sandbox is **paused** and inaccessible; new
cloud sandbox/workspace creation is blocked with the enumerated
credits-exhausted kind. Assert, LLM side: gateway rejects the test key's
completion call with the enumerated budget error; live session surfaces it as
an enumerated error, not a hang.
**Bypass sweep (added 2026-07-08 — "they definitely can't access things after
money bites, no matter what"):** while exhausted, attempt every alternate
entry we know exists and assert each is refused, not just the front door:
- resume the paused sandbox via direct API call (not UI);
- reconnect via a session opened **before** exhaustion (stale handle);
- the E2B-webhook race: force a `created`/`resumed` provider event while the
  spend hold is active → inline re-pause fires (webhook path, not just the
  15-min reconciler);
- LLM via a **pre-exhaustion materialized key** still on the sandbox disk —
  the disabled-key propagation must beat it (re-materialization path);
- start a workspace as a **different member of the same exhausted org**;
- trigger-driven work (workflow/automation) that would start a sandbox.
Then refill → sandbox resumable, gateway serves again, new workspaces allowed.
(Tier-2 T2-BILL-1 proves this logic against Stripe test clocks per-PR; this
scenario proves the **deployed** enforcement chain end-to-end on real
infrastructure.)

### T3-BILL-3: overage bills real money correctly (staging lane)
Added 2026-07-08 — overage is the highest-stakes billing path (it charges
cards) and was tier-2-only. On the staging test org with `overage_enabled`
and a small per-seat cap:
- **compute**: exhaust grants, keep a sandbox running → metered usage events
  arrive in Stripe (test mode) for the overage price, sandbox stays UP while
  under cap; cross the cap → hard block flips on (`cap_exhausted`), further
  usage written off, no more billing.
- **LLM**: drop below the top-up threshold → exactly one auto top-up invoice
  item charged in Stripe, `topup` grant appears, key stays live. Then disable
  the payment method → next threshold crossing fail-closes (key disabled),
  no silent free usage and no repeated failed charges.
Assert amounts end-to-end: seconds consumed → cents exported → Stripe event
totals match (the fractional-cent remainder logic is under test here too).

---

## Open rulings collected

1. "Plan gates the model list" — not in code; keep as planned work or delete
   the row (T2-BILL-2).
2. T3-PROV-1 time budget number.
3. T2-WS-2: is seam-only coverage of local/worktree create acceptable for
   tier 2, with full coverage in tier 3's desktop lane?
4. Google OAuth stays tier-3-only (mock not feasible without product change)
   — confirm.

## Product findings from the billing survey (2026-07-08) — rule before fixing

Confirmed against code; each needs a Pablo ruling (fix pre-release vs pin
current behavior as known-bug expected-fail):

1. **Org/per-user compute budget limits never fire.** `usage_segment` rows
   always bill the workspace owner's *personal* billing subject
   (`billing_runtime_usage.py:55-63`), so both compute-limit enforcement
   sites resolve `organization_id=None` and bail — an admin-configured
   compute cap saves in the UI and silently does nothing. (LLM caps are
   unaffected — correctly org-attributed.)
2. **Clean voluntary cancellation gets a `payment_failed` hold.**
   `customer.subscription.deleted` applies the hold unconditionally
   (`stripe_webhooks.py:193-199`) — no reason sensitivity, so a customer who
   cancels cleanly can be spuriously blocked when Stripe deletes the record
   at period end.
3. **No-GitHub account gets no free trial and no explanation.**
   `ensure_free_trial_v2_grant` silently returns when the account has no
   linked GitHub identity — looks broken to the user. (UX severity, not
   correctness.)
