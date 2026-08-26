# Agent auth

Which credentials a harness launches with. The control plane stores the user's **selections** (per harness, per surface) and **vault** entries, renders them into one `state.json` document per surface, and delivers it to whichever machine runs the harness; at every session launch the runtime reads that one file and materializes exactly the selected sources — or refuses the launch with a typed error. This spec is the system's authority on `main`. It supersedes [FEATURE_DOCS/AGENT_AUTH.md](deep-dive.md) as the owner; that document stays as the detailed target reference (per-harness recipes, the settings surface, the long gaps ledger) until it is folded in.

The one-sentence contract: **at session launch, the runtime reads one local document, resolves the harness's selected sources, and materializes them; a selection that cannot be satisfied refuses the launch rather than silently running on different credentials.**

## 1. Purpose

Own the answer to "which auth source does this user use for this harness on this surface", the storage of user-provided provider credentials, the delivery of resolved key material to the runtime, and the per-harness glue that turns a source into the files and environment the harness's own auth mechanism expects. Resolution order on `main` is *selection → native*; the settled architecture extends it to *run override → subject selection → org default* (see [Known gaps](#known-gaps--follow-ups)).

## 2. Owned state

All tables live in [db/models/agent_gateway.py](../../../server/proliferate/db/models/agent_gateway.py) (the file also hosts model-gateway tables — ownership is per table, below).

| Table | Rows mean | Key constraints |
| --- | --- | --- |
| `agent_api_key` | one vault entry: `kind ∈ {api_key, aws_bedrock, azure_openai}`, title, ciphertext, redacted hint, status `active \| revoked` | typed kinds decrypt to a JSON provider config; bare `api_key` is one opaque secret |
| `agent_auth_selection` | one desired source for `(user, harness_kind, surface)`: `source_kind ∈ {gateway, api_key}`, optional `api_key_id`, `env_var_name`, `enabled` | scope UNIQUE; "at most one gateway per scope" index; an `api_key` row always references a vault entry; `env_var_name` presence follows the entry's kind (bare requires one, typed forbids one — enforced in the store write gate because a CHECK cannot join) |
| `agent_auth_delivery_ack` | the last acknowledged `(revision, fingerprint)` per `(user, surface)` | revision is ms-epoch `max(updated_at)` over the surface's selection rows; only moves forward |
| `agent_auth_harness_settings` | catalog-declared toggle values per `(user, harness_kind, surface)` — **not auth**, riding this surface as the delivery vehicle | one row per scope |
| `org_agent_policy` | per-org allow-lists: `allowed_routes_json` (`gateway`, `api_key`, `native`) and `allowed_harnesses_json` | `native` is a policy value only — never a selection row |

Closed vocabularies live in [constants/agent_gateway.py](../../../server/proliferate/constants/agent_gateway.py): harness kinds `claude, codex, opencode, grok, cursor`; gateway-capable `claude, codex, opencode, grok` (cursor has no gateway recipe); surfaces `local | cloud`; `state.json` version `2`.

Runtime-side state: `<runtime_home>/agent-auth/state.json` (mode 0600), written by the delivery path and read fresh at every launch; per-revision materialized config directories with conservative GC ([route_auth/materialize.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/materialize.rs)).

## 3. Public surface

### Control plane (`/v1/cloud/…`, product-user bearer auth)

Served by [agent_auth/api.py](../../../server/proliferate/server/agent_auth/api.py). The same module also hosts two model-gateway routes under `/agent-gateway` (`GET /capabilities`, `GET /enrollment`), which are that system's surface.

```http
GET    /v1/cloud/agent-auth/keys                          vault list
POST   /v1/cloud/agent-auth/keys                          create bare key
POST   /v1/cloud/agent-auth/keys/provider-config          create typed provider config
DELETE /v1/cloud/agent-auth/keys/{key_id}                 revoke (selections cascade)
GET    /v1/cloud/agent-auth/selections?surface=           selections + applied flag
PUT    /v1/cloud/agent-auth/selections/{harness}?surface= full desired state (+ settings rider)
GET    /v1/cloud/agent-auth/state?surface=                rendered state.json v2 + riders
POST   /v1/cloud/agent-auth/state/ack?surface=            desktop delivery ack
GET    /v1/cloud/organizations/{org}/agent-auth/policy    org policy (admin)
PUT    /v1/cloud/organizations/{org}/agent-auth/policy
GET    /v1/cloud/organizations/{org}/agent-auth/policy/violations
```

Python callers use the modules the [MANIFEST.toml](../../../server/proliferate/server/agent_auth/MANIFEST.toml) declares: `agent_auth.api`, `.service`, `.models`. Measured importers: `accounts`, `billing`, `cloud`, `cloud/materialization`, `organizations`, `main.py`.

