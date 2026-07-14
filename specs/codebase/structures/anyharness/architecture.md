# AnyHarness — Architecture

Status: consolidated architecture reference for the AnyHarness runtime —
`anyharness/crates/{anyharness, anyharness-contract, anyharness-credential-discovery, anyharness-lib}`.
Covers purpose/ownership, the 20k-foot model, core workflows, and per-layer best
practices. The authoritative folder standards live in
`specs/codebase/structures/anyharness/README.md`; the live-layer rules in
`specs/codebase/structures/anyharness/guides/live-runtime.md`; the wire schemas in
`specs/codebase/structures/anyharness/contract.md`.

---

## 1. Purpose / Ownership

AnyHarness is **the runtime that runs coding-agent sessions over the ACP protocol,
inside the sandbox or on Desktop**. Product clients call it directly; managed
Cloud traffic reaches the same API through the cloud-sandbox gateway.

It owns:
- **Running agent sessions** — spawning the agent subprocess, driving prompt turns
  over ACP, and turning the agent's streamed output into an ordered, replayable
  event log.
- **The durable record** of those sessions (config, history, identity) in local
  SQLite.
- **Applied runtime config** — external MCP servers, skills, and agent/provider
  auth — and its materialization into a session.
- **The product MCP tools** we expose back to the agent (subagents, reviews,
  cowork, skills, …).

It does **not** own product orchestration or account/billing truth (Cloud's
job), nor the external launch/update machinery used by Desktop, Worker, or an
installed Supervisor. AnyHarness is a local runtime engine whose own APIs and
SQLite database own workspace/session execution truth.

**The defining axis — Durable vs Live.** Almost every placement question in
AnyHarness reduces to one split: *is this the durable meaning of a session, or the
coordination of a running one?* Durable lives in `domains/` + `persistence/`; live
lives in `live/`. Hold this and the rest of the structure follows.

---

## 2. 20k-Foot Detailed View

### The four crates

```text
anyharness                       thin binary — parse args, wire deps, run
anyharness-contract              wire schemas (shapes that cross the network)
anyharness-credential-discovery  probe the env for credentials (files/keychain/markers)
anyharness-lib                   the runtime engine — everything below
```

Three small satellites + one engine. The contract crate keeps wire shapes out of
runtime types; credential-discovery keeps "find the creds" out of "am I ready to
serve."

### The eight layers in `anyharness-lib/src` (edge → substrate)

```text
api/            edges — HTTP/ACP surface. Translates wire ↔ runtime, nothing more.
app/            composition root — wires deps, mounts SessionExtensions, registers product MCPs.
domains/        DURABLE product meaning — sessions, agents, runtime_config, plugins, reviews, …
live/           EPHEMERAL coordination — running sessions: the ACP actors, event sinks, rendezvous.
adapters/       translate between a domain's types and an integration's types.
integrations/   leaf I/O — talk to the outside (ACP processes, MCP protocol, filesystem).
persistence/    durable storage substrate (SQLite) — how domains/ actually save.
observability/  cross-cutting — tracing/metrics/logs.
```

The structural feature that makes AnyHarness feel "more numerous" than the server:
`domains/` and `live/` are **siblings, not a stack**. A feature splits across two
homes — its durable half in `domains/<feature>/` and its running half in
`live/<feature>/`. That doubling is the source of most of the extra rules.

### The session engine — the role chain

The spine walks durable → live → external:

```text
SessionRuntime → SessionService → SessionStore →          [DURABLE: domains/]
   LiveSessionManager → LiveSessionHandle → SessionActor → [LIVE: live/]
      driver (ACP conn + InboundDoor) / SessionEventSink / InteractionRendezvous   [EXTERNAL + ordering]
```

The handoff `SessionStore → LiveSessionManager` is exactly the durable/live
boundary.

### The live grammar (5 roles)

The only layer juggling concurrency, so the most rules:

```text
manager   registry of MANY        — the only way to find/create a live instance
handle    the ONE public port     — every interaction with a live instance goes through it
actor     private serialized core  — owns the gravity; decides WHEN things happen
driver    external backing mechanism — the ACP process/connection the actor drives
sink      ordered write path        — decides HOW events become an ordered stream
```

Two non-obvious boundaries: **"actor decides WHEN, sink decides HOW it becomes
ordered output"**; and the **handle is the only port** — actor commands are
constructed only inside `handle.rs` (`handle.send_prompt(...)`, never
`handle.command_tx.send(SessionCommand::Prompt{...})`).

