# Scenario Definitions

Status: implementation notes for the current scenario runners. The complete
normative target, required lanes, and pass/fail contract live in
[`core-release-validation.md`](core-release-validation.md). When this file
describes a smaller matrix, a blocked/expected-fail posture, or a deferred
flow, the core release contract wins. Endpoints/tables cited here are as-built
details for implementing that target.

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

### T2-AUTH-5: org SSO login entry points (PR #1048)
The user-facing ways *in* to org SSO: a slug login page (`/login`,
`/login/<slug>`), the cold-login "Sign in with SSO" affordance, and
`/join/<orgId>` web sign-in. All resolve an org **slug or id** to that org's
SSO connection via `GET /auth/sso/discover`, then hand off to the existing
start flow. This is the **entry-point seam**, distinct from the OIDC
round-trip (T2-AUTH-3): discover reads the connection's stored state and never
contacts the IdP, so the seam is fully assertable without one.
Assert (server seam, driven directly): unknown slug AND an existing org with
no SSO both return the identical generic answer (`enabled:false`,
`reason:"not_available"`, no ids) so slugs can't be cycled to enumerate orgs;
a slug (and an org id, the `/join` input) resolving to an ENABLED connection
returns exactly the start ids (`organizationId`, `connectionId`, `protocol`,
`displayName`). Setup seeds an enabled org-scope OIDC `sso_connection` row
directly (same spirit as the invitation-expiry direct-DB seed) since discover
never calls the IdP.
Assert (desktop web build): the `OrgSsoLoginLink` affordance on `/login`
expands to a slug field; submitting an unavailable slug (unknown, or an
existing org with no SSO) surfaces the one generic error and does not start
SSO.
Surface note: the tier-2 stack boots the **desktop web build** (`apps/desktop`),
so the `apps/web` pages (`LoginSsoPage`, the auth-screen link, `/join`) are not
rendered here; their logic sits on the same discover seam these cases pin. The
positive kickoff redirect and the full round-trip are T2-AUTH-3's.

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

## Tier 2 — integrations (connect + toggle, real definition, no outbound)

### T2-INT-1: api_key connect + org policy toggle
Ruled 2026-07-08: **no stub/fake integration provider** — same posture as
no-fake-sandbox/no-mock-LLM. Use a **real cataloged api_key-kind integration
definition**; the stored key is a placeholder value (connect/CRUD paths never
validate it against the provider). No outbound call leaves the stack in
tier 2 — the real tool call through the gateway is T3-INT-1's job.
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
via `start_block_reason`); personal legacy `refill_10h` or Pro
subscription/payment recovery → resume allowed again. Unsupported organization
or Pro refill grants nothing. Grant consumption **order** asserted: grants
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

### T2-BILL-6: managed LLM credits — exhaustion, caps, and alternate auth
Three distinct gate states that must not bleed into each other:
- **exhaustion**: drive `remaining_usd` ≤ 0 on a managed-credit subject → the
  target/selection-scoped Bifrost virtual key is disabled and
  `budget_status='exhausted'`; a supported entitlement renewal/change may
  reactivate managed access.
- **admin cap** (`billing_budget_limit` kind=`llm`, org-wide and per-user
  independently): over cap → `budget_status='limit_reached'`; credit refill
  does **not** clear it (deliberate); raising/disabling the cap does, even
  with zero new spend (the quiet-tick sweep).
- **alternate auth/spend**: BYOK remains separate from managed credit, while a
  Team upgrade creates/selects an organization entitlement rather than
  refilling the personal one. Managed credit never automatically charges or
  grants after exhaustion.
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

> Current-state registry notice (2026-07-10): this section describes the
> as-built workflow tests, including behaviors that the target architecture
> replaces. Canonical target behavior is
> [`../../codebase/features/workflows.md`](../../codebase/features/workflows.md),
> and the atomic migration/test replacement is owned by
> [`../../tbd/workflows-v1-completion-plan.md`](../../tbd/workflows-v1-completion-plan.md).
> Do not use a current green T2 row as proof that the target contract is met.

