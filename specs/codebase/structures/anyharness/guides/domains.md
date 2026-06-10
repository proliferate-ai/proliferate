# AnyHarness Domains

Status: authoritative for durable/product code under `anyharness-lib/src/domains/**`.

Read [mental-model.md](mental-model.md) first: it owns the eight jobs, the
use-case pipeline, the mapping/error doctrines, and the placement algorithm
this guide applies to domains.

Product domains live under `domains/**`. Core session, workspace, agent, and
repo-root domains use the same root as product surfaces, with dependency
direction enforced by domain tier.

Current session-domain reality:

- user MCP bindings and session MCP launch assembly live under
  `domains/sessions/mcp_bindings/**`.
- session persistence is split under `domains/sessions/store/**`.
- session runtime orchestration is split under `domains/sessions/runtime/**`.

## Purpose

Domains own product concepts and durable truth.

They answer questions like:

- What is a session?
- Where does execution happen?
- Which agents are supported and ready?
- What durable events and config are recorded?
- What does a cowork thread, review run, plan, or mobility transfer own?

Domains should be readable without knowing HTTP routing or live actor internals.

## Domain Tiers

Not every domain has the same role. Use the tier to decide dependency direction
and internal shape.

### Core Primitive Domains

```text
sessions
workspaces
agents
repo_roots
```

These are foundational runtime concepts. Other product domains may depend on
them. They should not depend on product surfaces such as cowork or reviews.

Core primitive domains may define extension traits when product surfaces need
to participate in a core lifecycle. `app/` wires implementations into the core.

Expected shape:

```text
<core-domain>/
  model.rs
  store/          # promoted when there is more than one table/query family
  service/        # durable rules, split by use case when it grows
  runtime/        # only for cross-domain/live orchestration
  <subdomain>/    # promoted concern with its own lifecycle or model/store/service
```

Examples:

```text
sessions/
  model.rs
  runtime_event.rs
  extensions.rs
  store/
  service/
  runtime/
  prompt/
  live_config/
  mcp_bindings/
  links/
  subagents/
  workspace_naming/

workspaces/
  model.rs
  store/
  service/
  runtime/
  materialization/
  purge/
  retention/
```

### Product Surface Domains

```text
artifacts
cowork
reviews
plans
mobility
```

These are product workflows built on core primitives. They may depend on core
domains. They should not be imported by core domains directly.

### Runtime Infrastructure Domains

```text
plugins
runtime_config
```

These own runtime infrastructure that sits between core domains and product
surfaces. `plugins` expands cloud-configured MCP plugins and skills into
session-ready MCP server definitions and skill rendering. `runtime_config`
owns the applied MCP/skill/plugin config revision for a session: manifest
storage, credential values, and the session context handed to session launch.
These are not product surface domains and should not own product tool behavior.

Expected shape:

```text
<product-domain>/
  model.rs        # durable product records and domain-owned types
  store/          # product-specific queries
  service/        # durable product rules
  runtime/        # only if it coordinates cross-domain or live work
  mcp/            # when the product exposes MCP tools
  session_extension.rs  # when the product plugs into session launch/prompt
```

Product domains should use extension points instead of forking core session
behavior. For example, reviews can inject review-specific MCP tools through a
session extension; it should not duplicate session launch logic.

### Session-Owned Product Subdomains

Some product features are session-scoped and should live under `sessions/`
rather than becoming top-level domains.

Examples:

```text
domains/sessions/subagents/
domains/sessions/workspace_naming/
domains/sessions/links/
```

Use this shape when the concept has durable state or tool behavior, but its
identity is subordinate to a session.

## Canonical Files

Default domain files:

```text
model.rs
store.rs or store/
service.rs or service/
runtime.rs or runtime/
```

Use:

- `model.rs` for durable records and domain-owned types.
- `store.rs` / `store/` for SQL only.
- `service.rs` / `service/` for durable rules over stores and domain models.
- `runtime.rs` / `runtime/` for high-level use cases that coordinate multiple
  services or bridge durable state to live execution.

Do not add broad `helpers.rs`, `utils.rs`, or `misc.rs`. Name the concept:
`prompt`, `events`, `retention`, `materialization`, `mcp_bindings`,
`extensions`, `catalog`, `readiness`.

## The Root Is A Table Of Contents

A domain's root may contain only the canonical files above plus named concern
folders. Every other file lives inside the concern it serves; each concern
folder repeats the identical internal grammar (exports-only `mod.rs`,
`service.rs`, policy, helpers — each earned, not mandatory).

