# Slack Integration Spec

This document describes the Slack integration implementation, core flows, and file structure.
It is intended to be a precise map of the current code paths and behavior.

Slack Integration Files
.
|-- apps
|   |-- gateway
|   |   |-- src
|   |   |   |-- hub
|   |   |   |   |-- session-hub.ts
|   |   |   |-- lib
|   |   |   |   |-- redis.ts
|   |   |   |   |-- session-creator.ts
|   |-- web
|   |   |-- src
|   |   |   |-- app
|   |   |   |   |-- api
|   |   |   |   |   |-- integrations
|   |   |   |   |   |   |-- slack
|   |   |   |   |   |   |   |-- oauth
|   |   |   |   |   |   |   |   |-- route.ts
|   |   |   |   |   |   |   |-- oauth
|   |   |   |   |   |   |       |-- callback
|   |   |   |   |   |   |           |-- route.ts
|   |   |   |   |   |-- slack
|   |   |   |   |       |-- events
|   |   |   |   |           |-- route.ts
|   |   |   |-- components
|   |   |   |   |-- onboarding
|   |   |   |   |   |-- step-slack-connect.tsx
|   |   |   |   |-- settings
|   |   |   |       |-- tabs
|   |   |   |           |-- connections-tab.tsx
|   |   |   |-- lib
|   |   |   |   |-- slack.ts
|   |   |   |-- server
|   |   |       |-- routers
|   |   |           |-- integrations.ts
|   |-- worker
|       |-- src
|           |-- index.ts
|           |-- pubsub
|           |   |-- session-events.ts
|           |-- slack
|               |-- api.ts
|               |-- client.ts
|               |-- lib.ts
|               |-- handlers
|                   |-- default-tool.ts
|                   |-- text.ts
|                   |-- todo.ts
|                   |-- verify.ts
|-- packages
|   |-- db
|   |   |-- src
|   |       |-- schema
|   |           |-- slack.ts
|   |-- gateway-clients
|   |   |-- src
|   |       |-- clients
|   |           |-- async
|   |               |-- index.ts
|   |               |-- receiver.ts
|   |-- queue
|   |   |-- src
|   |       |-- slack.ts
|   |-- services
|   |   |-- src
|   |       |-- integrations
|   |       |   |-- db.ts
|   |       |   |-- service.ts
|   |       |-- sessions
|   |           |-- db.ts
|   |-- shared
|       |-- src
|           |-- async-client.ts

## Scope

- Slack OAuth install + token storage
- Slack Events API webhook ingestion
- Background processing (BullMQ) for inbound messages + receiver streaming
- Gateway session creation + message delivery
- Web UI → Slack wakeups via Redis pub/sub
- Slack Connect support channel flow

## Key Modules and File Paths

Web (Next.js API + UI)
- OAuth entry: `apps/web/src/app/api/integrations/slack/oauth/route.ts`
- OAuth callback: `apps/web/src/app/api/integrations/slack/oauth/callback/route.ts`
- Events webhook: `apps/web/src/app/api/slack/events/route.ts`
- Slack API helper (OAuth, connect invite, revoke): `apps/web/src/lib/slack.ts`
- Integrations router (status/connect/disconnect): `apps/web/src/server/routers/integrations.ts`
- UI surfaces: `apps/web/src/components/settings/tabs/connections-tab.tsx`,
  `apps/web/src/components/onboarding/step-slack-connect.tsx`

Worker (BullMQ + Slack client)
- Worker entry: `apps/worker/src/index.ts`
- Slack client: `apps/worker/src/slack/client.ts`
- Slack API wrapper: `apps/worker/src/slack/api.ts`
- Slack utilities: `apps/worker/src/slack/lib.ts`
- Slack handlers: `apps/worker/src/slack/handlers/*.ts`
- Session pubsub subscriber: `apps/worker/src/pubsub/session-events.ts`

Shared queue + client infrastructure
- Slack queue types + factories: `packages/queue/src/slack.ts`
- Async client base: `packages/gateway-clients/src/clients/async/index.ts`
- Async receiver: `packages/gateway-clients/src/clients/async/receiver.ts`
- Shared async client types: `packages/shared/src/async-client.ts`

Gateway
- Session event publishing: `apps/gateway/src/lib/redis.ts`
- Session hub (user message publish): `apps/gateway/src/hub/session-hub.ts`
- Session creation: `apps/gateway/src/lib/session-creator.ts`