Implemented 2026-07-10 (the T2-WF program). Lives in three sibling specs:
`tests/intent/specs/workflows.spec.ts` (T2-WF-1, T2-WF-5),
`tests/intent/specs/workflows-invocations.spec.ts` (T2-WF-3, T2-WF-4),
`tests/intent/specs/workflows-triggers.spec.ts` (T2-WF-2, T2-WF-6, T2-WF-7).
Seed helpers live in `tests/intent/stack/seed-workflows.ts`; the intent stub
(`tests/intent/stack/invocation-stub.ts`) serves the poll feed + reserved
`/poll-feed/init` sample. Everything drives the product's own HTTP surface
except three documented direct-DB helpers (a GitHub-gated cloud repo
environment + materialized workspace, poll seen-set/cursor READS) and the
poller-tick driver.

Two environment facts shape the seams these hit:
- **Cloud runs stop earlier than the delivery attempt in tier-2.** A
  `personal_cloud` StartRun/poll run mints a per-run gateway token whose config
  needs `worker_cloud_base_url` (satisfied by `API_BASE_URL`); the local-lane
  run's seam is `pending_delivery` → owner-relay `/delivered` → `delivered`
  (no sandbox wake). The server-wakes-sandbox cloud delivery is tier-3.
- **Poll (and cloud-target schedule) triggers derive a server-owned cloud
  workspace from their repo pin (D16)**, which needs a cloud repo environment;
  the product create path is GitHub-App-gated and unreachable in tier-2, so the
  repo environment + a materialized workspace are seeded directly (the same
  direct-DB exception cloud-workspace.spec.ts documents).

### T2-WF-1: definition lifecycle + run-to-delivery-seam
Steps: create a workflow via the API (valid v2 definition, one declared input);
GET round-trips the canonical definition and pins version 1; update appends an
immutable version 2. Drive the EDITOR UI (desktop web build): open
`/workflows/{id}/edit`, select the step, edit its prompt to reference an
undeclared input → the header issue counter appears and Save is disabled (live
client-side validation, `@proliferate/product-domain/workflows/validation`); fix
the reference → issues clear, Save re-enables, click Save → the API reflects the
fixed prompt. Manual LOCAL StartRun with args.
Assert: `workflow_run` row created, status `pending_delivery`,
`resolved_plan_json` populated with the interpolated args (`{{inputs.*}}`
resolved into the step prompt); a missing required input is rejected at the
coercion seam (`missing_argument`, no dangling run row); the local-lane relay
`POST /runs/{id}/delivered` transitions `pending_delivery` → `delivered` (and is
idempotent). **Stop at the seam** — no runtime execution, no sandbox.

### T2-WF-2: poll trigger against stub feed
Against the intent stub's `/poll-feed` (replays the same three items: two valid
+ one schema-invalid `count`), driven by invoking the real poller tick
(`run_workflow_poller_tick`) in a server-venv process (the honest driving seam —
the poll loop's automations worker is not booted by the tier-2 stack, and there
is no HTTP endpoint for a single tick).
Assert: exactly one `workflow_trigger_item` per unique id — two `spawned`
(each with a `run_id`), the invalid item recorded `invalid` with the schema
error (`count`) and never spawned; the opaque cursor persists and advances
exactly once (NULL → `cursor-1`); a replay (trigger made due again via a
`last_poll_at` time-shift — the poll it drives is fully real) produces no
duplicate rows and no new runs (seen-set PK dedup) and leaves the cursor put;
`last_poll_error` is null through the healthy polls. Then the feed 503s → the
next tick records `last_poll_error`, keeps the cursor, spawns nothing, and the
trigger **stays enabled**.

### T2-WF-3: function-invocation CRUD
Steps/Assert on `/integrations/functions`: create an invocation
(name/endpoint_url/method/args_schema pointing at the intent stub) → workflow-only
by default (`chatScopeEnabled=false`); a malformed args_schema is rejected
(`invalid_payload`, the same jsonschema the gateway validates call args with); an
invalid name is rejected (`invalid_payload` — the name is the gateway tool
address). Headers are WRITE-ONLY: set on create → `hasHeaders=true` and no header
value ever rides create/list/rotate responses (a property of the response
schema — there is no `headers` field); rotating headers keeps them write-only;
rotating to null clears them. The reserved `functions` namespace: creating an
org-custom integration definition under it is rejected (`invalid_payload`, the
reservation check in the admin definition create path).

