# Plan And Code Review Agents

Status: authoritative target definition for plan review agents, code review
agents, review MCP behavior, prompts, and UI semantics.

## Purpose

Review agents are structured delegated work. They are created by the review
workflow to inspect a plan or code change, return a pass/fail judgment, and
submit critique through the Reviews product MCP.

Reviews are not general-purpose subagents. A reviewer session has a narrow
role:

```text
inspect
critique
submit a structured result
do not modify files
do not commit or push
do not launch child agents
```

Plan and code review share the same review-run model. They differ only by
target type and setup entrypoint.

## Product Model

```text
ReviewRun
  reviewId
  kind: plan | code
  title
  parentSessionId
  workspaceId
  target
  status
  currentRound
  maxRounds
  assignments
  feedback state
  transcript artifacts

ReviewAssignment
  reviewerId
  title
  persona prompt
  reviewer session reference
  status
  pass/fail result
  summary
  critique artifact reference
  retry state
```

Identity fields:

| Field | Meaning | Normal exposure |
| --- | --- | --- |
| `reviewId` | Stable agent/UI handle for a review run. | Parent tools, UI actions, debug/details |
| `reviewerId` | Stable handle for one reviewer assignment. | UI rows, retry/detail actions |
| `title` | Product display title, such as `Plan Review`. | Tabs, sidebar, popovers, transcript |
| `reviewer title` | Product display title, such as `Architecture Review`. | Reviewer rows |
| `avatarName` | Deterministic friendly display name, such as `Allen`. | UI hover/tooltip only |
| `reviewerSessionId` | Runtime session id for opening the reviewer session. | Internal/open-session routing |

Raw persistence ids may back `reviewId` and `reviewerId`, but the UI and MCP
copy should treat them as product handles, not expose database language.

## MCP Identity

```text
id: reviews
owner: domains/reviews
implementation: anyharness-lib/src/domains/reviews/mcp/**
route slug: reviews
server name: proliferate-reviews
visibility: internal
default injection:
  reviewer sessions receive reviewer tools
  parent sessions with active review state receive parent tools
```

The review MCP is role-sensitive. A reviewer should not see parent tools. A
parent should not see reviewer submission tools.

## Capability And Auth

Every MCP call is authorized against:

```text
workspace_id
session_id
product_mcp_id: reviews
role: reviewer | parent
review_id when known
reviewer_id when known
```

The shared product MCP token envelope belongs in:

```text
anyharness/crates/anyharness-lib/src/integrations/mcp/product_server/**
```

Review-specific scope construction and validation belongs in:

```text
anyharness/crates/anyharness-lib/src/domains/reviews/mcp/auth.rs
```

## Review Creation

Review creation is product workflow/API behavior, not reviewer MCP behavior.

Plan review starts from:

```text
ProposedPlanCard
Plan details / plan picker surfaces
```

Code review starts from:

```text
Changes / diff review surfaces
all-changes review entrypoints
```

Starting a review creates:

```text
ReviewRun
ReviewRound
ReviewAssignment rows
reviewer sessions
reviewer session links
review MCP bindings
```

Reviewer sessions should be launched with the requested harness initial config.
As with subagents, harness-specific options belong in `initialConfig`; review
setup should not require top-level `modelId`/`modeId` concepts in future API
surfaces.

Agent-launched reviews are intentionally separate from reviewer MCP submission.
If parent agents are allowed to start plan/code reviews later, add explicit
parent tools with the same product model instead of overloading reviewer tools.

## Workflow Presentation

Review workflow UI should render review creation and reviewer submission as
named product events rather than raw API/MCP payloads.

Plan review creation:

```text
Plan Review started
3 reviewers - round 1 of 2
Open review
```

Reviewer session creation:

```text
Security Review agent created
Reviewing - Claude
Open reviewer session
```

Reviewer submission:

```text
Security Review requested changes
View critique
```

The visible session links should open reviewer sessions. Normal review copy
should use `reviewId`, `reviewerId`, and reviewer titles; raw session/link ids
belong only in debug/details.

## Reviewer MCP Tools

Reviewer sessions receive exactly one completion tool.

### `submit_review_result`

Submits the final structured review result.

Args:

```json
{
  "pass": false,
  "summary": "The plan is directionally sound but misses migration rollback.",
  "critiqueMarkdown": "## Findings\n\n- Add a rollback step for..."
}
```

Required:

```text
pass
summary
critiqueMarkdown
```

Returns:

```json
{
  "submitted": true,
  "reviewId": "review_abc123",
  "reviewerId": "reviewer_architecture",
  "status": "submitted"
}
```

