# Flow Registry

Legacy human-readable inventory of end-to-end flows that must never break.
Owned and dictated by Pablo. Until the generated view replaces this file:

- Adding or materially changing a guarantee updates the canonical target
  manifest and collector metadata in the same PR.
- `Test pointer` is a temporary view of known collection. It is not run status
  or qualification evidence.
- The replacement generator discovers collectors in both directions and emits
  this view; no claimed completeness audit exists on current main yet.

Tiers per `README.md`: **2** = mocked intent (per-PR, blocks merge),
**3** = live end-to-end (release train), **4** = upgrade path (release train).

## Auth & identity — must work, even if basic

| Flow | Tier | Test pointer |
| --- | --- | --- |
| OAuth login-method availability seam (real provider dance remains Tier 3) | 2 | tests/intent/specs/login-methods.spec.ts (T2-AUTH-4) |
| `/setup` instance claim → password login → logout → re-login | 2 | tests/intent/specs/auth.spec.ts (T2-AUTH-1) |
| Session revocation ends access | 2 | tests/intent/specs/auth.spec.ts (T2-AUTH-2) |
| Invitation: invite → accept in fresh browser → membership + role | 2 | tests/intent/specs/invitation.spec.ts (T2-INV-1) |
| Invitation negatives: expired / revoked / wrong-email / duplicate pending | 2 | tests/intent/specs/invitation.spec.ts (T2-INV-1) |
| SSO: OIDC round-trip via mock IdP → user linked, domain policy applied | 2 | tests/intent/specs/sso.spec.ts (T2-AUTH-3) |
| SSO negatives: disallowed domain, unknown user, audience/issuer mismatch | 2 | tests/intent/specs/sso.spec.ts (T2-AUTH-3; see spec for currently reachable cells) |
| SSO org entry points: slug + org-id discovery (unknown / no-SSO collapse to one non-enumerating answer; enabled connection returns start ids) and the desktop cold-login affordance | 2 | tests/intent/specs/sso-entry-points.spec.ts (T2-AUTH-5; entry-point seam only — the OIDC round-trip is the row above. The `apps/web` slug/`join` pages are not booted by this suite; their logic sits on the same discover seam asserted here) |
| Real provider handshakes (Google/GitHub OAuth dance) | 3 | — |

## Organization — must work, even if basic

