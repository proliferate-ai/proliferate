# Product MCP Servers

Status: authoritative for product-owned MCP servers in AnyHarness.

Product MCP servers are AnyHarness-owned tools exposed to agents through MCP.
They let an agent call Proliferate product capabilities such as subagents,
reviews, cowork artifacts, computer use, browser use, or
artifacts.

This document does not cover arbitrary external/user-supplied MCP servers
except where those servers are merged into a session launch.

## Core Model

A product MCP has three parts:

```text
product behavior
  the domain-owned tool semantics: what tools exist and what they do

session attachment
  the session-owned decision of whether this session receives that MCP

protocol serving
  the integration-owned JSON-RPC/MCP transport mechanics
```

Do not collapse these parts.

```text
domains/<domain>/mcp
  What does this product MCP do?

domains/sessions/mcp_bindings
  Which MCP servers should this session launch with?

integrations/mcp
  How does MCP JSON-RPC, tool formatting, and capability-token validation work?
```

The live session actor receives a final concrete MCP server list. It must not
decide which product MCPs are enabled.

## Current And Future Product MCPs

Current internal product MCPs:

```text
domains/sessions/subagents/mcp
domains/reviews/mcp
domains/cowork/mcp
```

Likely future user-selectable product MCPs:

```text
domains/artifacts/mcp
domains/computer_use/mcp
domains/browser/mcp
domains/workspace_tools/mcp
```

Current product MCPs are HTTP MCP endpoints exposed by AnyHarness and injected
into agent sessions as MCP server configs. They are not separate stdio MCP
processes.

## Target Source Shape

Shared MCP protocol kit:

```text
anyharness-lib/src/integrations/mcp/
  capability_token.rs
  json_rpc.rs
  tools.rs
  product_server/
    mod.rs
    definition.rs
    dispatcher.rs
    endpoint.rs
    errors.rs
    request.rs
    response.rs
```

Session MCP binding and launch assembly:

```text
anyharness-lib/src/domains/sessions/mcp_bindings/
  mod.rs
  model.rs
  crypto.rs
  contract.rs
  summaries.rs
  acp.rs
  assembly.rs
  product_catalog.rs
  product_registry.rs
```

Product MCP implementation:

```text
anyharness-lib/src/domains/<domain>/mcp/
  mod.rs
  definition.rs
  auth.rs
  context.rs
  tools.rs
  calls.rs
```

Examples:

```text
domains/reviews/mcp/
domains/sessions/subagents/mcp/
domains/artifacts/mcp/
domains/computer_use/mcp/
domains/browser/mcp/
```

Product MCP code uses `mcp/`.

## Shared Protocol Kit

`integrations/mcp/product_server/**` owns generic MCP serving mechanics.

Allowed:

- parse JSON-RPC requests
- format JSON-RPC responses
- implement `initialize`
- accept `notifications/initialized`
- dispatch `tools/list`
- dispatch `tools/call`
- format MCP tool results and tool errors
- validate shared capability-token envelopes
- provide a reusable HTTP endpoint wrapper

Banned:

- product MCP IDs such as `reviews`, `subagents`, or `computer_use`
- product authorization rules
- session selection policy
- domain service calls
- launch prompt text
- binding summary semantics

The shared kit should be usable by every product MCP. If a feature needs custom
JSON-RPC plumbing, first ask whether the shared dispatcher is missing a generic
MCP behavior.

## Product MCP Definition

Every product MCP must define a static definition.

Required fields:

```text
id
  stable product MCP id, such as "reviews" or "computer_use"

display_name
  user-facing name for summaries/catalogs

description
  concise capability description

owner_domain
  owning product domain path/concept

route_slug
  stable endpoint segment when routed through the generic product MCP endpoint

visibility
  internal or user_selectable

default_injection_policy
  when the MCP is attached without explicit user selection

required_capabilities
  target/runtime capabilities required before launch

binding_summary_kind
  summary type written into session MCP binding summaries

prompt_policy
  whether it contributes system prompt or first-prompt-only text
```

Visibility:

```text
internal
  attached by product workflows or session extensions; usually not directly
  user-toggleable

user_selectable
  shown in local/cloud/team catalogs and selected by user, team, workspace,
  automation, or session policy
```

Default injection policies:

```text
never
  only attach when explicitly selected by policy

when_session_role_matches
  attach for a specific product session role, such as reviewer or subagent

when_product_feature_created_session
  attach for sessions created by a product workflow

when_capability_enabled
  attach if user/team/session policy enables the capability
```

