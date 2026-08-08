# Product Prompt And Skill Policy

Status: authoritative target policy for product-owned prompts, product skills,
and MCP-related agent guidance.

## Purpose

Product MCPs and product workflows often need to teach or constrain agents.
Those instructions must be delivered through the right channel:

```text
base system prompt
  platform invariants only

product role prompt
  strict instructions for product-created role sessions

product skill
  optional workflow guidance the agent can activate when needed

user/agent prompt
  authored work request, preserved exactly after validation

wake/notification prompt
  short operational reminder with the next actionable handle/tool

transcript artifact
  durable product context, not hidden instruction text
```

Do not put product workflow tutorials into the base parent system prompt. When
an agent needs best practices for a product capability, expose a skill.

## Channel Rules

### Base System Prompt

Use for:

- platform identity
- safety and repository rules
- global tool-use invariants
- global response-formatting invariants (file references as markdown links with
  the complete workspace-root path, never abbreviated;
  owned by `domains/sessions/response_formatting.rs`, injected for every
  session in `domains/sessions/mcp_bindings/assembly.rs` on both the
  `systemPrompt.append` meta channel and the first-prompt channel so Codex,
  which ignores session meta, still receives it)
- session role invariants that apply to every session of that launch

Do not use for:

- subagent workflow tutorials
- review workflow tutorials for normal parent sessions
- long MCP tool guides
- optional feature instructions

### Product Role Prompt

Use when the product creates a session for a strict role.

Examples:

```text
review-only reviewer sessions
managed cowork role sessions
future evaluator-only sessions
```

Role prompts may include hard constraints because the product workflow depends
on them. For example, a reviewer session must be told not to modify files and
must be told to submit through `submit_review_result`.

### Product Skill

Use for workflow best practices that an agent should opt into when relevant.

Required product skills:

```text
proliferate.subagents.workflow
  how to delegate bounded work, use wakeOnCompletion, read results, and close
  subagents
```

Potential future product skills:

```text
proliferate.reviews.workflow
  how a parent agent should reason about active review status if parent-agent
  review management becomes a first-class capability

proliferate.cowork.workflow
  how to delegate into managed workspaces once cowork tool calls are exposed
  with the same lifecycle handles
```

Reviewer agents should not need a skill to know how to finish. Their completion
contract is part of their product role prompt and MCP tool list.

### User And Agent Prompts

Prompt text sent by a human or parent agent is authored content. Preserve it.

Validation rule:

```text
reject if prompt.trim().is_empty()
send the original prompt string if valid
```

Do not silently trim, rewrap, prepend hidden instructions, or append hidden
instructions to parent-to-child prompts.

Provenance should be metadata, not prompt text. UI can display that a prompt was
sent by a parent agent or product workflow without changing what the child
session receives.

#### Peer Agent Messages

The metadata-only rule above was written for delegation, where the child
already knows it was created by a parent and has the handles to answer it.
Agent-to-agent messaging between peers has no such standing context: the
receiver may be any session in the runtime, with no link to the sender.

So a peer message is delivered inside a visible envelope:

```text
Message from agent "Deploy Checker" (session ses_abc123):

<authored body, byte-for-byte verbatim>

To reply, use send_agent_message with sessionId "ses_abc123".
```

Rules:

- the authored body stays verbatim inside the envelope — the envelope adds
  identity and a reply handle, never edits or summarizes the message
- the envelope is built once, at send time, in the sessions domain — never by
  the receiving actor, and never by two call sites that could disagree
- one canonical text: what the harness receives is exactly what the transcript
  stores. Storing a clean body and sending an envelope (or the reverse) is
  forbidden — the transcript must stay an honest record of what the agent read
- provenance metadata is still written beside the prompt, and that is what the
  UI renders from. The client never parses the envelope text
- this is the only case where a raw session id belongs in prompt text: it is
  the handle the receiver must call back with
- a peer send clears the same session-mutation admission fence as a human
  prompt: it acquires the target session's `Prompt` permit with the external
  source before dispatching, so a session a workflow run controls refuses a
  peer message exactly as it refuses one from the HTTP prompt route

Owner: `anyharness/crates/anyharness-lib/src/domains/sessions/prompt/envelope.rs`.

### Wake And Notification Prompts

Wake prompts are operational. They should tell the watcher what happened and
which tool/handle to use next.

There are two wake scopes, and they follow the same law. A LINK-scoped wake is
armed on a `session_links` row, so it only ever wakes a parent about its own
child. A SESSION-scoped wake is armed on a session pair
(`session_wake_schedules`) and can be armed on any session in the runtime — by
an agent (`schedule_agent_wake`, or `wakeOnReply` on `send_agent_message`) or by
the human (`POST /v1/sessions/{id}/wakes/{target_id}`, which writes the same
row). How the schedule was armed never changes what fires.

Session-scoped agent wake prompt:

```text
Agent "Deploy Checker" (session ses_xyz) completed a turn. Outcome: completed.

Use read_agent_transcript with sessionId "ses_xyz" for the result, or send_agent_message to follow up.
```

Subagent wake prompt:

```text
Subagent "API Surface Check" completed a turn.

subagentId: subagent_abc123
Outcome: completed

Use read_subagent_latest_turns or search_subagent_transcript with this subagentId before relying on the result.
```

