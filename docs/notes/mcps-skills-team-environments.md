# MCPs, Skills, And Team Environments

Status: reference note, not an authoritative area standard.

This note synthesizes how MCP servers, skills, and agent authentication move
through a session today, where they are stored, what survives a restart, and
where team-scoped environments and a centralized model gateway should slot in.

It is a cross-area note. The authoritative area docs still win for their area:

- `docs/architecture/plugins-and-skills.md` for plugin packages, skills, and
  the `SessionPluginBundle` runtime boundary.
- `docs/anyharness/specs/mcp.md` for the MCP mental model in AnyHarness.
- `docs/anyharness/src/workspaces.md` for workspace identity.
- `docs/notes/agent-credentials-sync.md` for agent credentials.
- `docs/notes/model-gateway-auth-facts.md` for model gateway facts.

## Why This Note Exists

Two questions keep getting conflated:

1. "Which MCP servers and skills does a session get, and who decides?"
2. "What is preconfigured per workspace versus per session versus per runtime?"

The confusion comes from there being two different planes that resolve plugin
state, and they are not connected to each other yet.

## Two Planes

### Plane A: AnyHarness Session Plane

This is what `plugins-and-skills.md` and `mcp.md` describe. A client resolves a
per-session `SessionPluginBundle` and hands it to AnyHarness through the
session API.

```text
client (Desktop today, Cloud resolver later)
  -> resolves SessionPluginBundle
  -> CreateSessionRequest.pluginBundle / ResumeSessionRequest.pluginBundle
  -> AnyHarness assembles the session MCP launch
```

Key code:

- `anyharness/crates/anyharness-contract/src/v1/sessions.rs` — `CreateSessionRequest`
- `anyharness/crates/anyharness-contract/src/v1/plugins.rs` — `SessionPluginBundle`
- `anyharness/crates/anyharness-lib/src/domains/plugins/registry.rs` — `PluginBundleRegistry`
- `anyharness/crates/anyharness-lib/src/domains/plugins/session_extension.rs` — `PluginSessionLaunchExtension`
- `anyharness/crates/anyharness-lib/src/sessions/mcp_bindings/assembly.rs` — `assemble_session_mcp_launch`

### Plane B: Cloud Worker / TargetConfig Plane

`proliferate-worker` materializes a versioned `TargetConfig` onto a compute
target. This is the plane that actually preconfigures git identity, agent auth,
MCPs, and skills per workspace.

```text
Cloud delivers a TargetConfigMaterializationPlan
  -> proliferate-worker materialize_plan(...)
  -> writes a .proliferate/ tree into the workspace root
  -> writes agent auth files into HOME
```

Key code:

- `anyharness/crates/proliferate-worker/src/materialization/mod.rs` — `TargetConfigMaterializationPlan`, `materialize_plan`
- `anyharness/crates/proliferate-worker/src/materialization/git.rs` — git identity + credential
- `anyharness/crates/proliferate-worker/src/materialization/env.rs` — env + agent credentials
- `anyharness/crates/proliferate-worker/src/materialization/mcp.rs` — MCP materialization
- `anyharness/crates/proliferate-worker/src/materialization/skills.rs` — skill refs

`materialize_plan` writes, per workspace root:

```text
.proliferate/env/session.env        repo env vars + env-mode agent credentials
.proliferate/git/gitconfig          [user] name/email + credential helper
.proliferate/git/credentials        github access token
.proliferate/mcp/materialization.json
.proliferate/skills/refs.json
.proliferate/target-config.json     manifest
~/.claude/.credentials.json etc.    file-mode agent credentials (allowlisted)
```

The `TargetConfig` is versioned (`config_version`). It carries `git_credential`,
`agent_credentials`, `mcp`, and `skills` together. This is the concrete object
behind "every workspace has preconfigured git identity and agent auth, and can
have its own MCPs and skills".

## The Scoping Ladder

```text
Runtime        agent catalog, agent credentials (model API keys / login)
  RepoRoot     remote provider/owner/repo, remote URL, default branch
    Workspace  local-vs-worktree identity, checkout path, branch
      Session  resolved SessionPluginBundle: skills + plugin MCP servers + creds
```

Important: skills and plugin MCP servers are not a workspace field. On Plane A
they are resolved per session. On Plane B they ride on the `TargetConfig` that
is materialized into the workspace. The durable plugin model in
`plugins-and-skills.md` uses `owner_scope: first_party | user | team | org |
self_hosted` — there is deliberately no `workspace` scope.

`WorkspaceRecord` (`anyharness/crates/anyharness-lib/src/workspaces/model.rs`)
has no git identity, agent auth, plugin, MCP, `team_id`, or `org_id` fields. It
is execution-surface identity only.

## Session Lifecycle And Durability

### Create

`CreateSessionRequest` carries two separate things, stored differently:

- `mcp_servers` + `mcp_binding_summaries` — user MCP servers. Encrypted into the
  durable `SessionRecord` as `mcp_bindings_ciphertext` and
  `mcp_binding_summaries_json`. Survives an AnyHarness process restart.
- `plugin_bundle` — the `SessionPluginBundle` (plugin MCP servers, skills,
  credential bindings). Stored only in the in-memory `PluginBundleRegistry`,
  keyed by session id. Never written to the AnyHarness DB.

Skills have no durable storage inside AnyHarness at all. `SessionPluginSkill`
carries inline `instructions: String`; there is no ref/hash field in the
contract today.

