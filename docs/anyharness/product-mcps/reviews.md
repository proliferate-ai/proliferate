# Reviews MCP

Status: authoritative target definition for the Reviews product MCP.

## Identity

```text
id: reviews
owner domain: domains/reviews
implementation: domains/reviews/mcp/**
visibility: internal
route slug: reviews
server name: proliferate-reviews
default injection: attach to review-created reviewer sessions and to parent
  sessions that have active review state
```

This MCP lets review agents submit structured review results and lets parent
sessions inspect/re-signal review status where the review workflow allows it.

## Auth

Current auth shape:

```text
header: x-review-session-token
secret file: review-mcp-token.key
ttl: 12 hours
scope: workspace_id + session_id
signature: HMAC SHA-256
```

Target scope should include the resolved review role when possible:

```text
workspace_id
session_id
product_mcp_id: reviews
role: reviewer | parent
review_run_id when known
```

The bearer token protects the AnyHarness route. The product MCP token proves
the MCP call was minted for this review/session capability.

## Selection And Injection

Attach when:

- the session is a reviewer session assigned to a review run
- the session is a parent session with active review state and allowed parent
  tools

Do not attach when:

- there is no active review role for the session
- the session/workspace does not match the review run
- the review workflow does not allow MCP-signaled revision readiness

Injection output:

```text
url: /v1/workspaces/{workspace_id}/sessions/{session_id}/mcp/reviews
headers:
  authorization: Bearer <runtime token> when runtime auth is enabled
  x-anyharness-product-mcp-token or x-review-session-token: scoped token
binding summary: review tools attached with role
prompt text: reviewer sessions must submit a final review result through the
  MCP; parent sessions may inspect review status
```

## Context

`context.rs` resolves `ReviewMcpRole`:

```text
Reviewer
  session is assigned as reviewer for a review run

Parent { can_signal_revision }
  session owns an active parent review run

None
  no review tools should be exposed
```

Context depends on review store/runtime state and workspace/session matching.
It belongs in the reviews domain.

## Tools

Reviewer tools:

```text
submit_review_result
  pass: boolean
  summary: string
  critiqueMarkdown: string
```

Parent tools:

```text
get_review_status
  returns active review status for the parent session

mark_review_revision_ready
  available only when the review run can accept manual revision-ready signals
```

Tool list must be role-sensitive. A reviewer should not see parent tools, and
a parent should not see `submit_review_result`.

## Calls

`calls.rs` delegates to `ReviewRuntime` and review services.

Required call invariants:

- reviewer submission must complete through `submit_review_result`
- parent status reads use review service/store state
- revision-ready signal validates run ownership and current review state
- review MCP does not create sessions, dispatch prompts, or write transcript
  events directly

## UI Exposure

Internal only.

Review UI/API owns:

- review run status
- pass/fail result
- critique presentation
- revision loop state

MCP binding summaries may show that review tools were attached and which role
was selected.

## Tests

Required tests:

- reviewer context exposes only `submit_review_result`
- parent context exposes `get_review_status`
- `mark_review_revision_ready` appears only when allowed
- no-role context exposes no tools and rejects calls
- token rejects wrong workspace/session/review scope
- review result submission delegates to `ReviewRuntime`
- endpoint returns JSON-RPC unknown-tool errors by role

## Migration Acceptance

Done when:

- `domains/reviews/mcp_server/**` is replaced by `domains/reviews/mcp/**`.
- role resolution lives in `context.rs`.
- tool definitions live in `tools.rs`.
- review tool calls delegate to `ReviewRuntime` from `calls.rs`.
- shared JSON-RPC dispatch lives in `integrations/mcp/product_server`.
- session selection/injection for review roles lives in
  `domains/sessions/mcp_bindings/**`.