### T2-WF-4: organization / chat default-access enforcement
The default-access authoring seams that FEED the composed chat run-scope. Assert:
a new invocation defaults workflow-only, and `PATCH /{name}/chat-scope-enabled`
round-trips (enable for chat → visible on the list surface → disable); the
per-integration default-access mode round-trips via the admin
`default-chat-scope` endpoint (`defaultChatIncluded` true by default → author the
exclusion → restore). The COMPOSED run scope
(`build_chat_default_access_scope`: defaults → exclusions → chat-enabled
invocations → the frozen allowlist a worker grant carries) is enforced at the
integration gateway for a real worker grant — tier-3, named as not-covered here.

### T2-WF-5: StartRun binding validation + all-mutations lockout + take-over
Assert (LOCAL target, so no cloud workspace needed): binding a slot not in the
workflow is rejected (`unknown_session_binding_slot`); a run that binds a session
is a LIVE run that holds it (the run row is the durable lock), so a second
StartRun binding the same session is locked out (409 `session_binding_held`);
taking over / cancelling the first run (`POST /runs/{id}/cancel`) lands it
terminal `cancelled` with `stopped_by_user_id` stamped, and that terminal write
IS the release — a subsequent StartRun binding the same session is accepted.
Named not-covered (needs a materialized cloud workspace / runtime, tier-3):
`session_binding_wrong_workspace` (foreign-session) and the harness-mismatch
reject (by design a runtime bind-boundary error, not a server seam).

### T2-WF-6: both /init setup flows
Flow 1 (workflow-from-poll): `POST /workflows/poll/inspect` against the stub's
reserved `/init` → derived inputs returned (scalar sample fields → typed
inputs), non-scalar sample fields (an array) reported as `skippedFields`; a dead
endpoint at inspect time returns the enumerated `poll_probe_failed`. Flow 2
(poll-trigger-from-workflow field-diff): creating a poll trigger on a workflow
whose declared inputs don't match the `/init` sample is rejected
(`poll_signature_mismatch`) carrying the full field-by-field diff in
`detail.mismatches`. Also: trigger create does the first network call — a dead
endpoint at create time returns `poll_probe_failed`; fragment (`#...`) and
userinfo (`user:pass@host`) poll URLs are rejected at save (`invalid_poll_config`).