Review feedback prompt:

```text
Plan Review finished round 1. Result: changes requested.

2 reviewers approved. 1 reviewer requested changes.

Use the review feedback artifact in the transcript before continuing.
```

Rules:

- include product title
- include stable agent-facing handle only when the agent must call a tool
- include outcome/status as runtime state, not product-quality judgment unless
  the workflow actually computed a judgment
- point to the next tool or transcript artifact
- keep long results in transcript artifacts or explicit read tools
- avoid raw session/link ids in normal prompts, except in a peer agent message's
  envelope, where the sender's session id IS the reply handle, and in a
  session-scoped wake pointer, where the target's session id is what the
  watcher must pass to `read_agent_transcript` / `send_agent_message`

A wake is only ever a pointer: label, id, outcome, next tool. It never carries
the target's turn output — output can be arbitrarily large, the read tools have
budgets for exactly that, and a wake must stay the same size no matter what the
target did. Content reaches an agent only as an explicit message or an explicit
read.

A real reply is not a wake prompt — it is a message, and it carries the full
content by itself. When an agent answers a peer that was waiting on it, the
pending session-scoped schedule is consumed rather than fired: a pointer after a
reply would only point at what the watcher already read.

Wake copy has the same owner as message copy
(`domains/sessions/prompt/envelope.rs`), for the same reason: text and the
provenance the UI renders from are produced as one value and cannot drift. Each
wake scope carries its own provenance — `subagent_wake` / `link_wake` name the
link and completion row they came from, `agent_wake` names the target session,
because a session-scoped schedule has neither.

### Transcript Artifacts

Use transcript artifacts for durable product context:

```text
proposed plans
plan references
review feedback summaries
review critique artifacts
subagent completion receipts
delegated-work started/completed receipts
```

Artifacts should be visible, copyable when appropriate, and re-readable later.
They should not be used as a hidden instruction transport.

## Product Skill Surface

Product skills are delivered through the session plugin/skill system. The agent
should see a compact index and activate a skill only when it needs the full
instructions.

Agent-visible index shape:

```text
Proliferate session skills are available through the proliferate_skills MCP server.
Use list_available_skills to inspect them and activate_skill before relying on
a skill's full instructions.

Available skills:
- proliferate.subagents.workflow (Subagent workflow) - Use Proliferate
  subagent MCP tools for bounded parallel work, result reads, wake scheduling,
  and cleanup.
```

The skill body should be concise and operational. It should name exact tools,
the recommended order, and the failure modes to avoid.

## Source Ownership

Skill and plugin delivery:

```text
anyharness/crates/anyharness-contract/src/v1/plugins.rs
anyharness/crates/anyharness-lib/src/domains/plugins/skills.rs
anyharness/crates/anyharness-lib/src/domains/plugins/session_extension.rs
anyharness/crates/anyharness-lib/src/domains/plugins/mcp/
  mod.rs
  definition.rs
  tools.rs
apps/desktop/src/lib/domain/plugins/session-plugin-bundle.ts
```

Product prompts:

```text
anyharness/crates/anyharness-lib/src/domains/sessions/prompt/envelope.rs
anyharness/crates/anyharness-lib/src/domains/sessions/agent_ops/definition.rs
anyharness/crates/anyharness-lib/src/domains/reviews/runtime/launch.rs
anyharness/crates/anyharness-lib/src/domains/reviews/service/detail.rs
anyharness/crates/anyharness-lib/src/domains/sessions/response_formatting.rs
anyharness/crates/anyharness-lib/src/domains/cowork/runtime.rs
anyharness/crates/anyharness-lib/src/domains/cowork/mcp/definition.rs
```

Prompt provenance and delegated child-session metadata:

```text
anyharness/crates/anyharness-lib/src/domains/sessions/delegation.rs
anyharness/crates/anyharness-lib/src/domains/sessions/subagents/store.rs
anyharness/crates/anyharness-lib/src/persistence/sql/0029_session_links_prompt_provenance.sql
anyharness/crates/anyharness-lib/src/persistence/sql/0030_subagent_links_and_completions.sql
```

Review and plan artifacts:

```text
anyharness/crates/anyharness-lib/src/domains/reviews/runtime/artifacts.rs
anyharness/crates/anyharness-lib/src/domains/reviews/store/feedback.rs
anyharness/crates/anyharness-lib/src/domains/plans/document.rs
anyharness/crates/anyharness-lib/src/domains/plans/runtime.rs
```

Frontend presentation:

```text
apps/desktop/src/components/workspace/chat/transcript/**
apps/desktop/src/components/workspace/reviews/**
apps/desktop/src/lib/domain/chat/subagents/provenance.ts
apps/desktop/src/lib/domain/reviews/**
apps/desktop/src/lib/domain/plans/**
```

## Acceptance

Done when:

- subagent workflow guidance is a product skill, not parent system text
- reviewer completion requirements remain product role prompt text
- wake prompts use stable product handles and recommended next tools
- parent-to-child prompts preserve authored text after validation
- raw session/link ids are absent from normal prompt copy
- product prompt text has explicit domain ownership
- transcript artifacts carry durable context instead of hidden prompt stuffing