### Runtime (`/v1`, runtime bearer auth)

[api/http/agent_auth.rs](../../../anyharness/crates/anyharness-lib/src/api/http/agent_auth.rs): `PUT /v1/agent-auth/state` (apply a document; revision-guarded) and `DELETE /v1/agent-auth/state` (clear). Both poke the launch-probe engine with `AuthApplied` so readiness re-observes.

### The wire document (`state.json` v2)

Pinned by [fixtures/contracts/agent-auth-state/](../../../fixtures/contracts/agent-auth-state): the Python renderer asserts it produces it, the Rust reader asserts it consumes it; a shape change is made by changing the fixture.

```text
{ version: 2, revision, user_id?,
  harnesses: [ { harness_kind, sources: [ source ], settings? } ] }
source = { kind: "gateway",         base_url, key }
       | { kind: "api_key",         env_var_name, value }
       | { kind: "provider_config", config_kind, env: {NAME: value} }
```

`GET /state` adds two response-only riders the desktop strips before pushing: `fingerprint` (the renderer's sha256 of the canonical document) and `harness_settings` (the surface's full settings map, so a native-auth harness's toggles still render).

### Generated clients

[cloud/sdk/src/client/agent-gateway.ts](../../../cloud/sdk/src/client/agent-gateway.ts) (`listAgentApiKeys`, `createAgentApiKey`, `revokeAgentApiKey`, `listAuthSelections`, `putAuthSelections`, `getAgentAuthState`, `ackAgentAuthState`, `getOrgAgentPolicy`, `updateOrgAgentPolicy`, `listOrgAgentPolicyViolations`) and the matching `cloud/sdk-react` hooks; [anyharness/sdk/src/client/agent-auth.ts](../../../anyharness/sdk/src/client/agent-auth.ts) for the runtime push.

## 4. Consumes

| Dependency | Owner | Used for |
| --- | --- | --- |
| harness auth vocabulary (slots, env names, login policy, `providerConfig` kinds) | agent distribution ([agent-distribution.md](../harnesses/distribution.md), [registry.json](../../../catalogs/agents/registry.json)) | declare-vs-apply: this system applies what the registry declares |
| the per-(subject, harness) gateway virtual key + budget status | model gateway ([MODELS.md](models.md) §Model gateway; code co-resident in `server/agent_auth/`) | rendered as an opaque `gateway` source; `budget.py`'s exhaustion predicate withholds key material at render |
| `log_cloud_event` | server event logging | audit events (§6) |
| encryption at rest | [db/store/agent_gateway/api_keys.py](../../../server/proliferate/db/store/agent_gateway/api_keys.py) over the secrets capability | vault ciphertext |
| `current_path_org_admin` | organizations / permissions | org policy routes |
| `PROLIFERATE_API_BASE_URL_ORIGIN` | desktop host ([sidecar.rs](../../../apps/desktop/src-tauri/src/sidecar.rs)) | the origin guard (§5) |
| after-commit re-materialization | today: `cloud/materialization/service.py` (`schedule_materialize_agent_auth`) | pushes a fresh document to cloud surfaces after selection/key/enrollment changes — see the hazard in Known gaps |

## 5. Laws

**Native is the absence of rows.** There is no `native` source kind; zero enabled rows for a harness means the harness runs on its own login, and the rendered document omits the harness entirely. Enforced by the constants (`AGENT_AUTH_SOURCE_KINDS` has two values) and the renderer.

**Present-but-empty fails closed.** A harness entry in the document whose sources cannot be satisfied is `AGENT_ROUTE_SELECTION_MISSING`, refused at session *create* (`409`, [service/create.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/service/create.rs)) and again at *launch* ([runtime/startup.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/runtime/startup.rs)). Without this a harness would silently run on whatever ambient credentials it found.

**One server validator decides legality.** [selection_rules.py](../../../server/proliferate/server/agent_auth/selection_rules.py) runs before every selection write: single-source harnesses (`claude`, `codex`, `grok`, `cursor`) allow at most one *enabled* source; `opencode` is additive; a `gateway` source needs a gateway-capable harness; `env_var_name` matches `^[A-Z][A-Z0-9_]{0,127}$`. The store's write gate owns cross-table shape (bare-requires-name / typed-forbids-name, key ownership, duplicates). The runtime deliberately has no cardinality check — the document cannot express a conflict the server would not have written.

**Selections are full desired state.** `PUT /selections/{harness}` replaces the scope's rows; there is no per-row patch. Every write bumps the scope revision, which is what the runtime's stale-revision guard compares.

**Rendering is pure and single-path.** `render_agent_auth_state` produces the document and its fingerprint from selection + vault + enrollment inputs; `GET /state` and the cloud materializer call the same function, so the two surfaces cannot disagree.

**Applied means acknowledged.** A selection reads `applied: true` only when the surface's delivery ack carries the current `(revision, fingerprint)`. The desktop acks after its runtime PUT succeeds, echoing the *served* fingerprint (never client-computed); an ack from the future (revision above the surface's current rendered revision) is `400` because accepting it would wedge the only-forward store against every later legitimate ack. Cloud acks are stamped server-side by the materialization worker.

