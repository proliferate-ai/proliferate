# Agent Auth & Catalog — Architecture v2 (target state)

*2026-07-06. The clean, whole-system description of agent auth + the runtime
catalog, written **as if every fix in
[`agent-auth-fixes-2026-07-06.md`](./agent-auth-fixes-2026-07-06.md) and every
piece of [`catalog-convergence-v1.md`](./catalog-convergence-v1.md) has landed**
(F1 rotation trigger, F2 tolerance pin, F3 open-model secrets, F4/P1–P5
convergence, F6 visibility overrides, plus in-flight #942/#963/#961/#962).
Where behavior is a settled product decision rather than code, it's marked
**[decision]**. Supersedes
[`codex/agent-auth-architecture-current.md`](../../codex/agent-auth-architecture-current.md)
as the map once the fix list clears; every chain below was adversarially
validated link-by-link against `main` on 2026-07-06 except the items the fix
list introduces.*

---

## 0. The premise in four sentences

The user decides, **per harness × per surface**, how each coding agent
authenticates. Two mechanisms compose: **direct provider keys** (titled secrets
from a provider-agnostic vault, wired to arbitrary env vars) and the **managed
gateway** (a LiteLLM virtual key — metered, budgeted, billable). **Native is the
empty state** — zero enabled wirings means the CLI's own login owns auth; native
credentials are never stored, only the *absence* of wiring. One AUTH-ONLY
contract file (`state.json` v2) crosses every plane; model truth never travels
in it — models are **probed** by the runtime and **pinned/policied** by the
catalog, two artifacts that converge to fleets independently.

## 1. The four planes

```
 CONTROL PLANE (server + Postgres)        DATA PLANE           RENDER PLANE (anyharness, Rust)
 ┌────────────────────────────────┐   ┌───────────────┐   ┌─────────────────────────────────┐
 │ 10 tables                      │   │ LiteLLM proxy │   │ state.json ─► two-phase PURE     │
 │  ├ vault (agent_api_key)       │   │ (own Postgres)│   │ render {set,remove,files}        │
 │  ├ wiring (agent_auth_selection)│  │ /v1/messages  │   │  ─► apply ─► spawn CLI           │
 │  ├ enrollment (vkeys)          │   │ /chat /resp.  │   │ absent/empty ⇒ native            │
 │  ├ harness settings (#963)     │   │ /v1/models ◄──┼───┤ gateway probe ─► sqlite          │
 │  ├ catalog snapshot+override   │   └───────────────┘   │  ─► GatewayModelPlan ─► render   │
 │  └ money ledger + org policy   │                       │ catalog: bundled ─► converged    │
 │        ▲            │          │                       └───────────▲─────────────────────┘
 │  usage importer     ▼          │        state.json v2 (cloud: materializer → sandbox file)
 │  ◄ /spend/logs   GET /state ───┼──────────────────────────────────► (local: desktop courier)
 │  GET /v1/catalogs/agents ──────┼── heartbeat catalogVersion ──► worker fetch+push (cloud)
 └────────────────────────────────┘         └── desktop sync hook (local)      │
                        ▲  desktop mirror-push (probe results, read-model) ◄───┘
```

One rule per plane:
- **Server** persists intent, decrypts secrets *into the file*, and serves the
  catalog; it never resolves models at launch.
- **Render plane** turns the file into an env delta + isolated config files;
  it knows nothing about model policy beyond the plan handed to it.
- **Runtime catalog** probes what the gateway can actually serve (truth) and
  carries what each harness is allowed/pinned to (policy); both feed render.
- **Desktop** is the only party holding cloud creds locally, so it plays
  courier both directions: auth state + catalog *down* to the local runtime,
  probe results *up* to the cloud read-model.

## 2. Control plane — the ten tables

[`db/models/cloud/agent_gateway.py`](../../server/proliferate/db/models/cloud/agent_gateway.py)
(+ [`support.py`](../../server/proliferate/db/models/support.py) for none of
this — listed to say so). Literals in
[`constants/agent_gateway.py`](../../server/proliferate/constants/agent_gateway.py).

| Table | Role | The key facts |
|---|---|---|
| `agent_api_key` | **Vault** | Titled, **provider-less** secret: `title`, Fernet `value_ciphertext`+`encryption_key_id`, `redacted_hint`, status. A key gains provider meaning only when a selection wires it under an `env_var_name`. |
| `agent_auth_selection` | **Wiring** | One row per `(user, harness_kind, surface, source_kind, env_var_name)`. `source_kind ∈ {gateway, api_key}` — **native is not a row**. `api_key_id`+`env_var_name` iff `api_key` (CHECKs enforce). Partial unique index `ux_agent_auth_selection_gateway` ⇒ ≤1 gateway per scope. `enabled` bool (disable ≠ delete). `provider_hint` display-only, never on the wire. |
| `agent_auth_harness_settings` (#963) | **Per-harness settings** | `(user_id, harness_kind, surface)` unique → `settings_json` (bool map, e.g. `{"chrome": true}`). User-scoped. Rides state.json as an optional field. |
| `agent_gateway_enrollment` | **Gateway identity** | LiteLLM team+user+vkey per billing subject. `subject_kind ∈ {user, organization}`; Fernet vkey ciphertext; `sync_status`, `budget_status`. **[decision]** Launch path resolves **personal enrollment only** (`get_enrollment_for_user`); org-subject rows are minted but unwired until the org-billing resolution order is decided (F5). |
| `agent_catalog_snapshot` | **Model read-model** | Layered per `(harness, surface, route, owner)`; `source ∈ {probe, seed, override, runtime-mirror}`; `models_json` = entries with at least `{id}`. |
| `agent_catalog_override` | **User model edits** | Per `(user, harness)`: `patch_json` `{remove, update, add}` applied in that order. **The visibility mechanism**: hiding writes `update[id].hidden=true`; absence of a patch = visible ⇒ **new models are visible by default** (F6). |
| `agent_llm_usage_event` | **Debits** | From `/spend/logs`; `litellm_request_id` UNIQUE ⇒ idempotent import. |
| `llm_credit_grant` | **Credits** | `source_ref` UNIQUE. Balance is always `Σ grants − Σ cost`, never stored. |
| `agent_llm_usage_import_cursor` | Importer cursor | Overlap-tolerant paging. |
| `org_agent_policy` | **Governance** | Flag-only allow-lists; violations computed live, nothing hard-blocked; PUT org-admin- and plan-gated. |

Nothing is plaintext at rest ([`utils/crypto.py`](../../server/proliferate/utils/crypto.py),
Fernet on `settings.cloud_secret_key`). 🏠 self-host needs `CLOUD_SECRET_KEY`.

## 3. Intent API + the one validator

[`server/cloud/agent_gateway/api.py`](../../server/proliferate/server/cloud/agent_gateway/api.py)
(mounted `/v1/cloud/agent-gateway`):

- **Vault** — `GET/POST /keys` (`{title, value}`, value write-only),
  `DELETE /keys/{id}` (409 + referencing harnesses if an enabled selection
  wires it).
- **Selections** — `PUT /selections/{harness}?surface=` takes the **full
  desired source list** plus optional `settings` (#963); server validates,
  diffs (rows keyed `(source_kind, env_var_name)` update in place — ids
  survive), persists, schedules cloud materialization.
- **State** — `GET /state?surface=` renders the caller's own state.json v2.
- **Catalog** — `GET /catalog/{harness}`, `POST .../refresh`, `POST .../mirror`,
  `PUT/DELETE .../override`.
- **Capabilities/enrollment/policy** — `GET /capabilities`
  (`gateway_enabled`, `public_base_url`, enrollment status), `GET /enrollment`
  (never the raw vkey), `GET/PUT /policy` + `GET /policy/violations`.

Two-layer legality, deliberately split:
- **Structural coherence** in the store
  ([`db/store/agent_gateway/selections.py`](../../server/proliferate/db/store/agent_gateway/selections.py)):
  source shape, key ownership/active status, no duplicate
  `(source_kind, env_var_name)` — uncircumventable by any caller.
- **Per-harness legality** in the ONE business validator
  ([`selection_rules.py`](../../server/proliferate/server/cloud/agent_gateway/selection_rules.py)):
  `claude/codex/grok` ≤1 enabled source; `opencode` = gateway + any number of
  api_key rows (+ native coexistence, #962); `cursor` = none; gateway only for
  recipe-bearing harnesses; env-var names `^[A-Z][A-Z0-9_]{0,127}$`.

[`service.py`](../../server/proliferate/server/cloud/agent_gateway/service.py):
validate → diff → audit → `schedule_materialize_agent_auth` (cloud surface).

## 4. The contract — `state.json` v2

Owner: [`materialization/materialize/agent_auth.py`](../../server/proliferate/server/cloud/materialization/materialize/agent_auth.py).
`render_agent_auth_state(inputs) → (state, fingerprint)`; both delivery paths
share it (cloud materializer writes the `cloud` surface; `GET /state` serves
`local`).

```json
{
  "version": 2, "revision": 41, "user_id": "…",
  "harnesses": [
    { "harness_kind": "claude",
      "sources": [ {"kind": "gateway", "base_url": "https://…", "key": "sk-vk-…"} ],
      "settings": {"chrome": true} },
    { "harness_kind": "opencode",
      "sources": [ {"kind": "gateway", "base_url": "https://…", "key": "sk-vk-…"},
                   {"kind": "api_key", "env_var_name": "ANTHROPIC_API_KEY", "value": "sk-ant-…"} ] }
  ]
}
```

Contract invariants:
- **AUTH-ONLY** (+ optional per-harness `settings`): no model lists, no slots,
  no providers.
- `sources` = enabled rows only; a harness with no resolvable source is
  **omitted** (reads as native); an entirely empty surface deletes file +
  manifest.
- `revision` = `max(updated_at)` ms across the surface's **selection** rows —
  monotonic while the scope is non-empty. **Content is authoritative**: change
  detection is a sha256 fingerprint of canonical JSON in a server-owned
  manifest. Anything that changes file *content* without touching selection
  rows — vkey rotation above all — **must schedule materialization** so the
  fingerprint check can run (F1 invariant: any `virtual_key_ciphertext`/status
  mutation schedules it).
- **Forward tolerance is pinned by test** (F2): the Rust state structs carry no
  `deny_unknown_fields`, and a regression fixture with unknown keys asserts old
  runtimes load new documents. Optional-field addition is the upgrade path;
  version bumps are for breaking shape changes only (v1 → fail-closed
  `MalformedStateFile` remains the precedent).
- 🏠 a gateway source with `AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL` unset is
  dropped **loudly** (operator `logger.warning`).

## 5. Delivery — the two validated chains

### 5.1 Local (server → desktop courier → runtime → process)

| Link | Mechanism |
|---|---|
| render | `GET /state?surface=local` → `build_agent_auth_state` → decrypts vault keys + enrollment vkey into the doc |
| courier | [`use-local-auth-state-sync.ts`](../../apps/desktop/src/hooks/agents/lifecycle/use-local-auth-state-sync.ts): on runtime-healthy + signed-in + mutation invalidations; guards `revision > 0` and fingerprint delta; → runtime `PUT /v1/agent-auth/state` |
| persist | [`agent_auth.rs`](../../anyharness/crates/anyharness-lib/src/api/http/agent_auth.rs) → `apply_state_file` ([`state.rs:138`](../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/state.rs)): atomic 0600 at `<runtime_home>/agent-auth/state.json`, **stale-revision 409**, self-heals malformed on-disk files |
| launch | [`startup.rs:335`](../../anyharness/crates/anyharness-lib/src/domains/sessions/runtime/startup.rs) → `resolve_launch_route_auth` reads the same path |
| spawn | `RenderedRouteAuth {set, remove}` → `LaunchEnv` ([`launch_policy.rs:189`](../../anyharness/crates/anyharness-lib/src/domains/sessions/runtime/launch_policy.rs)) → [`process.rs`](../../anyharness/crates/anyharness-lib/src/domains/sessions/live/sessions/driver/process.rs) `.envs(&spawn_env)` + `.env_remove(...)` + `.args(&launch_env.settings_extra_args)` |
| probe | every applied push schedules a gateway probe per gateway source (fire-and-forget) |

### 5.2 Cloud (selection edit / rotation → materializer → sandbox file)

| Link | Mechanism |
|---|---|
| trigger | selections PUT · **vkey rotation (F1)** · new enrollment · **new sandbox provision** (`sandbox.py` materializes agent auth *before* the first session can launch) |
| write | materializer renders via the same renderer, fingerprint-diffs against the server-owned manifest (unchanged ⇒ no write), writes 0600 via provider file write + atomic mv to `/home/user/.proliferate/anyharness/agent-auth/state.json` |
| read | identical Rust path (`runtime_home` defaults to `/home/user/.proliferate/anyharness` in sandboxes) — **path agreement verified exactly** |
| empty | all selections removed ⇒ file + manifest deleted in the sandbox; absent file ⇒ native (intended) |
| fail-closed | cloud launch refuses on unresolvable route auth in the Rust launcher — no ambient fallback |

Any `resolve_launch_route_auth` error is `StartSessionError::RouteAuth`: **the
launch is refused**. The runtime trusts the server (no per-harness legality
re-check); typed errors guard the shape only.

## 6. Render plane — two-phase PURE render

[`domains/agents/route_auth/`](../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/):

```
route_auth/
├── mod.rs          resolve_launch_route_auth = load → profile → resolve models → render → apply
├── state.rs        serde structs + tolerant load (absent→native; broken/≠v2→MalformedStateFile)
├── profile.rs      pure decision: enabled sources → typed ResolvedSource{Gateway|ApiKey}
├── plan.rs         GatewayModelPlan {default_model, small_fast_model, models} + resolve seam
├── render.rs       PURE: no I/O → RenderedRouteAuth {set: BTreeMap, remove: Vec, files: Vec<FileSpec>}
├── materialize.rs  APPLY: write FileSpecs 0600; revision-keyed dirs + keep-2 GC
└── render_tests.rs
```

Model values flow **into** render already resolved (the plan); render looks
nothing up. Per-harness gateway recipes (live-verified,
[`HARNESS-MATRIX.md`](../../scripts/agent-gateway-smoke/HARNESS-MATRIX.md)); no
model-id constants in Rust:

| Harness | Recipe | Sanitize / notes |
|---|---|---|
| claude | `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`; `ANTHROPIC_SMALL_FAST_MODEL` only when the plan pins it (the CLI's ambient haiku-tier sidecar model otherwise 400s against the proxy); isolated `CLAUDE_CONFIG_DIR` (stable dir) | always removes `CLAUDE_CODE_USE_BEDROCK/VERTEX`, `AWS_BEARER_TOKEN_BEDROCK`, and any `ANTHROPIC_*` var this render did not set |
| codex | isolated `CODEX_HOME` + generated `config.toml` (`wire_api="responses"`, provider `proliferate`, `env_key="PROLIFERATE_GATEWAY_KEY"`); **errors if `plan.default_model` is None** | removes ambient `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` |
| opencode | isolated `OPENCODE_CONFIG` + XDG dirs; generated `opencode.json` — openai-compatible provider, `apiKey: {env:PROLIFERATE_GATEWAY_KEY}`, models map = every plan id; **errors if plan.models empty** | native auth coexists with gateway/api-key (#962) |
| grok | isolated `HOME` + `GROK_MODELS_BASE_URL` + `XAI_API_KEY` | pure dynamic discovery |
| api_key (any) | `set[env_var_name] = value` — fully generic | |
| cursor | native only, no recipe | |

Secrets never touch disk except by env-var reference; the env delta is the only
secret carrier. Harness **settings** (#963) resolve separately:
[`catalog/settings.rs`](../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/settings.rs)
joins persisted `settings` against the catalog's per-setting declaration
(`cli_flag` mapping, **`surfaces` filter** — chrome is `["local"]`, so cloud
ignores it by design) → `extra_args` appended at spawn.

## 7. Runtime catalog — probed truth × authored policy

[`domains/agents/catalog/`](../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/):

```
catalog/
├── bundled.rs           include_str!(catalogs/agents/catalog.json) — first-boot fallback
├── loader.rs/schema.rs  parse + document schema (gatewayPolicy, install pins, settings, models)
├── validation*.rs       document invariants + registry pairing
├── sync.rs              converge-to-server: apply on ANY version difference (rollback = revert the PR)
├── service.rs           ActiveCatalog read surface (defaultVisible = the menu, availability = the truth)
├── settings.rs          per-harness settings resolution (#963)
├── gateway_probe.rs     GET {base}/v1/models w/ the user's vkey → sqlite
└── gateway_resolver.rs  plan building: probe-else-seed, provider filter, defaults/roles
```

**Two truths, deliberately separate:**
- **Probed truth** — `probe_gateway_models` hits the proxy with the user's own
  creds (so every deployment probes *its own* gateway; self-host correctness for
  free). Rows land in sqlite `gateway_model_probe (harness_kind, revision,
  models_json, probed_at)`, keyed by the auth revision that supplied the creds.
  Triggers: auth push, manual refresh endpoint, lazy-at-launch when stale, and
  **catalog-applied / agent-reinstall (convergence P4)**. Never blocks a launch.
- **Authored policy** — catalog.json `gatewayPolicy {providers, roles,
  seedModels}` + `defaults`: claude `providers:["anthropic"]` +
  `roles.small_fast`; codex `["anthropic","openai"]` + `defaults.gateway`;
  opencode seed-only (no filter); grok `{}` — **[decision]** unfiltered by
  design (dynamic-discovery CLI; sees everything the proxy serves).

**Filtering is entirely client-side.** Virtual keys are unscoped; the proxy
serves its whole `model_list` to every key. `provider_for_model`
([`gateway_resolver.rs:40`](../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/gateway_resolver.rs))
maps id prefixes → providers (`claude-*`/`*.anthropic.*`→anthropic,
`gpt-*`/`o<d>`/`openai.*`→openai, `grok-*`→xai, `deepseek-*`→deepseek,
`glm-*`→zhipu per #942); a new provider = one Rust arm + rebuild (generalizing
prefixes into catalog data is explicitly deferred). Unknown-prefix models
survive only for empty-filter harnesses. This is curation, not enforcement — a
harness that hardcodes an id can call anything on the proxy, and it bills.

**Enrichment is presentation-only.** The HTTP layer joins bundled-catalog
metadata (displayName, effort, modes…) onto resolved ids via the family-key
normalizer (strips region prefixes, `[1m]`, bedrock `-vN:M`, date suffixes);
plans/render consume plain ids. Un-joined ids render sparse — acceptable, and
the reason config.yaml and the catalog must stay generation-aligned.

**Visibility (F6):** absence of an override patch = visible, so **new models
appear by default on rollout**; hiding is an explicit per-user act
(`PUT /catalog/{harness}/override`, patch `update[id].hidden=true`), and hidden
is menu-level only — `availability` still governs launchability.

## 8. Convergence — how anything reaches a deployed fleet

(The [`catalog-convergence-v1.md`](./catalog-convergence-v1.md) design, landed.)
Principle inherited from self-hosting §4: **everything an operator runs is
downstream of the API version they control**; convergence applies on *any*
version difference, so reverting a catalog PR rolls fleets back.

| Artifact | Cloud fleet | Desktop fleet |
|---|---|---|
| auth state | materializer → sandbox file (edit/rotation/provision-triggered) | desktop courier hook (sync on health/sign-in/mutations) |
| catalog document | heartbeat advertises `catalogVersion` → worker fetches `GET /v1/catalogs/agents` (ETag) → `PUT` to runtime | desktop sync hook, same fetch+push, on start + the 60s poll tick with a version guard |
| harness CLIs (claude/codex/…) | catalog applied → reconcile poke → `VersionDrift` (`pinned != recorded`) → reinstall from catalog install specs (binary/archive/npm/git, SHA256-verified) into `~/.proliferate/anyharness/agents/<kind>/<role>/` | identical Rust path |
| anyharness/worker binaries | heartbeat `desiredVersions` → worker self-update (download, sha256, preflight, atomic swap, re-exec); supervisor-orchestrated session-preserving runtime swap = B10, separate lane | ride desktop app updates (worker `self_update_enabled=false`); bundled catalog/binary = first-boot fallback only |
| probe freshness | re-probe on auth push, catalog apply, agent reinstall, launch-if-stale, manual | same + desktop mirror-push publishes probe results to the cloud read-model (`runtime-mirror` snapshots) |

Version *visibility*: `AgentSummary` exposes installed vs pinned CLI versions +
active catalog version/source + probe freshness; the per-harness settings page
renders it read-only (post-restructure placement: between auth details and
All-Models). Convergence is automatic; the UI's job is trust, not control.

## 9. Gateway deployment + money + governance

**The proxy** ([`server/litellm/config.yaml`](../../server/litellm/config.yaml))
is the one authored artifact, dev/prod identical: real upstreams for Anthropic,
OpenAI, xAI, DeepSeek, Zhipu/GLM (#942), Bedrock (AWS credential chain — no
key). Same-provider aliasing only; mocks live in compose overlays, never here.
Keys come from container env; managed prod maps every
`AGENT_GATEWAY_MANAGED_<PROVIDER>_API_KEY` secret in `_deploy-litellm.yml` —
**adding an upstream = config entry + compose env + workflow secret mapping, all
three, or prod probes zero models from that family** (the F3 lesson). Adding a
model in an *existing* family = one config.yaml entry; it probes into every
unfiltered harness and defaults visible, no binary anywhere.

**Money:** `/spend/logs` → importer (cursor + overlap, unique request id) →
`remaining = Σ grants − Σ cost` → at zero: vkey disabled + `budget_status`
exhausted → Stripe top-up worker re-credits, reactivates, **rotates the vkey and
schedules re-materialization (F1)** so cloud sandboxes pick up the new key
within one materialization cycle. Free signup grant
`agent_gateway_free_credit_usd`. Every seam idempotent.

**Governance:** `org_agent_policy` flag-only allow-lists, violations computed
live; enforcement (scoped vkeys, hard blocks) is deliberately future work.

**Identity:** enrollment is eager at signup/org-join (after-commit hooks →
`ensure_team → ensure_user → mint_virtual_key` — single unscoped key —
`encrypt + mark synced`), backfill worker retries failures.
[`integrations/litellm/`](../../server/proliferate/integrations/litellm/) is the
only module that knows LiteLLM URLs.

## 10. End-to-end traces (the four that define the system)

1. **BYO key, cloud** — `PUT /selections/claude?surface=cloud` (one api_key
   source) → validator → diff → materializer decrypts vault key → sandbox
   state.json → launch: `set[ANTHROPIC_API_KEY]=…` on the spawned process.
2. **Gateway → money → recovery** — toggle on → vkey in state.json → recipe
   points the CLI at the proxy → metered → balance hits zero → vkey blocked →
   top-up → grant + **rotation + re-materialization** → next cloud launch on
   the new key with no user action.
3. **Model appears** — ops adds `glm-4-flash` to config.yaml (+ keys wired) →
   next probe returns it → unfiltered harnesses' plans include it → opencode's
   generated models map carries it → visible in pickers by default (no
   override) → sparse row until a catalog enrichment entry lands.
4. **CLI updates itself** — catalog PR bumps claude native to `2.1.190` →
   server serves new catalogVersion → heartbeat advertises → worker fetch+push
   (cloud) / desktop hook (local) → apply → reconcile: `pinned != recorded` →
   verified reinstall → re-probe → `AgentSummary` shows installed == pin. No
   binary release anywhere. Reverting the PR converges the fleet back down.

## 11. Self-hosting checklist 🏠

Config in [`config.py`](../../server/proliferate/config.py) (`agent_gateway_*`):

- `AGENT_GATEWAY_ENABLED=true`; LiteLLM proxy + own Postgres.
- `AGENT_GATEWAY_LITELLM_BASE_URL` (admin), **`_PUBLIC_BASE_URL`** (what
  sandboxes/harnesses dial — unset ⇒ gateway sources dropped, loudly),
  `_MASTER_KEY`.
- Provider keys on the proxy container for whichever upstream families you
  enable; leave a family's key unset and it simply never probes in.
- `CLOUD_SECRET_KEY` (Fernet).
- `docker compose --profile agent-gateway -f server/deploy/docker-compose.production.yml up -d`.
- Budgets/top-ups: `agent_gateway_default_user_budget_usd` / `_org_budget_usd`
  / `_free_credit_usd`; without `topups_enabled()`, exhausted subjects stay
  blocked (by design).
- Native/BYO-key only: leave the flag off; everything resolves native at
  launch, no proxy needed.
- Catalog + CLI convergence needs nothing extra: your API serves your release's
  catalog; your fleet converges to *your* version (D6).
- Packaging caveats until F8 closes: the compose LiteLLM image isn't published
  to GHCR (build locally / set `PROLIFERATE_LITELLM_IMAGE`) and has no Caddy
  route (compose-network only).

## 12. Invariants — the list that keeps this clean

1. **state.json is auth-only** (+ optional settings). Model data never rides it.
2. **Native = absence.** No native credential is ever stored or rendered.
3. **Content is authoritative; triggers must be complete.** Anything mutating
   rendered content (selections, vkey rotation/status, settings) schedules
   materialization; fingerprint-diff makes redundant triggers free.
4. **Forward tolerance by construction and by test.** Optional fields are the
   upgrade path; `deny_unknown_fields` is banned on wire structs; the
   unknown-key fixture is the tripwire.
5. **Fail closed at launch, never at write.** Bad state refuses the launch
   (`RouteAuth` error); pushes/probes/syncs are fire-and-forget with retry.
6. **Truth is probed, policy is authored, and they never merge.** The proxy's
   inventory can change without a catalog release; the catalog can change
   without touching the proxy. The maintenance invariant: keep them
   generation-aligned or rows render sparse (never broken).
7. **Convergence is bidirectional and automatic.** Apply on *different*, not
   newer. Reverting the PR is the rollback tool. Fleets are downstream of the
   API they point at.
8. **Visible by default, hidden by choice, launchable by availability.** Three
   independent layers; a rollout needs zero clicks to surface a new model.
9. **Secrets cross planes exactly once** — encrypted at rest, decrypted only
   into the delivered file (0600), carried into processes only as env.
10. **One validator, one renderer, one matcher.** Per-harness legality lives in
    `selection_rules.py`, the wire shape in `render_agent_auth_state`, provider
    mapping in `provider_for_model` — each with a single home.