If a file cannot say which concern it belongs to, that is an unnamed concern —
name it. A root holds roughly 5–9 entries. Shrink a table of contents by
naming concerns, never by merging files. The rule applies recursively: a
concern folder (or a `runtime/` folder) that accumulates 10+ files is several
concerns wearing one name.

Single-concern domains stay flat (`repo_roots`, `mobility`). The trigger for
folders is a root crossing ~8 files or containing two nameable concerns.

Migration exception: `domains/workspaces` currently has ~25 root files
(gates, worktrees, lifecycle, setup, and files concerns all flattened) and two
parallel entry surfaces (`WorkspaceService`, `WorkspaceRuntime`) with
duplicated bodies. Target: concern folders (`access/`, `lifecycle/`,
`worktrees/`, `setup/`, `files/`) behind one entry surface.

## Store vs Service vs Runtime

Stores:

- read/write domain rows
- construct SQL
- return domain records
- do not perform product workflows
- do not call live runtime systems

Services:

- enforce durable rules
- validate domain invariants
- coordinate domain stores
- may call adjacent domain stores when needed for durable validation
- do not start live actors or subprocesses

Runtimes:

- run high-level use cases
- coordinate multiple services
- bridge durable state to live state
- call `live/**` managers and handles
- own ordering when the workflow depends on live execution

For sessions:

```text
SessionStore   = SQL access for session rows/events/config/pending prompts
SessionService = durable session rules
SessionRuntime = session workflows that may start/prompt/resume live sessions
```

## Use-Case Shape

Complex use cases — service or runtime — follow one pipeline (see
[mental-model.md](mental-model.md) for the full law):

```text
preconditions -> idempotency -> pre-flight repairs -> resolve -> decide -> execute/record
```

The grammar per use case is a pair of files:

```text
service/create.rs          # the pipeline fn, resolve_create_context(), the
                           # private Context struct, the effects fn
service/create_policy.rs   # pure rules: (Context, Input) -> Plan
```

Rules:

- The **Context** (all fetched truths, one per line) is private to the
  use-case file. It is never exported, stored, or shared between use cases.
- **Policy files are pure**: no `&self`, no IO, no `Utc::now()`, no
  `Uuid::new_v4()`. Identity and clock are effects, minted in the
  execute/record step. Policy may read static bundled truth; dynamic truth
  arrives via the Context.
- A rule shared by several use cases graduates to one named domain-level home
  (the access gate pattern). The same rule decided in two places is the
  highest-priority smell.
- Inputs with more than 3 fields become one input struct in `model.rs`,
  replacing positional relays through service/runtime layers.
- Below the thresholds, everything collapses inline: one fetch is a `let`, one
  rule is an `if`. Ceremony is earned.

In-repo exemplar: `domains/artifacts` (typed `ArtifactCreatePlan` /
`ArtifactUpdatePlan` produced by plan functions, effects owned by the runtime).

## Growth Rules

The most common failure mode is letting a domain grow by appending methods to a
single `store.rs`, `service.rs`, or `runtime.rs`. Split by responsibility before
the file becomes a god module.

### Store Growth

Promote `store.rs` to `store/` when there is more than one table family or
query family.

```text
store/
  mod.rs
  sessions.rs
  events.rs
  raw_notifications.rs
  live_config.rs
  pending_prompts.rs
  background_work.rs
```

Store files split by durable data family, not by API route.

### Service Growth

Promote `service.rs` to `service/` when durable rules separate into named use
cases.

```text
service/
  mod.rs
  create.rs
  config.rs
  list.rs
  title.rs
  summaries.rs
```

Service files split by durable rule family. They do not hide live orchestration.

### Runtime Growth

Promote `runtime.rs` to `runtime/` when workflows bridge multiple services or
live systems.

```text
runtime/
  mod.rs
  create.rs
  prompt.rs
  resume.rs
  fork.rs
  interactions.rs
  pending_prompts.rs
```

Runtime files split by workflow family. If a workflow is actually actor state,
stream state, or pending callback state, it belongs in `live/**`, not a domain
runtime.

### Concept Promotion

Promote a named concern into its own folder when it has any of:

- its own durable model/store/service set
- its own lifecycle or background reconciliation
- its own MCP server or session extension
- repeated files with a stable concept name
- tests that naturally group around that concern

Examples:

```text
domains/sessions/links/
domains/sessions/subagents/
domains/sessions/workspace_naming/
domains/workspaces/materialization/
domains/workspaces/retention/
domains/workspaces/purge/
```