Submission invariants:

- one reviewer assignment can submit one active result per attempt
- empty summaries or critiques are rejected
- submission writes review state through the review runtime/service
- submission may complete the round and schedule parent feedback
- the reviewer should not need to call any other MCP tool to finish

## Parent MCP Tools

Parent review tools are available only to the parent session that owns an
active review run.

### `get_review_status`

Reads active or recently completed review state for the parent session.

Args:

```json
{
  "reviewId": "review_abc123"
}
```

`reviewId` is optional when there is exactly one active review for the parent.

Returns:

```json
{
  "reviews": [
    {
      "reviewId": "review_abc123",
      "kind": "plan",
      "title": "Plan Review",
      "status": "feedback_ready",
      "round": 1,
      "maxRounds": 2,
      "result": {
        "approved": 2,
        "requestedChanges": 1,
        "failed": 0,
        "pending": 0
      },
      "nextActions": [
        "inspect_review_feedback",
        "mark_review_revision_ready"
      ]
    }
  ]
}
```

This is a workflow status read, not the primary critique reader for UI. UI
critique presentation is owned by review API/UI surfaces.
`nextActions` are workflow hints; they are not necessarily MCP tool names.

### `mark_review_revision_ready`

Signals that the parent has completed a revision and the next review round may
start.

Args:

```json
{
  "reviewId": "review_abc123",
  "revisedPlanId": "plan_123"
}
```

`revisedPlanId` is optional and only valid for plan review flows where the
revision is represented by a new stored plan snapshot.

Returns:

```json
{
  "reviewId": "review_abc123",
  "status": "reviewing",
  "round": 2
}
```

The tool is only listed when the review run can accept a revision-ready signal.

## Status Model

Review run status:

```text
starting
reviewing
feedback_ready
parent_revising
waiting_for_revision
passed
stopped
system_failed
deleted
```

Reviewer assignment status:

```text
queued
reviewing
submitted
passed
changes_requested
failed
retryable_failed
deleted
```

UI may map these to friendlier labels, but the API should keep a stable
machine-readable status set.

## Prompt Contract

Reviewer role instructions are product role prompts. They are not optional
skills, because the review workflow depends on the reviewer using
`submit_review_result`.

Reviewer system prompt:

```text
You are a review-only agent. Inspect and critique the assigned target, but do
not modify files, commit, push, or launch child agents. Your completion signal
is the Reviews MCP submit_review_result tool.
```

Reviewer assignment prompt shape:

```text
Review target: Plan Review
Round: 1 of 2
Reviewer: Architecture Review

Target context:
<plan/code review context>

Reviewer instructions:
<persona-specific instructions>

When done, call submit_review_result with pass, summary, and critiqueMarkdown.
Do not stop with only prose.
```

Parent feedback prompt shape:

```text
Plan Review finished round 1. Result: changes requested.

2 reviewers approved. 1 reviewer requested changes.

Architecture Review: approved
Security Review: requested changes
Summary: Add a migration rollback path before implementation.

Use the review feedback artifact in the transcript before continuing.
```

Prompt rules:

- Review prompts should be short, role-specific, and operational.
- Reviewer prompts may include strict constraints because reviewer sessions are
  product-created role sessions.
- Parent feedback prompts should summarize state and point at durable
  transcript artifacts rather than paste every critique inline.
- Normal prompts should not expose raw assignment/session link ids.
- Plan and code targets should be referenced by durable artifacts or trusted
  snapshots, not by lossy rewritten summaries when exact text matters.

## UI Contract

Review agents appear as delegated work, but review runs are the primary object.
Users act on the review run most of the time, not on individual reviewer
sessions.

Surfaces:

```text
Plan card / Changes surface
  start a plan or code review

Tab strip
  show lightweight delegated-work presence on the parent tab

Composer Agents popover
  show active review runs and reviewer rows

Sidebar/session hierarchy
  parent session -> review run -> reviewer sessions

Transcript
  proposed plan artifacts, review started receipts, review feedback artifacts

Review details
  first-class feedback and critique view
```

Popover model:

```text
Agents

Needs attention
  Plan Review                    Feedback ready      View feedback
    Architecture Review          Approved            Open
    Security Review              Changes requested   View critique

Running
  Code Review                    Reviewing
    Correctness Review           Reviewing           Open
```

Primary review-run actions:

```text
View feedback
Send feedback
Review revision
Finish review
Delete review
```

Reviewer-level actions:

```text
Open reviewer
View critique
Retry reviewer
```

