# Live validation runbook — the agents/auth re-cut

Audience: a Claude Code session running on the founder's machine, with the
local `.env` credentials, AWS CLI, E2B access, and the staging LiteLLM proxy.
Everything sandbox-provable has already been verified and merged; your job is
the LIVE column only. Do not re-run the unit/integration suites — they are
green on main and re-running them proves nothing new.

## What you are validating (context in 60 seconds)

Main (from `15098c21a` forward) contains the full re-cut of the agent
auth/catalog/gateway stack, landed as: #1547 (integration of the 25-PR
stack), #1548 (re-cut specs + Proof ledgers), #1551 (D train: org-only
billing), #1552 (B train: composed observation), #1553 (C train:
acknowledged delivery), #1556 (docs reconciliation), #1558 (typed-config
write gate). The specs on main are the authority:
`specs/codebase/platforms/product/{agent-auth,model-catalog,model-gateway}.md`
— their Proof sections name every acceptance assertion; the ones below are
the deferred LIVE halves. The five one-liners that govern everything:
native is absence; the probe is a launch; applied means acknowledged;
unfunded fails closed; the observation is the menu.

## Credentials / environment expected

From the local `.env` (repo root or `~/proliferate/.env`):
`AGENT_GATEWAY_ENABLED=true`, `AGENT_GATEWAY_LITELLM_BASE_URL` (STAGING —
never prod), `AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL`,
`AGENT_GATEWAY_LITELLM_MASTER_KEY`; `E2B_API_KEY`, `E2B_TEMPLATE_NAME`;
`RELEASE_E2E_*` (server URL, gateway base/test key, durable user, BYOK
anthropic key) for the release scenarios; AWS credentials for Bedrock;
optionally an Azure OpenAI endpoint+key for the opencode azure cell and —
only if quota landed — the Foundry attempt. `STRIPE_TEST_SECRET_KEY` only
for t3-bill-4.

Staging discipline: create per-run aliases/orgs (suffix them with a run id),
and delete the LiteLLM teams/users/keys you mint at the end. Staging is
shared state.

## The validation matrix (in order)

### 1. D4-live — org-only billing against real LiteLLM staging

Fresh signup (new GitHub identity or the durable test user reset per your
local convention) with the gateway enabled against staging:

- LiteLLM team exists named `org-<org-uuid>`; LiteLLM user
  `org-<org>-user-<user-uuid>` (per-(org, member) — NOT the old bare
  `user-<uuid>`); exactly 4 harness keys (claude/codex/opencode/grok —
  cursor must be absent), each key's models = its own access group only.
- Team `max_budget` mirrors the free-credit grant (never null/0-as-uncapped).
- Drain the grant (chat until exhausted or shrink the grant admin-side):
  keys stop completing; team budget mirrors the exhausted floor **$0.01 —
  never literal 0**. An unfunded org must refuse, not become unlimited.
- Attribution: after a few completions, the spend rows resolve to the right
  (user, org, harness); the importer's needs_review lane stays empty.

### 2. D6-live echo — the migration against staging

Seed (or find) a pre-D-shaped account: personal enrollment row + old-format
`user-<uuid>` LiteLLM identity. Run one backfill tick
(`run_enrollment_backfill_once` path — the worker does it on schedule; you
can trigger via the worker or a shell into the server). Verify: org
enrollment exists with per-(org, member) identity; remaining credit moved
exactly (no duplicate free grant); OLD keys revoked on the proxy (LiteLLM
key list); personal row retired. Run the tick twice — second pass is a
no-op. KNOWN/EXPECTED: D-2-era org enrollments rotate their keys once on
the next sync (fingerprint material widened) — not a bug.

### 3. Release scenarios (D5 + C7) — REWIRE FIRST

⚠️ `tests/release/src/scenarios/t3-bill-4.ts` still asserts the FREE GRANT
ON THE PERSONAL SUBJECT (pre-D semantics, ~line 41). Running it unmodified
against post-D staging produces a FALSE failure. Rewire it (and any sibling
asserting personal-subject billing) to the org subject first — grant on the
default org's billing subject, team `org-<uuid>` — then run t3-bill-4.
Also grep `tests/release` for stale `ensure_user_enrollment` comments
(selfhost-qual-1.ts:759, tier2/t2-bill.ts:995) — cleanup, not blockers.
C7's release half: fresh signup on a healthy stack → the desktop
"Setting up your agents…" onboarding card resolves within the ~20s grace;
then with LiteLLM unreachable (point the base URL at a dead port) → signup
still completes, card auto-advances at grace, harness panes show the
ordinary pending state, NO error surface.