### MCP — a vertical, not a layer

The one feature that cuts through every layer:

```text
domains/sessions/mcp_bindings    durable: which MCPs a session/workspace has + binding policy
domains/<feature>/mcp            durable: a feature's product MCP tools (meaning)
integrations/mcp                 leaf: protocol mechanics (JSON-RPC, capability tokens)
live/.../rendezvous/mcp_elicitation     live: a pending elicitation rendezvous
api/http/product_mcp.rs          edge: the one HTTP route product MCPs are served on
```

### The two applied bundles

Both are **revision + scope versioned**, applied to a runtime scope, and
**snapshotted per session at create** (config never mutates inside a live session):

```text
runtime-config   PUT /v1/runtime-config       external MCPs + skills + artifacts + direct-attach-auth
                   secrets: in-memory cache (ephemeral, re-pushed to re-warm)
agent-auth       PUT /v1/agents/auth-config    per-agent-kind provider creds (env or files)
                   secrets: encrypted at rest (survives restart, needed to resume)
```

A session **pins** to a revision at create (`runtime_config_session_context` /
`agent_auth_scope` + `required_agent_auth_revision`), **materializes** secrets once
into the session, and launches from that frozen snapshot. "Refresh" means an
authorized caller applies a new revision and the *next* session picks it up —
never a live update.

### The event model

One `SessionEventSink` per session owns truth: a monotonic `seq`, the `turn_id`,
and the open-item state. ACP notifications are *normalized* into contract events
(one notification → 0..n events); `item_completed` is **synthesized** by
accumulating chunks, not a raw ACP frame. Every event is **persisted before
broadcast** (`publish_session_event`), which makes direct SSE/replay consumers
recoverable by `seq`.

---

## 3. Core Workflows

**Session start (durable → live):**
```text
create: pin runtime-config revision (bind_session_to_expected) + capture agent_auth_scope/revision
  → agent-auth launch_overlay: scope+revision gate (else 409 AGENT_AUTH_SELECTION_REQUIRED)
  → readiness gate: resolve_agent_with_env must be Ready
launch: SessionExtensions resolve launch extras
  → materialize external MCP servers (credentials interpolated from cache, once)
  → if skills: append skill INDEX to system prompt + add proliferate_skills MCP
  → choose_session_startup_strategy: Fresh (new_session) | LoadNative (load_session) | Fork
  → LiveSessionManager.start_session → spawn SessionActor (owns the ACP connection)
```

**A prompt turn (in → out):**
```text
handle.send_prompt → SessionCommand::Prompt → actor begins turn
  → sink.begin_turn (TurnStarted + User item) → conn.prompt(req)   [the long-lived ACP future]
  → ACP streams session/update notifications → InboundDoor → actor channel
  → sink.ingest normalizes (ItemStarted/ItemDelta/ToolCall…), each seq'd + persisted + broadcast
  → PromptResponse{stop_reason} → finish: sink.turn_ended → phase Idle → apply pending config → drain queue
```

**Mid-turn interactions (one rendezvous, many askers):**
```text
agent asks permission OR a product MCP tool elicits
  → rendezvous registers a parked oneshot + handle.add_pending_interaction + sink.interaction_requested
  → user answers → SessionCommand::ResolveInteraction (handled on the same actor)
  → rendezvous resolves the oneshot → the parked ACP callback returns → sink.interaction_resolved
```

**Config application:**
```text
authorized caller → PUT /v1/runtime-config or /v1/agents/auth-config
  → store upserts only when the sequence is newer
  → next session created snapshots the new revision (running sessions unaffected)
```

The current Proliferate Worker does not poll for these bundles or report applied
revisions. Managed Cloud calls/proxies to AnyHarness directly; the Worker's
AnyHarness HTTP use is limited to catalog convergence and the post-relaunch
`GET /health` version gate.

**Skill discovery / activation (advisory, no wiring change):**
```text
index in system prompt → agent: list_available_skills → activate_skill(id) returns full instructions
  (a pure read; no MCP enabled, no state set) → get_skill_resource(id, resId) streams one body
required MCPs are ALWAYS connected at launch; required_mcp_servers is a hint, not a gate
```

**Model switch in place:**
```text
SetConfigOption(model) → ensure live actor → attempt live apply (same session)
  catalog-authorized immediate rejection → persist selection
    → retire live agent process → relaunch under the same session
  queued replay rejection → remains an actor-level gap; no runtime relaunch
```