**`state.json` is the only transport, read fresh per launch.** No watch/refresh; absent file = native; a malformed or version-less file is `AGENT_ROUTE_STATE_MALFORMED`; a push with a lower revision than persisted is `AGENT_ROUTE_STATE_STALE` ([route_auth/state.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/state.rs)).

**The origin guard.** The desktop runtime ignores a state file issued by a server other than the one it currently points at (`matches_server_origin` against `PROLIFERATE_API_BASE_URL_ORIGIN`), so switching backends never launches with another environment's keys ([route_auth/mod.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/mod.rs)).

**Removal wins over ambient.** Rendered removals are applied after every set layer and the inherited copies are stripped at spawn ([driver/process.rs](../../../anyharness/crates/anyharness-lib/src/live/sessions/driver/process.rs)); a selected route cannot be shadowed by a developer's shell.

**Green display needs evidence.** `Usable`/`Authenticated` render only when `evidence_ref` names a probe observation, a key-scoped gateway check, or an acknowledged applied route with a non-null age; bare file/keychain presence is unverified ([auth_state.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/auth_state.rs)).

**Org policy is enforced at write time.** `_enforce_org_selection_policy` rejects a selection outside the org's allowed routes/harnesses; existing violations are listable per org. Editing policy requires org admin.

**Settings are not auth.** Harness toggles ride the selection PUT and the state document, but the fail-closed law forbids a settings-only harness entry — which is why a native-auth harness's settings never reach the runtime today (gap below).

## 6. Emits

Structured audit events via `log_cloud_event` ([service.py](../../../server/proliferate/server/agent_auth/service.py)): `agent_api_key_created`, `agent_provider_config_created`, `agent_api_key_revoked`, `agent_auth_selections_put`, `agent_auth_delivery_acked`, `org_agent_policy_updated`.

Runtime: the `AuthApplied` probe poke after state PUT/DELETE; typed `RouteAuthError` codes on the API/contract surface (`AGENT_ROUTE_STATE_MALFORMED`, `AGENT_ROUTE_STATE_STALE`, `AGENT_ROUTE_SELECTION_MISSING`, `AGENT_ROUTE_SELECTION_INCOMPLETE`, `AGENT_ROUTE_UNSUPPORTED`, `AGENT_ROUTE_UNKNOWN_HARNESS`, `AGENT_ROUTE_MATERIALIZE_FAILED`); the route signal that upgrades readiness ([readiness/service.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/readiness/service.rs)).

## 7. Fences

| Not owned here | Owner | The line |
| --- | --- | --- |
| Enrollment, LiteLLM teams/users, virtual keys, access groups, budgets, top-ups, usage import, verification, free credits | model gateway ([MODELS.md](models.md) §Model gateway) | this system renders the minted key as an opaque value; which models the key can see is proxy-side. The code is co-resident in `server/agent_auth/` (see code map) |
| Registry auth vocabulary, readiness *projection* | agent distribution ([agent-distribution.md](../harnesses/distribution.md)) | declare vs apply |
| Native credential detection, interactive login terminals | runtime `agents/auth/` ([auth/mod.rs](../../../anyharness/crates/anyharness-lib/src/domains/agents/auth/mod.rs)) | native is the empty state of *this* system |
| Model/launch-option observation, session live config | [MODELS.md](models.md) | this system never filters models |
| The sandbox writer and after-commit scheduling | today `cloud/materialization` (dark; being deleted) | the renderer is this system's; the *transport into a sandbox* is the environments system's |
| User login, JWTs, org membership | product auth ([auth/README.md](../identity/accounts.md)) | a different auth |

## 8. Code map

Ordered the way a credential travels. Files marked `← model_gateway` are co-resident in this folder but owned by that spec (the three-domain split S1 deferred); they are listed so no file is unowned.

