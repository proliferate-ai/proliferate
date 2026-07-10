# Flow Registry

The inventory of end-to-end flows that must never break. Owned and dictated by
Pablo; agents keep the pointers live. Rules:

- Adding or materially changing a flow adds/updates a row **in the same PR**.
- `Test pointer` names the spec/scenario file that enforces the flow at its
  tier. `—` means not yet implemented; an empty pointer is a to-do, not an
  excuse.
- A completeness audit (agent-run) checks: every row has a live pointer, and
  every pointer's test actually runs in the gate its tier claims.

Tiers per `README.md`: **2** = mocked intent (per-PR, blocks merge),
**3** = live end-to-end (release train), **4** = upgrade path (release train).

## Auth & identity — must work, even if basic

| Flow | Tier | Test pointer |
| --- | --- | --- |
| Google OAuth sign-in (mocked provider per-merge) | 2 | — |
| `/setup` instance claim → password login → logout → re-login | 2 | — |
| Session revocation ends access | 2 | — |
| Invitation: invite → accept in fresh browser → membership + role | 2 | — |
| Invitation negatives: expired / reused / wrong-email token | 2 | — |
| SSO: OIDC round-trip via mock IdP → user linked, domain policy applied | 2 | — |
| SSO negatives: disallowed domain, unknown user, audience/issuer mismatch | 2 | — |
| SSO org entry points: slug + org-id discovery (unknown / no-SSO collapse to one non-enumerating answer; enabled connection returns start ids) and the desktop cold-login affordance | 2 | tests/intent/specs/sso-entry-points.spec.ts (T2-AUTH-5; entry-point seam only — the OIDC round-trip is the row above. The `apps/web` slug/`join` pages are not booted by this suite; their logic sits on the same discover seam asserted here) |
| Real provider handshakes (Google/GitHub OAuth dance) | 3 | — |

## Organization — must work, even if basic

