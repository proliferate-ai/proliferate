# Triage: integrations + agent auth (2026-08-25)

Reproduce-only pass against `main` at `7109bbf32` (all cull-sweep PRs and the
six system-spec clusters merged). Nothing was fixed here. Each entry names the
owning spec, the exact repro, the evidence, and the smallest fix + pinning test.

## The headline

**The server side of both systems is green; the product is broken in the
client's gating layer.** Every Proof suite the two specs list passes on `main`
(integration gateway: 251 server tests; agent auth: 214 server tests; the
client vitest surfaces for both: 890 tests across 115 files). What breaks in
the shipped desktop app is one constant:

```ts
// apps/packages/product-client/src/lib/domain/capabilities/cloud-compute.ts
export const CLOUD_COMPUTE_TEMPORARILY_DISABLED = true;
```

`cloudComputeEnabled` folds that constant in
(`lib/domain/capabilities/app-capabilities.ts:164-165`), and
`cloudActive = cloudComputeEnabled && authenticated`
(`hooks/cloud/derived/use-cloud-availability-state.ts:33`) is therefore
**false for every signed-in production user**. Four control-plane features —
none of which involve cloud compute — still gate on `cloudActive`, so they are
unreachable code in production. That is what "integrations are broken" and
"agent auth is broken" are.

Two of the four already have an open, unmerged fix (#2133, open since
2026-08-21). The composer half has no fix yet.

## Bug ledger (by severity)

### AA-1 · First-run gateway adoption never runs → fresh accounts have no launchable model

- **Severity:** blocks-golden-path (every new account on the hosted product).
- **Owning spec:** `specs/codebase/systems/product/agent_auth/README.md`
  § 5 Laws ("Native is the absence of rows") and § 9 Proof (client);
  surface owner `specs/codebase/systems/product/onboarding/README.md`.
- **Bucket:** bug.
- **Repro:** sign in on Desktop with a fresh profile that has no native
  harness credentials → open a gateway-capable harness (claude/codex) → the
  runtime reports no launchable model. Code path:
  `hooks/agents/lifecycle/use-first-run-auth-adoption.ts:30-35,52` gates the
  whole adoption effect on `cloudActive`; `use-auth-setup-onboarding-step.ts:48,86,92`
  gates the ack watcher the same way. With `cloudActive === false` the user
  keeps zero `agent_auth_selection` rows, the rendered `state.json` omits the
  harness, and the harness runs "native" against credentials that do not exist.