## Product MCP Module Contract

Each `domains/<domain>/mcp/**` folder uses the same file grammar.

```text
definition.rs
  static metadata and injection defaults

auth.rs
  product-specific capability-token scope construction and validation wrapper

context.rs
  workspace/session/product role resolution

tools.rs
  data-shaped MCP tools/list definitions

calls.rs
  tools/call implementation, delegating to domain service/runtime/live handles
```

### `definition.rs`

Owns static metadata only.

It may reference domain-owned constants and copy. It must not query stores,
read runtime state, or build session launch config.

### `auth.rs`

Owns product-specific capability scopes.

Minimum scope:

```text
workspace_id
session_id
product_mcp_id
```

Add fields when the product needs them:

```text
role
parent_session_id
review_run_id
subagent_id
computer_use_allowed
browser_use_allowed
artifact_namespace
```

Runtime bearer auth proves the HTTP caller can access protected AnyHarness
routes. The product MCP capability token proves the MCP call was minted for a
specific workspace/session/product capability.

### `context.rs`

Owns request-time product context resolution.

Input:

```text
workspace_id
session_id
validated capability scope
```

Output:

```text
typed context for tools/list and tools/call
```

Examples:

```text
reviews
  parent session, reviewer session, review run role

subagents
  parent session allowed to manage child sessions

cowork
  cowork thread/session/artifact context

artifacts
  artifact namespace, read/write permissions, target capability availability

computer_use
  session has computer-use permission and sidecar/runtime capability exists

browser
  session has browser-use permission and browser sidecar is available
```

Context resolution belongs in the product domain because it depends on product
state.

Expected but currently unavailable product state should normally resolve to a
typed context that advertises fewer tools rather than failing protocol setup.
Examples: a reviews MCP attached to a session with no current review role, or a
subagents MCP attached to a parent that is now depth/fanout/config blocked.
Use a hard context error for missing rows, cross-workspace tokens, corrupt
state, or a product MCP attached to a fundamentally unsupported surface.

### `tools.rs`

Owns MCP `tools/list` definitions.

Tool definitions must be data-shaped:

```text
name
description
input_schema
availability by context/role
```

Tool definitions should be easy to unit test. Do not hide business logic in
tool-list construction.

### `calls.rs`

Owns MCP `tools/call` behavior.

The call flow is:

```text
parse tool arguments
validate context and role
call product domain service/runtime/live capability
return structured MCP result
```

Tool calls should delegate to product services/runtimes. The MCP server must
not become a second implementation of the product feature.

## Product MCP Trait

Rust should use traits and typed structs, not inheritance or feature-local
dispatchers copied by hand.

Target shape:

```rust
pub trait ProductMcpServer {
    type Context;

    fn definition(&self) -> ProductMcpDefinition;

    fn resolve_context(
        &self,
        request: ProductMcpRequestContext,
    ) -> anyhow::Result<Self::Context>;

    fn tools(&self, ctx: &Self::Context) -> Vec<McpToolDefinition>;

    async fn call_tool(
        &self,
        ctx: Self::Context,
        name: &str,
        arguments: serde_json::Value,
    ) -> anyhow::Result<McpToolResult>;
}
```

Shared code handles JSON-RPC. Product code handles product meaning.

## Session MCP Binding Modules

`domains/sessions/mcp_bindings/**` owns the central session MCP launch
boundary.

File responsibilities:

```text
model.rs
  SessionMcpServer, session binding models, selection records, launch output

crypto.rs
  external/user MCP binding encryption and decryption

contract.rs
  contract <-> domain mapping for user MCP binding APIs

summaries.rs
  binding summary validation, serialization, and merge rules

acp.rs
  SessionMcpServer -> ACP MCP server config conversion

assembly.rs
  one launch boundary that produces final MCP servers and prompt additions

product_catalog.rs
  launch-side facade: select and materialize product MCP launch extras for this session

product_registry.rs
  code-defined product MCP definitions and server lookup
```

`assembly.rs` answers one question:

```text
Which MCP servers, prompt additions, and binding summaries should this session
launch with?
```

It owns:

- applying `InternalOnly` vs user-inherited binding policy
- decrypting external/user MCP bindings
- collecting product MCPs selected by policy
- merging external/user MCP servers and product MCP servers in launch order
- minting product MCP capability headers
- producing binding summaries
- producing system prompt append text
- producing first-prompt-only prompt append text
- returning restart-required/missing-data-key errors when persisted bindings
  cannot be used

