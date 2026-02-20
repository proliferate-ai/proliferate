# Slack Configuration + Notification Implementation Plan (One PR)

Date: 2026-02-19  
Owners: Product, Design, Web, Worker, Gateway, Services

Companion docs:
- `docs/slack-notifications-ux-north-star.md`
- `docs/slack-configuration-flows-advisor-brief.md`

## 1) Goal

Ship one coherent behavior set for Slack notification routing and configuration selection across:
- Slack `@Proliferate` sessions
- Automation runs
- Sessions list notification subscription UX
- Integrations page Slack defaults

## 2) Locked decisions

1. `agent_decide` is allowed in both Slack and automation flows.
2. `agent_decide` can choose only from an explicit allowlist of existing configurations.
3. `agent_decide` must never create a new managed configuration.
4. A fallback configuration is required and always used when selection is invalid/low confidence.
5. Two selector prompts (Slack vs automation), one shared strict JSON output schema.
6. Session completion notifications must use durable outbox/queue delivery (not PubSub-only fire-and-forget).
7. Session API can expose typed Slack context (or precomputed Slack URL), never raw `clientMetadata`.
8. Slack event routing must be org-safe; team-only ambiguous lookup is not acceptable.
9. DM destination is a validated Slack user dropdown.

## 3) PR scope

## In scope

- Canonical destination model for automation notifications (`dm_user` / `channel` / `none` + event types).
- Session-level notification subscriptions (starting with owner DM on completion).
- Shared configuration selector service for Slack + automation with safe guardrails.
- Removal of dynamic managed-configuration creation path in `agent_decide` mode.
- Integrations UX for Slack default selection strategy.
- Automation editor UX for destination + strategy controls.
- Session row action `Send me notifications`.
- Slack-origin session deep-link visibility in web UI.
- Slack scope/reconnect upgrade handling.
- Tests + spec updates in same PR.

## Out of scope

- New notification channels beyond Slack.
- Full historical replay/backfill of missed session notifications.
- Multi-step wizard UX redesigns.

## 4) Workstreams and file targets

## Workstream A: Data model + contracts

- Add canonical automation notification fields (destination type, Slack user ID, channel ID, event types).
- Add session notification subscriptions table.
- Add typed session Slack context in shared contract (or computed `slackUrl`).

Likely files:
- `packages/db/src/schema/automations.ts`
- `packages/db/src/schema/sessions.ts` (if adding direct fields)
- `packages/db/src/schema/slack.ts` (if storing Slack context/table links)
- `packages/shared/src/contracts/automations.ts`
- `packages/shared/src/contracts/sessions.ts`

## Workstream B: Services and router wiring

- Add CRUD/service methods for session notification subscriptions.
- Update automation update/list/get service and router mapping for new notification fields.
- Keep temporary read compatibility for legacy `enabled_tools.slack_notify.channelId` during migration.

Likely files:
- `packages/services/src/automations/db.ts`
- `packages/services/src/automations/service.ts`
- `packages/services/src/automations/mapper.ts`
- `packages/services/src/notifications/*`
- `packages/services/src/sessions/*`
- `apps/web/src/server/routers/automations.ts`
- `apps/web/src/server/routers/sessions.ts`

## Workstream C: Shared configuration selector service

- Introduce one backend selector service used by both:
  - Slack session create path
  - Automation execution path
- Enforce allowlist + fallback + strict schema validation.
- Store decision trace (`selectedConfigurationId`, `confidence`, `reason`, `fallbackUsed`) in metadata.

Likely files:
- `apps/worker/src/automation/resolve-target.ts` (replace/reshape)
- `apps/worker/src/slack/client.ts` (switch from implicit `managedConfiguration: {}` to strategy resolver)
- `packages/services/src/configurations/*` (allowlist fetch helpers)
- New selector module under `packages/services` or `apps/worker` (decide and keep single owner)

## Workstream D: Remove managed-config creation path from auto-decision

- Ensure `agent_decide` returns only existing configuration IDs.
- Block any `repoIds -> managedConfiguration` creation path in this mode.

Likely files:
- `apps/worker/src/automation/resolve-target.ts`
- `apps/worker/src/automation/index.ts`
- Any Slack create-session strategy adapter

## Workstream E: Durable session completion notifications

- Emit completion notification intent via durable outbox row.
- Worker dispatches with idempotency key and retries.
- Build descriptive message with deep link.

