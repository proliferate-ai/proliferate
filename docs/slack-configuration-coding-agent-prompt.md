# Copy/Paste Prompt for Coding Agent

You are working in this exact repository worktree and branch:

- Branch: `codex/slack-config-ux-north-star`

Do not create a new branch or worktree. Implement all requested changes in this single branch for one PR.

## Read first

1. `docs/slack-notifications-ux-north-star.md`
2. `docs/slack-configuration-flows-advisor-brief.md`
3. `docs/slack-configuration-implementation-plan.md`
4. Relevant subsystem specs in `docs/specs/` before coding.

## Hard requirements

1. `agent_decide` must be available for both Slack-originated sessions and automation runs.
2. `agent_decide` is bounded:
- explicit allowlist only
- fallback configuration always required
- must never create new managed configurations
3. Automation notifications support:
- DM to selected Slack user (dropdown-backed)
- post to selected channel
- disabled
4. Session list supports `Send me notifications` (three-dots menu) to DM owner on completion.
5. Notification delivery must be durable and idempotent (outbox/queue + retries), not PubSub-only fire-and-forget.
6. Slack-origin sessions in web UI remain clearly marked and include Slack thread deep-link.
7. Fix Slack installation routing ambiguity (team-only lookup must not risk cross-org routing).
8. Keep temporary backward compatibility for legacy `enabled_tools.slack_notify.channelId` during migration.

## Implementation instructions

1. Execute the plan in `docs/slack-configuration-implementation-plan.md` end-to-end.
2. Prefer extending existing modules/patterns over creating parallel implementations.
3. Centralize Slack send/retry/timeout logic to reduce duplication.
4. Add/adjust tests for selector behavior, destination routing, idempotency, retry, and disambiguation.
5. Run validation commands and report outcomes:
- `pnpm lint`
- `pnpm typecheck`
- targeted tests for touched packages/apps
6. Update specs in the same PR if behavior changes:
- `docs/specs/automations-runs.md`
- `docs/specs/integrations.md`
- `docs/specs/sessions-gateway.md` (if completion semantics changed)
- `docs/specs/feature-registry.md`

## Output format required at completion

Provide:
1. Summary of implemented changes by layer (DB, services, worker/gateway, web UI, migrations, tests, specs)
2. File list with key paths
3. Validation commands run and pass/fail results
4. Known risks/follow-ups