It does not own:

- JSON-RPC parsing or response formatting
- product tool behavior
- product context resolution
- live MCP elicitation resolution
- actor startup policy

## Product MCP Registry

`product_registry.rs` is the session-facing registry of product MCPs available
to assembly and endpoints.

It should provide:

```text
lookup by product_mcp_id
list definitions for UI/catalog/summaries
server dispatch target for generic MCP endpoint
injection metadata for session launch
```

It may be constructed by app composition when concrete servers need runtime
dependencies. The session MCP assembly still owns selection and injection; app
composition only wires available implementations.

Do not make each product route manually rediscover its own MCP server. All
product MCP endpoint dispatch should use the same registry shape.

## Selection Policy

Selection happens before actor startup.

Inputs:

```text
workspace_id
session_id
session kind / role
session launch source
agent kind
external/user MCP binding policy
explicit session MCP selections
workspace/team/org MCP selections, when available
runtime capability availability
product session extension outputs
```

Outputs:

```text
selected product MCP ids
external/user MCP bindings to include
binding summaries
system prompt append
first-prompt-only prompt append
final SessionMcpServer list
```

Internal examples:

```text
review session
  receives reviews MCP with reviewer/parent scope

parent session with subagent support
  receives subagents MCP with parent-session scope

cowork session
  receives artifacts MCP with cowork thread/artifact scope
```

User-selectable examples:

```text
computer_use enabled for session
  receives computer_use MCP if target reports computer capability

browser_use enabled for workspace
  receives browser MCP if target reports browser capability

artifact tools enabled for team automation
  receives artifacts MCP with org/team/workspace/session scope
```

The live actor only receives the final launch payload. It must not evaluate
selection policy.

## Injection Shape

Product MCP injection produces a normal MCP server config.

For local AnyHarness:

```text
server name: product MCP id or stable display name
transport: HTTP MCP
url: /v1/workspaces/{workspace_id}/sessions/{session_id}/mcp/{product_mcp_id}
headers:
  authorization: Bearer <runtime token>          # when runtime auth is enabled
  x-anyharness-product-mcp-token: <capability token>
```

The capability token is minted at launch and scoped to the selected product
MCP. It is not durable user config.

The binding summary should make attached product MCPs visible without exposing
secret headers.

## Endpoint Flow

Preferred generic endpoint:

```text
/v1/workspaces/{workspace_id}/sessions/{session_id}/mcp/{product_mcp_id}
```

Compatibility aliases:

```text
/v1/workspaces/{workspace_id}/sessions/{session_id}/reviews/mcp
/v1/workspaces/{workspace_id}/sessions/{session_id}/subagents/mcp
```

POST flow:

```text
agent MCP client
  -> AnyHarness product MCP endpoint
  -> API validates runtime bearer token when configured
  -> shared endpoint validates product MCP capability token
  -> product registry resolves product MCP server
  -> shared MCP dispatcher parses JSON-RPC
  -> product MCP resolves context
  -> product MCP lists/calls tools
  -> product domain service/runtime/live capability performs behavior
  -> shared dispatcher formats JSON-RPC result
  -> agent receives MCP result
  -> agent emits normal ACP tool call/result notifications
  -> SessionEventSink persists and broadcasts transcript events
```

GET returns `204 No Content` for endpoint liveness.

## Event And Transcript Behavior

Most product MCP calls should not write transcript events directly.

Normal transcript flow:

```text
agent calls product MCP tool
product MCP endpoint returns result
agent emits ACP tool call/result notification
SessionActor receives notification
SessionEventSink persists/broadcasts normalized event
```

If a product MCP changes durable product state independently, the owning domain
may also expose normal API/UI refresh state. That does not belong in
`integrations/mcp`.

## Internal vs User-Selectable

Internal product MCPs:

```text
subagents
reviews
```

Properties:

- injected by product workflow/session role
- usually not shown as a user toggle
- may appear in binding summaries for transparency
- role/context depends on session relationship

User-selectable product MCPs:

```text
artifacts
computer_use
browser_use
workspace_tools
```

Properties:

- shown in local/cloud/team catalogs
- explicitly enabled by user, workspace, team, automation, or session policy
- require permission warnings
- may depend on compute capability availability
- use the same product MCP server pattern as internal MCPs

Only selection and UI policy differ. The protocol, endpoint, auth, context,
tools, and calls shape is the same.

## Storage

Code-defined internal product MCPs:

