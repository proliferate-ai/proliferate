# Workspace Provisioning / Creation Flow

Status: authoritative read path for managed workspace creation.

This spec is the entrypoint for the end-to-end creation flow. It does not
replace the owning implementation specs. It names the sequence, invariants, and
failure boundaries that connect sandbox provisioning, command delivery,
workspace lifecycle, and pending-shell product behavior.

## Purpose And Scope

Use this spec when changing any path that creates or command-enables a managed
cloud workspace from Desktop, Web, Mobile, Slack, automations, cowork, or API
entrypoints.

In scope:

- choosing the owner scope and repo/branch/worktree identity for a new managed
  workspace
- creating or reusing the sandbox profile, primary target (the ephemeral
  managed sandbox), and durable `cloud_workspace` row
- creating exposure and projection rows that make the workspace visible and
  commandable
- queuing materialization/session commands with the right preflights and
  target correlation
- handing pending client shells to durable workspace/session ids
- defining the read order for creation, materialization, wake, and lifecycle
  failures

Out of scope:

- profile/target/sandbox schema details, owned by
  [sandbox-provisioning.md](sandbox-provisioning.md)
- runtime-config, MCP, skill, and plugin materialization, owned by
  [mcp-skills.md](mcp-skills.md)
- agent-auth selection and materialization, owned by
  [agent-auth.md](agent-auth.md)
- command queue, wake, exposure, and projection internals, owned by
  [cloud-commands.md](cloud-commands.md)
- post-creation archive, hydrate, prune, delete, and materialization lifecycle,
  owned by [workspace-lifecycle.md](workspace-lifecycle.md)
- pending-shell rendering and client-side handoff behavior, owned by
  [../features/pending-workspace-shell.md](../features/pending-workspace-shell.md)

## Read Order

For creation work, read in this order:

1. This spec for the full sequence and ownership boundaries.
2. [sandbox-provisioning.md](sandbox-provisioning.md) for profile, target,
   sandbox, and `cloud_workspace` creation invariants.
3. [cloud-commands.md](cloud-commands.md) for `managed_profile_launch`,
   preflights, wake, exposure, projection, and command/result fencing.
4. [workspace-lifecycle.md](workspace-lifecycle.md) for durable workspace,
   worktree, and materialization state after creation.
5. The feature spec for the entrypoint, such as
   [pending-workspace-shell.md](../features/pending-workspace-shell.md),
   [cloud-dispatch.md](../features/cloud-dispatch.md),
   [mobile-cloud-client.md](../features/mobile-cloud-client.md),
   [automations.md](../features/automations.md), or
   [slack-bot.md](../features/slack-bot.md).

## Mental Model

Workspace creation crosses four ledgers:

```text
client intent
  -> pending shell / projected session, when the surface has visible UI
Cloud product ledger
  -> sandbox_profile, cloud_target (= the managed sandbox), cloud_sandbox,
     cloud_workspace
Cloud commandability ledger
  -> cloud_workspace_exposure, cloud_session_projection, cloud_commands
runtime materialization ledger
  -> AnyHarness workspace id, worktree path, materialized_target_id
```

The ledgers are separate. Do not collapse them to make one surface simpler.
The client may show a pending shell before the Cloud product row exists. Cloud
must create the product row before AnyHarness materialization begins. Runtime
materialization may complete after the workspace is already visible.

## Canonical Flow

Managed workspace creation should follow this sequence:

```text
1. Resolve owner scope, actor, repo identity, branch/ref, and display metadata.
2. If the surface is interactive, create a pending workspace shell and projected
   session before async work starts.
3. Call the server-owned managed profile launch path.
4. Server ensures sandbox_profile and primary cloud_target idempotently.
5. Server ensures or schedules sandbox provisioning for the target; E2B work
   remains background-owned by sandbox provisioning.
6. Server creates the durable cloud_workspace row before runtime
   materialization.
7. Server creates or updates cloud_workspace_exposure and, when applicable,
   cloud_session_projection.
8. Server queues materialize/start/send commands with cloud_workspace_id,
   sandbox_profile_id, required runtime-config revision, required agent-auth
   revision, and target id.
9. Wake-required commands return quickly; the wake job runs asynchronously.
10. Worker leases the command for its target_id (no slot fence).
11. Worker materializes the workspace and echoes cloud_workspace_id plus the
    AnyHarness workspace id in the result.
12. Server verifies the result against the Cloud row and target (rejecting
    reports from an archived/replaced target) before updating
    materialization/session state.
13. Worker event upload projects only active exposure/projection rows.
14. Client handoff remaps the pending shell to the durable workspace/session
    ids and clears pending state only after finalization is complete.
```

