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
- duplicate pending invite for same (org, email) → rejected by partial unique
  index → enumerated error.

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

### T2-BILL-1: checkout → grants → overage → cut-off → reactivate
Stripe test mode (`sk_test_` key) + webhook forwarding + test clocks, per
`specs/developing/local/stripe-local-testing.md`. Steps mirror the manual pass
already verified on the `billing` profile (memory: 2026-07-04): checkout
completes → plan reflects paid; simulate meter overage; drive credits to zero
via test clock.
Assert: `authorize_sandbox_start` blocks with
`WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED` (assert the enumerated kind,
via the blocked-action message in UI); refill/reactivate → authorization
passes again.

### T2-BILL-2: plan limits
Assert: free-plan repo limit enforced (`repo_limit_for_billing_state`);
agent-gateway policy edit gated by `agent_gateway_policy_min_plan` when set.
Survey flag for the registry row "plan gates the model list": **no
plan-conditioned model list exists in code today.** Row stays in `flows.md`
only if that behavior is planned product work; otherwise it should be
deleted. [PABLO TO RULE]

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
records): (a) **LLM consumption** — the session produced meter events whose
tokens/cost match the gateway's recorded usage for the test key, and the
credit balance decremented accordingly; (b) **compute consumption** — sandbox
runtime for the interval produced compute meter events and the corresponding
credit decrement. Both sides must attribute to the right org/user. Staging
lane additionally asserts the Stripe webhook path is live: meter events
delivered (no stuck/undelivered webhook backlog for the test org).

### T3-BILL-2: exhaustion gates — compute and LLM independently
Drive the test org's credits to exhaustion (smallest real mechanism available;
test-clock/grant manipulation is allowed as *setup*, but the enforcement under
test is real).
Assert, compute side: running sandbox is **paused** and inaccessible; new
cloud sandbox/workspace creation is blocked with the enumerated
credits-exhausted kind. Assert, LLM side: gateway rejects the test key's
completion call with the enumerated budget error; live session surfaces it as
an enumerated error, not a hang. Then refill → sandbox resumable, gateway
serves again, new workspaces allowed. (Tier-2 T2-BILL-1 proves this logic
against Stripe test clocks per-PR; this scenario proves the **deployed**
enforcement chain end-to-end on real infrastructure.)

---

## Open rulings collected

1. "Plan gates the model list" — not in code; keep as planned work or delete
   the row (T2-BILL-2).
2. T3-PROV-1 time budget number.
3. T2-WS-2: is seam-only coverage of local/worktree create acceptable for
   tier 2, with full coverage in tier 3's desktop lane?
4. Google OAuth stays tier-3-only (mock not feasible without product change)
   — confirm.
