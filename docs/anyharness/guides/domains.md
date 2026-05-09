# AnyHarness Domains

Status: authoritative for durable/product code under `anyharness-lib/src/domains/**`.

The current code is transitional. Product domains such as `agents`, `cowork`,
`reviews`, `plans`, and `mobility` live under `domains/**`. Core session,
workspace, repo-root, and terminal paths still use top-level transitional
folders until the final topology rename.

Current session-domain reality:

- user MCP bindings and session MCP launch assembly live under
  `sessions/mcp_bindings/**`.
- session persistence is split under `sessions/store/**`.
- session runtime orchestration is split under `sessions/runtime/**`, while the
  final `domains/sessions/**` topology remains deferred.

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
  store/
  service/
  runtime/
  prompt/
  events/
  mcp_bindings/
  extensions/
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
cowork
reviews
plans
mobility
```

These are product workflows built on core primitives. They may depend on core
domains. They should not be imported by core domains directly.

Expected shape:

```text
<product-domain>/
  model.rs        # durable product records and domain-owned types
  store/          # product-specific queries
  service/        # durable product rules
  runtime/        # only if it coordinates cross-domain or live work
  mcp_server/     # when the product exposes MCP tools
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
sessions/subagents/
sessions/workspace_naming/
sessions/links/
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
sessions/links/
sessions/subagents/
sessions/workspace_naming/
workspaces/materialization/
workspaces/retention/
workspaces/purge/
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

Current implementations are still transitional in places:
`domains/cowork/runtime.rs`, `domains/reviews/hooks.rs`,
`sessions/subagents/hooks.rs`, and `sessions/workspace_naming/hooks.rs`.

`app/` wires implementations into the core. The core domain depends only on the
trait.

## Contract Types

Avoid importing contract request/response types into domains. Use internal
domain models and API mappers.

Exception: session event payloads may use contract event types when those types
are the durable event-log payload.