## Source Ownership

| Concern | Owner |
| --- | --- |
| Client-side pending shell and projected session | [../features/pending-workspace-shell.md](../features/pending-workspace-shell.md) |
| Web/Mobile/Desktop cloud dispatch UX | [../features/cloud-dispatch.md](../features/cloud-dispatch.md), [../features/web-cloud-local-parity.md](../features/web-cloud-local-parity.md), [../features/mobile-cloud-client.md](../features/mobile-cloud-client.md) |
| Sandbox profile, target, sandbox, runtime access, and `cloud_workspace` foundation | [sandbox-provisioning.md](sandbox-provisioning.md) |
| Canonical server launch helper, exposure, projection, wake, and command queue | [cloud-commands.md](cloud-commands.md) |
| Workspace/worktree/materialization lifecycle after creation | [workspace-lifecycle.md](workspace-lifecycle.md) |
| Runtime config and MCP/skills/plugins preflight | [mcp-skills.md](mcp-skills.md) |
| Agent auth preflight and runtime auth materialization | [agent-auth.md](agent-auth.md) |
| Billing wake authorization | [billing.md](billing.md) |
| Shared/unclaimed team workspace claim path | [claiming.md](claiming.md) |

## Invariants

- Every managed creation path uses the same server-owned launch service named
  in [cloud-commands.md](cloud-commands.md). Feature code should not hand-roll
  sandbox/profile/workspace creation.
- `cloud_workspace` is the durable product row and is created before
  AnyHarness materialization starts.
- Worker results never auto-create `cloud_workspace`. Unknown
  `cloud_workspace_id` results are rejected as stale.
- `cloud_commands.cloud_workspace_id` is the Cloud product id; `workspace_id`
  remains the AnyHarness runtime id and may be absent before materialization.
- Command leasing, result ingest, and materialization updates correlate by
  `target_id`; reports from an archived (replaced) target are inert.
- Runtime-config and agent-auth requirements are preflighted before launch
  commands become deliverable.
- Passive list/detail/transcript reads do not wake the sandbox.
- Pending UI state is local shell truth only until handoff. It must not be
  persisted as a fake workspace row.

## Failure Boundaries

| Failure | First owner to inspect |
| --- | --- |
| Profile or target missing, duplicated, disabled, or not owned by caller | [sandbox-provisioning.md](sandbox-provisioning.md) |
| Sandbox stuck creating, worker enrollment missing, runtime access absent | [sandbox-provisioning.md](sandbox-provisioning.md), then [cloud-commands.md](cloud-commands.md) for wake/delivery state |
| Runtime config stale or MCP/skill/plugin materialization not applied | [mcp-skills.md](mcp-skills.md), then [cloud-commands.md](cloud-commands.md) preflight |
| Agent auth selection missing, stale, or not materialized | [agent-auth.md](agent-auth.md), then [agent-auth-bifrost-byok.md](agent-auth-bifrost-byok.md) for gateway/BYOK |
| Billing blocks wake or managed credits | [billing.md](billing.md) |
| Command remains queued, failed delivery, or wake timeout | [cloud-commands.md](cloud-commands.md) |
| Worker result references unknown workspace or archived target | [sandbox-provisioning.md](sandbox-provisioning.md), [cloud-commands.md](cloud-commands.md) |
| Pending shell duplicates sessions or clears too early | [../features/pending-workspace-shell.md](../features/pending-workspace-shell.md) |
| Workspace exists but files/terminal/prompt require hydration | [workspace-lifecycle.md](workspace-lifecycle.md) |

## Verification

Targeted creation verification should include:

- server tests that every creator calls the managed launch service instead of
  writing a separate profile/target/workspace path
- tests for idempotent concurrent launch of the same owner/repo/branch
- tests that materialization commands carry `cloud_workspace_id`,
  `sandbox_profile_id`, required runtime-config revision, and required
  agent-auth revision
- result-ingest tests that reject unknown `cloud_workspace_id` and reports
  from an archived (replaced) target
- passive UI tests proving workspace/session/transcript reads do not wake a
  sandbox
- feature tests for pending-shell handoff: projected session first, durable id
  remap, no duplicate session, clear pending state after finalization
- one real smoke for each changed entrypoint: Desktop/Web, Mobile, Slack,
  automation, cowork, or API

Use [../../developing/qa/README.md](../../developing/qa/README.md) to choose
the release QA surface matrix when creation behavior ships.
