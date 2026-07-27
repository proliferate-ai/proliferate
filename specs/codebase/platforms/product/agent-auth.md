# Agent Auth

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
[agent-distribution.md](agent-distribution.md): the registry declares a
harness's auth vocabulary (auth slots, env var names, login policy,
supported provider-config kinds), and readiness is computed from that
vocabulary. Agent auth owns what happens after a user picks a source:
storage, delivery, and application.

Fences with the neighboring platforms:

- Gateway enrollment, virtual keys, access groups, budgets, and usage
  import belong to the [model gateway](model-gateway.md). Agent auth
  consumes the minted per-(subject, harness) key as an opaque value.
- Which models a gateway key can see is enforced proxy-side by the key's
  access-group grant (model-gateway.md); agent auth never filters models.
- Probed model snapshots and picker data belong to the
  [model catalog](model-catalog.md).
- Readiness *projection* (the five-state ladder) belongs to
  [agent-distribution.md](agent-distribution.md); agent auth supplies the
  route signal that upgrades it at launch.

## The selection model

A selection answers "which source fills this harness's auth slot for this
user on this surface." It is stored per `(user, harness_kind, surface)`
where surface is `local` (desktop) or `cloud` (sandboxes) — the same user
can run the gateway in cloud sandboxes and their native login on desktop.

Three tables in
[db/models/cloud/agent_gateway.py](../../../../server/proliferate/db/models/cloud/agent_gateway.py):