| Flow | Tier | Test pointer |
| --- | --- | --- |
| Create organization | 2 | tests/intent/specs/organization-roles.spec.ts (T2-ORG-1; current single-org posture exercises the instance org) |
| Invite users; promote/demote roles | 2 | tests/intent/specs/organization-roles.spec.ts (T2-ORG-1) |
| Admin-only surfaces gated: member cannot see/do admin actions | 2 | tests/intent/specs/organization-roles.spec.ts (T2-ORG-1) |
| Member visibility boundaries (sees own work, not others' private state) | 2 | tests/intent/specs/member-visibility.spec.ts (T2-ORG-2) |
| Remove user; access ends | 2 | tests/intent/specs/organization-roles.spec.ts (T2-ORG-1; "remove a member -> membership status 'removed' -> their next org-scoped call fails" — 200 while active, 404 organization_not_found on the next org-scoped call post-removal, gone from the active roster, and a later relist 403s instance_access_removed rather than silently re-adding them) |

## Workspaces

| Flow | Tier | Test pointer |
| --- | --- | --- |
| Local workspace create | 3 | — |
| Worktree workspace create — locally AND inside a cloud sandbox | 3 | tests/release/src/scenarios/t3-wt-1.ts (T3-WT-1; local lane green, sandbox lane blocked on current_product_user) |
| Cloud workspace create: request path + UI state up to the provisioning seam | 2 | tests/intent/specs/cloud-workspace.spec.ts (T2-WS-1; configured-repo happy seam remains a collected gap) |
| Add-Repo flow entry: local/cloud branches render + desktop-web fallback limits (no native picker outside Tauri) | 2 | tests/intent/specs/workspace-entry.spec.ts |
| New user cold path: GitHub App authorization triggers first-ever sandbox provisioned from zero, within time budget | 3 | tests/release/src/scenarios/t3-prov-1.ts (T3-PROV-1; REAL trigger — seeds the App-auth callback's outcome via github_app_seed.py, real user token + real installation token, then runs the real post-callback body → real E2B sandbox; asserts positive AND negative trigger contract; fallback seam when seed creds absent) |
| Existing user warm path: reopen, pause (inaccessible), resume, state intact | 3 | tests/release/src/scenarios/t3-prov-2.ts (T3-PROV-2; #1041 — real and green end-to-end on --lane local against a real E2B sandbox: front-door reconnect via the anyharness gateway proxy, direct-E2B pause/resume with ground truth verified, filesystem state proven intact across the cycle; RELEASE_E2E_E2B_API_KEY-gated, expected-fail without it; blocked, not red, when the durable org's cloud-sandbox credits are exhausted) |
| Cloud workspace pause/resume/connect on real E2B | 3 | tests/release/src/scenarios/t3-prov-2.ts (T3-PROV-2; same scenario) |
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
| Secrets CRUD in UI: org, personal, file secrets | 2 | tests/intent/specs/secrets.spec.ts (T2-SEC-1; personal/org CRUD and workspace configuration seam) |
| Org secret set → materializes into the owner's personal cloud sandbox | 3 | tests/release/src/scenarios/t3-sec-mat-1.ts (T3-SEC-MAT-1; #1042 — real and green on --lane local: personal + org env-var secrets PUT, materialization polled to ready, then E2B-direct in-sandbox verification of global.env content and manifest sha256s, plus the update-propagation cycle; RELEASE_E2E_E2B_API_KEY-gated, expected-fail without it; blocked, not red, when the durable org's cloud-sandbox credits are exhausted) |
| Personal secret set → materializes into the owner's personal cloud sandbox | 3 | tests/release/src/scenarios/t3-sec-mat-1.ts (same scenario) |
| Workspace file secret set → lands at the right path in a fresh cloud workspace | 3 | tests/release/src/scenarios/t3-sec-mat-1.ts (same scenario; this half needs a seeded GitHub App user authorization for the durable identity — real on --lane local when the seed is available, expected-fail citing #1043's environmental gap otherwise; never attempted on --lane staging) |

## Integrations

| Flow | Tier | Test pointer |
| --- | --- | --- |
| Connect integration (real api_key definition, placeholder key, no outbound), toggle on/off | 2 | tests/intent/specs/integrations.spec.ts |
| Authenticate a real integration; **every cataloged harness** uses it through the gateway — local lane AND sandbox lane | 3 | tests/release/src/scenarios/t3-int-1.ts (T3-INT-1; local lane implemented end-to-end: connect exa (api_key) → provision a real gateway grant (desktop enrollment + worker enroll) → write the integration-gateway dotfile → a real cheap agent turn calls exa through the gateway → assert a `cloud_integration_tool_call_event` row (ok=true) via integration_audit_probe.py; org-policy toggle-off asserts the enumerated `integration_provider_disabled` + a failure audit row once. Needs RELEASE_E2E_INTEGRATION_API_KEY + RELEASE_E2E_LOCAL_DATABASE_URL (both wired in the CI local lane). Sandbox lane reuses T3-CHAT-1's in-sandbox session driver (#1042). Uses an api_key-kind seed (exa) — cataloged Slack is oauth2/hosted-MCP, #1030) |

## Self-hosting

Every self-hosted deploy is the production compose bundle (hand-run
`bootstrap.sh` or the AWS one-click), single-org, claimed once via `/setup`.
Canonical guarantee IDs and journeys live in `core-release-validation.md`, the
target manifest, and the Tier 3/4 scenario contracts. `self-hosting.md` is the
legacy implementation/evidence hand-off for the pointers below.

| Flow | Tier | Test pointer |
| --- | --- | --- |
| Single-org mode derives from telemetry mode (`!= hosted_product`), override wins both directions | 1 | server/tests/unit/test_telemetry_mode.py (T1-SH-1; self_managed AND local_dev single-org, hosted_product multi-org, `SINGLE_ORG_MODE`/`PROLIFERATE_SINGLE_ORG_MODE` override forces either way) |
| SSO env-var canonical form: every `SSO_*` ≡ `PROLIFERATE_SSO_*` | 1 | server/tests/unit/test_sso_env_aliases.py (T1-SH-2; structural pair sweep over all 19 SSO fields + functional bare/prefixed equivalence) |
| `/meta` version wire contract (the connect dialog's trust screen reads it) | 1 | server/tests/unit/test_meta_endpoint.py (T1-SH-3; golden field names + order on the response model and the live JSON — rename/reorder guard) |
| Connect to a self-hosted server: dialog validation, trust screen, switch A→B | 2 | — (T2-SH-1; the connect affordance is Tauri-gated (LoginScreen.tsx:117) and never renders in the desktop-web build this suite boots, and the `set_app_config` write + relaunch + credential store throw outside Tauri — tier-3 by ruling, self-hosting.md §4. Registered not-yet-implemented rather than faked) |
| `/setup` claim → claimer is OWNER of the single instance org; re-claim permanently closed (404) | 2 | tests/intent/specs/self-hosting.spec.ts (T2-SH-2; extends T2-AUTH-1 — owner role on the one `is_instance` org, second context gets the closed 404 API + rendered page) |
| Invite → `/register` with the invitation token → invitee sign-in; wrong-email rejected | 2 | tests/intent/specs/self-hosting.spec.ts (T2-SH-3; token = invitation id, delivery skipped locally; real token + mismatched email → uniform 403, no account minted) |
| Adaptive sign-in surface driven by `GET /auth/desktop/methods` + github availability | 2 | tests/intent/specs/self-hosting.spec.ts (T2-SH-4; no GitHub env → real password-only surface, no GitHub button; GitHub advertised → the button replaces the password form. With-GitHub asserted at the availability boundary — a real GitHub-configured server for the browser UI is tier-3 per §4, same ruling as T2-AUTH-4) |
| `/meta` capability contract holds on a REAL running process (not a synthetic Settings object): self-managed/add-ons-off advertises everything false; hosted mode advertises everything true | 2 | tests/intent/specs/capability-contract.spec.ts (T2-SH-5; two dedicated ephemeral server-only boots, no desktop-web/AnyHarness needed for `/meta`) |
| Cloud-workspace provisioning stays safe when E2B is half-configured: control plane comes up healthy (never crash-loops), a real create request gets the actionable 503 | 2 | tests/intent/specs/cloud-provisioning-gating.spec.ts (T2-SH-6; ephemeral server-only boot, `DEBUG=false` + `E2B_API_KEY` set + `E2B_TEMPLATE_NAME` empty — the shared stack's `DEBUG=true` posture can't reach this case) |
| SSO discover truthfulness: a connection marked enabled but missing required OIDC config still reports enabled=false with the specific reason, never a false positive | 2 | tests/intent/specs/sso-entry-points.spec.ts (T2-SH-7 / extends T2-AUTH-5; seeded via `seedIncompleteEnabledOrgSsoConnection`, `oidc_client_id_missing` by org-id query; slug query still collapses to the non-enumerating generic answer) |
| Gateway model eligibility: session creation on a gateway-only route rejects a bare native model id and accepts a real gateway-catalog id | 2 | tests/intent/specs/gateway-eligibility.spec.ts (T2-SH-7; runtime-dependent — self-skips, not fails, when the local AnyHarness runtime is unreachable, matching workspace-entry.spec.ts's documented precedent; the CURRENT CI profile sets TIER2_INTENT_SKIP_RUNTIME=1 so this is real-locally/CI-when-unblocked today, not yet enforced in the merge gate) |
| Cold boot to second user on real infra (bootstrap → claim → invite → register → login over real TLS/DNS) | 3 | tests/release/src/scenarios/selfhost/t3-sh-1.ts (T3-SH-1; provisions a throwaway EC2 box via tests/release/scripts/selfhost-box.sh — production compose bundle, sslip.io + real Caddy TLS — walks the journey over real TLS and asserts the rows in the instance Postgres, then terminates. Gated behind RELEASE_E2E_SELFHOST_PROVISION) |
| Real (Tauri) desktop connect to alpha/beta: relaunch + config.json + keychain end-to-end | 3 | tests/release/src/scenarios/selfhost/t3-sh-2.ts (T3-SH-2; the only lane that proves the Tauri connect slice T2-SH-1 can't — reports blocked until the headless native connect driver exists, the analogue of the T4-DESKTOP-1 updater-driver) |
| Model gateway real product path: enroll route (state.json only) → create session with no workspace-env injection (#1106) → real streamed turn on a gateway-eligible model | 3 | tests/release/src/scenarios/t3-gw-1.ts (T3-GW-1; local runtime lane, supplements T3-SH-3's direct completion — asserts the shipped workspace→session→turn path over the gateway with the credential living only in `agent-auth/state.json` and a concrete gateway model id resolved, never a bare native selector. Needs a reachable local AnyHarness runtime + RELEASE_E2E_GATEWAY_TEST_KEY/_BASE_URL; BLOCKED otherwise. Eligibility-rejection half pinned at unit tier, `catalog::service_tests::gateway_context_gates_native_ids_and_offers_only_gateway_models`, AND now proven for real at tier 2 without needing a real gateway key — tests/intent/specs/gateway-eligibility.spec.ts, T2-SH-7) |
| Model gateway add-on: `--profile agent-gateway` + LiteLLM → real agent response | 3 | tests/release/src/scenarios/selfhost/t3-sh-3.ts (T3-SH-3; real cheapest-model (claude-haiku-4-5) completion through the standing box's public gateway route (Caddy /llm), plus read-only SSH assertions that the profiled litellm service is healthy + AGENT_GATEWAY_ENABLED — read-plus-additive, never brings the standing add-on up/down. Green live 2026-07-09 against the alpha box, serverVersion 0.3.18. Needs RELEASE_E2E_SELFHOST_URL + RELEASE_E2E_GATEWAY_TEST_KEY; SSH assertions optional) |
| Base-install capability contract holds on the real deploy artifact: never hosted_product, never vendor support/pricing, never a hosted web app, `/meta`/`/health` versions agree | 3 | tests/release/src/scenarios/selfhost/t3-sh-4.ts (T3-SH-4; read-only against the standing box, RELEASE_E2E_SELFHOST_URL — posture-agnostic on add-ons so it never competes with T3-SH-3's gateway-on state; BLOCKED without that var) |
| Adaptive sign-in surface is truthful on the real deploy artifact: password login always advertised, github methods/availability agree, SSO discover survives with no context | 3 | tests/release/src/scenarios/selfhost/t3-sh-5.ts (T3-SH-5; read-only against the standing box, RELEASE_E2E_SELFHOST_URL; no login attempted — this box's real admin credentials are not available to the scenario; BLOCKED without that var) |
| Operator update motion: `./update.sh` migrates + restarts, `/meta` reports N, data intact | 4 | tests/release/src/scenarios/upgrade/t4-sh-1.ts (T4-SH-1; boots a box at N-1, claims, runs ./update.sh to N, asserts migrations + health + /meta == N + the pre-update admin still logs in. Gated behind RELEASE_E2E_SELFHOST_PROVISION) |
| Desktop artifact chain valid per release (server redirect follows, CDN manifest fresh, every platform artifact HEAD 200, tag contains the SHA) | 4 | tests/release/src/scenarios/upgrade/t4-sh-2.ts (T4-SH-2; the 2026-07-09 incident test — pure HTTP + git, no box, so it runs in the release gate via .github/workflows/release-e2e-selfhost.yml, self-hosting.md §5) |

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
| Seat-based Core billing: invite/remove/re-invite reconciles Stripe quantity + proration grants, no double-grant | 2 | tests/intent/specs/billing/seats.spec.ts (T2-BILL-3; current collector still reflects pre-migration allocations) |
| Core checkout: new-org-via-checkout activation + failure/expiry terminal states | 2 | tests/intent/specs/billing/seats.spec.ts (T2-BILL-4; intent-create + activation idempotency; failed_billing_state/expiry noted tier-1) |
| Compute overage: bills metered usage up to cap, writes off past it, then hard-blocks; disabled → immediate cutoff | 2 | tests/intent/specs/billing/overage.spec.ts (T2-BILL-5) |
| LLM credits: exhaustion disables key, admin caps independent of credit refill, auto top-up incl. declined-card fail-closed | 2 | tests/intent/specs/billing/overage.spec.ts (T2-BILL-6; balance/cap surfaces + fail-closed top-up; LiteLLM key-disable is tier-3) |
| Stripe webhook robustness: duplicate/replay idempotent, concurrent 409, failure retried once-only, out-of-order safe | 2 | tests/intent/specs/billing/webhooks.spec.ts (T2-BILL-7) |
| Subscription edges: payment-failed hold + clear, mid-period cancel + rollover grace, billing modes off/observe/enforce, one-trial-per-GitHub-identity | 2 | tests/intent/specs/billing/webhooks.spec.ts (T2-BILL-8; finding-7 subscription.deleted hold pinned expected-fail — issue filed) |
| Usage surfaces truthful: seeded usage matches summary/timeseries/by-user/llm-balance APIs + UI | 2 | tests/intent/specs/billing/usage.spec.ts (T2-BILL-9; #1028 org-attribution guarded by T2BILLING_ORG_COMPUTE_ATTRIBUTION flag) |
| Credits consumed properly: real session → LLM **and compute** meter events + credit decrement match consumption; Stripe webhook delivery live on staging | 3 | tests/release/src/scenarios/t3-bill-1.ts (T3-BILL-1; ledger reader + as-built compute-attribution assertion green via billing_probe.py; LLM half blocked on RELEASE_E2E_GATEWAY_TEST_KEY, compute half blocked on github_link_required + public webhook URL. Compute-attribution asserted via ORG_COMPUTE_ATTRIBUTION_FIXED, true since #1028 merged; the paying subject stays personal) |
| Out of credits: sandbox paused and not accessible — **including every bypass route** (direct API resume, stale session, webhook race, pre-exhaustion key, other org member, trigger-driven start) | 3 | tests/release/src/scenarios/t3-bill-2.ts (T3-BILL-2; exhaustion setup via drain-grants green; enforcement + 6-route bypass sweep blocked on github_link_required — cloud routes need a real sandbox + gate lift PR #1023) |
| Out of credits: gateway LLM access gated; reactivates on refill | 3 | tests/release/src/scenarios/t3-bill-2.ts (T3-BILL-2, LLM side; blocked on RELEASE_E2E_GATEWAY_TEST_KEY — no key to reject) |
| Overage bills real money correctly: compute metered events + amounts match up to cap then hard-block; LLM auto top-up charges once then fail-closes on payment failure | 3 | — |

## Upgrade & release

The target contract and current red gaps live in
[`tier-4-scenario-contract.md`](tier-4-scenario-contract.md). These pointers
name current collectors only; they do not imply complete qualification.

| Flow | Tier | Test pointer |
| --- | --- | --- |
| Desktop real N−1 → N update, bundled AnyHarness, installed native CLI/ACP reconciliation, preserved session, post-update turn | 4 | tests/release/src/scenarios/upgrade/t4-desktop-1.ts (current partial collector; not qualifying) |
| Existing E2B sandbox N−1 → candidate AnyHarness N through heartbeat and Supervisor ownership, installed native CLI/ACP reconciliation, preserved session, post-update turn | 4 | tests/release/src/scenarios/upgrade/t4-cloud-1.ts (current direct-Worker prototype; not qualifying; version-stamping blocker #1089) |
| Change-triggered self-host `update.sh` preserves data/auth/config and remains recoverable on failure | 4 | tests/release/src/scenarios/upgrade/t4-sh-1.ts (current collector requires execution audit) |
| Public release artifact chain is complete and immutable before feeds/tags move | 4 | tests/release/src/scenarios/upgrade/t4-sh-2.ts (current collector requires execution audit) |
| Forward migrations preserve retained Postgres, AnyHarness SQLite, and Worker SQLite state | 4 | — |

The target Tier 3 local-runtime contract derives every supported harness and
visible configuration from the live probe, including OpenCode. It exercises
managed LiteLLM and user API-key routes in GitHub Actions. Native CLI-login
permutations are deliberately outside that qualification matrix.