---

## 4. Each Layer's Best Practices

**`api/`** (the edges)
- Translate wire ↔ runtime and nothing more. No business logic. The product-MCP
  route (`product_mcp.rs`) looks up a handler by slug, validates the capability
  token, and dispatches — it does not know tool meaning.

**`app/`** (composition root)
- The "main()" of behavior: wire dependencies, mount `SessionExtension`s, register
  product MCPs into the launch catalog (selectors + token minters) and the endpoint
  registry. Keep it wiring; no logic.

**`domains/`** (durable meaning)
- Server-like `service + store` per feature, but the *running* half lives in
  `live/`. A domain owns durable truth and decisions; it must not reach into live
  coordination. `runtime_config` and `agents/auth` own the two synced
  bundles; `plugins` owns skills; `sessions` owns the session record + mcp_bindings
  + subagents.

**`live/`** (ephemeral coordination) — the grammar is law
- `manager` is the only registry; `handle` is the only public port; `actor` is
  private and serialized; `driver` is a mechanism (never makes product decisions);
  `sink` owns ordering. Outside `live/<resource>/`, only `manager` + `handle` +
  public types are visible.
- Dependency rules: `live → domains/integrations/adapters/observability` OK; AVOID
  `live → api/app`, `driver → domain services`, `sink → access-control`,
  `integrations → live`.
- The sink is the single source of event order: assign `seq`, persist, then
  broadcast — in that order.

**`adapters/`** — translate domain types ↔ integration types; pure shape-shifting.

**`integrations/`** (leaf I/O)
- Talk to the outside; never know about coordination. `integrations/mcp` owns MCP
  *protocol mechanics* (JSON-RPC, capability tokens) — the *meaning* of a product
  MCP tool lives in `domains/<feature>/mcp`.

**`persistence/`** — the SQLite substrate. Synced config is content-addressed:
skill bodies/resources are rows in `runtime_config_artifacts` (keyed by SHA), not
files on disk; the manifest pins per session in `runtime_config_session_context`.

**`observability/`** — cross-cutting tracing/metrics; keep it dependency-light.

**The MCP vertical convention** (to add a product MCP tool to feature X)
- Create `domains/X/mcp/{definition, tools, context, auth, calls, mod}.rs`:
  `definition` = identity (id/slug/codes); `tools` = arg structs +
  `MUTATING_TOOL_NAMES` + `build_tool_list`; `context` = `resolve_context`; `auth`
  = capability mint/validate; `calls` = `call_tool` match; `mod` = the
  `ProductMcpServer` impl bridging them.
- Register once in `app/product_mcp.rs`: a **launch-catalog** entry (selector
  closure decides which sessions attach it + a token minter) and an
  **endpoint-registry** entry (slug → handler + mutating list).
- Reuse the **interaction rendezvous** for any mid-call user prompt (elicitation) —
  do not invent a second one.

**Synced config & auth notes**
- Materialize secrets **once** at session create; fail loud (`MissingCredentials`)
  rather than launch with empty secrets. Runtime-config secrets are an ephemeral
  in-memory cache; agent-auth secrets are encrypted at rest.
- `expires_at` (agent-auth) is checked **only at launch** → 409 if expired. There
  is **no proactive refresh and no mid-session re-injection**: a running session
  whose grant expires fails on its next turn until a new session picks up the
  re-pushed revision. The cloud owns rotation; the sandbox is reactive.

---

## The Compression

**AnyHarness is a single-sandbox session engine split by one axis — durable meaning
(`domains/` + `persistence/`) vs the running instance (`live/`) — with edges
(`api`/`app`) on top and leaves (`adapters`/`integrations`) underneath.** The role
chain (`SessionRuntime → … → SessionActor → driver/Sink/Rendezvous`) walks that axis;
the live grammar (manager/handle/actor/driver/sink) governs the concurrency at the
bottom; one event sink owns `seq`/turn/item order (persist-before-broadcast); MCP is
the one vertical cutting through all layers; and two revision-pinned synced bundles
(runtime-config = external MCPs + skills; agent-auth = provider creds) are
snapshotted per session at create and never mutated live. Skills are DB-backed,
MCP-delivered, advisory know-how with progressive disclosure — not filesystem files
and not access control. Direct clients and the Cloud gateway use the same
AnyHarness contracts; the optional Worker only converges catalog/runtime
versions around the running process.
