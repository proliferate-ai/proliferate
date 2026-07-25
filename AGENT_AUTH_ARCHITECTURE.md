# Agent Auth — End-to-End Architecture & Reading Guide

> Companion doc for the file-by-file review of the agent-auth / LiteLLM stack.
> The premise of the whole system: **users control how each coding agent authenticates** —
> self-hosted credentials (their own API keys, or the CLI's native login on their machine)
> or the managed gateway (LiteLLM virtual keys, metered + billed by us). This doc walks the
> full path from Postgres to a spawned CLI process, bottom-up, with the exact files to read
> at each layer.
>
> Spec of record: `specs/codebase/primitives/agent-auth-litellm.md` (PR #825). Read §0
> (decision register) and §3.3 (schema) before anything else; §13 has the resolved risks.
>
> **You are reading this inside `agent-auth-full`** — the integration worktree with the
> whole stack merged (13-tip + 08/09 + 11 + 12, local branch `agent-auth/full-integration`,
> never pushed). Every path below resolves directly in this checkout.

## 0. Where the code lives (worktrees + PR map)

All branches are rebased onto post-UX-wave `main`, squashed to **one commit per PR**.
Per-PR worktrees under `~/.proliferate/worktrees/proliferate/` (use these to review each
PR's isolated diff; use *this* worktree to read the final composed system):

| PR | Branch | Worktree | Contents |
|----|--------|----------|----------|
| #825 | `agent-auth/00-spec` | `agent-auth-00-spec` | spec only |
| #814 | `agent-auth/01-bifrost-teardown` | `agent-auth-01-…` | delete Bifrost world |
| #818 | `agent-auth/02-litellm-service` | `agent-auth-02-…` | LiteLLM client + smoke rig |
| #819 | `agent-auth/03-schema-enrollment` | `agent-auth-03-…` | 8 tables + enrollment |
| #820 | `agent-auth/04-auth-api` | `agent-auth-04-…` | HTTP API + SDKs |
| #828 | `agent-auth/05-cloud-materialization` | `agent-auth-05-…` | state.json writer (cloud) |
| #826 | `agent-auth/06-anyharness-adapters` | `agent-auth-06-…` | Rust route_auth domain |
| #834 | `agent-auth/07-catalog` | `agent-auth-07-…` | model catalog |
| #821 | `agent-auth/08-usage-credits` | `agent-auth-08-…` | spend import + credits |
| #831 | `agent-auth/09-limits-topups` | `agent-auth-09-…` | caps + Stripe top-ups |
| #824 | `agent-auth/10-settings-ui` | `agent-auth-10-…` | desktop settings UI |
| #833 | `agent-auth/11-admin-policy` | `agent-auth-11-…` | org policy (flag-only) |
| #829 | `agent-auth/12-onboarding` | `agent-auth-12-…` | first-run adoption |
| #838 | `agent-auth/13-slot-composition` | `agent-auth-13-…` | opencode slots (**tip**) |
| PR 14 | `agent-auth/14-local-state-writer` | `agent-auth-14-local-writer` | local state.json writer (in build) |
| PR 15 | `agent-auth/15-agents-ui` | `agent-auth-15-agents-ui` | final Agents-scope UI (in build) |

Base chain (DAG, not a line): `01←main`, `02←01`, `03←02`, `04←03`; then `05/06/10/11←04`,
`08←03`, `09←08`, `07←06`, `12←10`, `13←07` (13 also carries 05+10 content for integration).

Line numbers below are accurate as of the pre-rebase review; treat as ≈ (files are
content-identical modulo conflict resolutions, so drift is small).

## 1. The mental model

Three planes, one contract file between them:

```
┌─ CONTROL PLANE — server + Postgres (source of truth, never in the token path) ─┐
│                                                                                │
│  9 tables ◄── agent_gateway service/API ◄── desktop settings UI / SDK          │
│     │                                                                          │
│     ├─► enrollment ─────► LiteLLM admin API   (/team/new, /key/generate, …)    │
│     ├─► materializer ───► state.json into sandboxes  (the ONLY cross-plane     │
│     │                                                  contract)               │
│     └─◄ usage importer ◄─ LiteLLM /spend/logs                                  │
└────────────────────────────────────────────────────────────────────────────────┘
┌─ DATA PLANE ──────────────────┐  ┌─ RENDER PLANE (AnyHarness, Rust) ───────────┐
│ LiteLLM proxy + its own PG    │  │ per launch: read state.json → decide route  │
│ /v1/messages /chat/completions│◄─┤ → render env {set,remove} + isolated homes  │
│ /v1/responses, ROOT /v1beta   │  │ → spawn CLI. Fail-closed: bad state = no    │
│ (genai facade for gemini)     │  │ launch, never ambient-credential fallback.  │
└───────────────────────────────┘  └──────────────────────────────────────────────┘
```

Locked decisions that explain the shape (spec §0):

- **Three routes.** `native` = the CLI's own login, local surface only, server stores
  only the *choice*. `api_key` = user's own key injected as env, both surfaces (gateway
  custody of raw keys was dropped — direct env is simpler and works identically local
  and cloud). `gateway` = LiteLLM virtual key, the metered managed path.
- **Personal-only key pool** in v1; org-shared keys deliberately out.
- **Eager enrollment**: LiteLLM team + user + virtual key are provisioned at
  signup/org-join, async with retry — the gateway route never stalls at first use.
- **Server owns auth state**; localStorage keeps only UI preferences.
- **Full schema reset**, no Bifrost migration (we have no users; drop migrations are blunt).
- **Slot axis** (PR 13): opencode is the one multi-provider harness — it composes
  gateway *plus* direct provider keys simultaneously. Everyone else is single-source.

## 2. Layer 1 — Persistent truth: nine tables

**Read:** `server/proliferate/db/models/cloud/agent_gateway.py` (one file, one domain).
Everything else in the system is derived state.

> NB: the similarly-named `agent_auth_gateway.py` you may find on *other* branches
> (e.g. the integrations stack) is the old Bifrost-era model — PR #814 deletes it.

First principles — the system must remember five things:

### 2.1 What keys did the user give us — `AgentApiKey` (≈L30)

```python
user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
provider: Mapped[str]                 # CHECK: anthropic|openai|xai|google|other
display_name: Mapped[str]
payload_ciphertext: Mapped[str]       # Fernet-encrypted; plaintext never at rest
payload_ciphertext_key_id: Mapped[str]  # which Fernet key — rotation-ready
redacted_hint: Mapped[str]            # "sk-ant-…XY4" for UI
status: Mapped[str]                   # active|revoked  (soft revoke + revoked_at)
```

Keys are **referenced** by selections, never copied — revoking one instantly affects
every selection that points at it. Crypto helpers: `proliferate/utils/crypto.py`.

### 2.2 What did the user choose — `AgentAuthRouteSelection` (≈L70)

The core intent table. One row per `(user, harness_kind, surface, slot)`:

```python
harness_kind: Mapped[str]   # claude|codex|opencode|grok|gemini
surface: Mapped[str]        # CHECK: local|cloud
slot: Mapped[str]           # default 'primary'; opencode: gateway|openai|anthropic|xai|google
route: Mapped[str]          # CHECK: native|api_key|gateway
api_key_id: Mapped[uuid.UUID | None] = mapped_column(
    ForeignKey("agent_api_key.id", ondelete="SET NULL"))
revision: Mapped[int]       # bumped on every real change → drives materialization
```

Three invariants live **in the schema**, not just app code:

```python
UniqueConstraint("user_id", "harness_kind", "surface", "slot")
CheckConstraint("surface != 'cloud' OR route != 'native'")   # no native creds in a sandbox
CheckConstraint("(route != 'api_key') OR (api_key_id IS NOT NULL)")
```

The DB physically cannot hold "native on cloud" — worth calling out in review.

### 2.3 Who is the user to the gateway — `AgentGatewayEnrollment` (≈L127)

One row per **billing subject** = the LiteLLM identity (team + user + virtual key):

```python
subject_kind: Mapped[str]   # 'user' | 'organization'
# CHECK ck_agent_gateway_enrollment_subject_shape: exactly one of user_id/organization_id
billing_subject_id: FK billing_subject.id          # ties spend to existing billing
litellm_team_id / litellm_user_id / virtual_key_id: str | None
virtual_key_ciphertext (+ _key_id): Text            # the vkey itself, Fernet-encrypted
sync_status: Mapped[str]    # pending|synced|failed — LiteLLM is remote, sync is async
sync_fingerprint / last_error_code / last_error_message   # backfill bookkeeping
```

Partial-unique indexes: at most one *active* (`revoked_at IS NULL`) enrollment per user
and per org. Org enrollments carry per-member `user_id` (per-member vkeys — the #819 fix).
PR 9 adds `budget_status: ok|exhausted` — the flag the importer flips at zero credit and
the top-up worker flips back.

### 2.4 What models exist — `AgentCatalogSnapshot` (≈L197) + `AgentCatalogOverride` (≈L239)

Layered: snapshot (probed or seeded) → user/org override patch on top.

- Snapshot scope `(harness_kind, surface, route, owner_user_id?)`;
  `owner_user_id = NULL` is the shared **seed**, a user's own probe shadows it.
  `source: probe|seed|override`, `models_json`, `probed_at`.
- Override: one row per owner per harness (partial-unique), owner = user **xor** org
  (CHECK), `patch_json = {remove, update, add}`, applied in that order.

### 2.5 What money moved — `AgentLlmUsageEvent` (≈L309), `LlmCreditGrant`, cursor (≈L360)

Minimal double-entry:

```python
class AgentLlmUsageEvent(Base):                      # DEBITS
    litellm_request_id: Mapped[str] = mapped_column(String(255), unique=True)  # idempotency
    prompt_tokens / completion_tokens / total_tokens: BigInteger
    cost_usd: Numeric(18, 8)
    user_id / organization_id / billing_subject_id: FK … ondelete="SET NULL"   # history outlives users
    occurred_at / imported_at, workspace_id, session_id, raw_metadata_json
```

```python
class LlmCreditGrant(Base):                          # CREDITS
    """… remaining credit is sum(active grants.amount_usd) - sum(usage.cost_usd).
    There is no per-grant consumption row: usage events are the single debit source."""
    source: Mapped[str]        # CHECK: free_signup|topup|admin
    amount_usd: Mapped[Decimal] = mapped_column(Numeric(12, 4))   # CHECK >= 0
    source_ref: Mapped[str | None]   # UNIQUE — a signup/invoice can only ever grant once
    expires_at: Mapped[datetime | None]
```

Balance is **always computed, never stored** (`db/store/agent_gateway/credits.py:128`)
— it cannot drift. `AgentLlmUsageImportCursor` is a singleton row (`CHECK id='default'`)
tracking `last_seen_occurred_at` for the importer.

### 2.6 Governance — `OrgAgentPolicy` (≈L286)

Flag-only, and the schema keeps it honest: just `allowed_routes_json` /
`allowed_harnesses_json` allow-lists keyed by org PK. **No violations table** —
violations are computed live (see §9).

### 2.7 Deliberately NOT in the DB

- No plaintext key material anywhere (pool keys *and* vkeys are ciphertext+key-id).
- No native credentials at all — only the fact the choice was made.
- No migration-era compat tables; no stored balances; no stored violations.

## 3. Layer 2 — Gateway identity: LiteLLM client + enrollment lifecycle

**Read:** `server/proliferate/integrations/litellm/` then
`server/proliferate/server/cloud/agent_gateway/enrollment.py`.

```
server/proliferate/integrations/litellm/
├── client.py    # the ONLY module that knows LiteLLM endpoint paths
├── models.py    # LiteLLMVirtualKey, LiteLLMSpendLogEntry (pydantic wire models)
└── errors.py    # LiteLLMIntegrationError(code, message) — one typed error surface
```

`client.py` public methods (all async, all keyword-only):

| Method | Endpoint | Notes to scrutinize |
|---|---|---|
| `ensure_team(alias, max_budget)` ≈L120 | GET `/team/list` → POST `/team/new` | list-first because LiteLLM team aliases are **not unique** |
| `ensure_user(user_id)` ≈L147 | POST `/user/new` | 409 = already exists = success |
| `mint_virtual_key(user_id, team_id, alias, max_budget, metadata)` ≈L161 | POST `/key/generate` | validates a key actually came back |
| `rotate_virtual_key(…)` ≈L191 | delete + mint | `/key/regenerate` is Enterprise-only |
| `disable_virtual_key(key_or_token_id)` ≈L217 | POST `/key/block` | used by exhaustion |
| `enable_virtual_key(…)` (PR 9) | POST `/key/unblock` | used by top-up reactivation |
| `set_key_budget` / `update_team_budget` ≈L222/230 | | used by top-ups |
| `list_models(virtual_key)` ≈L238 | GET `/v1/models` **with the vkey** | catalog probe |
| `page_spend_logs(start_date, end_date)` ≈L258 | GET `/spend/logs` | usage import |
| `health()` ≈L276 | | worker gating |

Enrollment lifecycle (`enrollment.py`):

```
signup / org-join ──after-commit──► ensure_user_enrollment (≈L56)
                                     │  ensure personal billing subject
                                     │  idempotent row, sync_status='pending'
                                     ▼
                               _sync_enrollment (≈L106)
                                     │  ensure_team("user-<id>") → ensure_user
                                     │  → mint_virtual_key → encrypt + mark synced
                                     │  → schedule materialization (≈L168)
                                     │  LiteLLMIntegrationError → mark failed
                                     ▼
                    backfill worker retries pending/failed + enrolls stragglers
                    (worker.py run_enrollment_backfill_once ≈L24, limit-batched)
```

`ensure_org_enrollment` (≈L81) mirrors it with team alias `org-<id>`. Trigger sites are
thin after-commit wrappers in `signup_hook.py` called from **every** account-creation
path — verify the coverage during review:

```
auth/identity/service.py:227,326,363     auth/desktop/service.py:472
auth/sso/service.py:258,398,413          organizations/service.py:424,485
billing/team_checkout/activation.py:365
```

## 4. Layer 3 — Intent API: routers, service, stores

**Read:** `server/proliferate/server/cloud/agent_gateway/{api,service}.py`, then
`server/proliferate/db/store/agent_gateway/route_selections.py`.

```
server/proliferate/server/cloud/agent_gateway/
├── api.py            # APIRouter(prefix="/agent-gateway") + org policy router (PR 11)
├── service.py        # orchestration, audit events, materialization scheduling
├── enrollment.py     # §3 above
├── catalog.py        # §7 below
├── free_credits.py   # §8
├── usage_import.py   # §8
├── topups.py         # §8
└── worker.py         # lifespan loops: backfill / usage import / top-ups
```

Endpoints (api.py):

| Method + path | ≈Line | Purpose |
|---|---|---|
| GET/POST `/api-keys`, DELETE `/api-keys/{id}` | L50–78 | personal key pool |
| GET `/route-selections` | L91 | list selections |
| PUT `/route-selections/{harness}/{surface}` | L105 | upsert — body `{route, api_key_id, slot}` |
| DELETE `/route-selections/{harness}/{surface}?slot=` | L136 | clear one slot |
| GET `/catalog/{harness}` · POST `…/refresh` · PUT/DELETE `…/override` | L156–227 | catalog |
| GET `/capabilities` | L244 | `gateway_enabled` + base_url + enrollment status |
| GET `/enrollment` | L261 | enrollment record (never the raw vkey) |
| GET/PUT `/policy`, GET `/policy/violations` (org router, PR 11) | L182–216 | admin |

The write path everything hangs off (`service.py` ≈L120–180): validate → upsert →
audit event (`agent_route_selection_upserted`) → and the load-bearing two lines:

```python
if surface == AGENT_AUTH_SURFACE_CLOUD:
    await materialization_service.schedule_materialize_agent_auth(db, user_id=user_id)
```

Slot legality is **store-level** (`route_selections.py`), so no caller can bypass it:

```python
# _validate_slot (≈L67-89)
#   non-opencode  → slot must be 'primary'
#   opencode      → slot ∈ {gateway, openai, anthropic, xai, google}
#                   gateway slot ⇒ gateway route; provider slot ⇒ api_key route
# upsert (≈L123-130): provider slot additionally requires a key of the SAME provider
# upsert (≈L156-162): revision += 1 only when route/api_key_id actually changed
```

SDK surface (thin, handwritten): `cloud/sdk/src/client/agent-gateway.ts` (12 functions,
paths under `/v1/cloud/agent-gateway/…`) + React-Query hooks in
`cloud/sdk-react/src/hooks/agent-gateway.ts` (`useRouteSelections`,
`useUpsertRouteSelection`, `useAgentGatewayCapabilities`, …).

## 5. Layer 4 — The contract: state.json materialization (cloud surface)

**Read:** `server/proliferate/server/cloud/materialization/materialize/agent_auth.py`.
Deliberately built on the **same machinery as secrets/env materialization** — compare
with sibling `materialize/secret_set.py` while reviewing: `paths`,
`sandbox_io.write_private_file_atomic`, manifests, `runner.run_after_commit`,
Redis-locked `operation.run_cloud_sandbox_operation(operation_key="agent-auth")`.

`build_agent_auth_state` (≈L184) renders **cloud selections only** into:

```json
{
  "revision": 7,
  "user_id": "3f2c…",
  "selections": [
    { "harness": "claude",   "route": "gateway", "slot": "primary",
      "base_url": "https://gw.internal", "key": "sk-…vkey…",
      "model_catalog": ["claude-sonnet-5", "…"] },
    { "harness": "opencode", "route": "gateway", "slot": "gateway",
      "base_url": "https://gw.internal", "key": "sk-…vkey…",
      "model_catalog": ["…"] },
    { "harness": "opencode", "route": "api_key", "slot": "openai",
      "provider": "openai",  "key": "sk-proj-…" }
  ]
}
```

Written to `<runtime home>/agent-auth/state.json`, **mode 0600**, with a sha256
fingerprint manifest so unchanged state is a no-op:

```python
state, fingerprint = await build_agent_auth_state(db, user_id)
if state is None:
    await sandbox_io.remove_owned_files(…, paths={state_path, manifest_path}); return
previous = await _read_previous_manifest(ctx)
if previous.get("fingerprint") == fingerprint: return          # idempotent
await sandbox_io.write_private_file_atomic(…, path=state_path, mode="600")
```

Per-entry rendering (≈L137–181): gateway entries decrypt the enrollment vkey and raise
typed errors (`AgentAuthEnrollmentNotSyncedError`, `AgentAuthGatewayConfigError`) if the
enrollment isn't usable; api_key entries decrypt the pool key and are **dropped if the
key was revoked**. Triggers (all after-commit, `materialization/service.py:64`):
route upsert/clear, key revoke, enrollment sync.

> **PR 14 (in build):** the LOCAL-surface counterpart — server
> `GET /agent-gateway/state?surface=local`, a Rust runtime endpoint
> `PUT /v1/agent-auth/state` (atomic 0600 write, stale-revision rejection), and a
> desktop lifecycle hook syncing one to the other.

## 6. Layer 5 — Render plane: the Rust `route_auth` domain

**Read:** `anyharness/crates/anyharness-lib/src/domains/agents/route_auth/` — reviewed
in this order the module tells its own story:

```
route_auth/
├── mod.rs           (~100)  entry point + error taxonomy (stable .code() strings,
│                            e.g. AGENT_ROUTE_SELECTION_MISSING → API mapping in
│                            api/http/sessions_errors.rs:116)
├── state.rs         (~300)  on-disk contract: serde structs, well-known path,
│                            tolerant load (absent→None, malformed→typed error)
├── profile.rs       (~520)  PURE decision layer: state + harness →
│                            Native | ApiKey | Gateway | OpenCodeComposite.
│                            No filesystem, no env. Fail-closed semantics live here.
├── render.rs        (~310)  profile → RenderedRouteAuth { set, remove } env delta;
│                            per-harness recipes; calls materialize for isolated FS
├── render_tests.rs          table-driven recipe tests
└── materialize.rs   (~200)  revision-keyed isolated homes/configs + GC
```

The contract structs (`state.rs`):

```rust
pub const STATE_FILE_RELATIVE_PATH: &[&str] = &["agent-auth", "state.json"];

pub enum AuthRoute { Native, ApiKey, Gateway }        // serde snake_case

pub struct AuthSelection {
    pub harness: String,
    pub route: AuthRoute,
    #[serde(default = "default_slot")]
    pub slot: String,                    // "primary" unless opencode
    pub provider: Option<String>,
    pub base_url: Option<String>,
    pub key: Option<String>,             // never logged — check Debug impls in review
    pub model_catalog: Option<Vec<String>>,
}

pub struct AgentAuthState {
    pub revision: i64,                   // 0 = legacy/native; >0 = fail-closed scoping
    pub user_id: Option<String>,
    pub selections: Vec<AuthSelection>,
}
```

Launch integration — the single entry point and the refusal semantics
(`sessions/runtime/startup.rs:332`):

```rust
let route_auth = resolve_launch_route_auth(&self.runtime_home, &record.agent_kind)
    .map_err(|error| {
        tracing::warn!(code = error.code(), "agent-auth route resolution failed; refusing launch");
        StartSessionError::RouteAuth(error)
    })?;
```

The delta flows through `assemble_session_launch` (startup.rs ≈L360) →
`launch_policy.rs:193` (split into `route_auth` set-layer + `route_auth_remove`) →
applied at spawn in `live/sessions/driver/process.rs:26-36,100`. Two rules to verify:
**route_auth layer wins** over session/workspace env layers, and **removals strip keys
from all layers** (that's what makes sanitization trustworthy).

### 6.1 Per-harness recipes (render.rs) — all live-verified

Ground truth: `scripts/agent-gateway-smoke/HARNESS-MATRIX.md` — every recipe below was
proven against a real LiteLLM with real CLIs before it became code.

| Harness | Gateway recipe | Why the quirks |
|---|---|---|
| **claude** | `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_SMALL_FAST_MODEL` pin, **remove** `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `AWS_BEARER_TOKEN_BEDROCK` (+ stale `ANTHROPIC_API_KEY` if not set by us) | ambient Bedrock flags silently reroute the CLI away from the proxy — the "400 invalid model with no proxy hit" bug we debugged live |
| **codex** | isolated `CODEX_HOME` with generated `config.toml`: provider `proliferate`, `wire_api = "responses"`, `env_key = PROLIFERATE_GATEWAY_KEY`; `--skip-git-repo-check` | codex speaks `/v1/responses`; verified no tool-schema errors through LiteLLM→Anthropic |
| **opencode** | generated `opencode.json`: catalog → `provider.proliferate.models` map, npm `@ai-sdk/openai-compatible`, `baseURL = <gw>/v1`, `apiKey = {env:PROLIFERATE_GATEWAY_KEY}`; **plus** one env var per direct provider slot | opencode needs an explicit models map; composite = gateway config + `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/… simultaneously |
| **grok** | isolated `HOME`, `GROK_MODELS_BASE_URL = <gw>/v1`, `XAI_API_KEY = <vkey>` | grok discovers models via that base URL; no catalog injection needed |
| **gemini** | isolated `HOME` with `~/.gemini/settings.json` → `security.auth.selectedType = "gemini-api-key"`, `GEMINI_CLI_TRUST_WORKSPACE=true`; gateway serves ROOT `/v1beta` genai facade | gemini CLI refuses env-key auth unless settings.json says so |

The claude sanitization, verbatim shape:

```rust
fn sanitize_claude_ambient(rendered: &mut RenderedRouteAuth) {
    for key in ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "AWS_BEARER_TOKEN_BEDROCK"] {
        rendered.remove(key);
    }
    if !rendered.set.contains_key("ANTHROPIC_API_KEY") {
        rendered.remove("ANTHROPIC_API_KEY");   // stale key must not shadow the token
    }
}
```

The opencode composite merge (render.rs ≈L84-99):

```rust
fn render_opencode_composite(profile: &OpenCodeCompositeProfile, runtime_home: &Path)
    -> Result<RenderedRouteAuth, RouteAuthError> {
    let mut rendered = RenderedRouteAuth::default();
    if let Some(gateway) = &profile.gateway {
        render_opencode_gateway(gateway, runtime_home, &mut rendered)?;  // OPENCODE_CONFIG
    }
    for key_profile in &profile.provider_keys {
        rendered.set(provider_env_key(key_profile.provider.as_deref()), &key_profile.key);
    }
    Ok(rendered)
}
```

### 6.2 Isolation + GC (materialize.rs)

Revision-keyed directories under `<runtime_home>/agent-auth/` with prefixes
`codex-home`, `grok-home`, `gemini-home`, `opencode-config`. GC is **by directory
name** — no bookkeeping DB:

```rust
fn prepare_revision_dir(runtime_home: &Path, prefix: &str, revision: i64) -> … {
    let target_name = format!("{prefix}-{revision}");
    remove_stale_revision_dirs(&root, prefix, &target_name)?;  // rm <prefix>-* != target
    fs::create_dir_all(&dir)?; Ok(dir)
}
```

Writes are atomic + 0600 (`tmp-<uuid>` → chmod → rename). The point of isolated homes:
harness config we generate must never touch, and never be polluted by, the user's real
`~/.claude` / `~/.codex` / `~/.config/opencode` / `~/.grok` / `~/.gemini`.

## 7. Layer 6 — Catalog loop

**Read:** `server/proliferate/server/cloud/agent_gateway/catalog.py`.

```
gateway route :  server probes LiteLLM /v1/models with the USER'S vkey (≈L260;
                 409 if enrollment not synced)
native/api_key:  the runtime probes through the booted harness and uploads
                 models_json; refresh_catalog (≈L186) stores a 'probe' snapshot
read path     :  own snapshot ?? ownerless seed → apply_override (≈L99;
                 remove → update → add)
delivery      :  snapshot → state.json model_catalog → opencode models map,
                 UI model pickers; grok resolves live via GROK_MODELS_BASE_URL
```

This implements "probe-based catalog, cached per user, refreshed on auth changes" —
probes write snapshots, users edit via overrides, reads compose the two.

## 8. Layer 7 — Money loop

**Read (in order):** `usage_import.py` → `db/store/agent_gateway/credits.py` →
`free_credits.py` → `topups.py` → `worker.py`.

```
LiteLLM spend logs
      │  usage_import.run_usage_import (≈L95)
      │    cursor.last_seen − overlap  →  page_spend_logs(…, end_date = now+1d)
      │    insert deduped on UNIQUE litellm_request_id   ← exactly-once by construction
      ▼
agent_llm_usage_event  (debits)
      │
      ▼
remaining = Σ active grants − Σ usage cost          credits.py:128 — computed live
      │  zero remaining & subject was granted?
      ▼
_enforce_subject_exhaustion (≈L243)
      →  litellm.disable_virtual_key  +  enrollment.budget_status = 'exhausted'
      │  overage-enabled subjects (billing.py: overage_enabled)
      ▼
topups.run_llm_topups (≈L249)
      →  _charge_llm_topup (≈L354): Stripe invoice → item → finalize,
         idempotency key derived from the top-up epoch
      →  create_llm_topup_grant(source_ref = f"{PURPOSE}:{invoice_id}")   ← UNIQUE
      →  _reactivate_enrollment (≈L183): unblock vkey (re-mint if unsupported),
         rewrite team+key budgets (granted amount if hard-capped, None = uncap
         for overage), budget_status = 'ok'
```

Idempotency at every seam — this is the review lens for these files:
`litellm_request_id` UNIQUE (importer re-reads overlap windows safely),
`source_ref` UNIQUE (an invoice or signup can only grant once), Stripe idempotency
keys (retried charges can't double-bill). Free signup credits:
`free_credits.ensure_user_free_credit_grant` (≈L41), deduped through the existing
GitHub-identity anti-abuse allocation (`free_cloud_allocation`).

Three lifespan loops in `worker.py`: enrollment backfill (≈L57), usage import (≈L98),
top-ups (≈L140 — only when `agent_gateway_enabled and topups_enabled()`), each opening
its own transaction per tick.

## 9. Layer 8 — Governance

**Read:** `service.py` bottom (`selection_violates_policy` ≈L399) +
`db/store/agent_gateway/policy.py`.

```python
def selection_violates_policy(selection, *, allowed_routes, allowed_harnesses) -> bool:
    """Flag-only conflict check; nothing is ever blocked."""
    if allowed_routes is not None and selection.route not in allowed_routes:
        return True
    return allowed_harnesses is not None and selection.harness_kind not in allowed_harnesses
```

Violations are a live join (`list_org_member_route_selections` — active memberships →
users → selections) against the allow-lists. PUT `/policy` is org-admin-gated
(`current_path_org_admin`). v1 intentionally never enforces — it surfaces.

## 10. Layer 9 — Desktop UI + onboarding

Current components (`apps/desktop/src/components/settings/panes/agent-auth/`):

```
agent-auth/
├── AgentAuthenticationSection.tsx   # per-harness route chooser; defaultRouteForSurface:
│                                    #   cloud → gateway, local → native
├── OpenCodeAuthSection.tsx          # additive: gateway Switch + per-provider rows,
│                                    #   one route-selection per slot
├── AgentApiKeysSection.tsx          # pool list + add form + revoke confirm
├── KeyPicker.tsx                    # searchable picker + inline "+ Add new key"
├── AgentAuthInstallGate.tsx         # shown when harness not installed
└── agent-api-key-providers.ts       # provider registry driving the UI
```

Onboarding: `useFirstRunAuthAdoption()` at `App.tsx:196` — runs once, only when
**zero selections exist** and only after the agent reconcile has settled (so
mid-hydration snapshots don't miss native creds); detected native → `native/local`,
none detected + gateway enabled → preselect `gateway`. Pure logic in
`lib/domain/agents/auth-onboarding.ts` (`hasDetectedNativeAuth`,
`planFirstRunAuthAdoption`).

**Ratified target (PR 15, in build)** — per `design-system/surfaces/SETTINGS_IA.md`:

```
Settings ▸ Agents scope
├── Overview          flat bordered harness list (icon · name · harness·version ·
│                     status Badge · chevron); InstallGate when none installed
├── <per-harness>     one page per agent (internal navigation from Overview rows):
│   ├── Cloud/Local SegmentedControl        ← the `surface` axis, top of page
│   ├── Authentication: RadioCardGroup      ← native (local only) / gateway / api_key
│   │     └─ api_key → KeyPicker; native → "Run login" when undetected
│   ├── Harness-specific section            ← reserved (e.g. Claude Chrome flag)
│   └── All Models subtab                   ← catalog grid + Refresh (probe) + overrides
│         (opencode variant: Authentication = additive switches, not radio)
└── API keys          pool + where-used per key (join over selections) + revoke
```

Wave 1 retired `SettingsCard`/`SettingsCardRow`; mid-stack PRs carry branch-local
shims so each compiles standalone — **PR 15 deletes the shims** and rebuilds on
`SettingsSection`/`SettingsRow`/`SettingsPageHeader` from `@proliferate/product-ui`,
porting `RadioCardGroup`/`SegmentedControl`/`InstallGate`/`ModelConfigGrid` from the
design-system reference into `@proliferate/ui`.

## 11. Three end-to-end traces (tell these in the meeting)

**A. "Use my Anthropic key for Claude in the cloud"**
UI `PUT /route-selections/claude/cloud {route: api_key, api_key_id}` → store validates
(key exists, provider matches, slot=primary) + bumps `revision` → after-commit
materializer decrypts the key and writes state.json into the personal sandbox
(fingerprint-diffed) → next Claude launch in that sandbox: Rust loads state, profile
resolves `ApiKey`, render sets `ANTHROPIC_API_KEY` **and removes the Bedrock ambients**,
spawns. No restarts anywhere; the next process launch simply sees the new world.

**B. Gateway request → money**
Harness → LiteLLM with the user's vkey → provider. Importer pulls spend logs
(cursor + overlap, deduped on request id) → usage event → balance recomputed live →
at zero: vkey blocked + `budget_status='exhausted'` → top-up worker charges Stripe
(idempotency-keyed) → grant row (`source_ref` unique) → vkey unblocked, budgets
rewritten, status `ok`. Every step is safe to retry; nothing double-counts.

**C. OpenCode composite**
Three selection rows (`gateway` slot + `openai` slot + `anthropic` slot) → three
entries in state.json → one launch merges them: generated `opencode.json` (gateway
provider + models map from the catalog) **plus** `OPENAI_API_KEY` +
`ANTHROPIC_API_KEY` in env. Additive multi-provider, exactly the composition the
one-route-per-harness model couldn't express before the slot axis.

## 12. Suggested reading order for the file-by-file review

1. **#825 spec** — decision register first; everything else is its consequence.
2. **#814 teardown** — mostly deletions; scrutinize the ~90 edited survivors and the
   `cloud_sandbox_profiles` import fix; confirm the drop migration is blunt (we want that).
3. **#818** — `integrations/litellm/client.py` + the smoke rig + `HARNESS-MATRIX.md`.
4. **#819** — the models file top to bottom (§2 here), then enrollment lifecycle +
   trigger-site coverage.
5. **#820** — api/service/stores; the store-level slot validation and audit events.
6. **#828** — materializer vs its sibling `secret_set.py`; fingerprint idempotency;
   error taxonomy when enrollment unsynced.
7. **#826** — Rust domain in module order (§6); then `startup.rs`/`process.rs`
   integration: layer precedence + removals.
8. **#834** — catalog layering + both probe paths.
9. **#821 → #831** — the money loop with the idempotency lens (§8).
10. **#824 → #829** — UI components + onboarding logic (knowing PR 15 re-skins them).
11. **#833** — policy flag-only semantics.
12. **#838** — the slot axis end to end: schema default, store validation, composite
    profile/render, `OpenCodeAuthSection`, and the slot migration.
13. **PR 14 → PR 15** once their build workflow lands.

## 13. Open items (as of 2026-07-01)

- **PR 14 — local state writer**: in build (workflow running).
- **PR 15 — final UI**: in build (workflow running); the ratified Agents pages (§10).
- **Review gate**: nothing merges before the joint file-by-file review.
- Merge-time rollout order (spec §10): LiteLLM dark-launch first, teardown last;
  PR 9 live-Stripe only after a full staging cycle.
