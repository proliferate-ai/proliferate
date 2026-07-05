# Agent Auth (agents + auth / LiteLLM gateway) — Architecture (current on `main`)

> **Changelog:** rewritten 2026-07-03 post-cleanup — retargets the doc onto the
> new auth model after the agent-auth cleanup landed: gemini removal (#896),
> real upstreams + prod compose (#906), auth rebuild / state.json v2 (#907),
> runtime catalog (#908), native-refresh fix (#912).
> 2026-07-03 (later): folded in the model-table arc — All-Models table +
> wire enrichment (#923 `f8da19591`) and round 2: modes column, family-key
> join, config generation alignment (#926 `23b34245b`). See §6a/§7.
> 2026-07-04: Bedrock gateway + dedup (#928 `49507cccc`), model-table display
> fixes (#955 `729c6adaf`), prod litellm service live. Updated §6a (Bedrock
> provider, dedup rule, provider_for_model), §8 (prod service URL), §11 (prod
> deployment state). See changelog below for specifics.
> **Status:** current-state map, verified file-by-file against `origin/main`
> (through #955) on 2026-07-04.
> **Self-hosting:** 🏠 marks deployment knobs; §11 is the checklist + known gaps.
> **Links** are relative from this file (`specs/codebase/architecture/`); line
> anchors in prose are ≈.

**Premise:** the user decides, per harness, how each coding agent authenticates.
Two mechanisms compose: **direct provider keys** (titled secrets from a personal
vault, wired to arbitrary env vars) and the **managed gateway** (a LiteLLM
virtual key, metered + billed). "Native" is simply the empty state — no wiring,
so the CLI's own login owns auth. One AUTH-ONLY contract file (`state.json` v2)
crosses every plane; model lists never travel in it.

```
CONTROL PLANE (server + Postgres)          DATA PLANE            RENDER PLANE (anyharness, Rust)
9 tables ◄ agent_gateway API ◄ desktop UI  LiteLLM proxy         reads state.json per launch →
   ├─► enrollment ─► LiteLLM admin API      + its own Postgres    two-phase PURE render:
   ├─► materializer ─┐                                            {set, remove, files} →
   │  GET /state ────┼─► state.json v2 ─────────────────────────► apply file specs → spawn CLI
   └─◄ usage importer ◄─ /spend/logs        /v1/messages,/chat,   (empty/absent → native)
                                            /responses            ▲ catalog: gateway probe → sqlite
   ▲ catalog mirror (read-model) ◄──────── desktop mirror-push ───┘  → GatewayModelPlan into render
```

Four moving parts, one rule each plane obeys: the **server** persists intent +
decrypts secrets into the file; the **render plane** turns the file into an env
delta + isolated config files and knows nothing about models; the **runtime
catalog** probes what the gateway can actually serve and feeds model values
back into render; the **desktop** is the only party holding cloud creds, so it
shuttles state down to the local runtime and probe results back up.

---

## 1. Nine tables — [`db/models/cloud/agent_gateway.py`](../../../server/proliferate/db/models/cloud/agent_gateway.py)

The persistent truth. The #907 rebuild replaced the provider-typed
`agent_api_key` + `agent_auth_route_selection` (with its `slot` axis) with a
titled provider-less vault + a wiring table. Alembic
[`c9b8a7d6e5f4_agent_auth_selection_rebuild.py`](../../../server/alembic/versions/c9b8a7d6e5f4_agent_auth_selection_rebuild.py)
drops the old tables and creates the new ones — **no data migration** (no users).

- **`agent_api_key`** — the vault. A **titled, provider-agnostic** secret:
  `title` (arbitrary, e.g. "Personal Anthropic API key"), `value_ciphertext` +
  `encryption_key_id`, `redacted_hint`, `status` active/revoked. **No provider
  column.** A key is bound to a provider only when a selection references it
  under a specific `env_var_name`. 🏠 needs `cloud_secret_key` (Fernet).
- **`agent_auth_selection`** — the wiring. One row per
  `(user, harness_kind, surface, source_kind, env_var_name)`:
  - `source_kind` CHECK `gateway | api_key` — **there is no `native` source**.
  - `api_key_id` + `env_var_name` set **iff** `api_key`; both NULL for `gateway`
    (two CHECK constraints enforce the shape).
  - `provider_hint` — **display-only** (a registry provider id), zero launch
    semantics, never on the wire.
  - `enabled` — a plain bool. Disable ≠ delete: you pre-wire a source and toggle
    it off without losing it (the capability slots never had).
  - `surface` CHECK `local | cloud`; the old `surface != cloud OR not native`
    invariant is moot now that native isn't a row.
  - Uniqueness: the scope UNIQUE treats gateway rows (`env_var_name` NULL) as
    distinct, so a **partial unique index** `ux_agent_auth_selection_gateway`
    (`WHERE source_kind='gateway'`) enforces at-most-one gateway per scope. The
    env-var name is the natural uniqueness key `slot` was faking — you can't map
    `ANTHROPIC_API_KEY` to two keys. **Native = zero enabled rows.**
- **`agent_gateway_enrollment`** — LiteLLM identity per billing subject (team +
  user + virtual key). `subject_kind` user | organization (org rows carry both
  `organization_id` and `user_id` — one vkey per member under the org team),
  `virtual_key_ciphertext`, `sync_status` pending/synced/failed, `budget_status`
  ok/exhausted. **Note:** the launch path resolves personal enrollment only
  (`get_enrollment_for_user`); org enrollment exists in the schema but isn't
  wired into materialization yet.
- **`agent_catalog_snapshot`** + **`agent_catalog_override`** — layered model
  catalog. Snapshot `source` now includes **`runtime-mirror`** (the desktop
  mirror-push, §6) alongside probe/seed/override; `route` native/api_key/gateway.
- **`agent_llm_usage_event`** + **`llm_credit_grant`** +
  **`agent_llm_usage_import_cursor`** — the money ledger. Debits = usage events
  (`litellm_request_id` UNIQUE = idempotent); credits = grants (`source_ref`
  UNIQUE). Balance is always `Σ grants − Σ cost`, never stored.
- **`org_agent_policy`** — flag-only allow-lists; violations computed live.

Nothing plaintext at rest: vault values + virtual keys are Fernet
ciphertext+key_id ([`utils/crypto.py`](../../../server/proliferate/utils/crypto.py),
keyed on `settings.cloud_secret_key`). No native credentials are ever
stored — only the *absence* of a wiring.

Source-kind / harness / surface / state-version literals live in
[`constants/agent_gateway.py`](../../../server/proliferate/constants/agent_gateway.py).

---

## 2. Gateway identity — LiteLLM client + enrollment (unchanged by the cleanup)

- [`integrations/litellm/`](../../../server/proliferate/integrations/litellm/) is the
  only module that knows LiteLLM URLs
  ([`client.py`](../../../server/proliferate/integrations/litellm/client.py),
  [`models.py`](../../../server/proliferate/integrations/litellm/models.py),
  [`errors.py`](../../../server/proliferate/integrations/litellm/errors.py)):
  `ensure_team`, `ensure_user`, `mint_virtual_key` (**single unscoped key** — no
  `models` scope; curation is a product concern, §6), rotate/disable/enable,
  budget setters, `list_models`, `page_spend_logs`, `health`. 🏠 talks to the
  proxy at `agent_gateway_litellm_base_url` with `agent_gateway_litellm_master_key`.
- [`agent_gateway/enrollment.py`](../../../server/proliferate/server/cloud/agent_gateway/enrollment.py)
  — eager at signup/org-join (after-commit hooks in
  [`signup_hook.py`](../../../server/proliferate/server/cloud/agent_gateway/signup_hook.py)):
  `ensure_team → ensure_user → mint_virtual_key → encrypt + mark synced`; on
  error mark failed. Backfill worker retries pending/failed
  ([`worker.py`](../../../server/proliferate/server/cloud/agent_gateway/worker.py)).

---

## 3. Intent API + the one validator — [`server/cloud/agent_gateway/`](../../../server/proliferate/server/cloud/agent_gateway/)

[`api.py`](../../../server/proliferate/server/cloud/agent_gateway/api.py) (mounted
`/v1/cloud/agent-gateway`), the shape that matters:
- **Vault:** `GET/POST /keys` (`{title, value}`; value write-only, never
  echoed), `DELETE /keys/{id}` (revoke; **409 with the referencing harnesses**
  if any *enabled* selection wires it).
- **Selections:** `GET /selections?surface=`; `PUT /selections/{harness_kind}?surface=`
  with the **full desired source list** `[{sourceKind, apiKeyId?, envVarName?,
  providerHint?, enabled}]` — server validates, diffs, writes, schedules
  materialization on the cloud surface.
- **State:** `GET /state?surface=` renders the caller's own `state.json` v2 (§4).
- **Catalog:** `GET /catalog/{harness}`, `POST .../refresh`, `POST .../mirror`
  (§6), `PUT/DELETE .../override`.
- **Capabilities/enrollment:** `GET /capabilities` (returns `gateway_enabled` +
  `public_base_url` + enrollment status), `GET /enrollment` (never leaks the raw
  vkey). Org policy router `GET/PUT /policy`, `GET /policy/violations`.

Two-layer legality (deliberate split):
- **Structural coherence** — source shape, key ownership + active status, no
  duplicate `(source_kind, env_var_name)` — lives in the store
  ([`selections.py`](../../../server/proliferate/db/store/agent_gateway/selections.py)),
  so no caller bypasses it. The PUT is a full-desired-state diff: rows keyed by
  `(source_kind, env_var_name)` are updated in place, absent ones deleted, new
  ones inserted (ids + created_at survive edits).
- **Per-harness legality** — the ONE business validator
  [`selection_rules.py`](../../../server/proliferate/server/cloud/agent_gateway/selection_rules.py):
  `validate_auth_selection_set` gates the **enabled** set —
  `claude/codex/grok` at most one enabled source; `opencode` = gateway + any
  number of api_key rows; `cursor` = no sources at all; gateway only for
  harnesses with a recipe (claude/codex/opencode/grok); env-var name must match
  `^[A-Z][A-Z0-9_]{0,127}$`.

[`service.py`](../../../server/proliferate/server/cloud/agent_gateway/service.py)
orchestrates: validate → store diff → audit event → `schedule_materialize_agent_auth`
(cloud surface only). Store errors surface as typed `CloudApiError` for uniform
mapping.

---

## 4. The contract — `state.json` v2 (AUTH-ONLY), one shared renderer

[`materialization/materialize/agent_auth.py`](../../../server/proliferate/server/cloud/materialization/materialize/agent_auth.py)
owns the wire contract. `render_agent_auth_state(inputs)` returns
`(state, fingerprint)` from pre-scoped inputs; `build_agent_auth_state` loads
those inputs for a surface. **Both delivery paths share this one renderer:** the
cloud materialization worker (`materialize_agent_auth`, writes the `cloud`
surface into a sandbox, fingerprint-diffed 0600 file) and `GET /state`
(`get_auth_state` → `build_agent_auth_state`, serves the `local` surface).

The v2 shape:

```json
{
  "version": 2, "revision": 41, "user_id": "…",
  "harnesses": [
    { "harness_kind": "claude",
      "sources": [ {"kind": "gateway", "base_url": "https://…", "key": "sk-vk-…"} ] },
    { "harness_kind": "opencode",
      "sources": [ {"kind": "gateway", "base_url": "https://…", "key": "sk-vk-…"},
                   {"kind": "api_key", "env_var_name": "ANTHROPIC_API_KEY", "value": "sk-ant-…"} ] }
  ]
}
```

- `sources` = the **enabled** rows only (disabled rows never leave the DB). No
  `model_catalog`, no `slot`, no `provider` — `provider_hint` stays UI-side.
- **`revision` is derived from `max(updated_at)` (ms since epoch)** across the
  surface's rows — the rebuild dropped the per-row revision column, so there is
  no counter to bump. Monotonic across edits that keep the scope non-empty,
  which is exactly what the runtime's stale-push protection needs. Content is
  authoritative: a vkey rotation changes the file (new fingerprint) without any
  row mutation, so change detection is a sha256 of the canonical JSON in a
  server-owned manifest — unchanged fingerprint ⇒ no write.
- A harness with no resolvable enabled source is **omitted** (reads as native);
  when the whole surface is empty the file + manifest are deleted (cloud launch
  fail-closes in the Rust launcher, not here). One unsatisfiable source (revoked
  key, unsynced gateway) is dropped, never fatal.
- ⚠️ 🏠 **The `public_base_url` drop is now LOUD.** A gateway source with
  `agent_gateway_litellm_public_base_url` unset is still dropped from the file
  (it cannot be delivered), but `_render_gateway_source` emits a
  `logger.warning("gateway selection dropped: … public_base_url is not
  configured")` — the L7 change from #906. It's infra misconfig, not a user
  error; set the public base URL in any real deploy.

---

## 5. Render plane (Rust) — two-phase PURE render — [`domains/agents/route_auth/`](../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/)

Entry [`mod.rs`](../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/mod.rs)
`resolve_launch_route_auth(runtime_home, harness_kind, resolver)`:
`load_state_file → resolve_profile → resolver.resolve_gateway_models → render_profile → apply_file_spec`.
The session runtime calls it from
[`runtime/startup.rs`](../anyharness/crates/anyharness-lib/src/domains/sessions/runtime/startup.rs) :332;
any error becomes `StartSessionError::RouteAuth` — **the launch is refused, no
ambient fallback** — and it then fires `schedule_launch_probe_if_stale` (:351).

- [`state.rs`](../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/state.rs)
  — serde structs + tolerant load. Absent file → `None` (native). Present +
  valid v2 → `Some`. Present + broken **or any `version != 2`** →
  `MalformedStateFile`. `apply_state_file` is the runtime's writer (atomic 0600,
  **stale-revision 409**, heals a malformed on-disk file).
- [`profile.rs`](../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/profile.rs)
  — pure decision. Absent harness / empty sources → **Native** (the #889
  behavior, now permanent). Each enabled source becomes a typed `ResolvedSource`
  (`Gateway{base_url,key}` | `ApiKey{env_var_name,value}`); unknown `kind` or a
  missing field → typed error (the server should never emit these). No
  per-harness legality is re-checked — the runtime trusts the server.
- [`plan.rs`](../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/plan.rs)
  — `GatewayModelPlan { default_model, small_fast_model, models }` + the
  `GatewayModelResolve` seam. **Model values flow INTO render already resolved**;
  render/materialize look nothing up.
- [`render.rs`](../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/render.rs)
  — `render_profile` is **PURE** (contract §4, folds in the old critique #7): no
  I/O, returns `RenderedRouteAuth { set: BTreeMap, remove: Vec, files: Vec<FileSpec> }`.
  Isolated-config paths are deterministic joins so the env vars and the file
  specs agree without touching disk. Composition is additive across sources.
- [`materialize.rs`](../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/materialize.rs)
  — the APPLY half. `apply_file_spec(runtime_home, spec)` writes each `FileSpec`
  (`{path_family, revision, contents}`) 0600. Revision-keyed dirs
  (`codex-home-<rev>`, `grok-home-<rev>`, `opencode-config-<rev>`) with
  conservative GC (keeps the current + immediately-previous revision so an
  in-flight process finishes on old state); `claude-config` is stable (not
  revision-keyed).

**Per-harness gateway recipes** (all live-verified,
[`scripts/agent-gateway-smoke/HARNESS-MATRIX.md`](../../../scripts/agent-gateway-smoke/HARNESS-MATRIX.md)),
model values from the plan, **no model-id constants in Rust anymore**:
- **claude** — `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`; the small-fast pin
  `ANTHROPIC_SMALL_FAST_MODEL` only when `plan.small_fast_model` is set (skipped
  otherwise); isolated `CLAUDE_CONFIG_DIR`. **Sanitize:** always removes
  `CLAUDE_CODE_USE_BEDROCK/VERTEX` + `AWS_BEARER_TOKEN_BEDROCK`, and removes any
  of `ANTHROPIC_API_KEY/AUTH_TOKEN/BASE_URL` this render did **not** set — the
  rules key off which vars render set, not off providers.
- **codex** — isolated `CODEX_HOME` with a `config.toml` (`wire_api="responses"`,
  provider `proliferate`, `env_key="PROLIFERATE_GATEWAY_KEY"`). `model =`
  **errors if `plan.default_model` is None** (codex refuses to launch without a
  servable model → the catalog MUST carry `defaults["gateway"]`). Removes
  ambient `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`.
- **opencode** — isolated `OPENCODE_CONFIG` + `XDG_CONFIG_HOME`/`XDG_DATA_HOME`;
  generated `opencode.json` (openai-compatible provider `proliferate`,
  `apiKey: {env:PROLIFERATE_GATEWAY_KEY}`, explicit models map). **Errors if
  `plan.models` is empty.**
- **grok** — isolated `HOME` + `GROK_MODELS_BASE_URL` + `XAI_API_KEY`.
- **api_key sources** are fully generic: `set[env_var_name] = value`, nothing
  else. **No gemini arm** (removed in #896;
  [`model.rs`](../anyharness/crates/anyharness-lib/src/domains/agents/model.rs)
  `AgentKind` = Claude/Codex/Cursor/OpenCode/Grok).

Secrets never touch disk except by env-var reference (`env_key` /
`{env:PROLIFERATE_GATEWAY_KEY}`); the env delta is the only secret carrier.

---

## 6. Runtime catalog — probe-always, curation-as-data — [`domains/agents/catalog/`](../anyharness/crates/anyharness-lib/src/domains/agents/catalog/)

The #908 payoff: truth is **probed by the runtime, never authored**; policy is
**catalog data, never Rust**; state.json stays auth-only.

**Catalog v2 policy data** ([`catalog.json`](../../../catalogs/agents/catalog.json),
schema struct `AgentCatalogGatewayPolicy` in
[`schema.rs`](../anyharness/crates/anyharness-lib/src/domains/agents/catalog/schema.rs) :235):
each gateway-capable agent carries `session.gatewayPolicy { providers, roles,
seedModels }` + `session.defaults["gateway"]`. On `main`:
- claude → `providers:["anthropic"]`, `roles.small_fast:"claude-haiku-4-5-20251001"`
  (no gateway default — claude has no default-model override, only small-fast).
- codex → `providers:["anthropic","openai"]`, `defaults.gateway:"claude-sonnet-4-5-20250929"`.
- grok → `gatewayPolicy:{}` (empty providers = all).
- opencode → `seedModels` = the four Anthropic ids (pre-probe fallback), no
  provider filter. `catalogVersion: "2026-07-02.1"`.

These are exactly the three former Rust pins (claude small-fast, codex default,
opencode fallback list), now data.

**Probe + store**
([`gateway_probe.rs`](../anyharness/crates/anyharness-lib/src/domains/agents/catalog/gateway_probe.rs)):
`probe_gateway_models(base_url, key)` = `GET {base_url}/v1/models` with the
virtual key, tolerant parse of `data[].id`, 10s timeout, **no harness process
spawned**. Results land in a new sqlite table `gateway_model_probe`
(harness_kind, revision, models_json, probed_at) keyed by the state.json
revision that supplied the creds.

**Triggers** (all fire-and-forget, never block a launch):
- **revision bump** — `PUT /v1/agent-auth/state`
  ([`api/http/agent_auth.rs`](../anyharness/crates/anyharness-lib/src/api/http/agent_auth.rs))
  schedules a probe per gateway source in the just-applied doc.
- **manual** — `POST /v1/agents/{kind}/catalog/refresh-gateway`
  ([`agent_gateway_catalog.rs`](../anyharness/crates/anyharness-lib/src/api/http/agent_gateway_catalog.rs)),
  surfaces probe errors (502).
- **lazy at launch** — `schedule_launch_probe_if_stale`: if no probe row exists
  for the current revision, spawn one in the background and launch on seed data.

**Resolver**
([`gateway_resolver.rs`](../anyharness/crates/anyharness-lib/src/domains/agents/catalog/gateway_resolver.rs)):
`resolve_with_source(harness, revision)` builds the `GatewayModelPlan` — latest
probe rows for the revision, else `gatewayPolicy.seedModels` — **filtered by
`gatewayPolicy.providers`** through `provider_for_model`, a prefix matcher that
now includes (#928): `claude-*` → `anthropic`; `anthropic.` / `us.anthropic.` /
`global.anthropic.` / `eu.anthropic.` / `apac.anthropic.` → `anthropic` (Bedrock
inference profiles); `openai.` → `openai` (Bedrock openai family); `gpt-*` →
`openai`; `o` + ascii-digit → `openai` (o-series, tightened to exclude opus);
`grok-*` → `xai`; empty providers = all. **Critical:** `provider_for_model`
doubles as the `filter_by_providers` gate — a new provider family without an arm
gets silently dropped from agents' plans. `default_model` / `small_fast_model`
come from `defaults.gateway` / `roles`. It implements the render plane's
`GatewayModelResolve`, so render consumes the plan directly.

**The two runtime catalog HTTP endpoints**
([`api/router.rs`](../anyharness/crates/anyharness-lib/src/api/router.rs)):
- `GET /v1/agents/{kind}/catalog/gateway-models` → `{ models, source:
  "seed"|"probe", probedAt? }` (provider-filtered plan for the local surface).
- `POST /v1/agents/{kind}/catalog/refresh-gateway` → re-probe now + record.

**Desktop mirror-push to the cloud read-model.** The local runtime holds **no
cloud session**, so the desktop plays courier: it owns the cloud creds, polls
the runtime `gateway-models` endpoint per ready harness, and forwards any FRESH
probe to `POST /agent-gateway/catalog/{harness}/mirror`, stored as a
`runtime-mirror` snapshot (`mirror_catalog` in
[`catalog.py`](../../../server/proliferate/server/cloud/agent_gateway/catalog.py)).
Truth never moves server-side — the mirror is a read-model so cloud UI +
automations can read at rest.

### 6a. Model enrichment + the family-key join (#923, #926)

The catalog rows above are bare ids on the probe path; the **HTTP layer joins
catalog-v2 metadata onto them** so consumers get rich rows (contract:
[`model-table-contract.md`](./model-table-contract.md)):

- `GET .../gateway-models` entries and the launch-options model entries are
  `{ id, displayName?, description?, provider?, status?, effort?{values,
  default}, fastMode?, modes? }` — joined in
  [`agent_gateway_catalog.rs`](../anyharness/crates/anyharness-lib/src/api/http/agent_gateway_catalog.rs)
  and [`launch_options.rs`](../anyharness/crates/anyharness-lib/src/domains/sessions/service/launch_options.rs)
  from the bundled catalog entry (`effort` = `controls.effort` **or**
  `controls.reasoning_effort` (#928 fallback, fixes codex's empty Thinking
  column) + observedValue; `modes` = `controls.mode.values`; `provider` from
  `provider_for_model`). Probe-only ids stay sparse `{id, provider?}`.
  `GatewayModelPlan`/render still consume plain ids — enrichment is
  presentation-layer only. **Display name fixes (#955):** catalog garbage names
  (`Claude-Fable-5` → `Fable 5`, `Claude-Opus-4-8` → `Opus 4.8`) fixed via
  `MODEL_DISPLAY_OVERRIDES` in
  [`build-catalog.mjs`](../../../scripts/agent-catalog/build-catalog.mjs);
  `global.anthropic.claude-fable-5` deduplicated (visibility false).
- **Family-key join** (`normalize_model_family` in
  [`gateway_resolver.rs`](../anyharness/crates/anyharness-lib/src/domains/agents/catalog/gateway_resolver.rs)):
  catalog ids are harness-native (`sonnet`, `opus[1m]`, `us.anthropic.…-v1:0`)
  while gateway ids are API ids (`claude-sonnet-4-6`), so exact-id joins
  matched nothing in reality. The normalizer strips `us./global.anthropic.`
  prefixes, `[1m]`, bedrock `-vN:M`, and trailing `-YYYYMMDD`; matching tries
  exact-id then family, preferring the non-`[1m]` most-specific entry. Pure
  CLI selectors (`default`, `sonnet`) deliberately stay unbridged.
- **Generation alignment + Bedrock dedup (#928, #955)**: the join only fires if
  [`config.yaml`](../../../server/litellm/config.yaml) serves the model generations
  the catalog knows. **Current-gen Anthropic is now Bedrock-only** in config.yaml:
  the bare direct entries (`claude-sonnet-4-6`, `claude-sonnet-5`, `claude-opus-4-7`,
  `claude-opus-4-8`, `claude-fable-5`) were REMOVED in #928 to deduplicate the model
  table — only the `us.anthropic.*` / `global.anthropic.*` inference-profile ids
  remain for current-gen; older-gen (sonnet-4-5, haiku-4-5, opus-4-6 + dated
  aliases) stay direct Anthropic. This inverts the original invariant: current-gen
  is Bedrock-only, older-gen is direct-only. **Maintenance invariant:** when the
  bundled catalog moves generations, config.yaml must follow this dedup rule, or
  gateway rows render sparse / duplicate.
- Richness rides everywhere the rows travel: the #912 native-refresh upload
  (`buildRuntimeCatalogModelsJson` in
  [`harness-catalog.ts`](../../../apps/desktop/src/lib/domain/settings/harness-catalog.ts))
  and the mirror push both forward the enriched entries; server
  `parse_models_json` stores extra keys as-is.

---

## 7. Desktop UX (agents scope) — [`components/settings/panes/agents/`](../../../apps/desktop/src/components/settings/panes/agents/)

Overview → per-harness [`HarnessPane.tsx`](../../../apps/desktop/src/components/settings/panes/agents/harness/HarnessPane.tsx)
(Cloud/Local segmented control = surface) → keys manager
[`api-keys/ApiKeysPane.tsx`](../../../apps/desktop/src/components/settings/panes/agents/api-keys/ApiKeysPane.tsx)
(vault: title + redacted hint + revoke; add form is **title + value only**).

**Per-harness auth section**
([`HarnessAuthSection.tsx`](../../../apps/desktop/src/components/settings/panes/agents/harness/HarnessAuthSection.tsx)):
- a **Gateway toggle** (one `Switch`, locked until capabilities resolve + the
  enrollment is synced);
- **env-var rows**
  ([`HarnessAuthApiKeyRow.tsx`](../../../apps/desktop/src/components/settings/panes/agents/harness/HarnessAuthApiKeyRow.tsx)):
  `[ENV_VAR_NAME] [titled-key dropdown ▾] [enabled switch] [remove]`, "Add
  variable" prefilled from a per-harness suggestion registry
  ([`config/harness-env-vars.ts`](../../../apps/desktop/src/config/harness-env-vars.ts):
  claude→`ANTHROPIC_API_KEY`, codex→`OPENAI_API_KEY`, grok→`XAI_API_KEY`);
- local-authoritative editor: every edit PUTs the **full desired source list**;
  single-source harnesses enforce radio semantics client-side (enabling one
  disables the rest); `native` = the empty state, shown as copy;
- **OpenCode** additionally shows "Add provider" →
  [`ProviderPickerModal.tsx`](../../../apps/desktop/src/components/settings/panes/agents/harness/ProviderPickerModal.tsx),
  a searchable picker over the **vendored models.dev registry**
  ([`provider-registry.generated.json`](../../../apps/desktop/src/config/provider-registry.generated.json),
  refreshed by [`scripts/vendor-provider-registry.mjs`](../../../scripts/vendor-provider-registry.mjs)) —
  selecting a provider prefills `env_var_name` + `provider_hint`;
- cursor shows native-only copy, no controls.

**All-Models tab**
([`HarnessAllModelsSection.tsx`](../../../apps/desktop/src/components/settings/panes/agents/harness/HarnessAllModelsSection.tsx)):
renders [`ModelTable`](../../../apps/packages/product-ui/src/settings/ModelTable.tsx)
(#923/#926, replacing the card grid; `ModelConfigGrid` survives only for the
org agent-policy pane). Columns: **Model** (displayName + description subtitle;
raw id on hover; mono-id subtitle only when no description) · **Provider** ·
**Thinking** (effort chips, observed default filled) · **Modes** (quiet pills,
max 3 + `+N` overflow, full list on hover) · **Fast mode** · **Enabled**
switch. Rows the enrichment can't bridge (§6a) render sparse (`—` cells);
Status is deliberately not rendered until non-`active` statuses exist in real
data (field stays on the wire). Data paths:
- **local + gateway route** reads the RUNTIME's resolved plan
  (`useAgentGatewayModelsQuery` → `GET gateway-models`) instead of the cloud
  snapshot, with a **"seed" vs "probed <time>"** freshness line; Refresh calls
  the runtime `refresh-gateway`. Runtime-resolved models have no override
  endpoint yet, so toggles are read-only there.
- **native / api_key routes (#912):** the cloud `refresh_catalog` rejects a
  refresh with no uploaded payload, so Refresh sources the model list from the
  local runtime's already-resolved **launch options**
  (`useAgentLaunchOptionsQuery` → `buildRuntimeCatalogModelsJson`) and uploads
  it via `POST /catalog/{harness}/refresh`.
- cloud surface keeps reading the layered cloud catalog snapshot+override
  (old thin snapshots render sparse; refreshed ones carry the enriched keys).

Lifecycle hooks (wired in [`App.tsx`](../../../apps/desktop/src/App.tsx) :210–216):
[`use-local-auth-state-sync.ts`](../../../apps/desktop/src/hooks/agents/lifecycle/use-local-auth-state-sync.ts)
(server `GET /state` → runtime `PUT /v1/agent-auth/state`),
[`use-gateway-catalog-mirror-sync.ts`](../../../apps/desktop/src/hooks/agents/lifecycle/use-gateway-catalog-mirror-sync.ts)
(runtime probe → cloud mirror, §6),
[`use-first-run-auth-adoption.ts`](../../../apps/desktop/src/hooks/agents/lifecycle/use-first-run-auth-adoption.ts).

---

## 8. LiteLLM gateway — real upstreams + compose — [`server/litellm/config.yaml`](../../../server/litellm/config.yaml)

The **one authored artifact** (dev and prod run it as-is). `model_list` maps
model names → **real** upstreams: Anthropic direct (older-gen: sonnet-4-5,
haiku-4-5, opus-4-6 + dated aliases), OpenAI (gpt-5.2, gpt-5-mini), **real xAI**
(grok-4, grok-4-fast→`xai/grok-4-1-fast`, grok-code-fast-1,
grok-build→`xai/grok-3-mini-latest`), and **AWS Bedrock** (#928):
- **Current-gen Anthropic via Bedrock cross-region inference profiles**
  (`us.anthropic.claude-sonnet-4-6`, `-sonnet-5`, `-opus-4-7`, `-opus-4-8`,
  `-fable-5`, `-haiku-4-5-20251001-v1:0`; `global.anthropic.claude-fable-5`) —
  these are the REAL inference-profile IDs so family-key enrichment works.
- **OpenAI open-weight on Bedrock** (`openai.gpt-oss-120b-1:0`, `-20b-1:0`).
- **Credentials:** AWS default credential chain. Prod/staging = ECS task role
  with attached policy `arn:aws:iam::157466816238:policy/proliferate-gateway-bedrock-invoke`;
  local dev = `GATEWAY_AWS_ACCESS_KEY_ID` + `GATEWAY_AWS_SECRET_ACCESS_KEY` env
  (optional; stack boots without them). Region via `AWS_BEDROCK_REGION`
  (default `us-east-1`).

**Dedup rule** (#928/#955): current-gen Anthropic bare entries (claude-sonnet-4-6,
-sonnet-5, -opus-4-7, -opus-4-8, -fable-5) were REMOVED to prevent duplicate rows
in the model table — only Bedrock inference-profile ids serve current-gen.

**Same-provider aliasing rule** (documented at the top of the file): a
`model_name` may only be re-pointed at a different upstream id when both are the
**same provider** (bare + dated pairs; grok-build→a cheaper xAI model). Never
cross-provider. Mocks / test shims belong in a dev compose overlay, never this
file. Provider keys come from the container env (`ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `XAI_API_KEY`, AWS creds as above); `master_key` from
`LITELLM_MASTER_KEY`. Config stays as-code — no LiteLLM DB-backed model management.

**Enrollment / budget / usage-import / top-ups are unchanged** — one unscoped
vkey per subject, curation is product-level (§6), money ledger as before
([`usage_import.py`](../../../server/proliferate/server/cloud/agent_gateway/usage_import.py),
[`topups.py`](../../../server/proliferate/server/cloud/agent_gateway/topups.py),
[`free_credits.py`](../../../server/proliferate/server/cloud/agent_gateway/free_credits.py),
[`worker.py`](../../../server/proliferate/server/cloud/agent_gateway/worker.py)).

**Dev compose** ([`server/docker-compose.yml`](../../../server/docker-compose.yml)):
`litellm` (`ghcr.io/berriai/litellm:main-stable`, `:14000`) + `litellm-db`,
always on, config bind-mounted. Passes through `AWS_BEDROCK_REGION` (default
`us-east-1`), `GATEWAY_AWS_ACCESS_KEY_ID`, `GATEWAY_AWS_SECRET_ACCESS_KEY`.

**Prod compose** ([`server/deploy/docker-compose.production.yml`](../../../server/deploy/docker-compose.production.yml),
new in #906): `litellm` + `litellm-db` both under `profiles: ["agent-gateway"]`
so bare `up -d`/`pull` skip them — self-hosters who leave the gateway off never
pull them. Image `${PROLIFERATE_LITELLM_IMAGE:-ghcr.io/proliferate-ai/proliferate-litellm}`.

**Managed prod** deploys LiteLLM as a **separate ECS Fargate service** via
[`_deploy-litellm.yml`](../../../.github/workflows/_deploy-litellm.yml) (gated
`LITELLM_DEPLOY_ENABLED`, own RDS, image pushed to **ECR**, keys from
`AGENT_GATEWAY_MANAGED_{ANTHROPIC,OPENAI,XAI}_API_KEY` secrets, ECS task role
prerequisite documented in the workflow). **As of 2026-07-04, the managed prod
service `proliferate-prod-litellm` (cluster `proliferate-prod`) is live and
public at https://gateway.proliferate.com** (ACM cert + ALB host-header rule).
The prod-compose service is the self-host path; ECS is the managed path — see
the gap in §11.

---

## 9. Money · Governance (brief)

- **Money:** spend logs → usage events (cursor + overlap, unique request-id) →
  `remaining = Σ grants − Σ cost` → at zero: disable vkey + `budget_status=exhausted`
  → 🏠 Stripe top-up worker re-credits + reactivates (only when
  `topups_enabled()`). Free signup grant `agent_gateway_free_credit_usd`.
- **Governance:** `org_agent_policy` flag-only allow-lists;
  `selection_violates_policy` computes conflicts **live**, nothing is blocked;
  PUT is org-admin-gated + plan-gated (`agent_gateway_policy_min_plan`).

---

## 10. End-to-end traces

1. **"My Anthropic key for Claude, cloud":** `PUT /selections/claude?surface=cloud`
   with one `api_key` source (`ANTHROPIC_API_KEY` → vault key) →
   `selection_rules` OK → store diff → materializer decrypts the vault key →
   writes `state.json` v2 into the sandbox → next launch: Rust resolves
   `ApiKey`, `set[ANTHROPIC_API_KEY]=…`, spawns.
2. **Gateway → money:** gateway toggle on → materializer decrypts the enrollment
   vkey → `state.json` gateway source → launch: claude recipe points the CLI at
   the proxy; the proxy meters; importer dedups spend → balance recomputed → at
   zero vkey blocked → top-up worker → grant → unblocked. Every seam idempotent.
3. **Runtime catalog:** apply `state.json` (rev 41) → background gateway probe →
   `gateway_model_probe(claude, 41)` → resolver serves probed models (filtered
   to `anthropic`) → opencode's `opencode.json` models map is live, not seed →
   desktop mirrors the probe up to the cloud read-model.

---

## 11. Self-hosting checklist (🏠)

Config in [`config.py`](../../../server/proliferate/config.py) (search `agent_gateway_`);
env-var names are the uppercase forms.

- **`AGENT_GATEWAY_ENABLED=true`** — feature flag (default off).
- **LiteLLM proxy** with its **own Postgres**. Point the server at it:
  - `AGENT_GATEWAY_LITELLM_BASE_URL` — server→proxy admin URL (default
    `http://127.0.0.1:14000`).
  - **`AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL`** — the URL sandboxes/harnesses
    use; **unset ⇒ gateway sources are dropped** (now with a loud operator
    warning, §4). Must be set for the gateway to work.
  - `AGENT_GATEWAY_LITELLM_MASTER_KEY` — admin key for `/team`,`/key`,`/spend/logs`.
- **Provider keys** on the proxy container: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
  `XAI_API_KEY` (managed prod maps these from `AGENT_GATEWAY_MANAGED_*` secrets);
  **Bedrock** via `AWS_BEDROCK_REGION` (default `us-east-1`) + AWS default
  credential chain (`GATEWAY_AWS_ACCESS_KEY_ID` + `GATEWAY_AWS_SECRET_ACCESS_KEY`
  for local dev; ECS task role with
  `arn:aws:iam::157466816238:policy/proliferate-gateway-bedrock-invoke` for
  deployed).
- **`cloud_secret_key`** (Fernet) — encrypts vault keys + virtual keys.
- **Bring the gateway up:**
  `docker compose --profile agent-gateway -f server/deploy/docker-compose.production.yml up -d`.
- **Budgets/credits/top-ups:** `agent_gateway_default_user_budget_usd` /
  `_org_budget_usd` / `_free_credit_usd`; top-ups run only when
  `topups_enabled()` — without them, exhausted subjects just stay blocked.
- **Direct-key / native only:** leave `AGENT_GATEWAY_ENABLED=false` — everything
  unconfigured resolves to native at launch; BYO-key wiring needs no proxy.

**⚠️ KNOWN GAPS (P2 follow-ups, real on `main`):**
- **Prod server env incomplete (2026-07-04).** The managed prod litellm ECS
  service is live at https://gateway.proliferate.com, but the prod server env
  still lacks `AGENT_GATEWAY_ENABLED` / `AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL` /
  master key, so cloud sessions don't use the gateway yet — it's deployed but
  not wired into the control plane.
- **No CI publishes `ghcr.io/proliferate-ai/proliferate-litellm`.** The prod
  compose references it, but the only image any workflow builds is pushed to
  **ECR** by `_deploy-litellm.yml` (the ECS path). A self-hoster enabling
  `--profile agent-gateway` hits a missing image — build the LiteLLM image
  ([`server/litellm/Dockerfile`](../../../server/litellm/Dockerfile)) locally / set
  `PROLIFERATE_LITELLM_IMAGE`, or wait for a publish job.
- **No Caddy exposure for the prod-compose LiteLLM service.** The Caddyfile only
  `reverse_proxy api:8000`; `litellm` has no published port and no route — it's
  reachable only on the compose network.
- **Stale self-host docs.** [`.env.production.example`](../../../server/deploy/.env.production.example)
  still describes **Bifrost** (`AGENT_GATEWAY_BIFROST_*`,
  `AGENT_GATEWAY_OPENCODE_ENABLED`) — env vars that no longer exist in
  `config.py`. It documents none of the LiteLLM knobs above.
- **(external, not repo-verifiable)** the OpenAI gpt-5 family requires org
  verification on the dev-key account (platform.openai.com settings).

---

## 12. Upgrading from the pre-2026-07-03 stack

- **Old `state.json` v1 files fail closed.** The render plane accepts only
  `version == 2`; any v1 / version-less file is `MalformedStateFile`, and since
  `resolve_launch_route_auth` loads the file **before** resolving any harness, a
  stale v1 file **blocks every launch** (including native harnesses). This is
  by design (fail-closed), not a bug.
- **Remedy:** delete `<runtime_home>/agent-auth/` (state file + isolated
  dirs + manifest). The desktop re-pushes a fresh v2 doc on the next sync
  (`apply_state_file` also self-heals a malformed on-disk file on any valid push).
- **Dev DBs need recreation.** The rebuild migration
  ([`c9b8a7d6e5f4`](../../../server/alembic/versions/c9b8a7d6e5f4_agent_auth_selection_rebuild.py))
  **drops** `agent_auth_route_selection` + the old `agent_api_key` and creates
  the new tables — **destructive, no data migration**. Any pre-rebuild vault
  keys + selections are gone; recreate the dev DB and re-add keys via the UI.