Services + DB
- Integrations service: `packages/services/src/integrations/service.ts`
- Integrations DB: `packages/services/src/integrations/db.ts`
- Sessions DB helpers: `packages/services/src/sessions/db.ts`
- Slack schema: `packages/db/src/schema/slack.ts`

## Data Model

Slack Installations (`slack_installations`)
- Workspace identity + bot credentials
- Key columns: `team_id`, `team_name`, `encrypted_bot_token`, `bot_user_id`,
  `scopes`, `status`, `connect_channel_id`, `invite_url`
- Schema: `packages/db/src/schema/slack.ts`

Slack Conversations (`slack_conversations`)
- Tracks Slack thread → session mapping (channel + thread timestamp)
- Key columns: `slack_installation_id`, `channel_id`, `thread_ts`, `session_id`, `repo_id`
- Schema: `packages/db/src/schema/slack.ts`

Slack Session Metadata (in `sessions.client_metadata`)
- Slack sessions store `installationId`, `channelId`, `threadTs`
- Lookup helper: `packages/services/src/sessions/db.ts` (`findBySlackThread`)

## Environment Variables

Required for Slack integration
- `SLACK_SIGNING_SECRET` — Slack Events signature verification
- `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` — OAuth
- `NEXT_PUBLIC_APP_URL` — OAuth redirect + links
- `USER_SECRETS_ENCRYPTION_KEY` — decrypt bot tokens

Worker/gateway dependencies
- `REDIS_URL` — BullMQ + pub/sub
- `SERVICE_TO_SERVICE_AUTH_TOKEN` — Gateway service auth
- `NEXT_PUBLIC_GATEWAY_URL` — Worker → Gateway

Optional
- `PROLIFERATE_SLACK_BOT_TOKEN` — Slack Connect support channel

## Core Flows

### 1) OAuth Install

Sequence (HTTP)
1. User clicks "Connect Slack" in UI.
2. Next.js API redirects to Slack OAuth URL with state.
3. Slack calls OAuth callback with code + state.
4. Server exchanges code for bot token and stores encrypted token.

Files
- OAuth entry: `apps/web/src/app/api/integrations/slack/oauth/route.ts`
- OAuth callback: `apps/web/src/app/api/integrations/slack/oauth/callback/route.ts`
- OAuth URL/scopes: `apps/web/src/lib/slack.ts`
- Persist installation: `packages/services/src/integrations/service.ts`
  → `packages/services/src/integrations/db.ts`

Notes
- State includes org + user + timestamp; enforced 5‑minute expiry.
- Bot token is encrypted with `USER_SECRETS_ENCRYPTION_KEY` before storage.

### 2) Events Webhook Ingest → Queue

Sequence (HTTP → BullMQ)
1. Slack Events API POSTs to `/api/slack/events`.
2. Signature verified using `X-Slack-Signature` + timestamp.
3. Only `app_mention` or threaded `message` events are accepted.
4. Extract prompt text (strip bot mention), capture files.
5. Find installation by Slack `team_id`.
6. Enqueue a `SlackMessageJob` with message data.

Files
- Webhook handler: `apps/web/src/app/api/slack/events/route.ts`
- Job types/queue: `packages/queue/src/slack.ts`
- Installation lookup: `packages/services/src/integrations/service.ts`

Notes
- Deduplication uses `messageTs` in the jobId.
- Files are passed as `url_private_download` for worker to fetch.

### 3) Worker Inbound Processing (Slack → Session)

Sequence (BullMQ → Gateway)
1. `SlackClient.processInbound` consumes `SlackMessageJob`.
2. Attempts to find existing session for `(installationId, channelId, threadTs)`.
3. If not found, creates session via Gateway (`createSession`) with `clientType: "slack"`.
4. Posts a welcome message and optional "prebuild setup" notice.
5. Ensures a receiver job exists for the session.
6. Downloads Slack image attachments and converts to base64.
7. Cancels any in‑progress work then posts the prompt to the Gateway.

Files
- Worker entry: `apps/worker/src/index.ts`
- Slack client: `apps/worker/src/slack/client.ts`
- Session lookup helper: `packages/services/src/sessions/db.ts` (`findBySlackThread`)
- Gateway client: `packages/gateway-clients/src/clients/sync/index.ts`