```text
server/proliferate/
├── constants/agent_gateway.py                  source kinds, surfaces, harness allow-lists, STATE_VERSION
├── db/models/agent_gateway.py                  agent_api_key · agent_auth_selection · agent_auth_delivery_ack
│                                               · agent_auth_harness_settings · org_agent_policy
│                                               (+ enrollment/usage/credit tables ← model_gateway)
├── db/store/agent_gateway/
│   ├── records.py · mappers.py                 typed records; DesiredAuthSource
│   ├── api_keys.py                             vault CRUD, encryption at rest, decrypt for render
│   ├── selections.py                           put (full desired state), _assert_keys_usable write gate,
│   │                                           scope revision touch, enabled reads
│   ├── delivery_acks.py                        only-forward ack stamp
│   ├── harness_settings.py                     settings rows
│   ├── policy.py                               org policy + member route listing
│   └── enrollments.py · enrollment_keys.py · credits.py · usage.py   ← model_gateway
└── server/agent_auth/
    ├── MANIFEST.toml
    ├── api.py                                  /agent-auth + org policy routers
    │                                           (hosts /agent-gateway capabilities+enrollment ← model_gateway)
    ├── models.py                               wire models incl. the state document + riders
    ├── selection_rules.py                      THE legality validator
    ├── service.py                              vault + selections + state + ack + org policy orchestration
    ├── harness_settings.py                     toggle validation + upsert (not auth)
    ├── budget.py                               launch-gating exhaustion predicate ← model_gateway (consumed at render)
    └── enrollment.py · free_credits.py · migration.py · signup_hook.py · topups.py
        · usage_import.py · verification.py · worker.py                 ← model_gateway

server/proliferate/server/cloud/materialization/materialize/agent_auth.py
                                                THE renderer: render_agent_auth_state, fingerprint,
                                                build_agent_auth_state — owned HERE, mislocated (gap)

fixtures/contracts/agent-auth-state/v2.json     the Python↔Rust wire pin

apps/
├── desktop/src-tauri/src/sidecar.rs            sets PROLIFERATE_API_BASE_URL_ORIGIN at spawn
└── packages/product-client/src/
    ├── hooks/agents/lifecycle/use-local-auth-state-sync.ts   desktop pull → stamp → push → ack loop
    ├── lib/domain/agents/local-auth-state.ts   push planning, origin stamping
    ├── lib/domain/settings/harness-auth-sources.ts · agent-auth-evidence.ts · provider-config-fields.ts
    ├── components/settings/panes/agents/harness/  HarnessPane, HarnessAuthSection, provider rows/badges
    ├── components/settings/panes/agents/api-keys/ ApiKeysPane
    └── components/settings/panes/agent-auth/   ApiKeyCreatorModal

cloud/sdk/src/client/agent-gateway.ts           generated CP client (+ sdk-react)
anyharness/sdk/src/client/agent-auth.ts         runtime push client

anyharness/crates/anyharness-lib/src/
├── api/http/agent_auth.rs                      PUT/DELETE /v1/agent-auth/state, AuthApplied poke
├── domains/agents/route_auth/
│   ├── state.rs                                wire contract, tolerant read, revision guard
│   ├── profile.rs                              sources[] → typed profile (pure)
│   ├── plan.rs · gateway_plan.rs · gateway_probe.rs   live gateway model plan seam
│   ├── render.rs                               per-harness recipes (pure env delta + file specs)
│   ├── materialize.rs                          atomic writes, revision dirs, GC
│   ├── probe_materialization.rs                scratch materialization for probes
│   └── mod.rs                                  pipeline, origin guard, RouteAuthError
├── domains/agents/auth_state.rs                the one evidence-based display derivation
├── domains/agents/readiness/service.rs         route-aware readiness upgrade
├── domains/sessions/service/create.rs          create-time fail-closed refusal
├── domains/sessions/runtime/startup.rs         launch integration, fail-closed refusal
└── live/sessions/driver/process.rs             env layering + ambient removal at spawn
```

## 9. Proof

- Server unit: [test_agent_gateway_domain.py](../../../server/tests/unit/test_agent_gateway_domain.py)
  (selection rules), `test_agent_auth_materialization.py`
  (renderer), [test_agent_auth_state_contract_fixture.py](../../../server/tests/unit/test_agent_auth_state_contract_fixture.py)
  (wire pin), [test_agent_auth_body_redaction.py](../../../server/tests/unit/test_agent_auth_body_redaction.py),
  [test_agent_auth_settings_rider.py](../../../server/tests/unit/test_agent_auth_settings_rider.py).
