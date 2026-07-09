# Agents

`anyharness-lib/src/domains/agents/**` owns supported-agent metadata, installation,
credential detection, readiness, and the final resolved launch surface handed to
the live ACP runtime.

## Core Concepts

The agents area answers:

- which agent kinds does AnyHarness support?
- how is each agent installed or discovered?
- how do we detect credentials?
- when is an agent ready vs blocked?
- what executable surface should ACP launch?

This area is about availability and launchability, not live session execution.

## Core Models

### `AgentDescriptor` (`anyharness/crates/anyharness-lib/src/domains/agents/model.rs`)

`AgentDescriptor` is the full static metadata definition for one supported
agent.

It includes:

- `kind`
- optional native CLI install spec
- required ACP-facing agent-process install spec
- launch template
- auth and credential-discovery config
- docs URL

The built-in descriptors live in
`anyharness/crates/anyharness-lib/src/domains/agents/registry/mod.rs`;
`registry/service.rs` provides `descriptor(kind)`, the sanctioned single-kind
lookup.

### Artifact Specs (`anyharness/crates/anyharness-lib/src/domains/agents/model.rs`)

There are two distinct artifact roles:

- `NativeCli`
  - the vendor CLI, when the agent family has one
- `AgentProcess`
  - the ACP-facing executable AnyHarness actually supervises

Install specs cover several cases:

- managed binary download
- managed tarball release
- managed npm package
- ACP-registry-backed install
- PATH-only discovery
- manual-install-only guidance

### Credential and Readiness Models (`anyharness/crates/anyharness-lib/src/domains/agents/model.rs`)

Credential detection produces `CredentialState`:

- `Ready`
- `ReadyViaLocalAuth`
- `MissingEnv`
- `LoginRequired`

Overall runtime readiness is summarized as `ResolvedAgentStatus`:

- `Ready`
- `InstallRequired`
- `CredentialsRequired`
- `LoginRequired`
- `Unsupported`
- `Error`

### `ResolvedArtifact` and `ResolvedAgent` (`anyharness/crates/anyharness-lib/src/domains/agents/model.rs`)

`ResolvedArtifact` is the machine-local state for one artifact:

- installed or not
- managed vs PATH source
- resolved path
- optional version
- user-facing message

`ResolvedAgent` combines:

- the descriptor
- resolved native artifact
- resolved agent-process artifact
- credential state
- overall readiness

This is the main handoff from the agents area into the rest of the runtime.

## Main Flow

### Bundled Catalog and Registry

There are two supported AnyHarness runtime agent inputs:

- `catalogs/agents/catalog.json` (the lockfile)
  - supported agent families
  - resolved, sha-pinned install `source` per harness role
  - model/control metadata + static session-display metadata
- `catalogs/agents/registry.json`
  - supported agent families
  - install method/launch metadata (probe-time discovery config)
  - auth-slot and materialization metadata
  - credential-discovery metadata

Runtime code projects those bundled inputs into target-local surfaces:

- `anyharness/crates/anyharness-lib/src/domains/agents/registry/mod.rs`
  - trusted built-in `AgentDescriptor` values
- `anyharness/crates/anyharness-lib/src/domains/agents/catalog/**`
  - schema, validation, bundled loading, and model/control projections
- `anyharness/crates/anyharness-lib/src/domains/agents/registry/**`
  - schema, validation, bundled loading, and descriptor/auth-slot projections

There is no separate runtime `catalog.rs` source and no split model/launch
catalog path. Cloud product catalogs may be newer than these bundled runtime
inputs; AnyHarness still validates creation against what the target runtime can
actually launch.

The two inputs converge on **different tracks**. The `catalog.json` *document*
syncs **live**: the cloud worker watches the heartbeat `catalogVersion`, fetches
the newer document, and `PUT`s it to the runtime, which validates and reconciles
without a binary change. `registry.json` (install/launch/auth recipes) rides the
**binary only** — it is `include_str!`'d, so a new registry ships iff a new
runtime binary ships. In cloud sandboxes the binary itself can now be swapped in
place (worker-owned; see `specs/tbd/anyharness-self-update-v1.md`); desktop gets
a new binary only via the app bundle.

### Resolution Flow