```text
definition lives in code
selection is derived from session/product role
tokens are minted at launch
no user config is required
```

User-selectable product MCPs:

```text
definition lives in code
selection records are durable product config
local/session selection first
workspace/team/org selection later
resolved at launch into SessionMcpServer configs
```

External/user MCP server configs:

```text
stored as encrypted session/workspace/team MCP bindings
decrypted during session MCP assembly
merged with product MCP servers before launch
```

Secrets:

```text
capability signing secrets live under runtime_home
tokens are minted per workspace/session/product MCP
tokens are injected into MCP headers
tokens are not durable user config
```

## Cloud And Worker Compatibility

The local structure must support future cloud/worker routing.

Local AnyHarness:

```text
session launch injects direct local AnyHarness URL and headers
agent calls local HTTP MCP endpoint
```

Cloud/worker:

```text
cloud stores team/org/session MCP selection policy
worker resolves policy for target compute
worker launches AnyHarness session with product MCP headers/URLs
product MCP endpoint is local to the worker/runtime or proxied near it
cloud receives normal session event sync after agent emits ACP events
```

Capability token scope may expand:

```text
org_id
team_id
workspace_id
session_id
product_mcp_id
role/capability
```

The same product MCP definition and call semantics should work locally and in
cloud. Routing changes; product behavior should not fork.

## Adding A New Product MCP

Concrete definitions for the MCPs currently being standardized live under
[definitions/](definitions/). Add or update that definition before
implementing code.

Required steps:

```text
1. Choose owning domain.
2. Add domains/<domain>/mcp/definition.rs.
3. Add domains/<domain>/mcp/auth.rs.
4. Add domains/<domain>/mcp/context.rs.
5. Add domains/<domain>/mcp/tools.rs.
6. Add domains/<domain>/mcp/calls.rs.
7. Register the product MCP in domains/sessions/mcp_bindings/product_registry.rs.
8. Add selection predicate and HTTP materialization in
   domains/sessions/mcp_bindings/product_catalog.rs.
9. Add endpoint routing through the generic product MCP endpoint.
10. Add UI exposure decision: internal-only or user-selectable.
11. Add tests for definition, auth, context, tools/list, tools/call, selection,
    injection, and endpoint dispatch.
```

Do not ship a product MCP until it can answer:

```text
who owns it?
who may call it?
when is it injected?
what durable state does it read/write?
what live capabilities can it touch?
what appears in transcript through normal ACP events?
what appears in UI outside transcript?
```

## Tests

Each product MCP needs focused tests:

```text
definition validates required metadata
selection attaches it for intended session roles/policies
selection does not attach it for unrelated sessions
capability token rejects wrong workspace/session/product MCP
tools/list varies correctly by context/role
tools/call validates arguments
tools/call delegates to owning domain service/runtime
endpoint returns valid JSON-RPC errors for unknown method/tool
launch injection adds safe headers and binding summary
```

Shared integration tests should cover:

```text
generic endpoint dispatch by product_mcp_id
shared initialize/tools/list/tools/call behavior
binding summary merge order
external/user MCP + product MCP merge order
actor receives final concrete MCP config only
```

## Banned Shapes

Do not add:

```text
integrations/mcp/reviews.rs
integrations/mcp/computer_use.rs
integrations/mcp/product_logic.rs
domains/<domain>/mcp/utils.rs
api/http/<domain>.rs with embedded tools/call business logic
live/sessions/actor code that decides which MCPs to attach
feature-local JSON-RPC dispatcher copies
durable product state changes inside integrations/mcp
```

Use:

```text
integrations/mcp/product_server
  shared protocol mechanics

domains/sessions/mcp_bindings
  attachment, selection, summaries, injection

domains/<domain>/mcp
  product behavior
```

## Acceptance

The product MCP structure is complete when:

- shared JSON-RPC/product-server scaffolding lives in
  `integrations/mcp/product_server/**`.
- product MCP behavior lives in `domains/<domain>/mcp/**`, not
  feature-local protocol copies.
- session launch uses one assembly boundary under
  `domains/sessions/mcp_bindings/assembly.rs`.
- product MCP selection and injection/token/header construction live under
  `domains/sessions/mcp_bindings/product_catalog.rs` plus product auth wrappers.
- the actor receives final concrete MCP server configs and has no product MCP
  policy branches.
- endpoint routing dispatches by product MCP id through one shared path.
- tests prove selection, injection, auth, tools/list, and tools/call behavior
  for every product MCP.