- **Observed vs expected:** observed — adoption effect returns early, zero
  selections, "no launchable model"; expected — the managed gateway route is
  adopted on first run (the effect's own doc comment).
- **Evidence:** file/line above; PR #2133's description verified live that
  `https://app.proliferate.com/api/meta` returns `cloudWorkspaces: true` and
  `agentGateway: true` (the server says cloud is on; the client constant
  overrides it). Negative control in that PR: reverting the source fails 26 of
  55 tests.
- **Fix:** merge #2133 (`fix/decouple-agent-auth-from-cloud-compute`) — gates
  the three hooks/panes on `authenticated && controlPlaneReachable`, the same
  decoupling `lib/domain/agents/local-auth-state.ts` (`shouldSyncLocalAuthState`)
  and `render-settings-section.tsx:52-63` (`authGate`, ADR FM6/Q9) already
  apply. Rebase needed (opened before the cull; mergeability was recomputing
  at the time of writing).
- **Pinning test:** the PR's suites run with `cloudActive: false` for the
  whole file — re-coupling any of the three fails the file.

### AA-2 · API keys pane renders a dead "Cloud is not configured" gate instead of the BYOK vault

- **Severity:** degraded (the harness pane's inline key creator still works;
  list/revoke and the pane the nav points at do not).
- **Owning spec:** agent_auth § 3 Public surface (vault routes) / settings
  surface spec.
- **Bucket:** bug.
- **Repro:** Settings → API keys while signed in on production.
  `render-settings-section.tsx:70-71` routes the pane through `authGate`
  (authenticated), then `ApiKeysPane.tsx:41-44,126-149` re-couples to
  `cloudActive` and renders the `cloudNotConfigured` empty state with
  `data-api-keys-state="gated"`.
- **Observed vs expected:** "Cloud is not configured" for a signed-in user on
  a server whose contract says cloud is configured; expected the vault.
- **Evidence:** the two files contradict each other on `main`; #2133 fixes
  and re-copies the empty state (`serverUnreachable`).
- **Fix / test:** in #2133.

### IG-1 · Composer integrations control is permanently hidden (reauth warnings never reach the composer)

- **Severity:** degraded, but it defeats a law: the composer is the one
  pre-run surface, and "health rolls up into readiness *before* anything runs
  on it" (integration_gateway § 5) cannot hold if the composer never reads
  health.
- **Owning spec:** `specs/codebase/systems/product/integration_gateway/README.md`
  § 6 Emits ("health verdicts … consumed by the chat composer's integrations
  control") and `chat/README.md` (the consuming surface).
- **Bucket:** bug + spec gap — the test file pins the wrong law.
- **Repro:** connect any integration in Settings (works — `UserIntegrationsPane`
  is routed through `authGate`), return to a workspace: the composer never
  shows the plug/count or the "Linear needs re-authentication" chip.
  `hooks/cloud/derived/use-composer-integrations-state.ts:34-40` passes
  `enabled: cloudActive` to `useIntegrationHealth`, so the query is disabled
  and `deriveComposerIntegrationsModel([])` yields `mode: "hidden"`;
  `ChatInputControlRow.tsx:167` mounts the control unconditionally, and the
  control returns `null` in hidden mode (`ComposerIntegrationsControl.tsx:37`).
- **Observed vs expected:** settings shows connected/needs-reauth providers;
  the composer shows nothing. Expected: the same health items drive the
  composer (they share the react-query key by design).
- **Evidence:** `use-composer-integrations-state.test.tsx:99-108` — "disables
  the query when cloud is inactive" — codifies the coupling; the settings
  router comment (`render-settings-section.tsx:52-58`) names integrations as
  a control-plane feature that must not depend on `cloudComputeEnabled`.
- **Fix:** gate on `authenticated && controlPlaneReachable` (import
  `shouldSyncLocalAuthState`'s shape or a shared `useControlPlaneAuthReady`);
  flip the test to "disables the query when signed out / unreachable" and add
  "renders health with cloud compute disabled". Not covered by #2133.
- **Pinning test:** the flipped test above, run with `cloudComputeEnabled:
  false` as the file default.

### IG-2 · OAuth return deep link can be dropped on Desktop launch (PRO-354)

- **Severity:** degraded / intermittent — bites when a queued launch deep link
  ahead of the OAuth callback rejects (e.g. an auth callback whose exchange
  fails), or when the live-listener registration failed once and stayed
  cached as failed for the process.
- **Owning spec:** desktop-host seam
  (`specs/codebase/systems/runtime/desktop-host/README.md`) — the OAuth
  callback surface is integration_gateway's (`connections/pages.py` renders the
  desktop deep link) but the drain is the host's.
- **Bucket:** bug.
- **Repro:** per #2171: launch Desktop with two queued deep links where the
  first handler rejects — the second (`workspaces/:id`, or an OAuth callback)
  is never delivered; separately, one transient `onOpenUrl` registration
  failure disables native live deep-link forwarding for the session
  (`apps/desktop/src/lib/access/tauri/deep-link.ts`).
- **Evidence:** open PR #2171 (`taira/pro-354-…`, since 2026-08-21) with two
  regression tests; not merged.
- **Fix / test:** merge #2171 after rebase.

### IG-3 · Health probes run only on demand; with IG-1 the only probe is a settings-pane visit

- **Severity:** degraded (silent expiry until someone opens Settings).
- **Owning spec:** integration_gateway § Current gaps ("Convergence legs").
- **Bucket:** spec gap (already ledgered; this pass confirms the live effect).
- **Repro / evidence:** `connections/health.py:93,142-198` — the active OAuth
  probe runs inside `GET /integrations/health`; nothing schedules it. The
  composer's 5-minute `refetchInterval` (`use-composer-integrations-state.ts:24`)
  was the de-facto scheduled probe and is disabled by IG-1, so a
  `needs_reauth` transition is not observed until the settings pane loads.
- **Fix:** the spec's scheduled-probe task; IG-1's fix restores the interim
  behavior.

### AA-3 · Credit exhaustion is illegible: launch fails with `AGENT_ROUTE_SELECTION_MISSING`, never "credits exhausted"

- **Severity:** degraded (correct fail-closed behavior, wrong explanation).
- **Owning spec:** model_gateway (`specs/codebase/systems/product/model_gateway/README.md`);
  consumer agent_auth § Failure modes ("Subject's gateway credit exhausted").
- **Bucket:** spec gap.
- **Repro / evidence:** `server/agent_auth/budget.py` docstring: "NO
  PRODUCT-SERVER ROUTE EMITS THIS TODAY" for
  `agent_gateway_credits_exhausted`; the renderer
  (`cloud/materialization/materialize/agent_auth.py:543-566`) withholds the
  gateway key with only a server-side `logger.warning`, so the rendered
  document carries a present-but-empty harness and the runtime refuses
  create/launch with `409 AGENT_ROUTE_SELECTION_MISSING` — the same code a
  misconfigured selection produces. The user sees "selection missing", not
  "out of credits".
- **Fix:** render a typed `unsatisfiable_reason: "credits_exhausted"` rider on
  the harness entry (fixture v2 → v3 or an additive field old readers ignore)
  and surface it in `HarnessAuthSection`; pin with a renderer unit test +
  `auth_state.rs` display test.

### AA-4 · Agent-auth renderer + three after-commit calls still live in `server/cloud/materialization/` (PR-Ab hazard)

- **Severity:** cosmetic today; blocks-golden-path the moment part 2 deletes
  `materialization/` without the relocation.
- **Owning spec:** agent_auth § Known gaps (first item). **Bucket:** seam
  change (agent_auth ↔ environments).
- **Evidence on `main`:** `server/agent_auth/service.py:57-58`,
  `enrollment.py:46`, `topups.py:61` import
  `proliferate.server.cloud.materialization`. Track A reports the renderer is
  relocated to `server/agent_auth/state_render.py` on
  `cull/delete-dark-cloud-part2`; not verified here (branch had no commits
  pushed at the time of this pass).
- **Pinning test:** an import-boundary test that `server/agent_auth` has no
  `server.cloud` importer, plus the existing renderer/fixture suites moving
  with the file.

## The class, not the instances

34 non-test files consume `cloudActive`. Most are legitimately compute-gated
(cloud workspaces, repo environments, billing surfaces, migrate/expose flows).
The four that are control-plane features wrongly coupled are exactly AA-1,
AA-2 (both in #2133) and IG-1 (unfixed):

```
hooks/agents/lifecycle/use-first-run-auth-adoption.ts       AA-1  (#2133)
hooks/agents/lifecycle/use-auth-setup-onboarding-step.ts    AA-1  (#2133)
components/settings/panes/agents/api-keys/ApiKeysPane.tsx   AA-2  (#2133)
hooks/cloud/derived/use-composer-integrations-state.ts      IG-1  (open)
```

The same regression has now been fixed three separate times in this codebase
(`shouldSyncLocalAuthState`, the settings `authGate`, #2133). Proposed guard:
a frontend fence rule (Track G's `check_frontend_fences.py`) that allows
`cloudActive` / `cloudComputeEnabled` imports only from an explicit
cloud-compute allowlist, with the four files above as the seeded negative
cases. Bucket: system change on the client fences.

## Verified NOT broken on `main` (so nobody chases these)

| Suite | Result |
| --- | --- |
| integration_gateway Proof (11 unit + 18 integration files) | 251 passed |
| agent_auth Proof (7 unit + 11 integration files) | 214 passed |
| client: `hooks/cloud`, `hooks/access/cloud/integrations`, `lib/domain/{cloud,settings,agents}`, `hooks/agents`, `components/settings/panes`, `components/workspace/chat/input`, `lib/workflows/cloud` | 890 passed / 115 files |

Also read and found consistent with the specs: the gateway grant dependency
(`gateway/dependencies.py` re-validates org membership per request), desktop
enrollment (`seam/workers/service.py:148-201`; `pending_ticket_policy`
defaults to `newest_wins`, so the client's rollout gate passes), the runtime's
gateway MCP injection (`mcp_bindings/integration_gateway.rs` reads
`<runtime_home>/integration-gateway.json`, independent of cloud compute), and
the desktop origin guard (`state.rs:172-182` normalizes case + trailing slash;
the desktop stamps `PROLIFERATE_API_BASE_URL_ORIGIN` at spawn,
`sidecar.rs:324-329`).

Run notes: server suites must run sequentially (`-p no:xdist`) with
`DATABASE_URL`, `JWT_SECRET`, `CLOUD_SECRET_KEY` set (the CI env in
`server-ci.yml:342-345`); client suites need the workspace packages built
first (`cloud-sdk`, `anyharness/sdk(+react)`, `cloud-sdk-react`, `design`) or
every suite fails at import.

## Not exercised (needs credentials or a live surface)

- **OAuth connect/reconnect end to end** — `CLOUD_MCP_SLACK_CLIENT_ID/SECRET`,
  `CLOUD_MCP_GOOGLE_WORKSPACE_OAUTH_CLIENT_ID/SECRET`,
  `CLOUD_MCP_OAUTH_CALLBACK_BASE_URL`, `CLOUD_MCP_SLACK_DISTRIBUTION_READY`,
  and a provider app that redirects to a reachable callback.
- **Gateway tool calls against a real provider** — a ready
  `cloud_integration_account` with live credentials; Linear (api-key
  definition) is the cheapest.
- **Model gateway / virtual keys / credit exhaustion live** —
  `AGENT_GATEWAY_ENABLED`, `AGENT_GATEWAY_LITELLM_BASE_URL`,
  `AGENT_GATEWAY_LITELLM_MASTER_KEY`, a running LiteLLM.
- **Desktop shell paths** (worker enrollment over the Tauri bridge, deep-link
  drain, `state.json` push to the local runtime) — need the built desktop app;
  reasoned from code and the two open PRs instead.
- **Production Sentry / `api/meta`** — not accessed from this pass; the live
  `cloudWorkspaces: true` claim is #2133's, dated 2026-08-21.

## Suggested order

1. Rebase + merge #2133 (AA-1, AA-2). 2. Fix IG-1 the same way (one hook, one
test flip). 3. Rebase + merge #2171 (IG-2). 4. Add the `cloudActive` fence
rule. 5. AA-3 and IG-3 ride the model_gateway / integration_gateway rebuilds;
AA-4 is PR-Ab's acceptance.
