## High level UX

Web and mobile are Cloud-mediated clients. They should use Cloud snapshots,
commands, and live streams rather than calling AnyHarness directly.

Web/mobile only show work that has active Cloud exposure. They do not discover
arbitrary AnyHarness workspaces directly.

If a Desktop-originated workspace/session should become available on mobile or
web, the product creates Cloud exposure/projection for that existing runtime.
It does not create a copy. After exposure, Desktop can keep talking directly to
AnyHarness while web/mobile talk through Cloud.

Purpose:

- onboard users;
- configure account/cloud basics;
- view and control cloud sessions;
- manage automations and Slack-created work;
- claim shared work;
- show billing/credits/readiness.

Desktop remains the richest direct runtime client for files, terminal, browser,
and local machine capabilities.

## DB models + schemas

Auth/account:

```text
user_account
  id
  primary_email
  name
  avatar_url
  status

organization
  id
  name
  plan
  status

organization_membership
  user_id
  organization_id
  role: admin | member
  status

oauth_identity
  user_id
  provider: github | google | apple
  provider_user_id
  email
  linked_at
```

Client-facing state comes from existing domain rows:

- cloud targets/workspaces/sessions/messages;
- automation rows;
- Slack thread work;
- billing/credit state;
- agent auth readiness;
- MCP/skill/plugin readiness.

## End to end flows through the product

New account onboarding:

1. User signs in with GitHub/Google/Apple.
2. Server creates user and default org.
3. Server creates/free-trial entitlement and managed-credit budget.
4. User chooses repo/cloud setup path.
5. User chooses agent auth: managed credits, synced auth, or BYOK only where
   the gateway BYOK capability is enabled.
6. User lands on cloud readiness/session creation.

Web session control:

1. Web loads Cloud workspace/session snapshot.
2. Web subscribes to live deltas.
3. User sends command/prompt through Cloud.
4. Cloud verifies active exposure, active projection, commandability, and
   actor permission.
5. Worker applies command to AnyHarness.
6. Events update Cloud rows and live stream.

Desktop + web/mobile on the same exposed session:

1. Desktop remains connected directly to AnyHarness.
2. Web/mobile remains connected to Cloud.
3. Both can send prompts only if policy allows it:
   - Desktop requires direct target authority or a claim token for shared work;
   - web/mobile requires active exposure, live projection, and `commandable`.
4. AnyHarness serializes accepted prompts/actions.
5. Worker projects the resulting events to Cloud, so web/mobile catch up to
   Desktop-originated work.

Mobile session control:

1. Mobile uses same Cloud SDK.
2. Mobile focuses on transcript, prompt, requests, notifications, claiming.
3. Heavy file/terminal/browser flows deep-link to Desktop/web where needed.

Claiming:

1. User opens claimable Slack/automation work.
2. Web/mobile calls claim API.
3. Cloud grants control according to policy.
4. UI switches from read/preview to active control.

## Hooks / things used and why

Client SDK:

- generated Cloud SDK for raw API calls;
- SDK React/query hooks for web;
- mobile wrappers around the same API contracts.

Core hooks:

```text
useCurrentUser()
useOrganizations()
useCloudTargets()
useCloudWorkspaces()
useCloudSession()
useCloudCommands()
useCloudWorkspaceExposure()
useCloudSessionProjection()
useClaimableWork()
useAutomations()
useBillingStatus()
useAgentAuthReadiness()
```

Live updates:

- SSE/WebSocket for web;
- push notifications for mobile;
- snapshots remain source for reconnect/reload.

## One offs

- Web/mobile must not construct raw AnyHarness URLs for cloud sessions.
- Keep auth/token refresh centralized in Cloud SDK.
- Mobile should not need local worker/AnyHarness assumptions.
- Notifications should link to Cloud session or claimable work.
- Shared work must clearly show owner/source/claim status.
- If a local Desktop session is not exposed, web/mobile should not show it.
- "Continue remotely" creates or upgrades exposure/projection before opening
  mobile control.
- "Disable remote access" pauses/revokes exposure or commandability. It should
  not delete the local AnyHarness workspace/session.

## Deeper concepts

Services:

- Web app: Cloud-mediated UI.
- Mobile app: Cloud-mediated lightweight control/notifications.
- Cloud API: auth, snapshots, commands, streams.
- Worker: target bridge.

Publishing:

- Web deploy follows normal server/frontend deployment.
- Mobile uses Expo/App Store/TestFlight flow with same Cloud API.

Design system:

- Share tokens/components where practical.
- Keep domain hooks/API access consistent with Desktop conventions.