## Extension Points

Core domains may define extension traits when product surfaces need lifecycle
hooks.

Example:

```text
domains/sessions/extensions/
  SessionExtension
```

Product surfaces implement the trait:

```text
domains/cowork/session_extension.rs
domains/reviews/session_extension.rs
domains/sessions/subagents/session_extension.rs
domains/sessions/workspace_naming/session_extension.rs
```

`app/` wires implementations into the core. The core domain depends only on the
trait.

## MCP Placement

MCP crosses several owners. Do not put all MCP code in one folder.

Domain-owned MCP code is product behavior:

```text
domains/<feature>/mcp/
  definition.rs
  auth.rs
  context.rs
  tools.rs
  calls.rs
  mod.rs
```

Use this shape when the MCP tools are part of the domain's product behavior.

File roles:

```text
definition.rs
  stable id, route slug, ACP server name, display name, instructions,
  prompt policy, and binding summary metadata

auth.rs
  thin feature wrapper around shared product MCP auth/token mechanics

context.rs
  resolve workspace/session/domain records and validate that this tool call
  applies to the current product context

tools.rs
  tool schemas and mutating tool name list

calls.rs
  actual product tool implementations

mod.rs
  product MCP server struct and ProductMcpServer implementation
```

Examples:

```text
domains/cowork/mcp/
domains/reviews/mcp/
domains/plugins/mcp/
domains/sessions/subagents/mcp/
domains/sessions/workspace_naming/mcp/
```

Generic MCP protocol/server mechanics do not belong in domains:

```text
integrations/mcp/product_server/
integrations/mcp/json_rpc.rs
integrations/mcp/tools.rs
integrations/mcp/capability_token.rs
```

Session launch assembly does not belong in product domains either:

```text
domains/sessions/mcp_bindings/assembly.rs
domains/sessions/mcp_bindings/product_catalog.rs
domains/sessions/mcp_bindings/product_registry.rs
```

The distinctions:

```text
domains/<feature>/mcp
  what this product MCP does

integrations/mcp/product_server
  how every product MCP speaks MCP/JSON-RPC consistently

domains/sessions/mcp_bindings/product_registry.rs
  serving-side registry: incoming route slug -> product MCP handler

domains/sessions/mcp_bindings/product_catalog.rs
  launch-side facade: select and materialize product MCP launch extras for this session

domains/sessions/mcp_bindings/assembly.rs
  whole-session composer: user MCPs + product MCPs + session extensions +
  prompt extras + summaries

api/http/product_mcp.rs
  incoming HTTP endpoint wrapper

app/
  product MCP endpoint registration
```

Add a new product MCP by touching the product and composition points, not by
forking transport or protocol machinery:

```text
1. Add domains/<feature>/mcp/{definition,auth,context,tools,calls}.rs.
2. Implement ProductMcpServer in domains/<feature>/mcp/mod.rs.
3. Register the server in app's ProductMcpEndpointRegistry wiring.
4. Add selection predicate and HTTP materialization in
   domains/sessions/mcp_bindings/product_catalog.rs.
5. Add tests for auth, selection, injection, tools/list, tools/call, and
   endpoint dispatch.
```

## Contract Types

Do not import contract request/response types into domains. Use internal
domain models and API mappers. Domain models are the lingua franca between
domains: cross-domain composition passes domain models as-is and never
translates them.

Exception: session event payloads may use contract event types when those types
are the durable event-log payload. The exception is for event payloads only —
contract types as a domain's working model or as persisted rows are
violations.

Migration exceptions (the rule is the law; this is the debt):
`domains/runtime_config` persists contract types as rows and uses them as its
model; `domains/agents/auth` uses contract auth structs end-to-end;
`domains/sessions/runtime/contract.rs` builds contract responses inside the
domain via a fetching mapper. Targets: domain twins minted at the API seam and
a runtime-composed view model with a dep-less mapper.

## Errors

One error enum per public surface (thiserror). Each layer adds only the
variants it introduces and absorbs lower errors with `#[from]` /
`#[error(transparent)]`. Banned: twin enums joined by hand-written
variant-copying mappers; `.to_string()` / `anyhow::anyhow!` applied to typed
errors; control flow on `message.contains(...)`. Expected outcomes
(not-found, needs-selection, already-done) are data in the `Ok` type, not
error strings. The HTTP mapping for a domain's errors lives in exactly one
`api/http/<resource>_errors.rs` `From` impl.
