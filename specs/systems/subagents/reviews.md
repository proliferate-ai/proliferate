# Plan And Code Review Agents

Status: authoritative definition of the review role contracts (reviewer and parent), status models, and prompt shapes. Review UI semantics live in [../../../../systems/product/agents/delegated-work.md](delegated-work.md); MCP token/role plumbing lives in [../servers.md](product-mcp-servers.md).

## Identity And Exposure

| Field | Meaning | Normal exposure |
| --- | --- | --- |
| `reviewId` | Stable handle for one review run. | MCP args/responses, UI data model |
| `reviewerId` | Stable handle for one reviewer assignment. | MCP responses, UI data model |
| `reviewerSessionId` | Runtime session id for the reviewer session. | Internal/debug/open-session routing only |

Raw persistence ids may back `reviewId` and `reviewerId`, but the UI and MCP copy never present them as session ids.

## Reviewer Role Contract

Reviews are not general-purpose subagents. A reviewer session has a narrow role:

```text
inspect
critique
submit a structured result
do not modify files
do not commit or push
do not launch child agents
```

Plan and code review share the same review-run model; they differ only by target type and setup entrypoint.

Reviewer sessions receive exactly one completion tool: `submit_review_result`, requiring `pass`, `summary`, and `critiqueMarkdown`. Submission invariants:

- one reviewer assignment can submit one active result per attempt
- empty summaries or critiques are rejected
- submission writes review state through the review runtime/service
- submission may complete the round and schedule parent feedback
- the reviewer should not need to call any other MCP tool to finish

A review run is bounded by `maxRounds`; each round holds one assignment per reviewer, and a reviewer submits one active result per attempt (retries create a new attempt).

## Parent Role Contract

Parent sessions that own an active review run receive two tools:

- `get_review_status` — workflow status read (`reviewId` optional); this is
  not the UI critique reader.
- `mark_review_revision_ready` — listed only when the review run can accept a
  revision.

Parent review tools are available only to the parent session that owns an active review run.

Agent-launched reviews are intentionally separate from reviewer MCP submission. If parent agents are allowed to start plan/code reviews later, add explicit parent tools with the same product model instead of overloading reviewer tools.

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

UI may map these to friendlier labels, but the API should keep a stable machine-readable status set.

## Prompt Shapes

Reviewer role instructions are product role prompts, not optional skills, because the review workflow depends on the reviewer using `submit_review_result`.

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