Delete semantics:

- deleting an active review run deletes/closes the delegated review workflow
  and ends active reviewer work after confirmation
- deleting a completed review run removes it from active delegated-work UI
- transcript feedback artifacts remain available according to retention policy
- reviewer sessions are not shown as independent active work once their review
  run is deleted

Naming:

- Review run title is serious product copy, such as `Plan Review`.
- Reviewer title is serious product copy, such as `Architecture Review`.
- Friendly names such as `Allen` are hover-only texture and should not replace
  reviewer titles in serious surfaces.

## Source Ownership

Review runtime/domain:

```text
anyharness/crates/anyharness-lib/src/domains/reviews/
  mod.rs
  model.rs
  service.rs
  service_detail.rs
  runtime.rs
  runtime_artifacts.rs
  runtime_helpers.rs
  store.rs
  store_feedback.rs
  store_iteration.rs
  store_rows.rs
  hooks.rs
  mcp/
    mod.rs
    definition.rs
    auth.rs
    context.rs
    tools.rs
    calls.rs
```

Plan runtime/domain:

```text
anyharness/crates/anyharness-lib/src/domains/plans/
  mod.rs
  model.rs
  document.rs
  runtime.rs
  service.rs
  store.rs

anyharness/crates/anyharness-lib/src/sessions/runtime/plans.rs
anyharness/crates/anyharness-lib/src/acp/event_sink/plans.rs
anyharness/crates/anyharness-lib/src/live/sessions/actor/notifications/plans.rs
```

Shared delegated-session primitives:

```text
anyharness/crates/anyharness-lib/src/sessions/delegation.rs
anyharness/crates/anyharness-lib/src/sessions/subagents/store.rs
anyharness/crates/anyharness-lib/src/domains/sessions/mcp_bindings/**
anyharness/crates/anyharness-lib/src/integrations/mcp/product_server/**
```

HTTP/API/contract:

```text
anyharness/crates/anyharness-lib/src/api/http/reviews.rs
anyharness/crates/anyharness-lib/src/api/http/plans.rs
anyharness/crates/anyharness-contract/src/v1/reviews.rs
anyharness/crates/anyharness-contract/src/v1/plans.rs
anyharness/sdk/src/client/reviews.ts
anyharness/sdk/src/client/plans.ts
anyharness/sdk/src/types/reviews.ts
anyharness/sdk/src/types/plans.ts
anyharness/sdk-react/src/hooks/reviews.ts
anyharness/sdk-react/src/hooks/plans.ts
```

Persistence:

```text
anyharness/crates/anyharness-lib/src/persistence/sql/0023_proposed_plans.sql
anyharness/crates/anyharness-lib/src/persistence/sql/0029_session_links_prompt_provenance.sql
anyharness/crates/anyharness-lib/src/persistence/sql/0034_review_agent_loops.sql
anyharness/crates/anyharness-lib/src/persistence/sql/0035_review_assignments_active_reviewer_index.sql
anyharness/crates/anyharness-lib/src/persistence/sql/0036_review_assignments_retryable_failed.sql
```

Frontend:

```text
apps/desktop/src/components/workspace/reviews/**
apps/desktop/src/components/workspace/chat/transcript/ProposedPlanCard.tsx
apps/desktop/src/components/workspace/chat/plans/**
apps/desktop/src/components/workspace/chat/input/delegated-work/**
apps/desktop/src/components/workspace/shell/tabs/**
apps/desktop/src/hooks/reviews/**
apps/desktop/src/hooks/plans/**
apps/desktop/src/hooks/chat/use-delegated-work-composer.ts
apps/desktop/src/hooks/workspaces/tabs/use-workspace-header-subagent-hierarchy.ts
apps/desktop/src/lib/domain/reviews/**
apps/desktop/src/lib/domain/plans/**
apps/desktop/src/lib/domain/delegated-work/**
apps/desktop/src/lib/access/anyharness/reviews.ts
apps/desktop/src/lib/access/anyharness/plans.ts
apps/desktop/src/stores/reviews/**
```

## Acceptance

Done when:

- reviewer sessions only expose `submit_review_result`
- parent sessions only expose parent review tools when they own active review
  state
- review result submission is the only reviewer completion signal
- reviewer prompts are strict product role prompts
- parent feedback prompts summarize results and point to durable artifacts
- plan review and code review share one review-run model
- review UI treats the review run as the primary object
- reviewer sessions appear under the review run in navigation
- active review deletion has clear lifecycle semantics
- raw runtime/session/link ids are hidden from normal review copy