Resolution is owned by
`anyharness/crates/anyharness-lib/src/domains/agents/readiness/**`.
`service.rs` is the side-effect-free entrypoint; artifact probing,
compatibility checks, override parsing, managed artifact paths, and status
calculation live in focused readiness modules beside it.

The flow is:

1. start with an `AgentDescriptor`
2. resolve the native artifact if one exists
3. resolve the ACP-facing agent-process artifact
4. detect compatibility issues
5. detect credentials
6. compute overall readiness
7. return a `ResolvedAgent`

Resolution does not install anything. It only reports the current machine-local
state.

### Credential Detection Flow

Credential detection is layered:

1. env vars win first
2. provider-specific local auth discovery runs next
3. if neither succeeds:
   - return `LoginRequired` when a native login flow exists
   - otherwise return `MissingEnv`

Provider-specific local discovery currently checks known local config/auth files
for Claude, Codex, Gemini, OpenCode, and Cursor.

OpenCode is intentionally treated as provider-managed for readiness. AnyHarness
may detect `~/.local/share/opencode/auth.json` as a positive signal, but it does
not require AnyHarness-owned `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` env vars for
OpenCode. OpenCode owns its provider universe, config files, AWS credential
chain support, public/free model behavior, and live ACP-reported model list.

Code path:

- `anyharness/crates/anyharness-lib/src/domains/agents/auth/credentials.rs`
- Claude/Codex local file parsing and portable export normalization are shared
  with desktop cloud sync via `anyharness/crates/anyharness-credential-discovery/`

Local readiness and cloud portability intentionally remain separate questions:

- readiness answers whether a provider appears usable on this machine
- portable export answers whether local auth can be serialized into the cloud
  credential file/env contract

### Installation Flow

Managed installation is owned by
`anyharness/crates/anyharness-lib/src/domains/agents/installer/service.rs`,
with focused sibling modules under `domains/agents/installer/`.

The flow is:

1. inspect the descriptor’s install specs
2. install the native CLI if the spec supports managed install
3. install the ACP-facing agent process if the spec supports managed install
4. return installed artifact results
5. resolve the agent again so the API returns fresh readiness state

Important install cases:

- every install materializes the agent's resolved **catalog pin**: a
  sha256-verified per-platform binary/archive download, or a pinned npm/git
  specifier. There is no install-time latest-fetch, PATH adoption, ACP-registry
  lookup, or fallback — a role with no pin is a hard error (see
  `agent-catalog-readiness` Banned Shapes)
- the ACP-mode launch args for registry-backed adapters (e.g. cursor `acp`,
  gemini `--acp`) are frozen into the pin and baked into the managed launcher;
  multi-file adapter bundles (cursor) keep their whole extracted tree
- direct binary/tarball native installs write into the managed artifact dir;
  managed npm/git installs create a managed launcher surface under runtime home
- managed npm readiness compares the installed package metadata against the
  bundled package spec; stale managed packages report `install_required` so
  normal setup/reconcile can update user-owned older ACP adapters
- the update path for every installable agent process recipe is reconcile against
  the catalog pins: the runtime startup pass does this automatically (installed-only),
  and the desktop "update local installs" button / manual reinstall do it on demand. The
  version + source come from the bundled catalog lockfile, resolved at probe time by
  `scripts/agent-catalog/resolve-pins.mjs`
- installer mutations are serialized by runtime-home file locks under
  `agents/<kind>/.install.lock` so desktop, CLI, and seed hydration do not
  write the same agent at the same time

Public HTTP routes include:

- `GET /v1/agents`
- `GET /v1/agents/launch-options`
- `GET /v1/agents/reconcile`
- `POST /v1/agents/reconcile`
- `GET /v1/agents/{kind}`
- `POST /v1/agents/{kind}/install`
- `POST /v1/agents/{kind}/login/start`
- `POST /v1/agents/{kind}/login/terminal`
- `GET /v1/agents/login-terminals/{id}`
- `DELETE /v1/agents/login-terminals/{id}`
- `GET /v1/agents/login-terminals/{id}/ws`
- `GET /v1/agents/{kind}/model-registry`
- `POST /v1/agents/{kind}/model-registry/refresh`

