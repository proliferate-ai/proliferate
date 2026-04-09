# Agent Credentials and Sync Notes

Status: working design note, not an authoritative area standard.

This note captures the current mental model for agent installation and
credentials, the confirmed env-var bug in desktop, and a scoped outline for a
future credential-sync system.

## 1. Current Mental Model

### Runtime-owned truth

The AnyHarness runtime is the source of truth for:

- which agent kinds exist
- whether each agent is installed
- whether each agent is compatible on this machine
- whether each agent is ready to use
- how each agent should be installed
- which env vars or login flow each agent supports

That resolved catalog is exposed to the UI through `useAgentsQuery()`.

Readiness should continue to mean:

- `install_required`
  - required binaries or agent process are missing
- `credentials_required`
  - install is complete, but the runtime cannot find required env-based auth
- `login_required`
  - install is complete, but the runtime expects a native login flow instead
- `ready`
  - install is complete and credentials are available to the runtime
- `unsupported`
  - installed, but not compatible on this machine/runtime

Important distinction:

- `saved in desktop keychain` is not the same as `ready`
- `ready` means the runtime process can actually see usable credentials

### Desktop-owned truth

The desktop app owns only local credential storage and UX state:

- save/delete supported secrets in the keychain
- show whether a supported env var is saved locally
- restart the sidecar/runtime so saved secrets become part of the runtime env
- present install/setup/login affordances

The desktop app should not be the source of truth for agent readiness.

### Session creation

`CreateSessionRequest` intentionally does not carry agent secrets directly.

Current model:

1. Desktop stores supported secrets in the keychain.
2. Desktop injects those secrets into the AnyHarness sidecar launch env.
3. The runtime process inherits them.
4. Agent subprocesses inherit the runtime process env when sessions start.

That means the main credential path is runtime-level env injection, not
per-session env payloads.

## 2. Runtime and Query Model

`@anyharness/sdk-react` already gives us the right runtime boundary.

- queries are scoped by `runtimeUrl`
- switching runtime URLs moves the UI onto a different query-key namespace
- old caches may remain in React Query until GC, but consumers do not read them
- restarting the same runtime URL still requires explicit invalidation/refetch

Conclusion:

- we do not need an app-level "agents provider" as the main state container
- `useAgentsQuery()` should remain the source of truth for the resolved agent
  catalog
- app hooks should derive from that query instead of copying it into Zustand or
  a custom provider

Recommended UI split:

- `useAgentsQuery()`
  - authoritative resolved agent catalog for the current runtime
- local credential hook
  - keychain-backed env-var presence and save/delete behavior
- install/reconcile hook
  - install and reinstall operations
- setup workflow hook
  - modal orchestration for install, login command retrieval, and restart
- page-level derived hooks
  - screen-specific presentation state only

## 3. Confirmed Desktop Bug

The desktop app only injects a fixed allowlist of keychain-backed env vars into
the AnyHarness sidecar launch env.

Current allowlist in `desktop/src-tauri/src/commands/keychain.rs`:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `CODEX_API_KEY`
- `GOOGLE_API_KEY`
- `GEMINI_API_KEY`

But the runtime agent registry currently expects additional env vars in
`anyharness/crates/anyharness-lib/src/agents/registry.rs`:

- `CURSOR_API_KEY`
- `AMP_API_KEY`

Effect:

- the user can conceptually save credentials for those agents
- the runtime does not receive those values at sidecar boot/restart
- readiness can never become `ready` via keychain-backed env auth for those
  agents
- spawned sessions also will not see those env vars

This is the immediate bug to fix.

### Immediate fix

Short-term fix:

1. Add `CURSOR_API_KEY` and `AMP_API_KEY` to the desktop allowlist.
2. Add a regression test or assertion around the supported env-var list if
   possible.
3. Make the setup UX explicitly state that a restart is required before the
   runtime can see newly saved env vars.

### Better follow-up fix

The desktop allowlist should not drift independently from the runtime agent
registry.

Better long-term options:

1. Expose supported env vars from the runtime over a small endpoint.
2. Generate a shared contract artifact from the agent registry.
3. Maintain one shared source for supported credential env vars and consume it
   from both desktop and runtime.

Preferred direction:

