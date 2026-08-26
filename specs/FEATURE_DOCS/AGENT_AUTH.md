# Agent Auth

> Superseded as system authority by
> [specs/codebase/systems/product/agent_auth/README.md](../codebase/systems/product/agent_auth/README.md)
> (the `agent_auth` system spec, which describes `main` and carries this
> document's gaps ledger). This document is retained as the detailed target
> reference — per-harness recipes, the settings surface, delivery detail —
> until it is folded in; where the two disagree, the system spec wins.

Status: target. This document describes the accepted destination for the
agent-auth platform. The body is written in the ideal state. Every
difference from `main` today is listed in [Current gaps](#current-gaps);
the list shrinks as follow-up PRs land, and the label comes off when it is
empty.

## Purpose

Agent auth is how a harness gets working model credentials at launch. It
owns four things:

- the stored answer to "which auth source does this user use for this
  harness on this surface" (the selection model),
- the vault of user-provided provider credentials (bare API keys and
  typed provider configurations like Bedrock or Azure),
- the delivery of resolved key material to whichever machine runs the
  harness (`state.json`), and
- the per-harness application glue that turns a resolved source into the
  exact files and environment the harness's own auth mechanism expects.

The end state is one sentence: **at session launch, the runtime reads one
local document, resolves the harness's selected sources, and materializes
them; a selection that cannot be satisfied refuses the launch with a typed
error rather than silently running on different credentials.**

## Boundaries

This is the *apply* side of the declare-vs-apply split defined in
[agent-distribution.md](../codebase/platforms/product/agent-distribution.md): the registry declares a
harness's auth vocabulary (auth slots, env var names, login policy,
supported provider-config kinds), and readiness is computed from that
vocabulary. Agent auth owns what happens after a user picks a source:
storage, delivery, and application.

Fences with the neighboring platforms:

- Gateway enrollment, virtual keys, access groups, budgets, and usage
  import belong to the [model gateway](MODELS.md). Agent auth
  consumes the minted per-(subject, harness) key as an opaque value.
- Which models a gateway key can see is enforced proxy-side by the key's
  access-group grant (model-gateway.md); agent auth never filters models.
- Target-observed harness launch options and picker data belong to
  [Models and harness launch options](MODELS.md).
- Readiness *projection* (the five-state ladder) belongs to
  [agent-distribution.md](../codebase/platforms/product/agent-distribution.md); agent auth supplies the
  route signal that upgrades it at launch.

## The selection model

A selection answers "which source fills this harness's auth slot for this
user on this surface." It is stored per `(user, harness_kind, surface)`
where surface is `local` (desktop) or `cloud` (sandboxes) — the same user
can run the gateway in cloud sandboxes and their native login on desktop.

Three tables in
[db/models/agent_gateway.py](../../server/proliferate/db/models/agent_gateway.py):

| Table | One row is | Scope | Key fields |
| --- | --- | --- | --- |
| `agent_auth_selection` | one enabled auth source for one harness | `(user, harness_kind, surface)` | `source_kind`; for `api_key`: `api_key_id` (vault FK) + `env_var_name`; `enabled`; `provider_hint` (display-only) |
| `agent_api_key` | one vault entry (a bare key *or* a typed provider config — see [The vault](#the-vault)) | `user` | `kind`, `title`, `value_ciphertext` (Fernet, `cloud-secret-v1`), `redacted_hint`, `status ∈ {active, revoked}` |
| `agent_auth_harness_settings` | legacy storage for retired static harness settings — **not auth**, see below | `(user, harness_kind, surface)` | compatibility-only `settings_json`; no executable launch consumer |

What each `source_kind` means, enables, and becomes:

| `source_kind` | The user is saying | References | Rendered at launch as |
| --- | --- | --- | --- |
| `gateway` | "bill my Proliferate subject; use managed model access" | nothing — the key comes from the subject's enrollment (model-gateway.md) | that harness's scoped virtual key + the proxy's public base URL, in the harness's own mechanism (env or config file) |
| `api_key` referencing a vault entry of kind `api_key` | "use my own provider account through this one secret" | vault row + `env_var_name` naming where the secret goes | exactly the named env var with the decrypted value |
| `api_key` referencing a typed vault entry (`aws_bedrock`, `azure_openai`) | "use my own cloud provider account" | vault row only — no `env_var_name`; the shape comes from the vault entry's kind | the provider's full native env set (e.g. `CLAUDE_CODE_USE_BEDROCK=1` + `AWS_REGION` + credential vars) |
| *(no rows)* | "use the harness's own login" — native is the **absence of rows, not a row** | — | nothing injected; the harness sees its own credentials |

Selection laws:

- **Native is the absence of rows.** `source_kind` has exactly two stored
  values, `gateway` and `api_key`
  ([constants/agent_gateway.py](../../server/proliferate/constants/agent_gateway.py)).
  Zero enabled rows for a scope means the harness runs on its own login.
  `native` exists as a string only in org-policy allow-lists.
- **Cardinality is a per-harness rule**, codified in
  [selection_rules.py](../../server/proliferate/server/agent_auth/selection_rules.py):
  claude, codex, grok, and cursor are single-source (at most one enabled
  row per scope — a radio); cursor's single source can only be `api_key`,
  because no gateway route exists for it; opencode is multi-source (a
  gateway row plus any number of `api_key` rows compose additively). A DB
  partial unique index additionally guarantees at most one `gateway` row
  per scope.
- **Shape checks are structural.** A `gateway` row references no vault
  entry and names no env var (DB CHECK). An `api_key` row must reference
  a vault entry; it names an `env_var_name` when that entry is a bare
  key and must not when the entry is typed (the typed kind carries its
  own env mapping) — enforced in the store, since it spans tables.

### Registry is the allow-list authority (FR-4)

[registry.json](../../catalogs/agents/registry.json) is the single
declared authority for three allow-lists: the harness-kind set, the
gateway-capable set (a harness is gateway-capable exactly when its
`auth.slots[]` contains a slot with id `gateway`; cursor has none), and the
single-vs-multi cardinality (an explicit per-agent `authCardinality` field,
`single` or `multi`, because deriving multiplicity from slot count is fragile).
Every other plane mirrors those sets rather than re-deriving them:

- The Python constants (`AGENT_AUTH_HARNESS_KINDS`,
  `AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS`,
  `SINGLE_SOURCE_HARNESSES`, `MULTI_SOURCE_HARNESSES`) stay literals so
  `constants/` keeps no runtime registry read and the store to server import
  boundary is untouched, but a drift test
  ([test_agent_registry_mirror_drift.py](../../server/tests/unit/test_agent_registry_mirror_drift.py))
  fails CI the moment a literal and its registry derivation disagree. The
  LiteLLM access-group contract test is anchored to the same registry
  derivation, not just the Python constant.
- The Rust `AgentKind` enum stays a type, but
  [schema_tests.rs](../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/schema_tests.rs)
  asserts `AgentKind::all()` equals the registry kind set and that the
  registry gateway-slot derivation matches `render.rs`'s
  gateway/`UnsupportedRoute` split (cursor is the only non-gateway kind).
- The TypeScript client derives the same three sets from the bundled registry
  copy (`bundled-agent-registry.ts`) instead of re-literalling them. Catalog
  data may decorate those harness rows for presentation, but it declares no
  executable model, control, default, or launch delta.
- **Org policy gates writes, not launches.**
  `PUT …/selections/{harness}` runs every org the user belongs to
  through `_enforce_org_selection_policy`
  ([service.py](../../server/proliferate/server/agent_auth/service.py))
  and rejects a violating write with 403 `policy_violation`. A policy
  tightened after the fact shows up in the admin violations report
  (`GET /policy/violations`), not as a launch failure.
- **Every selection write re-materializes.** The PUT handler ends by
  calling `schedule_materialize_agent_auth`
  ([service.py:250](../../server/proliferate/server/agent_auth/service.py)),
  so the stored truth and the delivered document never drift for longer
  than one materialization pass.

### Not auth: retired harness launch settings

The former `agent_auth_harness_settings` passenger was configuration, never
credential state. Static launch flag/env deltas were removed with the
target-observed launch-option cutover: first-party launch behavior now sends
only an exact model and `controlValues` selected from the target observation.
No catalog-declared harness setting may change executable membership or the
auth route used by the override-free probe.

The passenger needs a vehicle: a harness only gets a `harnesses` entry
when it has an enabled selection ("Absent means native; present-but-empty
fails closed" forbids a settings-only entry), so a native-auth harness's
persisted settings never appear in the rendered document. The settings
pane therefore reads them from the `harness_settings` **response rider**
on `GET /state` — the surface's full persisted map, keyed by
harness_kind, carried next to `fingerprint` and stripped the same way by
the desktop before the runtime push
([local-auth-state.ts](../../apps/packages/product-client/src/lib/domain/agents/local-auth-state.ts)).
The runtime consequence stands: a native-auth harness's settings do not
reach `resolve_settings_deltas`, because the document that would carry
them is exactly the one a selection-less harness is absent from.

`provider_hint` on a selection row is likewise display-only ("this key is
my Anthropic key"); the renderer never puts it on the wire and nothing at
launch reads it.

## The vault

**One table holds every kind of user-provided credential.** A typed
provider configuration is not a separate table and not multiple rows: it
is one `agent_api_key` row whose `kind` says how to interpret the
encrypted payload.

| `kind` | The ciphertext decrypts to | Applied as |
| --- | --- | --- |
| `api_key` (default) | one opaque secret string | the single env var named by the referencing selection |
| `aws_bedrock` | a JSON document: `region` + `bearerToken` | the harness's own Bedrock env set (for claude: `CLAUDE_CODE_USE_BEDROCK=1`, `AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION`) |
| `azure_openai` | a JSON document: `endpoint` + `apiKey` | the harness's own Azure env set (claude's Foundry vars; opencode's `AZURE_API_KEY` + `AZURE_RESOURCE_NAME`) |

The typed kinds carry exactly the fields some harness's env set actually
consumes, and no more. Two consequences worth stating, because both were
once a third field:

- **Bedrock is `region` + `bearerToken`**, not a static access-key pair and
  not a role to assume; that is the shape every arm of
  `_translate_provider_config_env` reads
  ([agent_auth.py:395-411](../../server/proliferate/server/cloud/materialization/materialize/agent_auth.py)).
- **Azure has no `deployment` field.** The renderer deliberately does not
  translate one: for opencode a deployment selection folds into a
  `--model azure/<id>` launch argument, which is outside `state.json`'s
  env-plus-files wire contract
  ([agent_auth.py:434-446](../../server/proliferate/server/cloud/materialization/materialize/agent_auth.py)).
  A field the apply side cannot honor must not be collected, so the Azure
  entry affordance asks for endpoint and key only.

All kinds share the same lifecycle: Fernet-encrypted at rest
(`cloud-secret-v1` key id), created and revoked through
[api_keys.py](../../server/proliferate/db/store/agent_gateway/api_keys.py),
displayed only as a redacted hint (`sk-…abc4`). A vault entry is not
bound to a harness at storage time — binding happens when a selection row
references it. Decryption happens in exactly two places, both
server-side: state materialization and the authenticated `GET /state`
read.

Two rules keep typed kinds from sprawling:

- The registry (agent-distribution's declare side) names which
  provider-config kinds each harness supports; the settings UI offers
  only those, and a typed entry selected for a harness that does not
  declare its kind is rejected at write time like any other invalid
  selection.
- Application reuses the harness's *native* mechanism (the same env vars
  a user would set by hand), so a typed config is rendered by the same
  per-harness recipe table as every other source — no separate code path.

Note the deployment-side complement: the gateway itself already serves
Bedrock models using the deployment's own AWS role (model-gateway.md's
config). Typed vault configs are for users who bring *their own* cloud
account; the two never mix in one source.

## Delivery: `state.json`

Selections and vault rows live in the product database; harnesses launch
on other machines. One document carries resolved key material to the
runtime: `<runtime_home>/agent-auth/state.json`, mode 0600, version 2.

Wire contract
([state.rs](../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/state.rs)):

```json
{
  "version": 2,
  "revision": 1721820000000,
  "user_id": "…",
  "issuing_server_origin": "https://api.proliferate.com",
  "harnesses": [
    {"harness_kind": "claude",
     "sources": [{"kind": "gateway", "base_url": "https://llm…/v1", "key": "<claude's scoped key>"}],
     "settings": {"chrome": true}},
    {"harness_kind": "opencode",
     "sources": [{"kind": "gateway", "base_url": "…", "key": "<opencode's scoped key>"},
                  {"kind": "api_key", "env_var_name": "ANTHROPIC_API_KEY", "value": "<raw key>"}]}
  ]
}
```

Document laws:

- **Each gateway source carries that harness's own key** — the virtual
  key minted for (subject, harness), whose access-group grant is the
  harness's model set (model-gateway.md's account model). The wire shape
  is already per-harness; the renderer looks up the harness's key rather
  than fanning one subject-wide key out to every entry.
- **`api_key` sources carry plaintext.** The vault entry is decrypted at
  materialization
  ([materialize/agent_auth.py](../../server/proliferate/server/cloud/materialization/materialize/agent_auth.py))
  and written into the 0600 file; revoking a key removes the value at the
  next pass. A typed vault entry travels as its resolved env-var map
  (`{"kind": "provider_config", "config_kind": "aws_bedrock", "env": {…}}`)
  so the runtime never learns provider-config internals.
- **Absent means native; present-but-empty fails closed.** A harness with
  no entry in the document runs on its own login. A harness whose entry
  is present but whose selected sources could not be satisfied (unsynced
  enrollment, exhausted budget, revoked key) keeps its entry with the
  dead source omitted — and a launch that then resolves zero usable
  sources for a still-selected route is refused with a typed error. A
  selection never silently degrades to the user's personal credentials.
- **`revision` is a backstop, not the mechanism.** Correctness of delivery
  lives in serialized, latest-wins pushes and the acknowledgement below;
  change detection is the content fingerprint. The revision has exactly one
  job: the runtime rejects a *delayed, out-of-order* push whose revision is
  lower than the persisted one, and accepts equal revisions as
  content-authoritative (key rotation without a selection change)
  ([state.rs `apply_state_file`](../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/state.rs)).
- **`issuing_server_origin` is the server-switch guard.** The desktop
  stamps the document with the origin it fetched from; the runtime
  compares it against `PROLIFERATE_API_BASE_URL_ORIGIN` (set by the Tauri
  sidecar at spawn,
  [sidecar.rs](../../apps/desktop/src-tauri/src/sidecar.rs)) and
  treats a mismatched document as absent
  ([route_auth/mod.rs](../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/mod.rs)).
  A desktop repointed at a different control plane can never inject the
  abandoned server's gateway key.

### Applied means acknowledged

An auth change is not *real* until the target runtime has confirmed the
applied document, and the UI says so:

- **Pending → applied.** A selection write shows as *pending* on its surface
  until the runtime acknowledges the applied `state.json`. A failed delivery
  is a visible pending state — never a silently stale runtime. The
  acknowledgement is also a trigger for the target launch-options probe
  ([MODELS.md](MODELS.md)'s auth-applied event), so the picker
  refreshes itself the moment the new world is real.
- **A cloud switch ensures the sandbox.** A `cloud`-surface selection write
  ensures the user's sandbox (provision-or-wake — always possible, since
  cloud auth editing sits behind the provisioning onboarding), materializes
  the document into it, and completes on the runtime's ack. The old
  "no-op if the sandbox has not booted" branch remains only for the
  never-provisioned case, which bootstrap covers.
- **Latest wins.** Rapid switches coalesce: the delivery pushes the latest
  rendered document, never replaying intermediates (the desktop hook's
  serialized operation queue; the cloud scheduler's after-commit read of
  committed truth).
- **Enrollment sync pokes both surfaces.** An enrollment reaching `synced`
  re-materializes cloud *and* invalidates the local-surface state so the
  desktop re-pulls — a state pulled before sync completed (gateway source
  dropped as unsatisfiable) must not persist until the next unrelated
  mutation.
- **Running sessions are offered a restart.** Auth applies at launch only,
  so running sessions keep the old world — including billing the old route.
  After the ack, the surface shows a modal — *"Restart running sessions on
  old auth?"* with actions `"yes, restart now"` / `"no"` (founder-settled
  copy, lowercase verbatim; the copy module marks it do-not-reword) —
  scoped to running sessions of the switched harness on the switched
  surface. Restart is an in-place relaunch
  (transcript kept; the resume path re-runs route_auth and the readiness
  gate). Declining leaves the sessions to run out their lives on the old
  auth.

### Cloud delivery

The materialization worker writes the file directly into the user's
sandbox
([materialize/agent_auth.py](../../server/proliferate/server/cloud/materialization/materialize/agent_auth.py)).

- **When it runs.** Unconditionally during sandbox bootstrap, as one of
  the standard materialization steps
  ([materialize/sandbox.py](../../server/proliferate/server/cloud/materialization/materialize/sandbox.py))
  — so a fresh sandbox has the document before its first session. After
  that, on every auth-relevant event: a selection write (which ensures the
  sandbox, per the acknowledgement contract above), an enrollment
  reaching `synced`, and a top-up reactivating an exhausted subject each
  call `schedule_materialize_agent_auth`.
- **How it runs.** Through the same asynchronous after-commit application
  used for every cloud-sandbox materialization event
  ([materialization/service.py](../../server/proliferate/server/cloud/materialization/service.py)):
  the handler registers the task on the open transaction via
  `run_after_commit`, and a spawned task runs only once the transaction
  commits — the materializer always reads committed truth, never a state
  mid-write. The task resolves the user's active personal sandbox. For a
  plain poke (enrollment sync, background refresh) it no-ops if none has
  booted yet — bootstrap will cover it. The ensure-on-switch path is the
  exception: a cloud selection change schedules with ensure semantics, so
  a provisioned-but-unbooted or asleep sandbox is provisioned/woken to
  receive the new state (never awaited by the request), and only a
  never-provisioned user — who cannot have cloud selections yet — defers
  to bootstrap. An ensure with an empty rendered document does not boot a
  sandbox just to delete a file.
- **What it writes.** The renderer builds the full document from enabled
  selections, decrypted vault values, and the enrollment's key material,
  then compares a sha256 fingerprint against a sidecar manifest: an
  unchanged document is not rewritten, a changed one is written
  atomically at mode 0600, and a document with zero harness entries
  deletes the file (the runtime reads absence as all-native).
- **When it is read.** Never watched, never pushed into a running
  session: the runtime reads the file fresh at each session launch, so a
  change lands on the next session, never mid-session — the same
  freshness contract as the agent catalog.

### Desktop delivery

The desktop app is the transport: it pulls from the control plane and
pushes into its embedded runtime
([use-local-auth-state-sync.ts](../../apps/packages/product-client/src/hooks/agents/lifecycle/use-local-auth-state-sync.ts)).

- **When it runs.** On app start once signed in with a healthy runtime,
  and again whenever an auth mutation (selection PUT, vault
  create/revoke) or an enrollment reaching `synced` invalidates the
  auth-state query. Sync requires only sign-in and a healthy local
  runtime — a self-hosted user with no cloud compute still gets gateway
  and BYOK routes locally.
- **First-run adoption settles once.** Local auth adoption applies only to
  Desktop. Web records a normal not-applicable empty decision without enabling
  the adoption Cloud queries, refetching the local catalog, loading the planner,
  or writing a selection. Desktop waits for the startup reconciliation job to
  complete, reads one fresh post-reconcile agent catalog, and then adopts the
  gateway for harnesses without native logins. A terminal runtime, query,
  reconcile, catalog, or planner failure records an empty decision before a
  bounded diagnostic; it has no user-facing error or automatic retry in that
  app run. Settings remains the authoritative place to manage auth.
- **Onboarding shows a card, never a block.** Account creation never
  waits on LiteLLM (enrollment is fire-and-forget at signup). The desktop
  first-run flow — auto-install, the settled adoption decision above, then this
  sync loop — is what delivers the first `state.json`, and a home-screen
  onboarding card ("Setting up your agents…") awaits the runtime's ack with a
  short grace window (~20s) before auto-advancing, degrading to a visible
  pending badge and letting the user proceed. It never blocks. An empty
  adoption decision hides the card.
- **Under `agentAuthEvidencePanes` the card is state-bound, not timed.**
  With the same flag that drives the evidence panes ON, the timer card is
  replaced by per-agent badges bound to the REAL states each adopted agent
  moves through: install progress (the agents projection's `installState`),
  the `state.json` selection ack, and the derived `authState` (display,
  next action, probe lifecycle). The card completes when every adopted agent
  reaches a launchable or actionable terminal state (usable, authenticated,
  or installed with a next action), never on a timer. Every terminal badge
  the card shows carries a next-action affordance routing to the right pane
  (from `authState.nextAction`, with an "open agent settings" fallback so no
  state is a dead end), and a stuck probe shows its backoff and next-attempt
  countdown rather than an eternal spinner. With the flag OFF the timer card
  above is untouched.
  ([auth-setup-badges.ts](../../apps/packages/product-client/src/lib/domain/agents/auth-setup-badges.ts),
  [use-auth-setup-onboarding-evidence.ts](../../apps/packages/product-client/src/hooks/agents/lifecycle/use-auth-setup-onboarding-evidence.ts))
- **Acceptance (FR-1).** The flag-ON onboarding coherence (sign-in,
  auto-install or adopt, default auth source resolution, state ack, probe,
  picker populated, first session) is covered by the badge-derivation domain
  tests and the card component tests that assert each real state renders its
  badge and affordance and that completion requires terminal states rather
  than a timer. The end-to-end live pass on a fresh profile was not run in
  the rung-7 change; see that PR's description for the exact blocker and the
  static evidence delivered in its place.
- **The loop.** `GET /v1/cloud/agent-auth/state?surface=local` (the same
  renderer as the cloud materializer, scoped to the `local`-surface
  selections) → fingerprint-compare against the last pushed document →
  stamp `issuing_server_origin`
  ([local-auth-state.ts](../../apps/packages/product-client/src/lib/domain/agents/local-auth-state.ts))
  → `PUT /v1/agent-auth/state` into the local runtime, or
  `DELETE /v1/agent-auth/state` when the document is empty (back to
  native).
- **The runtime's guard.** The push lands through
  [api/http/agent_auth.rs](../../anyharness/crates/anyharness-lib/src/api/http/agent_auth.rs)
  into `apply_state_file`, which enforces the monotonic-revision rule and
  heals a previously malformed file.

There is no third path.

## Applying auth at launch

The mental model: **a launch builds the harness a world to run in.** Each
harness expects credentials in its own shape — an env var, a config file
in a specific home directory, a provider block in a JSON config. So at
every live-session start (create, resume, fork), the runtime computes
exactly what that world must look like for the selected sources — every
env var to set, every env var that must *not* leak in, every file — then
writes the files and spawns the process into that environment. The
computation is deterministic from applied `state.json`, the selected harness's
auth declaration, and—only for a route whose config must enumerate provider
models—a live gateway model-materialization plan. That plan never supplies an
executable default or picker membership; the subsequent override-free harness
probe is the authority. Keeping lookup outside render makes retries idempotent
and the recipes unit-testable as pure functions.

The pipeline ([route_auth/mod.rs](../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/mod.rs))
answers four questions in order:

1. **What did the user choose?** Load `state.json` (checking the
   server-origin guard) and fold the harness's `sources[]` into a typed
   profile: `Native` (no entry → touch nothing) or the list of resolved
   sources
   ([profile.rs](../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/profile.rs)).
   A source missing a required field is `SelectionIncomplete`; an unknown
   kind is `UnsupportedRoute`. Pure mapping, no filesystem.
2. **Does route configuration require a provider model list?** Most recipes
   select only credentials and a provider. OpenCode's gateway provider block
   must enumerate models before the process starts, so `GatewayModelResolve`
   ([plan.rs](../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/plan.rs))
   supplies the exact live gateway `/v1/models` result. An empty result fails
   typed; it never falls back to a seed. Codex route config selects a provider
   but does not author a model. This materialization input is not picker truth:
   only the harness observation produced after spawn becomes
   `HarnessLaunchOptions`.
3. **What must the world contain?** Render every source, in order, into
   one composed delta: env vars to set, env vars to remove, files to
   write
   ([render.rs](../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/render.rs)).
   Sources compose additively (opencode's gateway + N api_keys merge into
   one delta). Still pure — the per-harness recipes below live here.
4. **Make it so.** Write the rendered files atomically at mode 0600 under
   `<runtime_home>/agent-auth/`
   ([materialize.rs](../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/materialize.rs)),
   then spawn with the composed env. Config dirs that embed credentials
   or models are revision-keyed (`codex-home-<revision>/`) so an
   in-flight session launched under revision N−1 keeps its files; GC
   retains the current and immediately previous revision only.

Any failure at any stage maps to `StartSessionError::RouteAuth`
([startup.rs](../../anyharness/crates/anyharness-lib/src/domains/sessions/runtime/startup.rs))
and the launch is refused — 409 for selection-shaped preconditions, 500
for a malformed or unwritable state
([sessions_errors.rs](../../anyharness/crates/anyharness-lib/src/api/http/sessions_errors.rs)).
There is no fallback to native on a failure: a user who selected the
gateway never silently runs on their personal login.

Environment layering law: the spawned process env is composed
workspace → session → route_auth (later wins), and route_auth's remove
list strips its keys from both the composed map and the truly inherited
ambient process env (`command.env_remove` at spawn,
[process.rs](../../anyharness/crates/anyharness-lib/src/live/sessions/driver/process.rs)).
An ambient `ANTHROPIC_API_KEY` on the host can never shadow or leak into
a routed launch.

Route-auth is the **only writer of harness homes and config files** under
`agent-auth/`, and it runs no commands — application is exclusively
atomic file writes plus env composition, which is what makes a failed
launch side-effect-free and a retry idempotent.

### Per-harness recipes

The render dispatch is a per-harness table; this is where "every harness
has its own way of accepting auth" is paid for, in one place:

| Harness | Native route | Gateway route | `api_key` route |
| --- | --- | --- | --- |
| claude | nothing — the CLI finds its own login and config | `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` (the scoped key); isolated `CLAUDE_CONFIG_DIR` (stable dir, no executable default) | the named env var |
| codex | the user's native auth/config world; no product-authored model default | isolated `CODEX_HOME=codex-home-<rev>/` with generated provider-only `config.toml` (`proliferate`, `base_url`, `env_key = "PROLIFERATE_GATEWAY_KEY"`, `wire_api = "responses"`); no model pin; removes ambient `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` | the named env var only |
| opencode | nothing | isolated `XDG_CONFIG_HOME` + generated `opencode.json` adding only the `proliferate` provider (`apiKey: "{env:PROLIFERATE_GATEWAY_KEY}"`, exact live gateway model-materialization list); **`XDG_DATA_HOME` deliberately left ambient** so natively-logged-in providers coexist | the named env var, additive beside gateway and native |
| grok | nothing | isolated `HOME=grok-home-<rev>/`, `GROK_MODELS_BASE_URL`, `XAI_API_KEY` (the scoped key) | the named env var |
| cursor | nothing | typed refusal (`UnsupportedRoute`) — no gateway route exists for cursor | the named env var (`CURSOR_API_KEY`, cursor's registry-declared slot) |

Three properties of the table itself, all load-bearing:

- **A route recipe does not choose a model.** Native launches leave the user's
  native harness world intact. Routed Codex gets an isolated provider config,
  but no `model` entry; OpenCode receives the live gateway list only because its
  provider schema requires enumeration before spawn. The persisted
  `ResolvedLaunchIntent` remains the sole explicit selection passed to startup.
- **Isolation follows the selected auth route.** A routed home contains only the
  credential/provider material needed by that route. Native auth is not copied
  into a routed home, and a routed launch never falls back to the ambient native
  login.
- **Claude's ambient sanitization applies to every non-native route**, once over
  the fully composed delta rather than per recipe: the rerouting flags
  (`CLAUDE_CODE_USE_BEDROCK`/`_VERTEX`/`_FOUNDRY`, `AWS_BEARER_TOKEN_BEDROCK`)
  are always removed, and each Anthropic selector the route did *not* itself set
  is removed so an ambient value cannot shadow the chosen credential.

Typed provider configs are a third column in spirit but not in code: a
`provider_config` source renders its env map through the same generic
set-these-vars path as `api_key`, plus the harness's mode switch where
one exists (claude's `CLAUDE_CODE_USE_BEDROCK`).

Ambient sanitization (claude): every routed launch strips
`CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`,
`AWS_BEARER_TOKEN_BEDROCK`, and any ambient
`ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_BASE_URL` not set
by the route itself
([render.rs `sanitize_claude_ambient`](../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/render.rs)).
A host configured for Bedrock cannot silently reroute a gateway or BYOK
launch. Sanitization applies to every non-native route, not only the
gateway.

Adding a harness means: declare its auth vocabulary in the registry
(agent-distribution), add its row to the server cardinality rules, and
write its render recipe. Nothing else in the pipeline changes.

### Native credentials are read, never written

Harnesses' own logins (claude's `~/.claude/.credentials.json` and
keychain entry, codex's `~/.codex/auth.json`, opencode's
`~/.local/share/opencode/auth.json`, grok's `~/.grok/auth.json`, cursor's
keychain entry) belong to the harness. Route-auth never writes them; for
gateway launches it *isolates away from them* by pointing the harness at
a synthetic home so a routed session cannot accidentally pick up (or
bill) the user's personal login. Opencode is the designed exception:
its data dir stays ambient because coexistence is its model. Native
credential *detection* for readiness is a separate read-only path
([auth/credentials.rs](../../anyharness/crates/anyharness-lib/src/domains/agents/auth/credentials.rs)),
owned by agent-distribution's projection.

Native login works on both surfaces, through the same mechanism:
"Authenticate" starts the harness's own login command in a real PTY
([login_terminal.rs](../../anyharness/crates/anyharness-lib/src/domains/agents/auth/login_terminal.rs))
streamed over WebSocket
([agent_login_terminals.rs](../../anyharness/crates/anyharness-lib/src/api/ws/agent_login_terminals.rs)).
The terminal is a PTY inside whichever process runs AnyHarness, so on
desktop the login runs against the local runtime and in the cloud it runs
inside the sandbox — the resulting credentials land in the sandbox's own
harness home, exactly as they would on a laptop.

### Readiness interplay

Readiness projection (agent-distribution.md) is computed from installed
artifacts plus locally-detected credentials, which alone would read
`CredentialsRequired` for a routed harness even though launch will inject
valid keys. Every projection therefore absorbs the enrolled route through
**one** seam, `apply_launch_route_upgrade` in
[readiness/service.rs](../../anyharness/crates/anyharness-lib/src/domains/agents/readiness/service.rs):
it asks route-auth one yes/no question —
`launch_route_provides_credentials`, the same state load and origin
guard as launch — and upgrades `CredentialsRequired`/`LoginRequired` to
`Ready`. The predicate is deliberately tolerant (a malformed state reads
`false`, never an error) because hard fail-closed belongs to the launch
path alone; and the upgrade can never clear `InstallRequired` or
`Unsupported`, because a route cannot conjure a binary.

Both the settings read (`resolve_agent`, behind `GET /v1/agents`) and the
launch path (`resolve_launch_agent`) go through that one seam — that shared
layer *is* the mechanism behind agent-distribution.md's law that the two
surfaces resolve readiness the same way. They differ only in which
environment counts: the launch path reads the workspace's composed env, the
settings read the host's. `resolve_agent_unrouted` remains for the callers
that genuinely mean "is the vendor CLI installed and logged in on this
machine": the login flow (an enrolled route must never suppress a native
login), the installed-only reconcile pass, and the catalog probe.

Because route-upgraded readiness and native readiness collapse to the same
`credentialState` on the wire, the projection also carries the provenance:
`AgentSummary.credentialsFromRoute` is true exactly when the route is why
the harness reads ready. Clients that mean native auth — first-run
native-auth adoption, CLI login chrome — must exclude that case; the flag is
absent on runtimes predating it, and those are the runtimes whose read
surface was native-only, so absent correctly means "not from a route".

Opencode's registry policy is `provider_managed`: the harness resolves
PROVIDER auth itself at prompt time, so readiness does not gate on any ONE
required slot the way `any_required_slot`/`all_required_slots` harnesses do.
It is not credential-less, though — `aggregate_credential_state` (A9) reads
every slot's actual ladder state and is `Ready` the moment any one resolves,
same shape as `any_required_slot` but without requiring
`required_for_readiness` on the slot. That is what makes the selection set
opencode's real auth truth everywhere: a selection enrolls a route, the route
clears the credential gap through the same `apply_launch_route_upgrade` seam
every other harness uses, and read surfaces (settings' active-methods list,
composer launch options) derive opencode's method state from the same
selections.

### The canonical evidence model

Readiness above is the ladder a UI renders today. Underneath it, the runtime
also computes ONE canonical per-harness agent-auth state as a struct of
orthogonal facts plus one shared derivation
([auth_state.rs](../../anyharness/crates/anyharness-lib/src/domains/agents/auth_state.rs)).
This is current runtime behavior for the derivation and its wire projection. It
runs ALONGSIDE `credentialState`/`readiness`/`cliAuthState` and changes none of
them, and the settings panes still render the legacy ladder until the UI rung
adopts it. Its reason to exist is one invariant the legacy ladder cannot state:
a harness reads green ONLY on dated evidence that the credential works, never on
bare file or keychain presence.

The facts are surface-agnostic and each answers one orthogonal question:

- **installed**: the harness's artifacts resolved as present (the
  `resolve_agent_unrouted` artifact question).
- **credential**: which source fills the slot (gateway virtual key, `api_key`
  BYOK, or native login) and the STRONGEST evidence held for it. That evidence
  is a probe observation, a tier-1 trial (a cheap key-scoped gateway check, the
  placeholder strength wired in the probe-tiers rung), an acknowledged applied
  route, or bare presence marked UNVERIFIED. Bare presence is the one that must
  never go green.
- **selection**: the `state.json` route for this scope, carrying whether the
  target runtime acknowledged it (monotonic revision) and whether it is
  satisfiable.
- **probe**: the lifecycle `{Idle, Queued, Running, Backoff}` with the
  last-success age, last-failure detail, and `next_attempt_at`, sourced from the
  target's launch-options observation state ([MODELS.md](MODELS.md)).
- **gateway**: a health slot filled by the gateway-verification rung, modeled
  now as an `Option` so the derivation's `Unavailable` arm exists.
- **handoff**: the browser-login handoff state
  `{initiated, awaiting-browser, completed, cancelled, timed-out}`, an `Option`
  whose adapters arrive later.

`derive_agent_auth_state(facts)` folds those into a `DerivedState` carrying a
`display`, a single `next_action`, and (when the display is green or an
acknowledged `selected`) an `evidence_ref` and its `evidence_age`. The display
vocabulary is a fixed precedence, first match wins, two structural pre-ladder
terminals first:

1. **NotInstalled**: artifact absent; next is install.
2. **Unsupported**: the render layer refuses the route (for example cursor
   gateway); next is none.
3. **Misconfigured**: a control-plane delta or probe config mismatch; next is
   fix config.
4. **Expired**: a payload expiry passed or a tier-1 auth check failed; next is
   log in or paste a key.
5. **Unavailable**: a gateway-sourced slot whose gateway is unreachable or out
   of budget; next is top up, retry, or wait.
6. **Probing**: a probe is `Running` or `Queued`; next is wait.
7. **Usable**: a fresh non-empty probe observation; next is none, launchable.
8. **Authenticated**: a tier-1 trial is green with no full probe yet; next is
   wait for the probe.
9. **Selected**: an acknowledged, satisfiable route with no trial or probe yet;
   next is wait.
10. **Installed**: installed with no chosen source and no verified credential;
    next is log in, paste a key, or choose a source.

The invariant, enforced by a fact-permutation sweep in the module's tests: a
display in `{Authenticated, Usable}` is reachable ONLY when `evidence_ref` names
a probe observation, a key-scoped gateway check, or an acknowledged applied
route, each with a non-null `evidence_age`. Bare file or keychain presence never
yields green, so a locally-detected credential lands at `Installed` or
`Selected` rather than a launchable terminal until a probe or trial confirms it.

The derived state and the facts it derived from serialize additively onto the
agents projection at `GET /v1/agents` as `AgentSummary.authState`, beside the
untouched `credentialState`, `readiness`, and `credentialsFromRoute` fields
([agents.rs](../../anyharness/crates/anyharness-contract/src/v1/agents.rs)).
The rung-2 fact adapter fills only what the readiness projection already carries.
The probe, gateway, and handoff slots stay at their empty defaults until the
rungs that own those inputs wire them, so no path through the current adapter can
yield a green display.

## The settings surface

Everything above is the machinery. This section is the surface a user
actually touches: **one pane per harness, reached from settings, whose job
is to make "what credentials will my next session run on" legible in one
screen** — and to make changing that answer a two-click operation rather
than a configuration exercise.

The implementation anchor is the Conductor reference capture at
`reference/conductor/` (a local, untracked capture set): its setting-row
rhythm (label left, state and affordance right, hairline between rows) is
what this pane is built out of. Two shape rules follow from it and hold
everywhere below:

- **Flat sections, no cards.** The pane is a vertical stack of titled
  sections separated by rules. Nothing in it is a card, a tile, or a
  bordered box — a card implies a self-contained object, and these sections
  are facets of one harness.
- **Existing components only.** Rows, inputs, modals, and status pills come
  from the shared UI package; the pane introduces no new atom. Where this
  document says "styled exactly like Conductor's", it means the existing
  setting-row component, not a visual reimplementation.

### Pane anatomy

Seven sections, in this order. The order is the ruling: it walks from
identity to auth to options to models, so the pane reads top to bottom as
"which harness → how it authenticates → whether that worked → what else it
can do → what it can run".

**§1 — Title and docs.** Harness display name, one-line description, and a
link to the harness's own documentation (`docsUrl`, already declared per
harness in the registry). Rationale: the first thing a user needs from a
vendor-tool pane is confirmation of which vendor tool it is, and an exit to
that vendor's own docs.

**§2 — Auth method.** The choice between `gateway`, `api_key`, and
`native`, rendered Conductor-style but **not inside a card**. Radio
semantics: picking one deselects the others, because for the four
single-source harnesses the selection model is literally a radio
([selection_rules.py](../../server/proliferate/server/agent_auth/selection_rules.py)'s
`SINGLE_SOURCE_HARNESSES`). Rationale: the stored model is one enabled
source, so the control that writes it must be one-of-N and not a set of
independent switches.

For **opencode this section is not a gate.** Opencode is
`MULTI_SOURCE_HARNESSES`
([selection_rules.py](../../server/proliferate/server/agent_auth/selection_rules.py)):
gateway, any number of API keys, and its own native login all compose
additively, so there is no "method" to pick before anything else becomes
usable. Nothing below §2 is disabled or hidden pending a choice there.
Rationale: a blocker UI would be a lie about a harness whose whole model is
coexistence.

**§3 — Authenticated status.** *Every* method — gateway, API key, native —
shows an authenticated-status row with a refresh affordance, styled exactly
like Conductor's status row. Rationale: "am I authenticated" is one
question with one answer shape; a per-method status treatment makes the
user learn three.

The native status row is additionally **clickable**, and opens the choice
between refreshing the status and running a login terminal session. The
login-terminal flow already exists and is surface-agnostic
([HarnessAuthCliDetails.tsx:110-136](../../apps/packages/product-client/src/components/settings/panes/agents/harness/HarnessAuthCliDetails.tsx),
over [login_terminal.rs](../../anyharness/crates/anyharness-lib/src/domains/agents/auth/login_terminal.rs));
this ruling only moves its entry point onto the status row it explains.
Rationale: the row that reports "not logged in" is the row a user clicks to
fix it.

Saved state and live state **coexist** in this section rather than
overwriting each other: "API key set" is a fact about the vault and the
selection; "authenticated" is a fact about the last observation. A saved
key whose provider rejects it must read as *saved but failing*, never as
either alone.

**§4 — API keys.** **One spot per key.** Instead of a generic "add
credential" affordance followed by a type picker, the section lists named
entry affordances — "Set OpenAI API key", "Configure Bedrock", "Configure
Azure" — each of which opens a **pre-typed, paste-first input**: the kind is
already decided by which affordance was clicked, so the modal asks only for
the value(s). Rationale: asking a user to classify a secret they just
pasted is asking them to do the registry's job; the affordance they clicked
already said which kind it is.

The section **always displays which kind is set**, not just that something
is. Field sets per kind, straight from the vault contract above:

| Affordance | Vault `kind` | Fields collected |
| --- | --- | --- |
| "Set &lt;provider&gt; API key" | `api_key` | the secret only (env var name comes from the registry slot) |
| "Configure Bedrock" | `aws_bedrock` | `region`, `bearerToken` |
| "Configure Azure" | `azure_openai` | `endpoint`, `apiKey` |

The Azure modal has **no `deployment` field** — see [The
vault](#the-vault)'s Azure note: the renderer deliberately does not
translate one, so collecting it would store a value nothing applies.

Keys are **disabled, not deleted, while in use.** Revocation of a key wired
into an enabled selection is refused server-side with the referencing
harnesses named
([service.py:232-240](../../server/proliferate/server/agent_auth/service.py)'s
`agent_api_key_referenced`), so the UI renders that state up front as an
"in use by N harnesses" chip and offers disable rather than a delete button
that 409s. Rationale: surface the refusal as a state, not as an error the
user discovers by hitting it.

**§5 — OpenCode "Add provider".** Opencode's pane gets one additional
affordance: a modal that is a **near-literal copy of Conductor's** provider
picker.

- **The full list is searchable.** All ~149 vendored providers
  ([provider-registry.generated.json](../../apps/packages/product-client/src/config/provider-registry.generated.json),
  vendored from `https://models.dev/api.json` by
  [scripts/vendor-provider-registry.mjs](../../scripts/vendor-provider-registry.mjs)).
  Rationale: opencode can talk to any of them, so the picker must not
  curate the user's provider choice down to a shortlist.
- **Rows without valid env vars are filtered out**, as the vendoring script
  and today's modal already do — there is nothing to prefill for a provider
  that declares no env var.
- **A featured subset is expanded; the rest collapses.** The popular
  providers (openai, anthropic, gemini, and peers) plus every provider the
  user has already configured show by default; the remainder sits behind
  "Show more providers" / "Show fewer providers". Rationale: 149 rows is a
  search box's job, not a scroll's, and already-configured providers are
  the ones a returning user came for.
- **Provider logos** render per row, from the models.dev logo set
  (`https://models.dev/logos/<id>.svg`), vendored alongside the registry.
  See [open verification items](#open-verification-items) — the logo set's
  license is unresolved and gates the vendoring, not the design.

Selecting a provider and pasting a key does exactly two writes: a vault
`api_key` entry, and one opencode selection row whose `env_var_name` is the
provider's first registry-declared env var and whose `provider_hint` is the
provider id. The hint stays display-only, per [Not
auth](#not-auth-retired-harness-launch-settings) — it is how the row later renders with
that provider's name and logo, and nothing at launch reads it.

The **expanded-row interaction is an assumption, not an observation**: this
document specifies an inline paste field appearing in the selected row. The
Conductor capture did not include that state, so it is marked as an
assumption to be resolved against the reference before implementation.

**§6 — No static launch-options section.** The former catalog-declared
harness toggles and `agent_auth_harness_settings` rider are compatibility
storage only. Executable models and controls render from target
`HarnessLaunchOptions` before create and from `SessionLiveConfigSnapshot`
after handshake; the auth pane does not author a parallel launch setting.

**§7 — Model list.** The probed model list
([MODELS.md](MODELS.md)), auto-collapsed by default, with a
probe status indicator on the left built from the **same status-row
component as §3's auth status** and a refresh affordance on the right.
Rationale: "when was this last checked, and can I check again" is the same
question for credentials and for models, so it gets the same control; and
the list itself is reference material, not the reason a user opened the
pane, so it starts closed.

For opencode specifically, **the pane's job is auth-status clarity plus the
provider listing** — ideally distinguishing opencode's own Zen service from
a subscription plan in the wording (see the Zen note below) — and *not*
displaying gateway models as its primary content. Rationale: an opencode
user's question is "which of my providers are live", and a flat gateway
model list answers a different question at the expense of that one.

Wording: opencode's own hosted service is **Zen**, and the pane says Zen
where it means Zen (the registry's `opencode-zen` slot, discovery kind
`opencode-auth-json/opencode`). It is not "OpenCode auth" and not a
subscription plan.

### Model attribution

Model rows in listings and popovers carry an origin icon. The rule is
**selection-derived, not name-derived**, and it differs by cardinality:

| Harness kind | Attribution source | Rendered as |
| --- | --- | --- |
| single-source (claude, codex, grok, cursor) | the enabled selection itself | bedrock-typed entry → AWS logo on every row; azure-typed → Microsoft logo; `gateway` → Proliferate logo; native (no rows) → no icon |
| opencode | the observation's verbatim `provider` field | that provider's logo, per row |

Rationale: for a single-source harness every model in the list is served by
the one selected source, so the selection *is* the attribution and no
per-row inference is needed or correct. Opencode's list is genuinely mixed,
and its observation already carries `provider` verbatim
([MODELS.md](MODELS.md)'s field contract) — so the honest
attribution is the one the harness itself reported.

The icon table is explicit, with a neutral fallback for any provider
without a mapped logo. And the hard rule: **attribution never gates
anything.** An unknown provider, a missing logo, or an unmapped icon
renders neutrally and changes nothing about whether the model is
selectable, launchable, or visible.

### Probing during a degraded apply

An apply can land while gateway enrollment sync is still incomplete: the
renderer drops the unsatisfiable gateway source
([agent_auth.py:261-271](../../server/proliferate/server/cloud/materialization/materialize/agent_auth.py)),
possibly leaving `sources: []` for that harness, which the launch path
treats fail-closed. The ruling for the probe in that window:

- **The probe still runs.** It observes whatever world actually exists and
  records it honestly.
- **Its results are shown, with a co-located pending badge** reading
  *gateway setup in progress* next to the model list and the §3 status row.
- **The existing freshness trigger repairs it.** Enrollment reaching
  `synced` re-materializes and re-pulls (see [Applied means
  acknowledged](#applied-means-acknowledged)), and the resulting apply ack
  fires a fresh probe.

Rationale: never lie about what was observed, and do not invent a special
no-probe state for a window that lasts seconds. A pending badge next to
real data beats an empty pane next to no explanation.

### Evidence panes (rung 6, flag-gated)

The panes above render the runtime's DERIVED `authState` rather than
re-deriving status in the client, behind the build-time flag
`agentAuthEvidencePanes` (env `VITE_AGENT_AUTH_EVIDENCE_PANES`, default off).
With the flag off the legacy locally-derived badge is untouched. With it on:

- **The status badge is the derivation, verbatim.** The badge reads
  `authState.display` for its label and tone and shows green ONLY for
  `usable`/`authenticated`, each carrying its evidence age ("verified 2m
  ago"). There is no local fallback and no readiness-based green, so the
  false greens the legacy badge produced (opencode's unconditional success,
  the `readiness === "ready"` fallback, enrollment `synced`) cannot occur.
- **The pane leads with the next action.** `authState.nextAction` names the
  one thing to do next (install, log in or paste a key, choose a source, top
  up or retry, fix config, wait). The probe lifecycle renders inline: a
  spinner while running or queued, and a backoff line with the
  `next_attempt_at` countdown and last-failure detail. The login handoff
  states (`initiated`, `awaiting-browser`, `completed`, `cancelled`,
  `timed-out`) render from `facts.handoff` when present, with an in-flight
  indicator and a retry affordance on the terminal failures. Handoff is
  wired to render from the typed field ahead of the runtime adapters that
  emit it, so nothing shows until those land.

**Observed membership is read-only.** The pane renders the target's exact
`HarnessLaunchOptions` model list. It may label, order, group, or search rows,
but no preference or server override may hide a model from executable
membership. There is no model-visibility write path, and legacy
`agent_catalog_override` storage is not a launch-option reader or writer.

### Open verification items

Cells this document specifies but does not yet claim as verified. Each is a
card the UI marks *pending* until its run passes — a pending declaration is
never offered as a working option.

- **claude × `azure_openai` (Foundry) is offerable in the registry but its
  render arm is self-admittedly unverified**
  ([agent_auth.py:418-433](../../server/proliferate/server/cloud/materialization/materialize/agent_auth.py)
  carries the unverified-judgment-call comment: the resource-name
  derivation and the API-key-vs-auth-token choice are both analogies to
  opencode's proven arm, not tested facts). **Ruling: verify before
  offering.** The live run is pending quota approval, so the cell stays an
  open verification item and the Azure card for claude renders pending.
- **The models.dev logo set's license is unchecked.** §5's per-row logos
  depend on vendoring `models.dev/logos/<id>.svg`; the license review is an
  open item that gates the vendoring step, not the picker's design.
- **§5's expanded-row inline paste field is an assumption**, not a captured
  Conductor state.
- **Desktop pull invalidation** is a dependency, not a new mechanism: §3's
  status and §7's list are only as fresh as the auth-state query's
  invalidation, which the [desktop delivery](#desktop-delivery) loop owns.

## API surface

`/v1/cloud/agent-auth/` owns the user-facing auth relationship
(handlers today in
[agent_gateway/api.py](../../server/proliferate/server/agent_auth/api.py)):

- `GET/POST /keys`, `DELETE /keys/{id}` — the vault.
- `GET /selections`, `PUT /selections/{harness}?surface=` — the selection
  model (the PUT carries the full desired source list; the server diffs).
- `GET /state?surface=` — the rendered document, same renderer as the
  cloud materializer; the desktop's pull path.
- `GET/PUT /organizations/{org}/agent-auth/policy`,
  `GET …/policy/violations` — org allow-lists and the drift report.

Gateway enrollment/capabilities stay under `/v1/cloud/agent-gateway/`
(model-gateway.md). Target-local launch options are read from
`GET /v1/agents/{kind}/launch-options`; cloud copies are addressed by cloud
sandbox plus harness. Exact observed identifiers cross those routes unchanged.

The runtime's own surface is two routes
([api/http/agent_auth.rs](../../anyharness/crates/anyharness-lib/src/api/http/agent_auth.rs),
[sdk client](../../anyharness/sdk/src/client/agent-auth.ts)):
`PUT /v1/agent-auth/state` (desktop push, revision-guarded) and
`DELETE /v1/agent-auth/state` (return to native).

## Code map

Where everything lives, in the order a credential travels:

```text
server/proliferate/
├── constants/agent_gateway.py                 source kinds, surfaces, harness allow-list
├── db/models/agent_gateway.py           the three tables + org policy, constraints
├── db/store/agent_gateway/                    row CRUD, encryption at rest
│   ├── selections.py
│   └── api_keys.py
└── server/cloud/
    ├── agent_gateway/
    │   ├── api.py                             /v1/cloud/agent-auth routes
    │   ├── service.py                         write orchestration, org-policy enforcement,
    │   │                                      re-materialize trigger
    │   ├── harness_settings.py                settings toggle validation + upsert (not auth)
    │   └── selection_rules.py                 per-harness cardinality
    └── materialization/
        ├── service.py                         after-commit task scheduling
        └── materialize/agent_auth.py          THE renderer (cloud + GET /state) and
                                               sandbox writer

apps/
├── packages/product-client/src/
│   ├── hooks/agents/lifecycle/use-local-auth-state-sync.ts   desktop pull→stamp→push loop
│   └── lib/domain/agents/local-auth-state.ts                 push planning, origin stamping
└── desktop/src-tauri/src/sidecar.rs           sets PROLIFERATE_API_BASE_URL_ORIGIN at spawn

anyharness/
├── sdk/src/client/agent-auth.ts               runtime state-push client
└── crates/anyharness-lib/src/
    ├── api/http/agent_auth.rs                 PUT/DELETE /v1/agent-auth/state
    ├── domains/agents/route_auth/
    │   ├── state.rs                           wire contract, revision guard
    │   ├── profile.rs                         sources[] → typed profile (pure)
    │   ├── plan.rs                            live gateway materialization-plan seam
    │   ├── render.rs                          per-harness recipes (pure)
    │   ├── materialize.rs                     atomic writes, revision dirs, GC
    │   └── mod.rs                             pipeline, origin guard, typed errors
    ├── domains/agents/readiness/service.rs    route-aware readiness upgrade
    ├── domains/sessions/service/create.rs     create-time fail-closed refusal (409)
    ├── domains/sessions/runtime/startup.rs    launch integration, fail-closed refusal
    └── live/sessions/driver/process.rs        env layering + ambient removal at spawn
```

The wire shape crossing the Python↔Rust boundary is pinned by the
`agent-auth-state` contract fixture
([fixtures/contracts/agent-auth-state/](../../fixtures/contracts/agent-auth-state/)):
the renderer asserts it produces it, `route_auth/` asserts it consumes it, and a
shape change is made by changing the fixture — which breaks whichever side lags.

| Layer | Owns |
| --- | --- |
| server storage + API | tables, constraints, cardinality, org policy, re-materialize triggers |
| the renderer | one code path serving the cloud materializer and `GET /state` |
| delivery | cloud: after-commit sandbox writes; desktop: pull→stamp→push |
| runtime `route_auth/` | state contract, profile resolve, recipes, materialize, origin guard |
| launch integration | fail-closed refusal, env layering, readiness upgrade |

## Failure modes

- Selected route unsatisfiable at launch (unsynced enrollment, exhausted
  budget, revoked key): typed 409 at session start naming the selection
  problem; never a silent native run.
- Malformed `state.json`: 500 `AGENT_ROUTE_STATE_MALFORMED`; the file is
  healed by the next push/materialization.
- Stale desktop push (lower revision): rejected
  `AGENT_ROUTE_STATE_STALE`; the desktop refetches and re-pushes.
- Server switch on desktop: origin mismatch reads as native until the new
  server's document lands — stale keys are unusable, not errors.
- Org policy violation: 403 at selection write time; existing violating
  selections surface in the admin report, and re-materialization on the
  next write scrubs them from delivered documents.
- Gateway not deployed (`gateway_enabled` false): the gateway option is
  not offered and nothing fails at launch.

## Proof

Named, binary assertions; a corridor of work is done when its assertions are
green. IDs are stable — tests reference them by name.

Auth (the full system):

- **A1** Zero enabled rows → no `state.json` entry → launch renders the
  empty delta; the harness sees only its own login. (contract fixtures +
  render tests)
- **A2** Every unsatisfiable selected source — unsynced enrollment, revoked
  key, exhausted credit, unfunded org — refuses launch with the typed 409;
  no input silently degrades a selection to native. (runtime startup tests +
  renderer pytest)
- **A3** Every non-native route strips ambient rerouting flags and unset
  Anthropic selectors; env vars the route itself set (including
  provider-config mode flags) always survive. (`render_tests.rs`)
- **A4** Opencode composes gateway + N api_keys + ambient native into one
  delta; `XDG_DATA_HOME` stays ambient. (`opencode_render_tests.rs`)
- **A5** Typed-config end to end (write gate open, registry-driven): typed
  vault row → selection with no env var → `provider_config` wire source →
  spawn env contains the harness's real env set; revoking the entry drops
  the source at the next pass; an undeclared or registry-`pending`
  (harness, kind) combo refuses the write. (server pytest + render tests +
  one intent test)
- **A6** The store rejects both illegal shapes: a bare-key selection
  without an env var, and a typed-entry selection with one. (server pytest)
- **A7** A gateway launch cannot read native credentials (isolated homes),
  and codex's native recipe delivers the copied `auth.json` so a relocated
  home stays authenticated. (render + native_render tests)

Delivery, acknowledgement, restart:

- **C1** A switch renders *pending* until the runtime ack and *applied*
  after; a failed push stays visibly pending — no path shows applied
  without an ack. (frontend hook tests + intent test)
- **C2** A cloud switch against an asleep sandbox ensures → materializes →
  acks; the never-provisioned case falls to bootstrap. (server integration
  test)
- **C3** Rapid switches deliver latest-wins; no intermediate document is
  observable after a later one. (desktop hook tests + server pytest)
- **C4** A delayed lower-revision push is rejected
  `AGENT_ROUTE_STATE_STALE`; an equal-revision content change applies.
  (`state.rs` tests)
- **C5** A state pulled before enrollment sync lacks the key; sync
  completion re-renders both surfaces with no unrelated mutation needed.
  (server pytest + hook test)
- **C6** After the ack, the restart modal lists exactly the running
  sessions of the switched harness on the switched surface; restart
  relaunches in place on the new auth with the transcript kept; declining
  leaves the old auth running. (runtime resume test + frontend test)
- **C7** A fresh signup on a healthy stack reaches an applied `state.json`
  and a first observation within the onboarding grace window; with LiteLLM
  down, signup still succeeds and onboarding proceeds with a pending
  badge. (release scenario)
- **C8** A server-switched desktop's stale document reads as absent.
  (`origin_guard_tests.rs`)

## Current gaps

Deltas between this document and the integration stack
(`agents/integration-rc1`), each struck by its follow-up PR:

- [ ] **The cloud surface has no auth-applied probe poke.** The desktop
      runtime's state PUT/DELETE fires the `AuthApplied` probe event, but
      the cloud materializer writes `state.json` directly into the sandbox
      and stamps the ack server-side, without poking an awake sandbox
      runtime's probe engine — so a cloud observation lags an applied auth
      change until the next wake/startup pass. Either the materialization
      op grows a poke of the runtime's refresh seam, or this bounded lag
      gets ruled acceptable (founder decision pending).
- [ ] **The `azure_openai` cells for codex AND claude are declared but
      pending.** The typed-config write gate itself is open (see below), and
      it is registry-driven: `_assert_keys_usable` admits a typed-entry
      reference exactly when the harness's registry `providerConfig`
      declaration for that kind is non-`pending`
      (`supported_provider_config_kinds`, threaded from the service layer).
      Two declared cells stay `pending` and therefore closed:
      codex×`azure_openai` (D3-rust built the `config.toml`
      `model_providers` injection, but the cell is live-unverified — nobody
      has exercised codex against real Azure OpenAI, and the registry only
      declares `AZURE_OPENAI_API_KEY` today) and claude×`azure_openai`
      (Foundry — the renderer's endpoint→`ANTHROPIC_FOUNDRY_RESOURCE`
      derivation and API_KEY/AUTH_TOKEN alternative are unverified judgment
      calls, R5/R11). Each opens by clearing its registry `pending` flag
      after its Gate 4 live run (or is dropped, pending a founder ruling).
      Per R5, the azure vault entry collects `endpoint` + `apiKey` only —
      `deployment` was dropped from the UI field spec and the server's
      create validation because the renderer deliberately never translated
      it.
- [ ] **A native-auth harness's settings never reach the runtime.** The
      `harness_settings` response rider makes the settings pane read and
      hold persisted toggle values for a selection-less harness (PRO-129),
      but the delivered `state.json` still cannot carry them: the
      fail-closed law forbids a settings-only `harnesses` entry, and every
      deployed runtime reads present-but-empty `sources` as a refused
      launch, so the launch-time `resolve_settings_deltas` join sees no
      settings for a native-auth harness. Closing this needs a
      wire-contract change the old-runtime fleet can survive (for example
      a settings channel outside `harnesses`, ignored by old readers),
      plus the matching runtime read. Separately, claude's `--chrome`
      mapping lands on the agent-process sidecar's argv, and the pinned
      `@proliferate/claude-agent-acp` does not forward unrecognized argv
      to the wrapped CLI — the flag is inert until the sidecar forwards
      it (its own repo + a catalog pin bump).
- [ ] **Module split.** The route prefix split landed (S1): vault,
      selections, state, and org policy now live under `/v1/cloud/agent-auth/`,
      and enrollment/capabilities stayed at `/v1/cloud/agent-gateway/`
      (model-gateway.md). The matching `api.py`/`service.py`/`models.py`
      three-domain code split (one module set per platform, not one shared
      `agent_gateway` package) is still pending — S1 was URL-string-only by
      design, so the account/auth/policy code still lives in the single
      `agent_gateway` package regardless of which prefix its routes answer.
- [x] ~~**Cursor's api_key route reports a false Ready.**~~ **Struck as
      stale.** This gap asserted that "cursor-agent's ACP process ignores
      `CURSOR_API_KEY` and requires macOS Keychain auth", making cursor's
      `Ready` a lie. That is **refuted**: a live test on 2026-07-26 drove
      `initialize` → `session/new` → prompt → `end_turn` with a valid
      `CURSOR_API_KEY`, an isolated `HOME`, and
      `AGENT_CLI_CREDENTIAL_STORE=file`. The false comment and its dead
      `cursor-api` bail arm were deleted and the arm now injects a supplied
      key in commit `4ccbfc41a`
      ([catalog_probe.rs](../../anyharness/crates/anyharness/src/commands/catalog_probe.rs)).
      Cursor's `api_key` route is real, its `Ready` is honest, and no
      founder ruling about dropping the card is owed. What remains correct
      and unchanged: cursor is **manual-refresh-only** for probing, because
      its native credential lives in the macOS keychain and an unattended
      spawn can raise an OS keychain prompt with no user-visible cause
      ([MODELS.md](MODELS.md)'s probe engine; enforced in
      `targets.rs`'s `AUTO_PROBE_EXCLUDED_HARNESSES`).
- [ ] **The same stale claim is restated in two other places.** The docs
      copy in [agent-distribution.md](../codebase/platforms/product/agent-distribution.md)'s cursor
      carve-out is corrected in this pass. The code comment in
      `anyharness/crates/anyharness-lib/src/domains/agents/model_snapshot/targets.rs`
      (the `AUTO_PROBE_EXCLUDED_HARNESSES` doc comment) still says
      cursor-agent "ignores `CURSOR_API_KEY`" as its *reason* for the
      exclusion; the exclusion is right and stays, but its justification
      should be rewritten to the keychain-prompt reason alone. Code
      follow-up, not part of this docs pass.
- [ ] **Opencode's native detector throws away the provider key.**
      `detect_opencode_local_auth`
      ([auth/credentials.rs:288-341](../../anyharness/crates/anyharness-lib/src/domains/agents/auth/credentials.rs))
      iterates `~/.local/share/opencode/auth.json` as
      `for (_provider, value)` — it discards the provider name and returns
      one whole-file `Present`/`Expired`/`Absent` verdict, so the pane
      cannot say *which* provider a user is natively logged into. The fix
      is to preserve the key and match it against each slot's declared
      `discoveryKinds` (`opencode-auth-json/anthropic`,
      `.../openai`, `.../google`, `.../gemini`, `.../opencode`), producing
      a per-slot verdict. **This introduces no new wire concept**: per-slot
      results already flow to clients through the existing `auth_slots`
      field on the readiness projection
      ([readiness/service.rs:118-147](../../anyharness/crates/anyharness-lib/src/domains/agents/readiness/service.rs)),
      so this is a detector change plus the pane reading a field that is
      already there. It is the precondition for §3's per-provider status
      rows and for the Zen-vs-provider distinction.
- [ ] **The typed-vault path is unreachable behind two gates, not one.**
      The server gate is documented in the typed-selections gap above
      (`_assert_keys_usable`'s `kind == 'api_key'` filter,
      [selections.py:63-92](../../server/proliferate/db/store/agent_gateway/selections.py),
      plus the `ck_agent_auth_selection_api_key_shape` CHECK constraint
      that a migration must loosen). The **client** gate is separate and
      equally blocking: `getSupportedProviderConfigKinds()` is hardcoded to
      return `[]` for every harness
      ([provider-config-fields.ts:121-125](../../apps/packages/product-client/src/lib/domain/settings/provider-config-fields.ts)),
      so §4's "Configure Bedrock"/"Configure Azure" affordances render for
      nobody. The stub's own comment is now stale — it defers to a registry
      `providerConfig` declaration that has since landed
      ([registry.json](../../catalogs/agents/registry.json) declares
      `aws_bedrock` and `azure_openai` for claude, codex, and opencode,
      with codex×azure marked `pending`), so the replacement is a read of
      the harness's registry entry minus pending kinds. Both gates must
      open together: either alone leaves the path dead.