`login/start` is a compatibility endpoint for older clients that still show a
command. New local/Desktop clients use `login/terminal`: AnyHarness resolves
the correct provider executable, starts an ephemeral runtime-scoped PTY, and
streams it over the agent-login terminal websocket. These terminals are not
workspace terminals, do not mutate workspace terminal state, and do not persist
output to `terminal_command_runs`.

Login command resolution is runtime-owned and must not assume that the provider
CLI is available on global `PATH`. Resolution order is:

1. managed native executable
2. managed agent-process registry binary or registry npm binary
3. global `PATH`, only when the executable is actually resolvable

The launched auth process receives a `PATH` prefixed with the resolved
executable directory and managed runtime binary directories. It keeps the
user's normal `HOME` and runs from the user home directory when available, so
vendor CLIs write their usual local auth files.

Cloud target enrollment, Git bootstrap, and workspace materialization do not
install agents. A fresh cloud/SSH target may report worker and AnyHarness
online while `start_session` still fails with an install/readiness error until
the requested agent is installed through this API. The runtime startup pass keeps
*already-installed* agents on a cloud worker current with the catalog pins, but it
does not eagerly install missing agents — those still install on demand here.

### ACP Registry Flow (probe-time only)

ACP-registry resolution is a **producer / probe-time** concern, not a runtime
install input. `scripts/agent-catalog/resolve-pins.mjs` fetches the ACP registry
(`cdn.agentclientprotocol.com/registry/v1/latest`), resolves each agent's
platform distribution + ACP launch args, downloads + checksums the artifacts,
and freezes the result into the catalog pin (`harness.<role>.source`).

The runtime installer never consults the ACP registry — it materializes the
frozen, sha256-verified pin. The former in-tree
`integrations/agent_cli/acp_registry` module (registry fetch + install-time
distribution resolution) was removed when the install path was fenced.

### Reconcile Flow

`installer/reconcile/`
(`anyharness/crates/anyharness-lib/src/domains/agents/installer/reconcile/`)
is the batch install path.

It iterates the built-in registry and attempts managed install where supported,
returning:

- installed
- already installed
- skipped
- failed

This is the “make the runtime ready” bulk path, not the per-agent resolution
path.

Reconcile runs in two scopes, selected by the `installed_only` flag:

- **full** (`installed_only=false`, the `POST /v1/agents/reconcile` default): attempt
  managed install for every registry agent — installs missing ones too.
- **installed-only** (`installed_only=true`): only agents already installed on disk
  (`resolve_agent(..).agent_process.installed`) are reconciled to the catalog pins; a
  missing agent is `skipped` (it installs on demand at session start). This is the scope
  used by the runtime startup pass and the desktop "update local installs" button.

The runtime drives reconcile itself at startup — `AgentRuntime::spawn_startup_pass`
(kicked from `app/` wiring, runs on the desktop sidecar AND cloud workers): hydrate the
bundled seed if pending, then run an installed-only reconcile. It is non-blocking (the
HTTP server boots and answers `/health` while it runs), best-effort (failures land in the
reconcile snapshot, never fatal), and idempotent (an up-to-date agent short-circuits with
no network — see `install_policy` version-drift detection). The catalog-applied poke (a
newer cloud catalog synced at runtime) also kicks an installed-only reconcile.

### Bundled Agent Seed Flow

Packaged desktop builds can ship a compressed agent seed so first launch does
not need to download the most common managed agents before the user can start.
The seed is a `.tar.zst` resource built by `scripts/build-agent-seed.mjs` from
`apps/desktop/src-tauri/agent-seed.inputs.json` and hydrated by
`anyharness/crates/anyharness-lib/src/domains/agents/installer/seed/` at
runtime startup.
The HTTP runtime starts immediately with `agentSeed.status=hydrating`; the heavy
archive extraction and checksum verification run on a blocking background task
so `/health` can respond while seed hydration is still in progress.

V1 seeds include:

- `claude`
- `codex`
- the target-specific Node runtime under `node/<target>/`

The seed hydrates into the normal runtime home layout. It does not add a
parallel resolver path:

```text
<runtime_home>/
  agents/
    claude/
      native/
      agent_process/
    codex/
      native/
      agent_process/
  node/
    <target>/
```