- Server integration: [test_agent_gateway_selections.py](../../../server/tests/integration/test_agent_gateway_selections.py),
  [test_agent_gateway_store.py](../../../server/tests/integration/test_agent_gateway_store.py),
  [test_agent_gateway_key_lifecycle.py](../../../server/tests/integration/test_agent_gateway_key_lifecycle.py),
  `test_agent_auth_delivery_ack.py`,
  `test_agent_auth_materialization.py`,
  [test_agent_gateway_policy_api.py](../../../server/tests/integration/test_agent_gateway_policy_api.py),
  [test_agent_gateway_policy_enforcement.py](../../../server/tests/integration/test_agent_gateway_policy_enforcement.py),
  [test_agent_gateway_api.py](../../../server/tests/integration/test_agent_gateway_api.py).
- Runtime: `route_auth/{render,gateway_plan,origin_guard,contract_fixture,cursor_render,opencode_render,provider_config_render}_tests.rs`,
  `probe_materialization_tests/`, `auth_state_tests.rs`.
- Client: vitest beside `harness-auth-sources`, `agent-auth-evidence`,
  `provider-config-fields`, `local-auth-state`, `use-local-auth-state-sync`,
  and the harness/api-keys panes.

## Failure modes

| Condition | Observed as | Recovery |
| --- | --- | --- |
| Illegal selection set | `400` from `selection_rules` / store gate | fix the desired set |
| Selection outside org policy | `403 policy_violation`; existing violations listed under `/policy/violations` | admin widens policy or user picks an allowed route |
| Ack revision above rendered revision | `400 invalid_agent_auth_delivery_ack` | re-fetch `/state`, re-push, re-ack |
| Document present, sources unsatisfiable | `409 AGENT_ROUTE_SELECTION_MISSING` at create/launch | fix the selection; native = remove the rows |
| Pushed document older than persisted | `AGENT_ROUTE_STATE_STALE` | push the current document |
| Desktop pointed at another server | state ignored (origin guard); harness runs native | sign in to the matching server |
| Subject's gateway credit exhausted | gateway source withheld at render → launch refuses | top-up / reactivation (model gateway) |

## Known gaps / follow-ups

Carried from AGENT_AUTH.md's ledger plus what the cull surfaced.

- [ ] **Renderer mislocated in a dying package — HAZARD.**
      `render_agent_auth_state` / `build_agent_auth_state` live in
      `server/cloud/materialization/materialize/agent_auth.py`, and
      `service.py`, `enrollment.py`, `topups.py` import
      `cloud.materialization.service.schedule_materialize_agent_auth`.
      The dark-cloud deletion (delivery-spec-delete-dark-cloud, part 2) must
      relocate the renderer into `server/agent_auth/` (e.g. `render.py`) and
      replace the three schedule calls with this system's own after-commit
      seam before `materialization/` goes. Bucket-4 with environments.
- [ ] **Three-domain module split.** Model-gateway code (enrollment,
      budgets, top-ups, usage import, verification, workers) is co-resident
      in `server/agent_auth/` and `db/store/agent_gateway/`; the S1 URL
      split landed, the code split did not. Wave-2 move.
- [ ] **Resolution order for headless subjects.** `run override → subject
      selection → org default` does not exist: selections are per user, org
      policy only *restricts*. Task-class runs ([runs.md](../automations/runs.md)) need org
      defaults and per-run gateway keys.

  > [!decision] PABLO DECIDES: org default = a new `org_agent_default`
  > table (one selection set per org per harness, admin-owned; recommended —
  > it is the headless subject's selection and keeps Law 6 mechanical), or
  > extend `org_agent_policy` with a default route. Per-run gateway keys
  > belong to model gateway either way.

- [ ] **No cloud auth-applied poke.** The cloud materializer writes the file
      and stamps the ack without poking an awake runtime's probe engine; a
      cloud observation lags until the next wake. Either the transport grows
      a poke or the lag is ruled acceptable.
- [ ] **`azure_openai` cells stay pending** for codex and claude until each
      clears its registry `pending` flag after a live run (or is dropped).
- [ ] **Native-auth harness settings never reach the runtime**: the
      fail-closed law forbids a settings-only entry. Needs a settings
      channel outside `harnesses` that old readers ignore, plus the runtime
      read; claude's `--chrome` flag is inert until the ACP sidecar forwards
      argv.
- [ ] **Typed-vault path is behind two gates**: the store's `kind ==
      'api_key'` filter + CHECK constraint, and the client's
      `getSupportedProviderConfigKinds()` returning `[]`. Both open together
      or neither.
- [ ] **Opencode's native detector discards the provider name** (one
      whole-file verdict instead of per-slot).
- [ ] **Stale cursor comment** in `model_snapshot/targets.rs`
      (`AUTO_PROBE_EXCLUDED_HARNESSES`): the exclusion is right (keychain
      prompt), the stated reason is wrong.