### 4. E2B — cloud delivery + composed observation end-to-end

- Cloud auth switch on a SLEEPING sandbox: flip a harness's cloud selection
  in settings → the sandbox provisions/wakes (ensure-on-switch), state.json
  lands (0600, correct content for the selection), and the selection flips
  pending→applied via the materialization ack (watch the `applied` field on
  GET selections).
- Worker sync: launch a harness in the sandbox → one composed
  `model-snapshot.json` (schemaVersion 2, no `entries` map) per harness is
  uploaded; the web picker with no runtime attached serves it.
- KNOWN GAP (ruled, recorded in agent-auth.md's gap list): an AWAKE
  sandbox's probe engine gets no auth-applied poke — observation lags until
  next wake/startup. Confirm the lag exists and is bounded; do not file it
  as a bug.

### 5. Typed keys live (Bedrock / Azure)

- Bedrock × claude (AWS creds local): save a typed `aws_bedrock` vault entry
  (region + bearer token), select it for claude, launch → session env has
  `CLAUDE_CODE_USE_BEDROCK=1` + region/credential vars, and a real
  completion returns. Repeat for codex (renders config.toml via the
  built-in amazon-bedrock provider) and opencode if time allows.
- Azure × opencode (if an Azure key is local): endpoint + apiKey only (the
  `deployment` field is gone by ruling R5) → working completion.
- Foundry (azure × claude): ONLY if quota landed. It is registry-`pending`;
  a successful live run is what flips the flag (separate small PR editing
  `catalogs/agents/registry.json`). If untested, leave pending.

### 6. Desktop QA (~15 min, the founder can drive)

1. Switch claude local auth gateway→api_key: pane shows "Applying…" then
   applied; model list refreshes (auth-apply probe event).
2. With a running claude session, switch auth → modal appears: EXACTLY
   "Restart running sessions on old auth?" / "yes, restart now" / "no",
   listing only that harness+surface's running sessions. "yes" relaunches
   in place — SAME session, transcript preserved. Decline → nothing, no
   badge, and a re-switch re-offers.
3. All-Models per harness: one composed observation, "refreshed N min ago",
   provenance line (binary + install identity) muted; kill the credential
   (revoke the key) and Refresh → last-good list stays, "last refresh
   failed" badge appears — never an empty picker.
4. opencode with gateway + a provider api_key enabled: the model list is
   the honest union, provider carried per model.
5. Unsupported saved model: pick a model, switch auth so it vanishes,
   launch → single typed refusal naming the active universe (no "gated"
   language anywhere).
6. cursor: no gateway option offered; api_key slot works; probe only via
   manual refresh.
7. Fresh-signup onboarding: the "Setting up your agents…" card (see §3).

## Known pitfalls (do not rediscover these)

- `authenticated-markdown-cascade.test.ts` needs Chrome — the one known
  pre-existing test failure; ignore it and nothing else.
- Login first-load JS budget: 484,707/485,000 bytes — 293 B headroom. Any
  frontend change you make must not touch the login chunk (verify with
  `node scripts/measure-login-runtime-budget.mjs` after `pnpm web:build`).
- PR hygiene if you push fixes: strict `type(scope): change` title (no `!`),
  exactly one `release:*` label, every `area:*` the diff touches,
  `scripts/check_max_lines.py` allowlist pinned to observed,
  `check_appearance_scaling.py` (no ≤10% foreground-alpha overlays; JSX
  `{list.map(` in non-virtualized files trips the long-list rule),
  `check_docs.py` for spec edits.
- The typed-config UI submit handler is a KNOWN placeholder
  (`HarnessAuthApiKeyDetails.tsx`) — the settings-surface pass (#1554 step
  3) owns it. Validate typed keys via the API/store path or the fields that
  do work; do not fix the handler ad hoc.

## Reporting back

Produce a table mirroring the matrix: item → PASS / FAIL(evidence) /
BLOCKED(missing cred) / SKIPPED(reason), plus any staging resources you
could not clean up. File failures as comments on the owning PR (#1551
billing, #1552 catalog, #1553 delivery, #1558 typed keys) rather than new
issues, so the corridor context is attached. The Proof-ledger IDs these
runs close: D4(live), D5, D6(live echo), C7(release half), A5(live typed),
plus the E2B halves of B's cloud-copy items.