Likely files:
- `apps/gateway/src/hub/event-processor.ts` and/or session completion handling integration point
- `packages/services/src/outbox/*`
- `apps/worker/src/automation/index.ts` pattern reuse or new session notification dispatcher
- `apps/worker/src/slack/*` shared sender

## Workstream F: Slack destination resolution + member/channel lookup APIs

- Add backend endpoints to list Slack members for dropdown (validated list).
- Add channel lookup/list endpoint for channel selector.
- Add DM routing utility (`conversations.open` then `chat.postMessage`).

Likely files:
- `apps/web/src/server/routers/integrations.ts`
- `apps/web/src/lib/slack.ts`
- `apps/worker/src/slack/api.ts` or shared Slack send abstraction
- `apps/worker/src/automation/notifications.ts`

## Workstream G: UI changes

- Automations edit page:
  - notification destination type select
  - DM user dropdown
  - channel picker
  - event-type toggles
  - strategy control (`fixed` vs `agent_decide`) with allowlist + fallback selector
- Sessions list row menu:
  - add `Send me notifications`
- Sessions list/display:
  - keep Slack-origin badge
  - add Slack thread deep-link
- Integrations page:
  - Slack default strategy and fallback config controls
  - reconnect CTA when scopes are outdated

Likely files:
- `apps/web/src/app/(command-center)/dashboard/automations/[id]/page.tsx`
- `apps/web/src/components/automations/integration-permissions.tsx`
- `apps/web/src/components/sessions/session-card.tsx`
- `apps/web/src/components/dashboard/session-item.tsx`
- `apps/web/src/components/ui/item-actions-menu.tsx`
- `apps/web/src/app/(command-center)/dashboard/integrations/page.tsx`
- `apps/web/src/hooks/use-integrations.ts`
- `apps/web/src/hooks/use-automations.ts`
- `apps/web/src/hooks/use-sessions.ts`

## Workstream H: Slack installation disambiguation

- Replace ambiguous team-only installation selection for Slack events.
- Implement deterministic org-safe strategy (channel-to-org mapping, user mapping, or explicit one-to-one policy).

Likely files:
- `packages/services/src/integrations/db.ts`
- `packages/services/src/integrations/service.ts`
- `apps/web/src/app/api/slack/events/route.ts`

## 5) Migration strategy

1. Add new columns/tables with backward-compatible defaults.
2. Deploy code that reads both canonical and legacy fields.
3. Run migration script to copy legacy channel IDs into canonical fields.
4. Update UI to write canonical fields only.
5. Remove legacy read fallback after migration validation.

## 6) Acceptance criteria

1. Automation can notify either Slack DM user or channel, or be disabled.
2. Session row `Send me notifications` creates owner DM subscription and sends completion message.
3. `agent_decide` works for Slack and automation, always bounded by allowlist and fallback.
4. No dynamic managed configuration creation in `agent_decide` mode.
5. Slack-origin sessions show Slack source and deep-link in web UI.
6. Notification payloads are descriptive and include correct deep-links.
7. Durable delivery, idempotency, and retries are verified with tests.
8. Legacy automation Slack channel data remains functional through migration.
9. Slack scope mismatch produces clear reconnect UX.
10. No cross-org ambiguity in Slack event routing.

## 7) Test plan (minimum)

- Unit tests:
  - selector validation and fallback behavior
  - destination resolution
  - idempotency keys and retryable vs non-retryable Slack errors
- Integration tests:
  - automation terminal notification dispatch for DM and channel
  - session completion subscription dispatch path
  - Slack event routing disambiguation
- UI/manual checks:
  - automations editor controls
  - sessions list action + confirmation/toast behavior
  - integrations reconnect CTA

## 8) Required spec updates in same PR

Because behavior changes are substantive, update specs in this PR:
- `docs/specs/automations-runs.md`
- `docs/specs/integrations.md`
- `docs/specs/sessions-gateway.md` (if completion event semantics change)
- `docs/specs/feature-registry.md`

## 9) Suggested commit grouping (single PR, multiple commits)

1. `feat: add canonical slack destination and session notification schemas`
2. `feat: implement shared configuration selector with safe agent_decide`
3. `feat: add durable session completion notification dispatch`
4. `feat: add automation and integrations slack configuration UI`
5. `feat: add sessions send-me-notifications UX and slack deeplink`
6. `chore: migrate legacy slack notification channel data`
7. `test: add coverage for selector, routing, notifications, and retries`
8. `docs: update subsystem specs and feature registry`

