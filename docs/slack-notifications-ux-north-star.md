# Slack Notifications + Configuration UX North Star

Date: 2026-02-19  
Audience: Product, design, engineering

This defines the end-state UX we are aiming for across all product surfaces that touch Slack-driven agent work (integrations settings, automations editing, sessions list, and Slack threads).

## 1) One mental model across product surfaces
Users should not have to learn different Slack behaviors in different parts of the product.

- The same destination concepts must exist everywhere notifications are configured.
- The same configuration selection strategy concepts must exist everywhere a session/run is created.

## 2) Automation notification destination is explicit and easy
On the automation edit screen, when Slack is connected, users can pick exactly where state-transition notifications go.

Allowed destination types:
- DM a Slack user (selected from a dropdown of workspace members)
- Post to a Slack channel
- Disable Slack notifications for that automation

## 3) Session notifications are one click from the sessions list
For user-owned sessions, the row actions menu (three dots) includes `Send me notifications`.

Behavior:
- Choosing it subscribes that user to completion notifications for that session.
- Notifications are sent as a DM from the Slack app/bot to that user.

## 4) Notifications are state-transition based and descriptive
Notifications should trigger on meaningful transitions (for example: `succeeded`, `failed`, `timed_out`, `needs_human`, and session completion milestones).

Every notification must include:
- Clear status label
- Short summary of what happened
- Deep link to the exact run/session in Proliferate
- Enough context to decide if human action is needed

## 5) Slack-initiated sessions remain thread-native
For `@Proliferate` sessions in Slack:
- Streaming responses continue in the original Slack thread (this is the primary conversation surface).
- In the web UI, these sessions are clearly marked as Slack-originated.
- The web UI shows a deep link back to the Slack thread.

## 6) Configuration strategy is user-configurable in both places
Both entry points must support the same strategy options:
- Always use a specific configuration
- Let agent decide

Where configured:
- Slack: in Integrations settings (default strategy for Slack-initiated sessions)
- Automations: in the automation editing screen (run-specific strategy)

## 7) “DM a Slack user” is a proper picker, not free text
When destination is DM:
- User selects from a validated dropdown of Slack workspace members.
- Invalid/unknown users cannot be saved.
- If the target user is deactivated/removed, the system surfaces a clear error and fallback guidance.

## 8) “Let agent decide” must still be safe and bounded
Auto-decision does not mean unbounded behavior.

Requirements:
- Agent chooses from an explicit allowlist of allowed existing configurations only.
- Agent decision must never create a new managed configuration.
- Deterministic fallback configuration is required and always available.
- Decision reasoning and confidence are logged for debugging/audit.

## 9) Reliability and scale are first-class UX requirements
User trust depends on delivery guarantees.

Requirements:
- Idempotent sends (no duplicate spam on retries)
- Retries with bounded backoff on transient Slack failures
- Clear terminal failure handling when destination is invalid
- Observability (structured logs + metrics for send success/failure/latency)

## 10) Code quality is part of the UX contract
Implementation quality is not optional.

Requirements:
- Clean ownership boundaries and minimal duplication
- Shared Slack routing/formatting/retry primitives
- Explicit contracts for destination/config strategy
- Test coverage for routing, selection, fallback, and idempotency paths

## 11) Slack app upgrade path is explicit
New Slack destination capabilities may require additional OAuth scopes.

Requirements:
- If new scopes are required (for example DM/channel discovery scopes), existing installations surface a clear reconnect CTA.
- Until reconnect is complete, UX and runtime errors are explicit and actionable (no silent failures).