- make the runtime the canonical source for supported env-var names
- have desktop read that list instead of hardcoding its own copy

## 4. Installation, Reinstallation, and Availability

This is the mental model we should keep consistent in the product.

### Installation

Installation means:

- required native CLI and/or ACP process artifacts are placed in the managed
  location
- the runtime resolver can find them

The runtime owns this logic.

### Reinstallation

Reinstallation is the same install path, invoked with reinstall intent.

It should not be a separate conceptual system. It is just:

- install again
- refresh resolved state afterward

### Available vs ready

These terms should stay distinct:

- available
  - the agent exists in the built-in registry / resolved catalog
- installed
  - the required binaries/processes are present
- configured
  - credentials are saved or login state exists somewhere
- ready
  - the runtime can actually use the credentials now

Important product nuance:

- "saved in keychain" means the desktop has credential material
- it does not mean the runtime has ingested it yet
- after saving an env-var secret, runtime readiness should be treated as
  pending until restart

## 5. Credential Sync: Scope for Future Work

We should separate three different concepts that are easy to conflate:

1. local desktop credential storage
2. runtime launch env injection
3. cloud credential sync

They are related, but they are not the same system.

### What sync should mean

Future credential sync should mean:

- take an explicitly approved local secret source
- transform it into a syncable credential payload
- send it to a cloud-backed secret store
- let a cloud workspace/runtime materialize it securely when needed

That is different from local runtime startup, where secrets are injected into
the local sidecar process env.

### Why we need a separate sync concept

We are going to want more than "save one API key to the local keychain."

Examples:

- syncing supported provider env vars to cloud workspaces
- syncing portable auth files for providers that do not use env vars
- eventually syncing selected dotenv-style values from files such as
  `.env.local`

That should not become "upload arbitrary local env files to the cloud."

### Proposed principles for sync

Credential sync should be:

- explicit and opt-in
- allowlisted by key name or credential type
- provider-aware where possible
- reviewable before upload
- revocable
- encrypted server-side and never echoed back as plaintext

It should not:

- blindly upload every value from `.env.local`
- infer that all repo-local env vars are safe for cloud use
- merge local developer-only secrets into every cloud session automatically

### Proposed future model

Think in terms of "syncable secret sources."

Examples:

- keychain-backed provider env var
  - `ANTHROPIC_API_KEY`
  - `OPENAI_API_KEY`
  - `CURSOR_API_KEY`
- portable auth file
  - Claude auth JSON
  - Codex auth JSON
- selected dotenv entries
  - explicit user-approved keys from `.env.local`

For each source, we should know:

- source kind
- owning provider or usage scope
- secret keys included
- whether it is portable to cloud
- where it should be mounted or injected

### Cloud-mediated operation

Yes, credential sync should probably be cloud-mediated.

Reason:

- local sidecar launch env is only relevant for the local runtime
- cloud workspaces need credentials available in the cloud control plane /
  cloud runtime path
- the sync system should be able to target cloud workspaces without depending
  on the local sidecar process

Reasonable future flow:

1. Desktop discovers local syncable secret sources.
2. User explicitly chooses what to sync.
3. Desktop sends an encrypted or protected payload to the cloud API.
4. Cloud stores it as a scoped secret bundle.
5. Cloud workspace startup injects only the approved values.

### `.env.local` support

If we add `.env.local` support, it should be selective.

Recommended constraints:

- only sync explicitly selected keys
- preview the exact keys to be synced
- never auto-sync all dotenv values
- ideally scope synced keys to a workspace, repo, or provider

We should think of this as:

- `sync selected env vars from a local source`

not:

- `upload my environment`

## 6. Suggested Work Order

### Now

1. Fix the desktop env-var allowlist mismatch.
2. Make restart-required behavior explicit in the setup UX.
3. Keep `useAgentsQuery()` as the runtime-owned source of truth.

### Next

1. Define a canonical source for supported credential env vars.
2. Separate local credential hooks from agent-catalog hooks in desktop.
3. Tighten naming in the UI around `saved`, `configured`, and `ready`.

### Later

1. Design a dedicated credential-sync contract.
2. Add provider/file/env-var source typing for syncable secrets.
3. Add selective dotenv sync.
4. Add cloud-scoped secret injection behavior.