### Assembly And Run

`assemble_session_mcp_launch` builds the final MCP server list at every actor
launch from three sources:

1. user MCP bindings decrypted from `mcp_bindings_ciphertext` (DB)
2. session extensions — `PluginSessionLaunchExtension` reads the in-memory
   `PluginBundleRegistry` and contributes plugin MCP servers, the
   `proliferate_skills` MCP server, and the prompt-level skill index
3. the product MCP launch catalog

The list is deduped and handed to `acp_manager.start_session`. The ACP harness
subprocess is what actually connects to MCP servers. An MCP server only "runs"
for the lifetime of a live actor. An MCP binding is config data, not a process.

### Sending A Message

Sending a prompt to an already-live session does nothing to the bundle. A
`pluginBundle` on a live actor is rejected with `409 SESSION_RESTART_REQUIRED`.

Sending a prompt to a cold session auto-starts the actor through
`ensure_live_session_handle(record, None, ...)` — it reuses whatever is already
in the registry and does not re-resolve.

### Cold Restart

Two cases, and they behave differently:

- Actor died, AnyHarness process alive: the `PluginBundleRegistry` HashMap is
  still in memory. The session can be woken without re-sending the bundle.
- AnyHarness process restarted: the HashMap is wiped. User MCP bindings survive
  (DB, encrypted). Plugin MCP servers and skills are gone, and the DB has
  nothing to fall back to.

Because the client cannot tell which case it is in, Desktop re-resolves against
the cloud and re-sends `pluginBundle` on every resume.

## What Survives What

```text
                         AnyHarness DB   AnyHarness RAM   target disk
user MCP bindings         yes (crypt)     -                -
plugin MCP servers        no              yes (registry)   .proliferate/mcp/*
skills                    no              yes (registry)   .proliferate/skills/*
agent credentials         no              -                .proliferate/env/*, HOME
git identity              no              -                .proliferate/git/*
```

"Survives" here means: can the layer remember the config across its own
restart. Running is always re-done fresh at actor launch.

## The Missing Bridge

Plane B writes `.proliferate/mcp/materialization.json` and
`.proliferate/skills/refs.json` to the target disk. Plane A assembly reads from
the DB, the in-memory registry, and the product catalog. It does not read the
`.proliferate/` tree. The contract has no ref-backed skill field.

So there is no established path from "worker materialized a `.proliferate/`
tree" to "AnyHarness session launched with those skills and MCPs". Closing this
is the central piece of work for shared/cloud sessions:

- either the worker translates the materialized `TargetConfig` into a
  `SessionPluginBundle` and passes it through `CreateSessionRequest`, or
- the contract gains ref-backed skills and AnyHarness gains a content store
  that reads the allowlisted `.proliferate/` artifacts.

`plugins-and-skills.md` already describes the resolution rule the bridge must
respect: the product resolver decides what is selected, the worker only
materializes selected artifacts, and AnyHarness serves only what the bundle
allowlists.

## Team Environments: Where Scoping Slots In

No team or org scoping exists in code today — not in AnyHarness models, not in
the worker `TargetConfig`, not in Cloud MCP materialization (which is
user-scoped only).

Where it should attach when it lands:

- Durable plugin model: `owner_scope` already includes `team` and `org` in the
  designed schema in `plugins-and-skills.md`. Team plugin catalogs and install
  policy are an input to the resolver, not a new runtime concept.
- Resolver: a team/org policy input filters which plugins, MCP servers, and
  skills are eligible before a `SessionPluginBundle` is produced.
- `TargetConfig`: a team-owned target config would carry team-shared git
  identity and team-shared credentials instead of a single user's.
- AnyHarness: stays unaware of teams. It keeps receiving a resolved bundle. Do
  not push team policy into session assembly.

## The Centralized Gateway: Where It Slots In

The model gateway (see `model-gateway-auth-facts.md`) is not implemented; that
doc is a facts note from source inspection. It is orthogonal to MCPs and
skills:

- MCPs and skills are tool surfaces resolved into the session bundle.
- The gateway concerns the harness's own model provider calls (Anthropic,
  OpenAI, Google), reached after ACP, when the harness process calls the model.

The gateway slots in at the runtime launch/auth layer, alongside agent
credentials. A team gateway token would replace per-developer model API keys,
which is the natural team-shared agent-auth story. It must expose multiple
protocol facades because the harnesses do not share one gateway protocol.

## What Does Not Exist Today

- Ref-backed skills in the contract; skills are inline-only.
- A durable store for `SessionPluginBundle` / skills in AnyHarness.
- A bridge from the worker `.proliferate/` tree to a `SessionPluginBundle`.
- Team or org scoping anywhere (models, worker, Cloud materialization).
- A centralized model gateway.
- Cloud-mediated credential sync (designed in `agent-credentials-sync.md`).

## Open Questions And Suggested Order

1. Decide the bridge shape: worker-builds-bundle vs ref-backed skills plus an
   AnyHarness content store.
2. Add ref-backed `SessionPluginSkill` fields without breaking the bundle
   boundary, if option two is chosen.
3. Introduce team/org `owner_scope` rows and a resolver policy input.
4. Decide whether `TargetConfig` becomes team-owned, and how team-shared
   credentials and git identity are represented.
5. Treat the model gateway as a separate runtime-auth workstream; do not couple
   it to the plugin bundle.