### T2-WF-7: schedule + poll trigger CRUD incl. missedRunPolicy
Assert: schedule triggers (LOCAL target — no cloud workspace needed, 2a) accept
each `missedRunPolicy` value `{run_latest, skip_all, replay_all}`, default
`run_latest` when omitted, and a PATCH of `missedRunPolicy` round-trips; an
invalid `missedRunPolicy` value is rejected at the request-model Literal (422,
before the service's defense-in-depth `invalid_missed_run_policy`). Poll trigger
1d fix: with the endpoint down, `PATCH {enabled:false}` succeeds (disabling a
broken poll trigger must never reprobe — `enabled:false` never reprobes).

---

## Self-hosting

Full narrative + tier-3/4 definitions live in
`specs/developing/testing/self-hosting.md` (the self-hosting spec of record);
the tier-1/2 scenarios that the test suite implements are indexed here.

### T1-SH-1: single-org derivation (unit)
`telemetry_mode == "self_managed"` OR `"local_dev"` ⇒ `single_org_mode` true;
`"hosted_product"` ⇒ false. `single_org_mode_override`
(`SINGLE_ORG_MODE`/`PROLIFERATE_SINGLE_ORG_MODE`) wins in both directions.
(config.py:376-379.)

### T1-SH-2: SSO env alias equivalence (unit)
Every SSO setting carries exactly the two-form alias pair, and the bare
`SSO_*` form populates the field identically to `PROLIFERATE_SSO_*`. Guards the
docs' canonical bare-form promise; a new SSO var can't ship with only one alias.

### T1-SH-3: `/meta` wire contract (unit)
Golden field names AND order on `MetaResponse` and the live JSON. `/meta` is
what the connect dialog's trust screen renders; a rename/reorder breaks every
desktop silently.

### T2-SH-1: connect + switch (NOT tier 2)
The connect affordance is Tauri-gated (`LoginScreen.tsx:117`) and never renders
in the desktop-web build; the `set_app_config` write + relaunch + credential
store throw outside Tauri. Tier-3 by ruling (self-hosting.md §4) — registered
in `flows.md` as not-yet-implemented, not faked here.

### T2-SH-2: `/setup` claim UI (extends T2-AUTH-1)
Assert the self-hosted specifics on top of the claim/login lifecycle: the
claimed user is **owner** of the one `is_instance` organization (single-org: the
org list has exactly one), and a second context hitting `/setup` after the claim
gets the permanently-closed 404 (API status AND the rendered "Not found — there
is nothing to set up here" page).

### T2-SH-3: invite → register-with-token → invitee sign-in
Admin invites (delivery `skipped` locally, no email) → invitee opens
`/register?token={invitation_id}&email=...` → sets a password → signs into the
desktop-web app. Assert: active membership with the invited role in the instance
org. Negative: a real token presented with a **mismatched email** is rejected by
the uniform 403 (`_not_invited`) and mints no account.

### T2-SH-4: adaptive sign-in
Driven purely by `GET /auth/desktop/methods` + `/auth/desktop/github/availability`.
No GitHub OAuth env (this stack) ⇒ real password-only surface, no GitHub button.
GitHub availability advertised ⇒ the "Continue with GitHub" button replaces the
password form (asserted at the availability boundary — a real GitHub-configured
server driving the browser UI is tier-3, self-hosting.md §4, matching T2-AUTH-4).

### T2-SH-5: `/meta` capability contract, integration layer
`server/tests/unit/test_meta_endpoint.py` pins the pure
`build_server_capabilities(Settings)` function exhaustively; this proves the
same contract through a REAL running process (real env → pydantic Settings →
the live `/meta` route → JSON), on two dedicated ephemeral server-only boots
(no desktop-web, no AnyHarness runtime — `/meta` needs neither): self-managed
with every add-on off (billing/usageMetering/cloudWorkspaces/agentGateway all
false, `support.kind` reflecting whatever operator support fields are set,
`deployment.displayName` empty absent `INSTANCE_NAME`), and hosted mode with
every add-on on (all true, `support.kind=vendor`, vendor pricing available).
`tests/intent/specs/capability-contract.spec.ts`.

### T2-SH-6: cloud-workspace provisioning stays safe when E2B is half-configured
`server/tests/unit/test_cloud_provisioning_config.py` pins the pure
`Settings.cloud_provisioning_config_error` / `require_cloud_provisioning_
configured()` contract; this proves the REAL deployed process, booted with
`E2B_API_KEY` set and `E2B_TEMPLATE_NAME` empty in non-debug mode (the exact
posture that used to crash-loop the whole control plane at startup), (a)
actually comes up healthy — auth and every base surface stay reachable — and
(b) answers a real `POST /v1/cloud/workspaces` with the specific, actionable
503 (`e2b_template_not_configured`, naming the missing var, never echoing the
key) rather than a crash or a generic 500, before any repo/GitHub lookup runs.
Ephemeral server-only boot, `DEBUG=false` (the shared `t2intent` stack always
boots `DEBUG=true`, under which this posture is not reachable — debug mode
intentionally waives the template requirement).
`tests/intent/specs/cloud-provisioning-gating.spec.ts`.

### T2-SH-7: SSO discover truthfulness (extends T2-AUTH-5) + gateway model eligibility
Two self-hosting-relevant additions to the existing entry-point-seam spec and
a new runtime-dependent spec, respectively:
- `tests/intent/specs/sso-entry-points.spec.ts` gained a negative case: a
  connection whose `status` is `'enabled'` but whose OIDC config drifted
  incomplete afterward (an admin edit `enable_organization_sso_connection`
  itself cannot produce, since it re-tests live endpoints before flipping
  status) must still report `enabled:false` with the specific
  `oidc_configuration_error` reason — never a false positive. Seeded via a new
  `seedIncompleteEnabledOrgSsoConnection` helper (`tests/intent/stack/seed.ts`).
- `tests/intent/specs/gateway-eligibility.spec.ts` (new): after pushing a
  gateway-only agent-auth state (no native credential), session creation
  REJECTS a bare native model selector (`"default"`) and ACCEPTS a real
  gateway-catalog id — the runtime-level half of `catalog::service_tests::
  gateway_context_gates_native_ids_and_offers_only_gateway_models`, proven
  against the real AnyHarness HTTP API with no LLM call ever made. Required CI
  builds the runtime, supplies it through `ANYHARNESS_DEV_RUNTIME_BIN`, and
  sets `TIER2_INTENT_REQUIRE_RUNTIME=1`; a build, startup, or reachability
  failure is red rather than skipped. The test's historical T2-SH-7 label maps
  to the gateway-eligibility slice of normative T2-SH-4 and remains to be
  reconciled by the machine-manifest migration.

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
Ruled 2026-07-08, amended 2026-07-09 (#1030): the integration is **any
api_key-kind catalog entry with a real key** (the scenario currently seeds
exa; cataloged Slack is oauth2/hosted-MCP so a Slack bot token cannot be an
api_key credential) — no OAuth dance in the runner, no mocked provider; the
gateway itself is what's under test.
Steps: connect the integration once with the real key; then for **each
cataloged harness, in both lanes** (piggybacking T3-CHAT-1's session matrix):
the agent session calls a tool through the integrations gateway.
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
Then personal legacy refill or subscription/payment recovery restores the
compute subject; an entitlement/cap change or valid BYOK selection restores
the applicable LLM path. The two ledgers never refill one another.
(Tier-2 T2-BILL-1 proves this logic against Stripe test clocks per-PR; this
scenario proves the **deployed** enforcement chain end-to-end on real
infrastructure.)

### T3-BILL-3: compute overage and managed-credit hard cap (staging lane)
Added 2026-07-08 — overage is the highest-stakes billing path (it charges
cards) and was tier-2-only. On the staging test org with `overage_enabled`
and a small per-seat cap:
- **compute**: exhaust grants, keep a sandbox running → metered usage events
  arrive in Stripe (test mode) for the overage price, sandbox stays UP while
  under cap; cross the cap → hard block flips on (`cap_exhausted`), further
  usage written off, no more billing.
- **managed LLM**: exhaust the entitlement → the scoped Bifrost key disables,
  no Stripe charge or grant occurs, and subsequent managed launches fail
  closed. An entitlement/cap change may recover managed access; valid BYOK is
  an alternate path and never debits managed credit.
Assert amounts end-to-end: seconds consumed → cents exported → Stripe event
totals match (the fractional-cent remainder logic is under test here too).

**Status (2026-07-09): partially unblocked — the funded posture is now live,
the metered AMOUNTS are still deferred.** Staging was swapped from `sk_live_` to
the account's **test mode** (test price/meter ids, `PRO_BILLING_ENABLED=true`, a
test-mode webhook endpoint at the billing webhook URL), which retires finding #4:
`cloud-checkout` now returns test-mode Stripe URLs, the `org_pro_billing_disabled`
gate is cleared, and the durable org was **funded through a Stripe test
subscription** (card 4242 → the same `customer.subscription.created` /
`invoice.paid` webhooks a real checkout fires → credits granted, verified via
`/billing/overview`). The scenario (`tests/release/src/scenarios/t3-bill-3.ts`,
`--lane staging`) asserts that reachable half: test-mode deployment posture +
funded org + overage on/off round-trip. The **metered-overage AMOUNTS** stay
deferred because finding #5 is still open — E2B webhooks to
`POST /api/v1/cloud/webhooks/e2b` still all return **401
`invalid_webhook_signature`** (zero 2xx), so `usage_segment` rows never open and
no `proliferate_managed_cloud_overage_cents` meter event is emitted; and the
managed-credit Bifrost import path still needs a disposable scoped key and
entitlement fixture. Tier-2 T2-BILL-* proves the
metered arithmetic against Stripe test clocks per-PR. Note also: with
`PRO_BILLING_ENABLED=true`, personal `refill-checkout` returns
`refill_checkout_disabled` (refills are a non-Pro-billing feature) — the Pro
compute model uses subscription plus overage, while managed LLM credit remains
hard capped. Durable-org tension:
this scenario needs the org FUNDED while T3-BILL-4 needs it EXHAUSTED; the ruling
gives the funded half here, so while funded T3-BILL-4 reports blocked (its own
"funded out of band" guard), not red.

### T3-BILL-4: org billing lifecycle — out-of-credits enforcement, live
Added 2026-07-10. The reachable half of the durable-org lifecycle ruling
(Pablo 2026-07-10), asserted against the real staging deployment through the
billing HTTP surface a client uses — the T3-BILL-1/2 ledger DB seam is
local-only (staging DB is VPC-only; the durable staging user is a real
GitHub-OAuth account that passes `current_product_user`). Staging lane
(`--lane staging`); the local lane reports blocked (its ledger is T3-BILL-1/2's).
Against the durable org's exhausted subject, assert:
- the **enumerated out-of-credits state** on `cloud-plan`/`overview`
  (`startBlocked`, `holdReason=credits_exhausted`, 0 remaining hours) and
  `llm-balance` (`remainingUsd=0`);
- the **live compute start gate** (#1036, wired into the service layer):
  `POST /cloud-sandbox/ensure` is refused with a 402 `billing_credits_exhausted`
  and **no sandbox is created** (the gate fires before the row insert);
- the **#1047 attribution split** as a positive contrast: the org member's
  compute + LLM bill the ORG subject (exhausted) while the same user's PERSONAL
  subject keeps its free grant — org work does not silently drain personal
  credits;
- **overage can be turned on** for the org via `overage-settings` and the policy
  round-trips (restored afterward).
The funded half (fund → consume → refill/reactivate → meter overage) is
deferred to T3-BILL-3 above, blocked by the same staging Stripe live-mode /
E2B-webhook findings. Test: `tests/release/src/scenarios/t3-bill-4.ts`.

---

## Tier 3 — workflows (T3-WF lane)

> Current-state registry notice (2026-07-10): the WF1-WF7 entries and the CUT
> WF8 statement below document the existing runner only. They are not the target
> release manifest. WS10 in
> [`../../tbd/workflows-v1-completion-plan.md`](../../tbd/workflows-v1-completion-plan.md)
> replaces this section atomically with strict T3-WF-1 through T3-WF-10, where
> missing, blocked, skipped, expected-fail, cancelled, duplicate, or failed rows
> all fail the release run.

Added 2026-07-10 (workflows build program, "Testing track"). Each scenario is a
version-pinned fixture WORKFLOW DEFINITION
(`tests/release/fixtures/workflows/*.json`, test data — same rule as the golden
contract fixtures) exercising exactly one capability through the real workflow
API + gateway. Assertions read the run row + step-action ledger (`GET
/v1/cloud/workflows/runs/{id}` returns both), the trigger + trigger-item
surfaces, the run gateway-token scope DB seam
(`tests/release/scripts/workflow_probe.py`), and emitted `step_outputs` — never
transcript text. Deny-path scenarios assert at the GATEWAY (audit row + absence
of an upstream call), never the agent's prose. Tests under
`tests/release/src/scenarios/workflows/`.

The staging target is deferred for every T3-WF scenario (they create workflows/
triggers/runs against the SHARED durable user/org — same posture as
T3-INT-1/staging), and agent-executing halves report expected-fail where the
runner cannot yet drive a runnable target (in-sandbox delivery path #1042, or the
desktop executor). T3-WF-8 (agent comms) is CUT — dropped from program scope
(2026-07-09).

### T3-WF-1: structured output + required tools (`wf-emit-gate`)
One agent: a `required_invocation` prompt gate + a strict-schema `agent.emit`.
Assert: the first emit attempt may fail the schema → a corrective reprompt
occurs → the validated output persists to `step_outputs`; the gate step advances
only after the required tool call; `step_actions[].attemptCount` is the re-ask
evidence. Surfaces the same functions-grant gap as T3-WF-2 (the fixture's
`required_invocation` uses the reserved `functions` namespace).

### T3-WF-2: function invocations + denial (`wf-invoke-allowed` / `wf-invoke-denied`)
Allowed → the agent's outbound HTTP hits a scenario-local capture endpoint
(request recorded, args schema-validated); denied → gateway scope 403 in the
audit, ZERO outbound requests, run still completes with the agent's emitted
failure report. The invocation-def CRUD + the capture endpoint run for real as
setup. (Building this scenario surfaced that a workflow could not grant the
reserved `functions` namespace — save rejected it and L22 required a ready
integration ACCOUNT; fixed in the same PR: `visible_provider_namespaces` and
`assert_declared_providers_ready` accept the virtual `functions` provider when
the owner has ≥1 live invocation, unit-tested in
`test_workflow_service.py::test_functions_*`. The scenario treats a
reappearance of `workflow_function_provider_unknown` as a real red.)

### T3-WF-3: integration scoping (`wf-integration-denied`)
The workflow grants NO integrations, yet the agent is told to use a
connected-but-ungranted provider (default exa, connected for real via
`RELEASE_E2E_INTEGRATION_API_KEY`). Assert: `list_providers` omits it; a forced
`call_tool` returns `integration_gateway_scope_denied`; zero upstream calls. The
connected-but-ungranted precondition runs for real; the scope-403 proof reuses
T3-INT-1's LLM-free gateway-token gate once a runnable target exists.

### T3-WF-4: parallel + sequential lanes (L30) (`wf-parallel-review`)
Intake slot → a 2-lane parallel review block → summarize slot whose emit
references both lanes (referenceable only after the join). Sandbox lane only
(parallel forces worktree isolation + a cloud target). Assert: the parallel
definition round-trips through create + read (runs for real); per-lane
independent advance, lane-qualified `<node>.<lane>.<step>` keys, and join gating
need a real E2B sandbox.

### T3-WF-5: polls end-to-end (`wf-poll-feed`)
Against a scenario-local stub feed (poll contract §4.2). Assert: `/init`
inference derives `{item_id, title}` from the sample item — a stateless server
probe (`POST /poll/inspect`), NO workflow/agent, **runs LIVE locally** (the SSRF
guard is bypassed under server debug, so a 127.0.0.1 stub is reachable). The
item→inputs delivery + cursor-advance-once-per-item + replay-spawns-no-second-run
half needs a poll trigger (derives a cloud workspace from a repo pin, D16) + the
running poller loop.

### T3-WF-6: automations (cloud) (`wf-schedule-cloud`)
A 1-minute schedule trigger, `personal_cloud`, `concurrency=queue`,
`run_latest`. Assert: the trigger's `next_run_at` is stamped (runs for real);
fire-within-budget (`scheduled_for`/`started_at`), queue FIFO drain, and
missed-run `run_latest` (suspend the beat one tick) need the scheduler beat + a
real cloud sandbox.

### T3-WF-7: automations (desktop) (`wf-schedule-cloud`, `target_mode` local)
Same fixture, `target_mode=local` at trigger time. LOCAL dev-profile lane only:
a real desktop executor (track-2a claim poll + heartbeat + relay) drives it.
Guarded to report blocked under CI/sandbox (recorded limitation: no headless
desktop lane). Assert: `next_run_at` stamped (runs for real); claim → execute →
relay → terminal needs a running desktop executor.

---

## Tier 4 — upgrade path

### T4-CLOUD-1: AnyHarness runtime binary self-update in a cloud sandbox
Spec of record: `specs/tbd/anyharness-self-update-v1.md` §7. Sandbox lane,
`--lane staging`. The one place the AnyHarness binary itself converges in a
running sandbox (not via a new E2B template).

Shape: with a sandbox already running version N, record the advertised
`desiredVersions.anyharness` pin (`/meta` `runtimeVersion`) and the running
version (proxied runtime `/health` via `GET /v1/cloud/cloud-sandbox/anyharness/
health`); bump the advertised pin to a different published version; let the
sandbox worker converge the binary in place (no test-side artifact push — the
feed is the only thing moved); assert the runtime reports the new version (spec
§5 "converged" for the binary track) and, secondarily, that the catalog/agent
pins reconcile.

Feed knob: the server advertises the pin from `RUNTIME_VERSION`, a baked-in
image ENV with no runtime override, so the test-scoped bump overrides
`RUNTIME_VERSION` in the `proliferate-staging-server` ECS task definition and
rolls the service (ECS task env wins), restoring the original task definition in
a `finally`. Gated behind the explicit `RELEASE_E2E_STAGING_ECS_PIN_BUMP` opt-in
and `assertNotProduction`; never touches `proliferate-prod*`. Test:
`tests/release/src/scenarios/upgrade/t4-cloud-1.ts`.

Standing state (2026-07-09): reports blocked without a live E2B-backed sandbox
plus the ECS opt-in. When it reaches the mechanism it is expected-fail on a
diagnosed product blocker (issue #1089): the released binary reports
`CARGO_PKG_VERSION` (hardcoded 0.1.0) from both `anyharness --version` and
`/health` `version`, and the worker's convergence preflight + health-gate both
require an exact match to the pinned semver, so no real pin converges. Building
this test also surfaced that nothing published the `runtime/`/`worker/` CDN
trees the redirects resolve to — now closed by
`scripts/ci-cd/publish-runtime-cdn.sh` + the `release-runtime.yml` `publish-cdn`
job.

### T4-DESKTOP-1: desktop app auto-update, N-1 → N
The Tauri-updater mechanism from the tier-4 registry (a broken updater strands
every existing desktop user). Build a test-flavor N-1 `.app` pointed at a local
update feed, build an N `.app` signed with the **same** key, stage
N + `latest.json` behind `tests/release/scripts/serve-updater-feed.mjs`, then
drive the real `tauri_plugin_updater` (`check()` + `download_and_install()` —
the code the JS wrappers in `apps/desktop/src/lib/access/tauri/updater.ts` call
through) against a pristine copy of the N-1 bundle. Assert:
- `check()` reports an available update whose version == N;
- `download_and_install()` verifies the N artifact's minisign signature against
  the pubkey the N-1 build trusts (signature is checked at download, not
  check() time) and swaps the on-disk `.app` in place;
- the installed bundle's `CFBundleShortVersionString` went N-1 → N — exactly
  what `getVersion()` returns after a relaunch, so this is the faithful
  "the relaunched app is version N" assertion.

The GUI is deliberately not clicked: the update UX is user-gated inside a
release webview (Settings → "Desktop updates" → check → download → restart),
and webview automation is far more brittle headlessly than invoking the same
updater API directly. The headless Rust driver
(`tests/release/upgrade/updater-driver`) is the "call the wrappers directly"
path — it exercises the parts that actually break (manifest fetch, semver
compare, signature verification, real macOS bundle swap). Its mock app reports
running version 0.1.0 (a `tauri::test` limitation, not the real N-1 semver);
irrelevant to what is asserted, since the on-disk bundle version is read from
the real N-1 build's Info.plist.

**Local-macOS-aarch64-only**, gated behind `RELEASE_E2E_DESKTOP_T4=1` (two full
`tauri build`s, ~10+ min cold; bundles are cached across runs). In CI / on any
non-macOS-aarch64 host / without the opt-in it reports `blocked` cleanly, never
red. Orchestrator + local invocation:
`specs/developing/testing/desktop-update-testing.md` ("Running the T4
scenario").

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

## Staging infra findings (2026-07-10) — block the tier-3 billing funded lane

Surfaced building T3-BILL-4 / trying to enroll the durable staging org.

4. **Staging Stripe was in LIVE mode — RESOLVED 2026-07-09 (swapped to test
   mode).** `proliferate-staging-server` used to carry a `sk_live_`
   `STRIPE_SECRET_KEY` and a `cloud-checkout` returned a `cs_live_` session, so
   the durable org could not be funded without a real charge. Staging is now
   pointed at the account's **test mode**: `STRIPE_SECRET_KEY` +
   `STRIPE_WEBHOOK_SECRET` (Secrets Manager `proliferate/staging/server-app`)
   are test-mode values, the `STRIPE_*_PRICE_ID` / meter-id / meter-event-name
   task-def env vars point at the "Proliferate Cloud (Local Test)" test objects
   (`scripts/stripe-setup-test-mode.mjs`'s catalog + a `proliferate_llm_topup_10usd_test`
   price), `PRO_BILLING_ENABLED=true`, and a test-mode webhook endpoint is
   registered at `…/api/v1/billing/webhooks/stripe`. Verified: `cloud-checkout`
   returns test-mode URLs, `proBillingEnabled=true`, and the durable org was
   funded through a Stripe test subscription (card 4242 → webhook grant → 20h /
   pro plan). T3-BILL-3 now asserts this funded posture; T3-BILL-4's exhausted
   contract now reports blocked while the org is funded.
5. **Staging E2B webhooks all fail signature validation — STILL OPEN
   (re-confirmed 2026-07-09).** E2B delivers to
   `POST /api/v1/cloud/webhooks/e2b` (source 34.177.112.204) but every request
   still returns **401 `invalid_webhook_signature`** (steady 401s in the last
   few hours, zero 2xx). The
   server computes `base64(sha256(secret + body))` (`e2b_webhooks.py`) against
   `E2B_WEBHOOK_SIGNATURE_SECRET`; the configured secret does not match what E2B
   signs with (E2B's dashboard never surfaced a signing secret). Consequence:
   `usage_segment` rows are never opened/closed on staging, so compute metering
   is dead there regardless of billing state. Fix: obtain/rotate the real E2B
   signing secret (or confirm E2B's actual signing scheme) and reconcile with
   `verify_e2b_webhook_signature`.