Notes
- Session creation uses Gateway-managed prebuilds.
- Image downloads handle Slack CDN redirects without dropping auth headers.

### 4) Receiver Streaming (Gateway → Slack)

Sequence (BullMQ → WebSocket → Slack)
1. Receiver job opens Gateway WebSocket.
2. On `text_part_complete`, posts text to Slack thread (markdown → mrkdwn).
3. On `tool_end`, runs tool‑specific Slack handlers (verify/todowrite).
4. On `message_complete`, receiver exits.

Files
- Receiver loop: `packages/gateway-clients/src/clients/async/receiver.ts`
- Slack event handling: `apps/worker/src/slack/client.ts`
- Text handler: `apps/worker/src/slack/handlers/text.ts`
- Tool handlers: `apps/worker/src/slack/handlers/*.ts`

Notes
- Only significant tools are posted to Slack to reduce noise.

### 5) Web UI Message → Slack Wakeup

Sequence (Gateway → Redis pub/sub → Worker)
1. Web UI sends a message to the session (Gateway HTTP).
2. Gateway publishes a `session:events` Redis message.
3. Worker subscribes and calls `SlackClient.wake(...)`.
4. Slack client posts a "User:" message in the Slack thread and ensures receiver job.

Files
- Publish event: `apps/gateway/src/hub/session-hub.ts`
- Redis publisher: `apps/gateway/src/lib/redis.ts`
- Redis subscriber: `apps/worker/src/pubsub/session-events.ts`
- Wake implementation: `apps/worker/src/slack/client.ts`

### 6) Slack Connect Support Channel

Sequence (Web UI → Slack API → DB)
1. User requests a support channel.
2. Server creates a Slack Connect channel and invite using Proliferate bot token.
3. Channel ID + invite URL saved on the installation.

Files
- Router: `apps/web/src/server/routers/integrations.ts` (`slackConnect`)
- Slack API helper: `apps/web/src/lib/slack.ts` (`sendSlackConnectInvite`)
- DB update: `packages/services/src/integrations/service.ts` (`updateSlackSupportChannel`)

### 7) Disconnect Slack

Sequence (Web UI → Slack API → DB)
1. User disconnects Slack.
2. Server revokes bot token and marks installation as revoked.

Files
- Router: `apps/web/src/server/routers/integrations.ts` (`slackDisconnect`)
- Slack API helper: `apps/web/src/lib/slack.ts` (`revokeToken`)
- DB update: `packages/services/src/integrations/service.ts` (`revokeSlackInstallation`)

## Queues and Jobs

Slack jobs (BullMQ)
- `SlackMessageJob`: one per inbound Slack message
- `SlackReceiverJob`: one per session stream

Definitions
- `packages/queue/src/slack.ts`

Queue names
- `slack-messages` / `slack-receivers` (from `packages/queue/src/slack.ts`)
- `slack-inbound` / `slack-receiver` (from `packages/gateway-clients/src/clients/async/index.ts`)

Worker setup
- `apps/worker/src/index.ts` (concurrency: inbound=5, receiver=10)

## Security and Idempotency

Signature verification
- HMAC-SHA256 of body + timestamp; 5‑minute window
- `apps/web/src/app/api/slack/events/route.ts`

Token security
- Bot tokens encrypted at rest (`USER_SECRETS_ENCRYPTION_KEY`)
- Decrypted only inside worker when posting to Slack
- `apps/web/src/app/api/integrations/slack/oauth/callback/route.ts`
- `apps/worker/src/slack/api.ts`

Idempotency
- Slack inbound jobs are deduped via `messageTs` in jobId
- `packages/queue/src/slack.ts`

## Operational Notes

- Worker health endpoint is `GET /health` in `apps/worker/src/index.ts`.
- Logs are the primary debugging surface for Slack flow.
- Slack Events must be publicly accessible (e.g., via ngrok in local dev).

## Known Constraints / Legacy

- `slack_conversations` schema exists and is used by the webhook for follow‑up gating, while\n+  the worker session lookup uses `sessions.client_metadata` (`packages/services/src/sessions/db.ts`).\n+- Queue naming is split between `packages/queue` and `AsyncClient` (see queue names above).\n+- Only `app_mention` and thread replies (with existing session) are accepted.
