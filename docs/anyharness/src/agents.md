# Agents

`anyharness-lib/src/agents/**` owns supported-agent metadata, installation,
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

### `AgentDescriptor` (`anyharness/crates/anyharness-lib/src/agents/model.rs`)

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
`anyharness/crates/anyharness-lib/src/agents/registry.rs`.

### Artifact Specs (`anyharness/crates/anyharness-lib/src/agents/model.rs`)

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

### Credential and Readiness Models (`anyharness/crates/anyharness-lib/src/agents/model.rs`)

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

### `ResolvedArtifact` and `ResolvedAgent` (`anyharness/crates/anyharness-lib/src/agents/model.rs`)

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

### Static Registry and Catalog

There are two separate static sources:

- `registry.rs`
  - built-in agent descriptors
- `catalog.rs`
  - curated provider/model catalog used for session validation and defaults

Code paths:

- `anyharness/crates/anyharness-lib/src/agents/registry.rs`
- `anyharness/crates/anyharness-lib/src/agents/catalog.rs`

Those are related but distinct:

- the registry defines install, auth, and launch behavior
- the catalog defines model choices the session domain can validate against

### Resolution Flow

Resolution is owned by
`anyharness/crates/anyharness-lib/src/agents/resolver.rs`.

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
for Claude, Codex, Gemini, OpenCode, Cursor, and Amp.

Code path:

- `anyharness/crates/anyharness-lib/src/agents/credentials.rs`
- Claude/Codex local file parsing and portable export normalization are shared
  with desktop cloud sync via `anyharness/crates/anyharness-credential-discovery/`

Local readiness and cloud portability intentionally remain separate questions:

- readiness answers whether a provider appears usable on this machine
- portable export answers whether local auth can be serialized into the cloud
  credential file/env contract

### Installation Flow

Managed installation is owned by
`anyharness/crates/anyharness-lib/src/agents/installer.rs`.

The flow is:

1. inspect the descriptor’s install specs
2. install the native CLI if the spec supports managed install
3. install the ACP-facing agent process if the spec supports managed install
4. return installed artifact results
5. resolve the agent again so the API returns fresh readiness state

Important install cases:

- direct binary or tarball native installs write into the managed artifact dir
- ACP-registry-backed installs try the ACP registry first
- registry-backed installs fall back to local npm/native-subcommand/binary-hint
  rules when needed
- managed npm installs create a managed launcher surface under runtime home

### ACP Registry Flow

`acp_registry.rs`
(`anyharness/crates/anyharness-lib/src/agents/acp_registry.rs`)
is a helper boundary for ACP-registry-backed agent-process installation.

It owns:

- fetching the registry document
- resolving the best platform distribution
- applying version overrides
- installing registry-provided npm or binary distributions

It does not own agent readiness. It is only one install/discovery input into
the broader agents flow.

### Reconcile Flow

`reconcile.rs`
(`anyharness/crates/anyharness-lib/src/agents/reconcile.rs`)
is the batch install path.

It iterates the built-in registry and attempts managed install where supported,
returning:

- installed
- already installed
- skipped
- failed

This is the “make the runtime ready” bulk path, not the per-agent resolution
path.

## Boundaries

### Agents Owns

- the built-in supported-agent registry
- static install and auth metadata
- provider-specific credential detection
- managed install behavior
- ACP-registry-backed distribution resolution
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

- Built-in descriptors are the source of truth for supported agents in v1.
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
- a new ACP registry mapping
- a new provider/model catalog surface

Do not add behavior here when it belongs to:

- live actor/session control
- transcript normalization
- session persistence or config snapshots