| Flow | Tier | Test pointer |
| --- | --- | --- |
| Create organization | 2 | — |
| Invite users; promote/demote roles | 2 | — |
| Admin-only surfaces gated: member cannot see/do admin actions | 2 | — |
| Member visibility boundaries (sees own work, not others' private state) | 2 | — |
| Remove user; access ends | 2 | tests/intent/specs/organization-roles.spec.ts (T2-ORG-1; "remove a member -> membership status 'removed' -> their next org-scoped call fails" — 200 while active, 404 organization_not_found on the next org-scoped call post-removal, gone from the active roster, and a later relist 403s instance_access_removed rather than silently re-adding them) |

## Workspaces

| Flow | Tier | Test pointer |
| --- | --- | --- |
| Local workspace create | 3 | — |
| Worktree workspace create — locally AND inside a cloud sandbox | 3 | tests/release/src/scenarios/t3-wt-1.ts (T3-WT-1; local lane green, sandbox lane blocked on current_product_user) |
| Cloud workspace create: request path + UI state up to the provisioning seam | 2 | — |
| Add-Repo flow entry: local/cloud branches render + desktop-web fallback limits (no native picker outside Tauri) | 2 | tests/intent/specs/workspace-entry.spec.ts |
| New user cold path: GitHub App authorization triggers first-ever sandbox provisioned from zero, within time budget | 3 | tests/release/src/scenarios/t3-prov-1.ts (T3-PROV-1; REAL trigger — seeds the App-auth callback's outcome via github_app_seed.py, real user token + real installation token, then runs the real post-callback body → real E2B sandbox; asserts positive AND negative trigger contract; fallback seam when seed creds absent) |
| Existing user warm path: reopen, pause (inaccessible), resume, state intact | 3 | tests/release/src/scenarios/t3-prov-2.ts (T3-PROV-2; blocked on current_product_user — no fallback seam for this one, it's specifically the front-door path) |
| Cloud workspace pause/resume/connect on real E2B | 3 | tests/release/src/scenarios/t3-prov-2.ts (T3-PROV-2; blocked, see above) |
| Local ↔ cloud workspace migration | 3 | — |
| Add repo from cloud | 2 | — |
| Repo settings applied: default branch, action scripts, environment scripts/env vars take effect — locally AND in sandbox | 3 | tests/release/src/scenarios/t3-repo-1.ts (T3-REPO-1; #1043 authorization blocker resolved — seeds the durable user's real App auth; remaining expected-fail is environmental: t3local's App (proliferate-dev/pablonyx) isn't installed on the fixture org proliferate-e2e → github_app_installation_required) |

## Agents & sessions

| Flow | Tier | Test pointer |
| --- | --- | --- |
| Every cataloged harness × its cheapest model via the gateway: send a message, get a real message back — local lane AND sandbox lane | 3 | tests/release/src/scenarios/t3-chat-1.ts (T3-CHAT-1; local lane green for claude, per-harness expected-fail for opencode — issue #1024; sandbox lane blocked on current_product_user; not yet routed through a dedicated gateway test key, see env-manifest.ts) |
| Correct harness spawned: right binary, right version per catalog pin — asserted locally AND in the sandbox, before the chat | 3 | tests/release/src/scenarios/t3-chat-1.ts (asserted before chat in the local lane) |
| Install an agent; switch agents in a workspace | 3 | — |
| Per-agent catalog version bump gate (staging smoke before pin bump) | 3 | — |
| Config/harness option updates applied by a live agent: cycle every catalog-enumerated option (models, modes) in an existing session | 3 | tests/release/src/scenarios/t3-cfg-1.ts (T3-CFG-1; local lane green — verified round-trip on mode + model controls) |
| Session resume after runtime restart | 3 | — |

## Secrets

| Flow | Tier | Test pointer |
| --- | --- | --- |
| Secrets CRUD in UI: org, personal, file secrets | 2 | — |
| Org secret set → materializes in a new cloud sandbox | 3 | tests/release/src/scenarios/t3-sec-mat-1.ts (T3-SEC-MAT-1; blocked on current_product_user — no local-lane variant exists in the contract) |
| Personal secret set → materializes in a new cloud sandbox | 3 | tests/release/src/scenarios/t3-sec-mat-1.ts (same scenario, blocked) |
| File secret set → lands at the right path in the sandbox | 3 | tests/release/src/scenarios/t3-sec-mat-1.ts (same scenario, blocked) |

## Integrations

| Flow | Tier | Test pointer |
| --- | --- | --- |
| Connect integration (real api_key definition, placeholder key, no outbound), toggle on/off | 2 | tests/intent/specs/integrations.spec.ts |
| Authenticate a real integration; **every cataloged harness** uses it through the gateway — local lane AND sandbox lane | 3 | tests/release/src/scenarios/t3-int-1.ts (T3-INT-1; blocked on credential RELEASE_E2E_INTEGRATION_API_KEY + github_link_required on the gateway route. Finding: cataloged Slack is oauth2/hosted-MCP not api_key, so the contract's Slack-bot-token premise does not fit the catalog — filed; scenario uses an api_key-kind seed (exa)) |

## Self-hosting

Every self-hosted deploy is the production compose bundle (hand-run
`bootstrap.sh` or the AWS one-click), single-org, claimed once via `/setup`.
Spec of record + scenario definitions: `specs/developing/testing/self-hosting.md`.

| Flow | Tier | Test pointer |
| --- | --- | --- |
| Single-org mode derives from telemetry mode (`!= hosted_product`), override wins both directions | 1 | server/tests/unit/test_telemetry_mode.py (T1-SH-1; self_managed AND local_dev single-org, hosted_product multi-org, `SINGLE_ORG_MODE`/`PROLIFERATE_SINGLE_ORG_MODE` override forces either way) |
| SSO env-var canonical form: every `SSO_*` ≡ `PROLIFERATE_SSO_*` | 1 | server/tests/unit/test_sso_env_aliases.py (T1-SH-2; structural pair sweep over all 19 SSO fields + functional bare/prefixed equivalence) |
| `/meta` version wire contract (the connect dialog's trust screen reads it) | 1 | server/tests/unit/test_meta_endpoint.py (T1-SH-3; golden field names + order on the response model and the live JSON — rename/reorder guard) |
| Connect to a self-hosted server: dialog validation, trust screen, switch A→B | 2 | — (T2-SH-1; the connect affordance is Tauri-gated (LoginScreen.tsx:117) and never renders in the desktop-web build this suite boots, and the `set_app_config` write + relaunch + credential store throw outside Tauri — tier-3 by ruling, self-hosting.md §4. Registered not-yet-implemented rather than faked) |
| `/setup` claim → claimer is OWNER of the single instance org; re-claim permanently closed (404) | 2 | tests/intent/specs/self-hosting.spec.ts (T2-SH-2; extends T2-AUTH-1 — owner role on the one `is_instance` org, second context gets the closed 404 API + rendered page) |
| Invite → `/register` with the invitation token → invitee sign-in; wrong-email rejected | 2 | tests/intent/specs/self-hosting.spec.ts (T2-SH-3; token = invitation id, delivery skipped locally; real token + mismatched email → uniform 403, no account minted) |
| Adaptive sign-in surface driven by `GET /auth/desktop/methods` + github availability | 2 | tests/intent/specs/self-hosting.spec.ts (T2-SH-4; no GitHub env → real password-only surface, no GitHub button; GitHub advertised → the button replaces the password form. With-GitHub asserted at the availability boundary — a real GitHub-configured server for the browser UI is tier-3 per §4, same ruling as T2-AUTH-4) |
| Cold boot to second user on real infra (bootstrap → claim → invite → register → login over real TLS/DNS) | 3 | — (T3-SH-1; needs standing staging EC2 + DNS/TLS, self-hosting.md §6) |
| Real (Tauri) desktop connect to alpha/beta: relaunch + config.json + keychain end-to-end | 3 | — (T3-SH-2; the only lane that proves the Tauri connect slice T2-SH-1 can't) |
| Model gateway add-on: `--profile agent-gateway` + LiteLLM → real agent response | 3 | — (T3-SH-3; staging gateway test key) |
| Operator update motion: `./update.sh` migrates + restarts, `/meta` reports N, data intact | 4 | — (T4-SH-1) |
| Desktop artifact chain valid per release (server redirect follows, CDN manifest fresh, every platform artifact HEAD 200, tag contains the SHA) | 4 | — (T4-SH-2; the 2026-07-09 incident test — must run in the release gate, self-hosting.md §5) |

## Workflows — PARKED (surface being reworked; tests land with the rework PRs)

| Flow | Tier | Test pointer |
| --- | --- | --- |
| Create/edit/trigger workflow via UI → run created, plan resolved, delivery attempted (up to the sandbox seam) | 2 | parked |
| Workflow run reaches terminal state with a real agent | 3 | parked |
| Poll trigger against stub feed: replay-safe, invalid items surfaced | 2 | parked |
| Workflow services live: schedule + poll triggers, emit, chaining, Slack delivery | 3 | parked |

## Billing

| Flow | Tier | Test pointer |
| --- | --- | --- |
| Checkout → grants → consumption → cut-off → reactivation (Stripe test mode + test clocks); grant drain order | 2 | tests/intent/specs/billing/core.spec.ts (T2-BILL-1; real Stripe test-clock subscription + invoice.paid grant, real accounting-pass drain, snapshot cut-off/reactivate) |
| Seat-based billing on Pro orgs: invite/remove/re-invite reconciles Stripe quantity + proration grants, no double-grant | 2 | tests/intent/specs/billing/seats.spec.ts (T2-BILL-3) |
| Team checkout: new-org-via-checkout activation + failure/expiry terminal states | 2 | tests/intent/specs/billing/seats.spec.ts (T2-BILL-4; intent-create + activation idempotency; failed_billing_state/expiry noted tier-1) |
| Compute overage: bills metered usage up to cap, writes off past it, then hard-blocks; disabled → immediate cutoff | 2 | tests/intent/specs/billing/overage.spec.ts (T2-BILL-5) |
| LLM credits: exhaustion disables key, admin caps independent of credit refill, auto top-up incl. declined-card fail-closed | 2 | tests/intent/specs/billing/overage.spec.ts (T2-BILL-6; balance/cap surfaces + fail-closed top-up; LiteLLM key-disable is tier-3) |
| Stripe webhook robustness: duplicate/replay idempotent, concurrent 409, failure retried once-only, out-of-order safe | 2 | tests/intent/specs/billing/webhooks.spec.ts (T2-BILL-7) |
| Subscription edges: payment-failed hold + clear, mid-period cancel + rollover grace, billing modes off/observe/enforce, one-trial-per-GitHub-identity | 2 | tests/intent/specs/billing/webhooks.spec.ts (T2-BILL-8; finding-7 subscription.deleted hold pinned expected-fail — issue filed) |
| Usage surfaces truthful: seeded usage matches summary/timeseries/by-user/llm-balance APIs + UI | 2 | tests/intent/specs/billing/usage.spec.ts (T2-BILL-9; #1028 org-attribution guarded by T2BILLING_ORG_COMPUTE_ATTRIBUTION flag) |
| Credits consumed properly: real session → LLM **and compute** meter events + credit decrement match consumption; Stripe webhook delivery live on staging | 3 | tests/release/src/scenarios/t3-bill-1.ts (T3-BILL-1; ledger reader + as-built compute-attribution assertion green via billing_probe.py; LLM half blocked on RELEASE_E2E_GATEWAY_TEST_KEY, compute half blocked on github_link_required + public webhook URL. Compute-attribution asserted via ORG_COMPUTE_ATTRIBUTION_FIXED, true since #1028 merged; the paying subject stays personal) |
| Out of credits: sandbox paused and not accessible — **including every bypass route** (direct API resume, stale session, webhook race, pre-exhaustion key, other org member, trigger-driven start) | 3 | tests/release/src/scenarios/t3-bill-2.ts (T3-BILL-2; exhaustion setup via drain-grants green; enforcement + 6-route bypass sweep blocked on github_link_required — cloud routes need a real sandbox + gate lift PR #1023) |
| Out of credits: gateway LLM access gated; reactivates on refill | 3 | tests/release/src/scenarios/t3-bill-2.ts (T3-BILL-2, LLM side; blocked on RELEASE_E2E_GATEWAY_TEST_KEY — no key to reject) |
| Overage bills real money correctly: compute metered events + amounts match up to cap then hard-block; LLM auto top-up charges once then fail-closes on payment failure | 3 | — |
| Plan gates the model list: user sees/uses exactly the models their plan allows | 3 | — |

## Upgrade & release

There is no single "upgrade path" — five distinct mechanisms, each tested at
its own seam. Mechanism map and current-coverage audit: the tier-4 section of
`README.md`.

| Flow | Tier | Test pointer |
| --- | --- | --- |
| Worker self-update: sandbox worker N−1 heartbeats, downloads N from stubbed CDN base (`DESKTOP_DOWNLOADS_BASE_URL`), verifies, swaps, execs — with a live session on the box that survives | 4 | — |
| Catalog convergence full chain (sandbox): server catalog version bump → heartbeat → worker push → runtime reconcile → agent CLI in an **existing** sandbox reinstalled at the new pin — independent of any worker binary update | 4 | tests/release/src/scenarios/t3-update-1.ts (T3-UPDATE-1; blocked on current_product_user) |
| Catalog convergence on desktop local: same chain through the bundled desktop worker → local runtime → agent CLI reinstalled at the new pin | 4 | tests/release/src/scenarios/t3-update-1.ts (T3-UPDATE-1; expected-fail — no such mechanism exists for the local runtime today, filed as issue #1025) |
| AnyHarness binary self-update (sandbox): worker sees `desiredVersions.anyharness` bump → downloads pinned runtime → stops/swaps/relaunches it in place → a live session on the box restarts and completes → heartbeat reports the new version and agent CLIs reconcile to the new registry's pins | 4 | tests/release/src/scenarios/upgrade/t4-cloud-1.ts (T4-CLOUD-1; feed knob = staging server RUNTIME_VERSION via an ECS task-def override, gated behind `RELEASE_E2E_STAGING_ECS_PIN_BUMP` and `assertNotProduction`, restored in a finally. Blocked without a live E2B-backed sandbox + the ECS opt-in. **Product blocker found building this test:** the released anyharness binary reports `CARGO_PKG_VERSION` (hardcoded 0.1.0, never stamped) from both `anyharness --version` and `/health` `version`, but the worker's convergence preflight + health-gate require an exact match to the pinned semver — so no real pin can converge. Marked expected-fail with that diagnosis when it reaches the mechanism. Also: nothing published the `runtime/`|`worker/` CDN trees the redirects resolve to until scripts/ci-cd/publish-runtime-cdn.sh + the release-runtime.yml publish-cdn job) |
| Desktop app update replaces bundled anyharness + worker sidecars; post-update catalog reconcile installs the right agent CLIs | 4 | — |
| Desktop feed artifact valid per release: `latest.json` shape, signature verifies against bundled pubkey, bundle sidecars report correct versions | 4 | — |
| Desktop real N−1 → N auto-update (nightly native lane; needs a test build with overridable feed endpoint) | 4 | — |
| SQLite migrations forward-apply on real N−1 data | 4 | — |
| New release's sandboxes provision from the new E2B template; existing paused workspaces still wake on their old image | 4 | — |

Old-template → new-template workspace movement is the managed-target
replacement path, which is a placeholder runbook today
(`specs/developing/runbooks/managed-target-replacement.md`) — its test enters
this registry when the mechanism is built.

**Sandbox anyharness in-place update is built**
(`specs/tbd/anyharness-self-update-v1.md`): the sandbox worker acts on
`desiredVersions.anyharness` and swaps the runtime binary in place (download →
stop → swap → relaunch → health-gate → roll back on failure) — the row above
tracks it, and the end-to-end scenario is now written
(tests/release/src/scenarios/upgrade/t4-cloud-1.ts). Building it surfaced two
gaps: (1) nothing in-repo published the `runtime/`/`worker/` bare-binary CDN
trees the server redirects resolve to — now published by
scripts/ci-cd/publish-runtime-cdn.sh and the release-runtime.yml publish-cdn
job; (2) the released binary's `--version` and `/health` version are hardcoded
`CARGO_PKG_VERSION` (0.1.0), which the worker's exact-match preflight/health-gate
reject, so no real pin converges (issue #1089). A new
anyharness now reaches a running sandbox without a new template. Desktop gets
it only inside the app bundle, and that stays bundle-only by design (the worker
leaves the gate off). The supervisor `update/` module stages but never fetches
or swaps, and is not the update owner in v1.

## Deferred — add on first production break

Explicitly not in scope until one breaks in production (postmortem rule then
applies and the test lands with the fix):

- OpenCode configuration correctness per harness
- Full agent × auth-method matrix (beyond the default auth method per agent)