| Table | One row is | Scope | Key fields |
| --- | --- | --- | --- |
| `agent_auth_selection` | one enabled auth source for one harness | `(user, harness_kind, surface)` | `source_kind`; for `api_key`: `api_key_id` (vault FK) + `env_var_name`; `enabled`; `provider_hint` (display-only) |
| `agent_api_key` | one vault entry (a bare key *or* a typed provider config — see [The vault](#the-vault)) | `user` | `kind`, `title`, `value_ciphertext` (Fernet, `cloud-secret-v1`), `redacted_hint`, `status ∈ {active, revoked}` |
| `agent_auth_harness_settings` | one harness's configuration toggles — **not auth**, see below | `(user, harness_kind, surface)` | `settings_json` (key → value per the catalog's declared settings) |

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
  ([constants/agent_gateway.py](../../../../server/proliferate/constants/agent_gateway.py)).
  Zero enabled rows for a scope means the harness runs on its own login.
  `native` exists as a string only in org-policy allow-lists.
- **Cardinality is a per-harness rule**, codified in
  [selection_rules.py](../../../../server/proliferate/server/cloud/agent_gateway/selection_rules.py):
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
- **Org policy gates writes, not launches.**
  `PUT …/selections/{harness}` runs every org the user belongs to
  through `_enforce_org_selection_policy`
  ([service.py](../../../../server/proliferate/server/cloud/agent_gateway/service.py))
  and rejects a violating write with 403 `policy_violation`. A policy
  tightened after the fact shows up in the admin violations report
  (`GET /policy/violations`), not as a launch failure.
- **Every selection write re-materializes.** The PUT handler ends by
  calling `schedule_materialize_agent_auth`
  ([service.py:250](../../../../server/proliferate/server/cloud/agent_gateway/service.py)),
  so the stored truth and the delivered document never drift for longer
  than one materialization pass.

### Not auth: harness settings

`agent_auth_harness_settings` stores per-harness *configuration* toggles,
not credentials — for example claude's "Use Claude Code with Chrome"
switch, whose catalog declaration maps it to the `--chrome` CLI flag. The
toggles a harness offers are declared in the agent catalog
(agent-distribution's declare side); this table stores only the user's
chosen values, and they ride `state.json`'s per-harness `settings` map as
a **passenger** because it is the one per-user, per-surface document
already delivered to every runtime. At launch,
[`resolve_settings_deltas`](../../../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/settings.rs)
joins the catalog's declarations with the persisted values and emits the
CLI-flag/env deltas — entirely outside the auth pipeline. Read
"agent_auth" in this table's name as naming the *delivery vehicle*, not
the content; nothing in it is a secret and nothing in it affects which
credentials a session runs on.

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
| `aws_bedrock` | a JSON document: region + credentials (static access key pair or a role to assume) | the harness's own Bedrock env set (for claude: `CLAUDE_CODE_USE_BEDROCK=1`, `AWS_REGION`, credential vars) |
| `azure_openai` | a JSON document: endpoint, deployment, key | the harness's own Azure env set |

All kinds share the same lifecycle: Fernet-encrypted at rest
(`cloud-secret-v1` key id), created and revoked through
[api_keys.py](../../../../server/proliferate/db/store/agent_gateway/api_keys.py),
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
([state.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/state.rs)):

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
  ([materialize/agent_auth.py](../../../../server/proliferate/server/cloud/materialization/materialize/agent_auth.py))
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
- **`revision` is monotonic and the write guard.** The runtime rejects a
  pushed document whose revision is lower than the persisted one and
  accepts equal revisions as content-authoritative (key rotation without
  a selection change)
  ([state.rs `apply_state_file`](../../../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/state.rs)).
- **`issuing_server_origin` is the server-switch guard.** The desktop
  stamps the document with the origin it fetched from; the runtime
  compares it against `PROLIFERATE_API_BASE_URL_ORIGIN` (set by the Tauri
  sidecar at spawn,
  [sidecar.rs](../../../../apps/desktop/src-tauri/src/sidecar.rs)) and
  treats a mismatched document as absent
  ([route_auth/mod.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/mod.rs)).
  A desktop repointed at a different control plane can never inject the
  abandoned server's gateway key.

### Cloud delivery

The materialization worker writes the file directly into the user's
sandbox
([materialize/agent_auth.py](../../../../server/proliferate/server/cloud/materialization/materialize/agent_auth.py)).

- **When it runs.** Unconditionally during sandbox bootstrap, as one of
  the standard materialization steps
  ([materialize/sandbox.py](../../../../server/proliferate/server/cloud/materialization/materialize/sandbox.py))
  — so a fresh sandbox has the document before its first session. After
  that, on every auth-relevant event: a selection write, an enrollment
  reaching `synced`, and a top-up reactivating an exhausted subject each
  call `schedule_materialize_agent_auth`.
- **How it runs.** Through the same asynchronous after-commit application
  used for every cloud-sandbox materialization event
  ([materialization/service.py](../../../../server/proliferate/server/cloud/materialization/service.py)):
  the handler registers the task on the open transaction via
  `run_after_commit`, and a spawned task runs only once the transaction
  commits — the materializer always reads committed truth, never a state
  mid-write. The task resolves the user's active personal sandbox and
  no-ops if none has booted yet (bootstrap will cover it).
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
([use-local-auth-state-sync.ts](../../../../apps/packages/product-client/src/hooks/agents/lifecycle/use-local-auth-state-sync.ts)).

- **When it runs.** On app start once signed in with a healthy runtime,
  and again whenever an auth mutation (selection PUT, vault
  create/revoke) invalidates the auth-state query. Sync requires only
  sign-in and a healthy local runtime — a self-hosted user with no cloud
  compute still gets gateway and BYOK routes locally.
- **The loop.** `GET /v1/cloud/agent-auth/state?surface=local` (the same
  renderer as the cloud materializer, scoped to the `local`-surface
  selections) → fingerprint-compare against the last pushed document →
  stamp `issuing_server_origin`
  ([local-auth-state.ts](../../../../apps/packages/product-client/src/lib/domain/agents/local-auth-state.ts))
  → `PUT /v1/agent-auth/state` into the local runtime, or
  `DELETE /v1/agent-auth/state` when the document is empty (back to
  native).
- **The runtime's guard.** The push lands through
  [api/http/agent_auth.rs](../../../../anyharness/crates/anyharness-lib/src/api/http/agent_auth.rs)
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
computation is deterministic from two local inputs (`state.json` and the
agent catalog), which is what makes a retry idempotent and the recipes
unit-testable as pure functions.

The pipeline ([route_auth/mod.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/mod.rs))
answers four questions in order:

1. **What did the user choose?** Load `state.json` (checking the
   server-origin guard) and fold the harness's `sources[]` into a typed
   profile: `Native` (no entry → touch nothing) or the list of resolved
   sources
   ([profile.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/profile.rs)).
   A source missing a required field is `SelectionIncomplete`; an unknown
   kind is `UnsupportedRoute`. Pure mapping, no filesystem.
2. **What models does the world mention?** Recipes embed model names
   (codex's `config.toml` pins a default model on the native route as well
   as the gateway one; opencode's provider block lists models). Those names
   come from the catalog's `session.defaults` and gateway policy through the
   `GatewayModelResolve` seam
   ([plan.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/plan.rs))
   — model names are catalog data, never Rust constants. The plan carries a
   separate native default (resolved from the non-gateway auth contexts in
   precedence order) so a native launch pins the model the user's own
   provider serves rather than the gateway's.
3. **What must the world contain?** Render every source, in order, into
   one composed delta: env vars to set, env vars to remove, files to
   write
   ([render.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/render.rs)).
   Sources compose additively (opencode's gateway + N api_keys merge into
   one delta). Still pure — the per-harness recipes below live here.
4. **Make it so.** Write the rendered files atomically at mode 0600 under
   `<runtime_home>/agent-auth/`
   ([materialize.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/materialize.rs)),
   then spawn with the composed env. Config dirs that embed credentials
   or models are revision-keyed (`codex-home-<revision>/`) so an
   in-flight session launched under revision N−1 keeps its files; GC
   retains the current and immediately previous revision only.

Any failure at any stage maps to `StartSessionError::RouteAuth`
([startup.rs](../../../../anyharness/crates/anyharness-lib/src/domains/sessions/runtime/startup.rs))
and the launch is refused — 409 for selection-shaped preconditions, 500
for a malformed or unwritable state
([sessions_errors.rs](../../../../anyharness/crates/anyharness-lib/src/api/http/sessions_errors.rs)).
There is no fallback to native on a failure: a user who selected the
gateway never silently runs on their personal login.

Environment layering law: the spawned process env is composed
workspace → session → route_auth (later wins), and route_auth's remove
list strips its keys from both the composed map and the truly inherited
ambient process env (`command.env_remove` at spawn,
[process.rs](../../../../anyharness/crates/anyharness-lib/src/live/sessions/driver/process.rs)).
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
| claude | nothing — the CLI finds its own login and config | `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` (the scoped key); optional `ANTHROPIC_SMALL_FAST_MODEL` from the catalog plan; isolated `CLAUDE_CONFIG_DIR` (stable dir, no file) | the named env var |
| codex | isolated `CODEX_HOME=codex-native/` (stable, not revision-keyed) holding TWO files: a `config.toml` pinning only the catalog's native default model (no provider table — the credential is the user's own), and a copy of the user's own `auth.json`, because codex resolves credentials at `$CODEX_HOME/auth.json` and relocating the home relocates that lookup | isolated `CODEX_HOME=codex-home-<rev>/` with generated `config.toml` (provider `proliferate`, `base_url`, `env_key = "PROLIFERATE_GATEWAY_KEY"`, `wire_api = "responses"`, catalog gateway default model); removes ambient `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` | the named env var only |
| opencode | nothing | isolated `XDG_CONFIG_HOME` + generated `opencode.json` adding only the `proliferate` provider (`apiKey: "{env:PROLIFERATE_GATEWAY_KEY}"`, catalog model list); **`XDG_DATA_HOME` deliberately left ambient** so natively-logged-in providers coexist | the named env var, additive beside gateway and native |
| grok | nothing | isolated `HOME=grok-home-<rev>/`, `GROK_MODELS_BASE_URL`, `XAI_API_KEY` (the scoped key) | the named env var |
| cursor | nothing | typed refusal (`UnsupportedRoute`) — no gateway route exists for cursor | the named env var (`CURSOR_API_KEY`, cursor's registry-declared slot) |

Three properties of the table itself, all load-bearing:

- **Native is a route with a recipe, not the absence of one.** Four harnesses
  render nothing natively, but codex needs an isolated `CODEX_HOME` even on the
  user's own login, because it reads its model from `config.toml` rather than
  from env and must not inherit whatever a developer left in `~/.codex`. Keeping
  that in this table — rather than in a second launch-env path — is what makes
  the native and routed homes distinct directories that cannot shadow or GC each
  other, and what keeps every codex `config.toml` in the system emitted by one
  function.
- **An isolated home must carry the credential it isolates away from.** Codex
  resolves credentials at `$CODEX_HOME/auth.json`, so setting `CODEX_HOME` moves
  the credential lookup along with the config — a config-only isolated home
  launches a natively-logged-in user *unauthenticated*, and nothing later repairs
  it (the login terminal adjusts only `PATH`, so `codex login` writes `~/.codex`
  and never the isolated home). The native recipe therefore delivers the user's
  own `auth.json` as its second file, read at apply time from the user's real
  codex home so the render stays pure. On macOS, codex's keychain entry is keyed
  on `sha256(canonical CODEX_HOME)` and so is unreachable from a relocated home;
  this is covered because the credential reader consults the keychain first and
  materializes its payload as `auth.json` bytes — the keychain login arrives as a
  file the relocated home can read. The one accepted residual: a token refresh
  the child performs lands in the isolated home rather than the user's keychain,
  which cannot diverge because every launch re-copies from the source.
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
([render.rs `sanitize_claude_ambient`](../../../../anyharness/crates/anyharness-lib/src/domains/agents/route_auth/render.rs)).
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
([auth/credentials.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/auth/credentials.rs)),
owned by agent-distribution's projection.

Native login works on both surfaces, through the same mechanism:
"Authenticate" starts the harness's own login command in a real PTY
([login_terminal.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/auth/login_terminal.rs))
streamed over WebSocket
([agent_login_terminals.rs](../../../../anyharness/crates/anyharness-lib/src/api/ws/agent_login_terminals.rs)).
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
[readiness/service.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/readiness/service.rs):
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

## API surface

`/v1/cloud/agent-auth/` owns the user-facing auth relationship
(handlers today in
[agent_gateway/api.py](../../../../server/proliferate/server/cloud/agent_gateway/api.py)):

- `GET/POST /keys`, `DELETE /keys/{id}` — the vault.
- `GET /selections`, `PUT /selections/{harness}?surface=` — the selection
  model (the PUT carries the full desired source list; the server diffs).
- `GET /state?surface=` — the rendered document, same renderer as the
  cloud materializer; the desktop's pull path.
- `GET/PUT /organizations/{org}/agent-auth/policy`,
  `GET …/policy/violations` — org allow-lists and the drift report.

Gateway enrollment/capabilities stay under `/v1/cloud/agent-gateway/`
(model-gateway.md), and per-harness model snapshot routes belong to the
model catalog. Renames are hard cutovers, no alias windows (all consumers
are first-party).

The runtime's own surface is two routes
([api/http/agent_auth.rs](../../../../anyharness/crates/anyharness-lib/src/api/http/agent_auth.rs),
[sdk client](../../../../anyharness/sdk/src/client/agent-auth.ts)):
`PUT /v1/agent-auth/state` (desktop push, revision-guarded) and
`DELETE /v1/agent-auth/state` (return to native).

## Code map

Where everything lives, in the order a credential travels:

```text
server/proliferate/
├── constants/agent_gateway.py                 source kinds, surfaces, harness allow-list
├── db/models/cloud/agent_gateway.py           the three tables + org policy, constraints
├── db/store/agent_gateway/                    row CRUD, encryption at rest
│   ├── selections.py
│   └── api_keys.py
└── server/cloud/
    ├── agent_gateway/
    │   ├── api.py                             /v1/cloud/agent-auth routes
    │   ├── service.py                         write orchestration, org-policy enforcement,
    │   │                                      re-materialize trigger
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
    │   ├── plan.rs                            catalog model-plan seam
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
([fixtures/contracts/agent-auth-state/](../../../../fixtures/contracts/agent-auth-state/)):
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

## Current gaps

Deltas between this document and `main`, each struck by its follow-up PR:

- [ ] **Typed provider configurations do not exist.** The vault has no
      `kind` column and stores exactly one opaque string per entry; no
      Bedrock/Azure payloads, no `provider_config` wire source, no
      registry declaration of supported provider-config kinds. (The old
      Bifrost `provider_kind` tables were dropped outright and are not a
      starting point.)
- [ ] **Route prefix.** Vault, selections, state, and org policy still
      live under `/v1/cloud/agent-gateway/`; the split to
      `/v1/cloud/agent-auth/` (with catalog routes to the model-catalog
      platform) is pending, including the matching
      `api.py`/`service.py`/`models.py` three-domain split.
- [ ] **Stale IA references.** The settings information-architecture doc
      still describes the removed Bifrost-era `agent-authentication`
      pane (the shipped UI redirects it to `agent-api-keys`); its Agents
      scope needs a truth pass (PR E).
- [ ] **Cursor's api_key route reports a false Ready.** The api_key source
      is persisted and rendered for cursor, and readiness reports `Ready`
      for it — the check is kind-agnostic
      ([readiness/service.rs](../../../../anyharness/crates/anyharness-lib/src/domains/agents/readiness/service.rs))
      and the catalog's `cursor-login` auth context's `anyOf` signal
      includes the `CURSOR_API_KEY` env var. But cursor-agent's ACP
      process ignores `CURSOR_API_KEY` and requires macOS Keychain auth
      ([catalog_probe.rs](../../../../anyharness/crates/anyharness/src/commands/catalog_probe.rs)),
      so a user who selects "API key" sees Ready, and the session fails at
      runtime. Resolution needs either an upstream cursor-agent change or
      dropping the api_key card for cursor (founder ruling).