The seed archive intentionally does not carry generated launchers. After
hydration, the runtime regenerates launchers in the real runtime home so their
absolute executable paths and PATH prefixes point at the final location. The
generated launchers include the managed native CLI directory and the bundled
Node `bin` directory when present. Managed Claude launchers set
`DISABLE_AUTOUPDATER=1` so desktop releases, not Claude's own updater, own the
managed seeded version.

Hydration is ownership-aware:

- missing artifacts are written from the seed and recorded as seed-owned
- existing artifacts with no seed state are preserved and recorded as
  user-owned existing files
- previously seed-owned artifacts are repaired when missing or unchanged from
  the last seeded checksum
- seed-owned artifacts that were modified by an install/reinstall path are
  treated as user-modified and are not overwritten by a later seed

Public health reports low-cardinality seed state only:

- `status`: `not_configured_dev`, `missing_bundled_seed`, `hydrating`,
  `ready`, `partial`, or `failed`
- `ownership`: `full_seed`, `partial_seed`, `user_owned_existing`, or
  `not_configured`
- `lastAction`: `none`, `hydrated`, or `repaired`
- artifact counts, target, seeded agent names, and a coarse `failureKind`

`/health` also carries a coarse `agentReconcile` summary (status, current agent, and
installed / already-installed / skipped / failed counts) for the startup reconcile. The
per-agent detail stays on `GET /v1/agents/reconcile`.

The runtime startup pass runs the installed-only reconcile after seed hydration
settles (`AgentRuntime::spawn_startup_pass` awaits hydration, then reconciles), so
already-installed agents track the catalog pins on both the desktop sidecar and cloud
workers. The desktop frontend no longer triggers reconcile — it polls the reconcile
snapshot (`GET /v1/agents/reconcile`) to display per-agent status and refreshes the agent
list as the job transitions. Missing non-seeded agents are not auto-installed at startup;
they install on demand at session start or via an explicit per-agent install.

Seed hydration verifies the archive `.sha256`, validates the manifest target and
schema, rejects unsafe tar entries, extracts into a staging directory under the
same runtime home, preserves executable bits, and strips
`com.apple.quarantine` from hydrated macOS executables on a best-effort basis.
External seed dirs are dev-only unless a packaged build sets
`ANYHARNESS_AGENT_SEED_DIR_UNSAFE=1`.

Claude's compatibility gate also checks the bundled Node binary before falling
back to global `PATH`, so a machine without system Node can still resolve a
seeded Claude install.

## Boundaries

### Agents Owns

- the built-in supported-agent registry
- static install and auth metadata
- provider-specific credential detection
- managed install behavior (fenced: materialize EXACTLY the catalog pin,
  sha-verified — ACP-registry resolution is probe-time, see "ACP Registry Flow")
- readiness computation
- the final resolved launch surface handed to ACP
- curated provider/model catalogs used by sessions

### Agents Does Not Own

- live session actors
- ACP stdio connections
- prompt execution
- session persistence
- workspace registration or path resolution
- HTTP transport logic

## Important Distinctions

### Registry vs Catalog

These are different:

- the agent registry answers “how does this agent install, authenticate, and
  launch?”
- the provider catalog answers “what model IDs can the session domain validate
  and default?”

### Native CLI vs Agent Process

These are also different:

- the native CLI is the vendor-facing login or local install surface
- the agent process is the ACP-facing executable AnyHarness launches

Some agents need both. Some only need the ACP-facing surface.

### Resolution vs Installation

Resolution reports current state.

Installation changes machine-local state.

Do not mix those responsibilities. `resolve_agent(...)` should stay side-effect
free.

## Important Invariants

- Built-in registry descriptors are the source of truth for supported runtime
  agents in v1.
- `ResolvedAgentStatus` is derived from installation state, compatibility, and
  credential state together.
- Credential detection must remain explicit and provider-specific.
- The agents area hands ACP a resolved executable surface; ACP should not
  decide installation or credential rules.

## Extension Points

Add behavior here when it changes agent availability, for example:

- a new supported agent family
- a new credential-discovery mechanism
- a new managed install strategy
- a new resolved-pin source kind (binary/archive/npm/git) + its probe resolver
- a new provider/model catalog surface

Do not add behavior here when it belongs to:

- live actor/session control
- transcript normalization
- session persistence or config snapshots
