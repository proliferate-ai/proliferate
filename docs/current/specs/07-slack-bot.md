# 07 — Slack Bot

Status: implementation-ready spec.

Date: 2026-05-20.

Depends on: [`00-sandbox-foundation.md`](00-sandbox-foundation.md),
[`02-agent-auth.md`](02-agent-auth.md),
[`04-cloud-running-alignment.md`](04-cloud-running-alignment.md),
[`05-claiming.md`](05-claiming.md),
[`06-automations.md`](06-automations.md).

Slack is a team-automation entrypoint. A Slack mention creates a
shared, unclaimed cloud workspace/session in the org's managed
shared sandbox; end-of-turn events from AnyHarness are posted back
to the Slack thread. No Slack-specific runtime/auth/MCP/model
config — Slack reuses the same primitives.

## 1. Purpose & Scope

In scope:

- Slack OAuth install + reconnect flow (per-organization).
- DB models for the workspace connection, the per-org bot config
  (repo routing mode, default `cloud_agent_run_config`, allowed
  channels), and the Slack thread ↔ Cloud workspace mapping.
- Inbound event handler with Slack signature verification + event
  dedupe.
- Mention handler that routes through `managed_profile_launch`
  (spec 04) with `origin='slack'`, `source_kind='slack'`,
  `visibility='shared_unclaimed'`. Output is claim-eligible per
  spec 05.
- Repo selection: either fixed (admin pins one repo) or auto
  (router picks from an allowlist based on bounded metadata —
  no live code scanning).
- End-of-turn detection in the event-ingest path; outbound Slack
  thread response on completion.
- Outbound posting with retry + rate-limit awareness (bounded
  in-process queue).
- New small `organization_settings` table to hold cross-cutting
  per-org config (referenced by spec 06 for org defaults; spec 07
  is the first concrete user).
- Settings → Slack bot admin page (spec 03 §5.1 slot).

Out of scope:

- Slash commands (V1 is `@mention` only). Slash commands fit the
  same handler but are a follow-up.
- Per-channel routing rules (allowlist is org-wide; per-channel is
  a follow-up).
- Live (token-by-token) streaming to Slack threads. V1 posts on
  end-of-turn and on completed tool-summary boundaries only.
- Interactive Slack components (buttons, modals) beyond the basic
  ack/done messages. Follow-up.
- Multi-org Slack workspace installs. One Slack workspace can be
  connected to one Proliferate organization in V1.
- Slack as a personal automation entrypoint. Slack is team-only.
- Replying to Cloud-mediated edits in non-Slack surfaces (e.g.
  forwarding web messages to Slack). Not a V1 product surface.

## 2. Mental Model

```text
Slack mention                                  user @mentions the bot
   |
   v
POST /v1/cloud/slack/events                    Slack -> Proliferate
   |  verify signature (HMAC-SHA256 + timestamp tolerance)
   |  dedupe by slack_event_id
   |  resolve slack_workspace_connection -> organization
   v
SlackMentionContext                            { channel, thread_ts, user, text }
   |
   v
resolve repo                                   fixed -> use slack_bot_config.fixed_repo
                                               auto  -> router picks from allowlist
   |
   v
managed_profile_launch (spec 04)               origin='slack', source_kind='slack',
                                               visibility='shared_unclaimed',
                                               commandable=true
   |
   v
slack_thread_work                              (workspace, session, exposure) -> thread_ts
   |
   v
Slack ack reply                                "Working on it..." with link
   |
   v
start_session + send_prompt                    (via cloud_commands)
   |
   v
Worker dispatches to AnyHarness ...
   |
   v
events flow back via /worker/events/batches
   |
   v
end-of-turn detected in projection             event_kind in END_OF_TURN_KINDS
   |
   v
slack_post_end_of_turn(thread_work)            format + post via outbound queue
   |
   v
Slack thread updated                           assistant message summary
```

Rules:

- **No Slack-specific MCP/auth/model surface.** Slack consumes
  `cloud_agent_run_config` (spec 06), `sandbox_profile` (spec 00),
  agent auth (spec 02), runtime config (spec 01) just like
  automations and Desktop new-chat.
- **Slack-created work is org-owned and `shared_unclaimed`.**
  Any org member can claim via spec 05 to take over.
- **Slack is the messenger, not the source of truth.** The Cloud
  session/transcript is canonical; Slack messages link to the
  Cloud web view for the full conversation.

## 3. Dependencies

Hard:

- Spec 00: `sandbox_profile`, `ensure_organization_sandbox_profile`,
  `ensure_primary_profile_target`.
- Spec 02: `sandbox_profile_target_state` agent-auth columns;
  spec-07 fail-fast if org agent auth isn't ready.
- Spec 04: `managed_profile_launch`, `cloud_workspace_exposure`,
  exposure-gated event ingest, runtime config + agent auth
  preflight (auto-cascade per spec 06 §5.5 pattern reused).
- Spec 05: `shared_unclaimed` claim flow.
- Spec 06: `cloud_agent_run_config` model + per-org default
  via `organization_settings`. Spec 07 introduces the
  `organization_settings` table as the cross-cutting home for
  per-org cross-cutting config; spec 06's reference resolves to
  the same table.

Soft:

- Spec 03: `useIsAdmin(org)` admin gate for Slack settings;
  Settings → Slack bot page slot.
- Spec 09: billing wake gate is consulted on Slack-triggered
  launches like every other source.

## 4. Current Repo State

Verified against the current repository worktree on 2026-05-20.

### 4.1 What is shipped

**Outbound Slack utilities**
(`server/proliferate/integrations/slack/`):

```text
__init__.py
webhooks.py    post_incoming_webhook(url, blocks)
messages.py    build_mrkdwn_message_blocks(title, body, fields)
errors.py
```

Used today by `server/proliferate/server/support/service.py` to
forward user feedback to a Proliferate-owned Slack channel
(`settings.support_slack_webhook_url`). Direct `httpx` calls; no
queue or retry. No `slack_sdk` / `slack-bolt` dependency in
`server/pyproject.toml`.

**Cloud command source enum**: `cloud_commands.actor_kind` and
`cloud_commands.source` already accept `'slack'`
(`server/alembic/versions/c5d6e7f8a9b0_cloud_commands.py:94-101`).
No producer in the repo yet.

**Inbound webhook patterns** to reuse:

```text
server/proliferate/server/billing/stripe_webhooks.py
  HMAC-SHA256 verification with timestamp tolerance (300s)

server/proliferate/server/cloud/webhooks/service.py
  E2B signature verification delegate
```

**Event ingestion path**
(`server/proliferate/server/cloud/worker/events/service.py`):

```text
ingest_worker_event_batch()
  for each accepted event:
    _apply_projection()
    publish_session_patch()           live SSE/WebSocket fanout

no end-of-turn detection hook
no on-session-complete callback
event types derived from raw payload via event_type()
```

**Repo configuration**
(`server/proliferate/db/models/cloud/repo_config.py`):

```text
CloudRepoConfig
  user_id, git_owner, git_repo_name  UNIQUE (user_id, git_owner, git_repo_name)
  -- user-scoped only; no org-shared repos
```

**Organization table**
(`server/proliferate/db/models/organizations.py`):

```text
Organization
  id, name, logo_domain, logo_image, created_at, updated_at
  -- no settings_json; no organization_settings table
```

**Existing `origin_json` on `cloud_workspace`** is used for
free-form provenance (e.g. `{"kind":"human","entrypoint":"cloud"}`).
Spec 04 adds a typed `origin` enum column; Slack-created
workspaces stamp `origin='slack'`.

### 4.2 Gaps spec 07 closes

- No `slack_workspace_connection`, `slack_bot_config`,
  `slack_thread_work` tables.
- No Slack OAuth flow.
- No `POST /v1/cloud/slack/events` handler.
- No signature verification middleware for Slack (Stripe / E2B
  patterns exist to copy).
- No end-of-turn hook in event ingest.
- No outbound queue with retry / rate-limit awareness.
- No org-scoped repo allowlist.
- No `organization_settings` table.

## 5. Target Model

### 5.1 Slack OAuth install flow

```text
Admin clicks "Install Slack"
  -> redirect to Slack OAuth v2 (slack.com/oauth/v2/authorize)
       client_id from settings.slack_client_id
       scopes:  bot scopes (app_mentions:read, chat:write,
                            chat:write.public, channels:history)
       state:   signed state including organization_id +
                actor_user_id (HMAC with cloud_secret_key,
                expires_at within 10 minutes)
  -> Slack redirects to /v1/cloud/slack/oauth/callback
       verify state HMAC + expiry
       exchange code for tokens
       insert slack_workspace_connection
       redirect Desktop to Settings > Slack bot

Reconnect: same flow, upserts the connection (preserves id).
```

Settings additions:

```text
settings.slack_client_id            from Slack app
settings.slack_client_secret        from Slack app
settings.slack_signing_secret       for inbound signature verification
settings.slack_oauth_redirect_url   https://api.proliferate.ai/v1/cloud/slack/oauth/callback
```

### 5.2 `slack_workspace_connection` (new)

One row per Proliferate organization that has installed the bot.
Multi-tenant Slack workspaces are out of scope: one Slack workspace
maps to one Proliferate org.

```text
slack_workspace_connection
  id                          uuid pk
  organization_id             uuid fk organization.id        UNIQUE NOT NULL
  slack_team_id               text                           NOT NULL
  slack_team_name             text                           NOT NULL
  slack_bot_user_id           text                           NOT NULL
  bot_token_ciphertext        bytea / text                   NOT NULL
  bot_token_ciphertext_key_id text                           NOT NULL
  bot_scopes                  text                           NOT NULL  -- comma-separated
  status                      text                           NOT NULL
                              'active' | 'reauth_required' | 'revoked'
  installed_by_user_id        uuid fk user.id                NOT NULL
  installed_at                timestamptz                    NOT NULL
  last_validated_at           timestamptz                    nullable
  revoked_at                  timestamptz                    nullable
  created_at, updated_at

  UNIQUE (slack_team_id)
  UNIQUE (organization_id)   WHERE status != 'revoked'
  CHECK ck_slack_workspace_connection_status
```

Bot tokens are encrypted at rest using the same cipher as agent
gateway credentials and runtime tokens.

A periodic validator (every 24h) calls Slack `auth.test`; failure
flips status to `reauth_required` and surfaces in the Settings UI.

### 5.3 `slack_bot_config` (new)

Per-org bot configuration. Stays narrow to Slack-specific fields
(repo routing, allowed channels). Cross-cutting per-org defaults
(like default `cloud_agent_run_config_id`) live in
`organization_settings` (§5.10).

```text
slack_bot_config
  id                              uuid pk
  organization_id                 uuid fk organization.id    UNIQUE NOT NULL
  slack_workspace_connection_id   uuid fk slack_workspace_connection.id  NOT NULL
  enabled                         boolean                    NOT NULL default true

  repo_mode                       text  'fixed' | 'auto'    NOT NULL default 'auto'
  fixed_cloud_repo_config_id      uuid fk cloud_repo_config.id  nullable
                                   required when repo_mode='fixed'
  allowed_cloud_repo_config_ids   text                       -- comma-separated UUIDs
                                                              for repo_mode='auto'
  default_agent_kind              text                       nullable
                                   if null, use per-agent default from
                                   organization_settings

  allowed_slack_channel_ids       text                       nullable
                                   comma-separated; if null, bot responds in any
                                   channel; if set, only listed channels

  ack_message_template            text                       nullable
                                   override for the initial "working on it..."
                                   message; default in copy/cloud/slack-copy.ts

  created_at, updated_at

  CHECK ck_slack_bot_config_repo_mode
  CHECK ck_slack_bot_config_fixed_repo_present
    (repo_mode='fixed' -> fixed_cloud_repo_config_id IS NOT NULL)
```

Repo references use `cloud_repo_config.id`. To support org-shared
repos, `cloud_repo_config` gains optional `organization_id` and
`owner_scope` (see §5.5).

### 5.4 `slack_thread_work` (new)

Maps a Slack thread to the Cloud workspace/session it created.
Append-only; an existing thread always resolves to the same Cloud
work. Follow-up messages in the same thread can post to the
existing session (`send_prompt`) instead of creating a new
workspace.

```text
slack_thread_work
  id                              uuid pk
  organization_id                 uuid fk organization.id        NOT NULL
  slack_team_id                   text                           NOT NULL
  slack_channel_id                text                           NOT NULL
  slack_thread_ts                 text                           NOT NULL
                                  -- the parent message ts of the thread

  cloud_workspace_id              uuid fk cloud_workspace.id     NOT NULL
  cloud_session_id                uuid fk cloud_session.id       nullable
  cloud_workspace_exposure_id     uuid fk cloud_workspace_exposure.id  NOT NULL
  cloud_session_projection_id     uuid fk cloud_session_projection.id  nullable

  root_message_ts                 text                           NOT NULL
                                  -- the user's mention message ts
  bot_ack_message_ts              text                           nullable
                                  -- the bot's ack reply ts
  initial_repo_id                 uuid fk cloud_repo_config.id   NOT NULL

  status                          text   'active' | 'archived'
  created_at                      timestamptz                    NOT NULL
  archived_at                     timestamptz                    nullable

  UNIQUE (slack_team_id, slack_channel_id, slack_thread_ts)
  CHECK ck_slack_thread_work_status
```

Follow-up messages in the same thread post a new `send_prompt`
command on `cloud_session_id`. They do not create a new workspace.

### 5.5 Org repo routing

Extend `cloud_repo_config` to support organization-scoped repos:

```text
ALTER cloud_repo_config:
  ADD COLUMN owner_scope text     'personal' | 'organization'   NOT NULL default 'personal'
  ADD COLUMN organization_id uuid fk organization.id            nullable

  CHECK ck_cloud_repo_config_owner_fields
    (owner_scope='personal' AND user_id IS NOT NULL AND organization_id IS NULL)
    OR
    (owner_scope='organization' AND organization_id IS NOT NULL AND user_id IS NULL)

  -- existing UNIQUE (user_id, git_owner, git_repo_name) becomes partial:
  --   WHERE owner_scope='personal'
  -- add UNIQUE (organization_id, git_owner, git_repo_name) WHERE owner_scope='organization'
```

For Slack `repo_mode='auto'`, the bot picks one of the
`allowed_cloud_repo_config_ids` based on a deterministic router.
The router uses bounded metadata only — no live code scanning:

```text
inputs:
  slack message text (cleaned of @mention)
  slack thread context (parent message + last N replies if exists)
  channel name
  for each candidate repo:
    git_owner, git_repo_name
    repo display name (CloudRepoConfig display_name if any)
    org-supplied description    (new column; optional)
    README first 4KB            (cached via the existing github access path
                                  if available; expires daily)
    primary languages           (from GitHub repo API, cached)
    topics                      (from GitHub repo API, cached)

selector behaviour (V1):
  pure heuristic match: keyword score over name + description +
  README summary + topics. Tied scores -> ask in Slack with the
  top 3 candidates as buttons (interactive component; if not
  shipped in V1, fall back to "I'm not sure which repo — please
  configure Slack default in Settings or @mention with a hint").

repo_mode='auto' fallback:
  if no candidate scores above a threshold and only one repo is
  configured, pick it
  if multiple candidates above threshold, pick highest score
  if all below threshold, post a clarification question and do
  not create a workspace
```

A new tiny cache table holds router metadata:

```text
cloud_repo_routing_profile
  id                          uuid pk
  cloud_repo_config_id        uuid fk cloud_repo_config.id   UNIQUE NOT NULL
  organization_id             uuid fk organization.id        NOT NULL
  display_name                text                           nullable
  description                 text                           nullable
                              -- admin-editable in Slack bot settings
  readme_summary              text                           nullable
                              -- first 4KB; cached
  languages_json              text                           nullable
                              -- JSON list of strings
  topics_json                 text                           nullable
                              -- JSON list of strings
  cached_at                   timestamptz                    nullable
  created_at, updated_at
```

The router is a pure function in
`server/cloud/slack/domain/repo_router.py`.

If interactive Slack components are out for V1, the
"ask-with-buttons" path degrades to a text reply asking the user
to use a `--repo <name>` hint in their @mention. This keeps V1
shipping without interactive deps.

### 5.6 Inbound event handler + signature verification + dedupe

```text
POST /v1/cloud/slack/events
  no Cloud user auth; Slack signs the request
  verify:
    X-Slack-Signature header
    X-Slack-Request-Timestamp within 300s
    HMAC-SHA256 over "v0:{ts}:{body}" using settings.slack_signing_secret
    constant-time compare

  parse Slack envelope:
    if type=url_verification: respond 200 with the challenge
    if type=event_callback:
      dedupe by event_id (slack_event_envelope_seen table)
      route to handler by event.type:
        app_mention            -> handle_app_mention
        message.channels       -> handle_message (only when in a
                                                   thread we own;
                                                   otherwise ignore)
        team_join / channel_*  -> ignore in V1
```

Dedupe table:

```text
slack_event_envelope_seen
  slack_event_id        text PRIMARY KEY
  organization_id       uuid fk organization.id
  received_at           timestamptz
  -- prune entries older than 7 days
```

A fast path responds 200 within Slack's 3s SLA; the actual work
(repo selection, workspace creation, command enqueue) happens in
a background job:

```text
POST /v1/cloud/slack/events    handler:
  verify signature
  parse + dedupe
  insert a slack_inbound_event_job row
  return 200 OK to Slack

background job processor:
  load the job, route to handler
  handlers may enqueue cloud_commands and post outbound Slack messages
```

This decouples Slack's tight SLA from any downstream latency.

### 5.7 Mention → `managed_profile_launch`

Happy path (background processor):

```text
1. verify connection.status='active' for this organization
2. verify slack_bot_config.enabled=true
3. verify channel is in allowed_slack_channel_ids if set
4. ensure organization sandbox profile (spec 00)
   if fails: post error in thread; mark job failed
5. resolve repo:
   repo_mode='fixed' -> fixed_cloud_repo_config_id
   repo_mode='auto'  -> repo_router(message_text, candidates)
   if undecidable: post clarification in thread; do not create
   workspace
6. resolve agent_run_config:
   slack_bot_config.default_agent_run_config_id ??
   organization_settings.default_agent_run_config_id_by_agent_kind[default_agent_kind] ??
   system starter preset for default_agent_kind
7. preflight runtime config (spec 01) + agent auth (spec 02)
   auto-cascade per spec 06's mechanism (same helper);
   cascade attempts capped (settings.slack_run_cascade_max_attempts)
8. call managed_profile_launch (spec 04) with:
   sandbox_profile_id (organization)
   target_id          (primary)
   normalized_repo_key
   branch             (from repo config snapshot; default branch)
   origin='slack'
   source_kind='slack'
   visibility='shared_unclaimed'
   commandable=true
   default_projection_level='live'
9. insert slack_thread_work row
10. post ack message in thread; capture bot_ack_message_ts
11. enqueue start_session command (cloud_commands.source='slack',
    actor_kind='slack')
12. enqueue send_prompt command with the user's text
    (cleaned of @mention)
13. job complete; subsequent events flow back via worker
```

Follow-up messages in the same thread (event is `message.channels`
with `thread_ts` matching an existing `slack_thread_work` row):

```text
1. verify same connection / bot config gates
2. load slack_thread_work; if archived, post "this work is
   closed" and skip
3. load can_interact_cloud_workspace check:
   - if exposure.visibility='shared_unclaimed': any org member may
     post; treat as Cloud-mediated interact
   - if exposure.visibility='claimed' AND claimed_by != Slack user
     mapped to Proliferate user: post "claimed by X; ask them or
     start fresh"
4. enqueue send_prompt on the existing cloud_session
```

Slack user → Proliferate user mapping:

```text
slack_user_id  text  on cloud_commands.actor_slack_user_id (new column)
                      or in cloud_commands.authorization_context_json

For V1: the mention's slack_user_id is recorded but not resolved to
a Proliferate user unless the user has linked their Slack identity
(future). The bot acts as a system-actor on behalf of the org for
shared_unclaimed work; identity-linking is an open question (see §10).
```

### 5.8 End-of-turn detection + Slack thread response

New hook in `ingest_worker_event_batch` (spec 04 leaves this
extension point clean):

```text
server/proliferate/server/cloud/worker/events/service.py

after _apply_projection(event):
  if event.event_kind in END_OF_TURN_KINDS:
    enqueue_post_session_processors(cloud_session_id, event)

END_OF_TURN_KINDS = {
  'assistant_message_complete',
  'turn_ended',
  'pending_interaction_opened',
  'session_ended',
  'session_failed',
}
```

`enqueue_post_session_processors` schedules a small handler:

```text
server/proliferate/server/cloud/slack/post_session_hook.py

handle_post_session_event(cloud_session_id, event):
  load slack_thread_work via cloud_session.cloud_workspace_id
  if no slack_thread_work: return
  format Slack reply (block kit) using messages.py helpers:
    - assistant_message_complete: post the new assistant message
      (truncated + "Open in web" link)
    - turn_ended: nothing extra (covered by assistant_message_complete)
    - pending_interaction_opened: post "I need clarification: ..."
      with a "Reply in thread" prompt
    - session_ended: post "Done. Final summary." + link
    - session_failed: post "Failed: <typed reason>" + retry hint
  enqueue an outbound Slack post via the outbound queue
```

The post-session-event handler is a generic extension. Spec 07 adds
the Slack consumer; future specs (e.g. customer.io notifications)
add others. The hook fires inside the event-ingest transaction
boundary as a deferred queue insert so retries are safe.

### 5.9 Outbound posting with retry + rate limit

```text
slack_outbound_message_queue
  id                              uuid pk
  organization_id                 uuid fk organization.id        NOT NULL
  slack_workspace_connection_id   uuid fk slack_workspace_connection.id  NOT NULL
  slack_team_id                   text                           NOT NULL
  slack_channel_id                text                           NOT NULL
  slack_thread_ts                 text                           nullable
                                  -- null for non-thread posts (rare)
  blocks_json                     text                           NOT NULL
  fallback_text                   text                           NOT NULL
  source                          text   'ack' | 'turn' | 'interaction' |
                                          'done' | 'failed' | 'admin'
  source_event_id                 text                           nullable
                                  -- idempotency key for retries

  status                          text   'queued' | 'sending' | 'sent' |
                                          'failed' | 'dropped'
  attempts                        integer NOT NULL default 0
  next_attempt_at                 timestamptz                    NOT NULL
  last_error_code                 text                           nullable
  last_error_message              text                           nullable
  sent_message_ts                 text                           nullable

  created_at, updated_at, sent_at

  UNIQUE (slack_workspace_connection_id, source_event_id)
    WHERE source_event_id IS NOT NULL
  CHECK ck_slack_outbound_status
  CHECK ck_slack_outbound_source
```

Worker:

```text
server/proliferate/server/cloud/slack/outbound_worker.py
  every N seconds:
    select up to batch_size queued rows where next_attempt_at <= now
    for each row:
      attempt post via Slack chat.postMessage (decrypt bot token)
      on success: status='sent', sent_message_ts=<ts>
      on rate_limit (429 with Retry-After): set next_attempt_at,
                                            do not increment attempts
      on transient 5xx: increment attempts; exponential backoff
                       up to max_attempts
      on permanent 4xx (not_in_channel, etc.): status='failed';
                                                surface to admin

rate limit envelope:
  obey Retry-After header
  per-team budget of N posts/sec (Slack's published rate is
  ~1 msg/sec/channel for chat.postMessage Tier 1; we conservatively
  cap at 1/sec/team for the bot)
```

The outbound queue is per-org; rate limits are enforced per Slack
team.

### 5.10 `organization_settings` (new, cross-cutting)

This is the home for per-org cross-cutting settings that don't
warrant a dedicated table. Spec 06 §5.3 referenced it for org
agent defaults; spec 07 introduces it formally.

```text
organization_settings
  organization_id   uuid PRIMARY KEY fk organization.id
  settings_json     jsonb NOT NULL default '{}'
  created_at, updated_at

initial settings_json shape (extensible):
  {
    "default_agent_run_config_id_by_agent_kind": {
      "claude": "<uuid>",
      "codex":  "<uuid>",
      ...
    },
    "slack": {
      -- placeholder for future Slack-level cross-cutting prefs
      -- not used in V1; slack_bot_config covers V1 needs
    }
  }
```

Reads:

```text
load_org_settings(organization_id) -> OrgSettings
  inserts default row on first access
  returns frozen dataclass over the jsonb
```

Writes:

```text
update_org_settings(organization_id, **patches)
  partial update; settings.update(patches); bump updated_at
  validate known keys at the store boundary
```

Spec 06 §5.3 uses
`load_org_settings(org).default_agent_run_config_id_by_agent_kind`
to resolve org defaults. Spec 07 uses the same accessor.

### 5.11 UI: Settings → Slack bot

The page slot exists in spec 03 §5.1 as `slack-bot`, admin-only.
Spec 07 fills the content:

```text
desktop/src/components/settings/panes/SlackBotPane.tsx        (replace stub)

sections:
  Connection
    - "Install Slack" / "Reconnect" button
    - shows slack_team_name, installed_by, installed_at, status
    - "Disconnect" button (admin confirm)

  Bot status
    - enabled toggle
    - last_validated_at; "Validate now" action calls auth.test
    - status badges using spec 03 StatusBadge

  Session defaults
    - default_agent_kind selector (catalog)
    - inline "Default config for <agent_kind>" via AgentRunConfigSelector
      (filtered to usable_in_shared_sandboxes=true)
    - if no per-agent default is set, falls back to
      organization_settings.default_agent_run_config_id_by_agent_kind

  Repo routing
    - repo_mode toggle: Fixed | Auto
    - Fixed -> CloudRepoConfigSelector (org-scoped) for fixed_cloud_repo_config_id
    - Auto -> allowed_cloud_repo_config_ids multi-select + per-repo
              description editor (writes cloud_repo_routing_profile)

  Channels
    - allowed_slack_channel_ids multi-channel picker (Slack
      conversations.list call when token is fresh)
    - empty -> bot responds in any channel

  Shared readiness summary
    - RuntimeReadinessPanel (spec 03) for the org sandbox profile
    - "Open shared cloud settings" link to the Compute pane
```

Admin gate: `useIsAdmin(activeOrganizationId)` per spec 03.

## 6. Files To Change

Server (Python):

```text
server/proliferate/db/models/cloud/slack.py                          (new)
  SlackWorkspaceConnection
  SlackBotConfig
  SlackThreadWork
  SlackEventEnvelopeSeen
  SlackOutboundMessageQueue
  CloudRepoRoutingProfile

server/proliferate/db/models/organization_settings.py                (new)
  OrganizationSettings

server/proliferate/db/models/cloud/repo_config.py
  - add owner_scope, organization_id
  - update unique indexes

server/proliferate/db/migrations/versions/<NEW>_slack_bot.py
  all of the above + repo_config owner_scope migration

server/proliferate/db/store/cloud_slack/                             (new)
  connections.py
  bot_configs.py
  thread_work.py
  events_seen.py
  outbound.py
  repo_routing_profiles.py

server/proliferate/db/store/organization_settings.py                 (new)
  load_org_settings, update_org_settings

server/proliferate/server/cloud/slack/                               (new)
  api.py                  POST /v1/cloud/slack/events
                          GET  /v1/cloud/slack/oauth/start
                          GET  /v1/cloud/slack/oauth/callback
                          POST /v1/cloud/slack/disconnect
                          GET  /v1/cloud/slack/bot-config
                          PATCH /v1/cloud/slack/bot-config
                          POST /v1/cloud/slack/bot-config/validate-connection
  service.py              install/reconnect; bot_config CRUD;
                          mention handler; thread follow-up handler
  signature.py            HMAC-SHA256 verification (Slack-flavored)
  oauth.py                exchange code; refresh as needed
  outbound_worker.py      retry + rate-limit aware sender
  post_session_hook.py    end-of-turn -> outbound queue insert
  domain/
    repo_router.py        pure router (heuristic match)
    mention_parse.py      strip @mention, extract --repo hints
    message_format.py     block kit builders (reuses
                          integrations/slack/messages.py)
    policy.py             allow/deny invariants

server/proliferate/server/cloud/worker/events/service.py
  - add END_OF_TURN_KINDS hook
  - enqueue_post_session_processors() after _apply_projection

server/proliferate/server/cloud/post_session/                        (new)
  registry.py             process registry (Slack registers here;
                          future: customer.io, email)
  worker.py               periodic processor of queued events
  models.py               PostSessionProcessorEvent dataclasses

server/proliferate/config.py
  + slack_client_id
  + slack_client_secret
  + slack_signing_secret
  + slack_oauth_redirect_url
  + slack_outbound_max_attempts            default 5
  + slack_outbound_rate_per_team_per_sec   default 1.0
  + slack_run_cascade_max_attempts         default 3
```

Worker scheduling:

```text
The outbound Slack sender and the post-session processor reuse the
same scheduler primitive as automations / agent gateway reconciler
(per spec 00 Open Q #5; decision to be confirmed at impl time).
No new scheduler infrastructure.
```

SDK regeneration:

```text
cloud/sdk/src/client/slack.ts                                        (new)
cloud/sdk/src/client/organization-settings.ts                        (new)
cloud/sdk/src/types/generated.ts                                     regen
```

Desktop:

```text
desktop/src/components/settings/panes/SlackBotPane.tsx               replace stub
desktop/src/components/settings/panes/slack/                         (new)
  ConnectionSection.tsx
  BotStatusSection.tsx
  SessionDefaultsSection.tsx
  RepoRoutingSection.tsx
  ChannelsSection.tsx

desktop/src/hooks/access/cloud/slack/                                (new)
  use-slack-connection.ts
  use-slack-bot-config.ts
  use-slack-bot-config-mutations.ts
  use-slack-channels.ts
  use-slack-repo-routing-profiles.ts

desktop/src/hooks/access/cloud/organization-settings/                (new)
  use-organization-settings.ts
  use-organization-settings-mutations.ts
```

## 7. Implementation Chunks

```text
Chunk A  organization_settings table + spec 06 backfill
  - migration creates organization_settings
  - load/update store helpers
  - spec 06's reference to org defaults resolves here

Chunk B  Slack DB models
  - slack_workspace_connection
  - slack_bot_config
  - slack_thread_work
  - slack_event_envelope_seen
  - slack_outbound_message_queue
  - cloud_repo_routing_profile
  - cloud_repo_config owner_scope extension
  - one migration

Chunk C  OAuth install flow
  - GET /v1/cloud/slack/oauth/start  -> redirect
  - GET /v1/cloud/slack/oauth/callback -> exchange + persist
  - signed state HMAC; expiry 10m
  - settings additions

Chunk D  Inbound event handler
  - POST /v1/cloud/slack/events
  - signature.py HMAC verify
  - parse + dedupe via slack_event_envelope_seen
  - enqueue slack_inbound_event_job (lightweight; reuses
    organization_settings background scheduler)
  - 200 OK fast path

Chunk E  Mention handler + thread follow-up handler
  - background processor for inbound jobs
  - ensure_organization_sandbox_profile
  - repo router (fixed + auto)
  - managed_profile_launch with origin='slack'
  - slack_thread_work insert
  - ack message via outbound queue
  - start_session + send_prompt enqueue
  - follow-up: send_prompt on existing session

Chunk F  End-of-turn hook + post-session processor
  - END_OF_TURN_KINDS in events/service.py
  - enqueue_post_session_processors after _apply_projection
  - PostSessionProcessor registry
  - Slack processor: looks up slack_thread_work; formats reply;
    inserts into outbound queue

Chunk G  Outbound queue + sender
  - outbound_worker.py periodic loop
  - Slack chat.postMessage call (httpx)
  - rate-limit/Retry-After handling
  - exponential backoff
  - status transitions

Chunk H  Desktop UI
  - SlackBotPane sections (replace stub)
  - hooks
  - use AgentRunConfigSelector + CloudRepoConfigSelector +
    RuntimeReadinessPanel primitives
  - admin gate via useIsAdmin

Chunk I  Tests + smoke
```

## 8. Acceptance Criteria

1. `slack_workspace_connection` exists with UNIQUE
   `(organization_id) WHERE status != 'revoked'`. One Slack
   workspace per Proliferate org.
2. Slack OAuth install flow: `GET /v1/cloud/slack/oauth/start`
   redirects to Slack with signed state; callback exchanges code,
   stores connection, redirects to Settings.
3. `POST /v1/cloud/slack/events` verifies Slack signature
   (HMAC-SHA256 + 300s timestamp tolerance). Invalid signature
   returns 401. URL verification challenge handled.
4. Events dedupe by `slack_event_id` via
   `slack_event_envelope_seen`. Duplicate POSTs return 200 with
   no side effects.
5. The event handler returns 200 within Slack's 3s SLA. Heavy
   work (workspace launch) runs in a background job.
6. Mention handler calls `ensure_organization_sandbox_profile`,
   resolves repo (fixed or auto router), and calls
   `managed_profile_launch` with `origin='slack'`,
   `source_kind='slack'`, `visibility='shared_unclaimed'`,
   `commandable=true`. Result is claim-eligible (spec 05).
7. Follow-up messages in an existing thread enqueue `send_prompt`
   on the existing `cloud_session`; no new workspace.
8. `slack_thread_work` unique on
   `(slack_team_id, slack_channel_id, slack_thread_ts)`.
9. `cloud_repo_config.owner_scope` exists with the
   `personal | organization` check. Org-scoped repos coexist with
   personal repos via partial unique indexes.
10. `repo_mode='auto'` calls a pure router using only
    `cloud_repo_routing_profile` cached metadata. No live code
    scanning per Slack event. Undecidable -> clarification reply;
    no workspace created.
11. End-of-turn hook fires for `END_OF_TURN_KINDS` after
    `_apply_projection`. The hook is a registry-based extension
    point; Slack registers a processor.
12. Slack post-session processor formats and enqueues outbound
    posts via `slack_outbound_message_queue`. No inline `httpx`
    calls.
13. Outbound sender obeys Slack `Retry-After` headers and a
    per-team rate cap (default 1/sec); retries with exponential
    backoff up to `slack_outbound_max_attempts`.
14. Outbound queue is idempotent on `source_event_id` per
    connection.
15. `organization_settings` table exists with `settings_json`
    jsonb. Spec 06's
    `default_agent_run_config_id_by_agent_kind` reads/writes here.
16. Slack runs use the same runtime config + agent auth preflight
    as other sources, with auto-cascade (per spec 06 §5.5 reuse).
    Cascade attempts capped via
    `slack_run_cascade_max_attempts`.
17. `cloud_commands` produced by Slack have
    `actor_kind='slack'`, `source='slack'`. The Slack user id is
    captured in `authorization_context_json`.
18. The Slack source is not granted any new MCP / agent auth /
    model surface. A grep verifies no Slack-specific config
    objects outside the bot config / thread work / outbound queue
    tables.
19. Settings → Slack bot page is admin-only (useIsAdmin) and
    composes the spec 03 primitives.
20. Desktop UI does not store the bot token. Token reads stay
    server-side; encrypted at rest with the existing cipher.

## 9. Verification / Tests

Server:

```bash
cd server
uv run pytest -q
```

Targeted tests:

```text
tests/server/cloud/slack/test_signature_verification.py
tests/server/cloud/slack/test_event_dedupe.py
tests/server/cloud/slack/test_url_verification_challenge.py
tests/server/cloud/slack/test_oauth_install_flow.py
tests/server/cloud/slack/test_oauth_state_hmac_expiry.py
tests/server/cloud/slack/test_mention_routes_through_managed_profile_launch.py
tests/server/cloud/slack/test_mention_creates_shared_unclaimed_exposure.py
tests/server/cloud/slack/test_followup_uses_existing_session.py
tests/server/cloud/slack/test_repo_router_fixed_mode.py
tests/server/cloud/slack/test_repo_router_auto_mode.py
tests/server/cloud/slack/test_repo_router_undecidable_clarification.py
tests/server/cloud/slack/test_thread_work_unique.py
tests/server/cloud/slack/test_repo_config_owner_scope.py
tests/server/cloud/slack/test_outbound_retry_after.py
tests/server/cloud/slack/test_outbound_exponential_backoff.py
tests/server/cloud/slack/test_outbound_idempotency_key.py
tests/server/cloud/slack/test_post_session_hook_registers.py
tests/server/cloud/slack/test_end_of_turn_enqueues_outbound.py
tests/server/cloud/slack/test_admin_gate_on_settings.py
tests/server/cloud/slack/test_agent_run_config_inheritance.py
tests/server/cloud/slack/test_runtime_config_cascade.py
tests/server/cloud/slack/test_agent_auth_cascade.py
tests/server/organization_settings/test_load_and_update.py
```

Desktop:

```bash
cd desktop && pnpm test -- --run && pnpm typecheck
```

Targeted Desktop tests:

```text
desktop/src/components/settings/panes/SlackBotPane.test.tsx
  - admin gate
  - install button triggers oauth start
  - repo mode toggle behavior
  - allowed channels picker
desktop/src/hooks/access/cloud/slack/use-slack-connection.test.ts
desktop/src/hooks/access/cloud/slack/use-slack-bot-config.test.ts
```

Manual smoke:

```text
1. Admin installs Slack
   - clicks Install -> Slack OAuth -> redirect back
   - slack_workspace_connection row exists; status='active'
   - Settings > Slack bot shows Connected

2. Admin configures fixed repo + default config
   - SlackBotPane: repo_mode='fixed', fixed_cloud_repo_config_id set
   - default_agent_kind=claude
   - default config picked (filtered to usable_in_shared_sandboxes=true)
   - "Enable" toggle on

3. User @mentions bot in Slack
   - signature verified; event dedupe applied
   - bot posts ack in 3s
   - managed_profile_launch creates shared_unclaimed exposure
   - start_session + send_prompt enqueued
   - thread_work row exists

4. End of turn
   - assistant_message_complete event ingested
   - post-session-hook fires; outbound queue receives the message
   - outbound worker sends within rate budget
   - Slack thread updated with the assistant reply + "Open in web" link

5. Org member claims
   - clicks claim in web or Desktop (spec 05 flow)
   - exposure.visibility flips to claimed
   - subsequent Slack thread follow-ups by the claimer continue
     normally
   - follow-ups by non-claimers fail at enqueue
     (claim_held_by_other; bot posts the error in thread)

6. Slack rate limit (429)
   - Slack returns Retry-After: 5
   - outbound row stays queued; next_attempt_at = now + 5s
   - attempt count NOT incremented (rate limits aren't failures)
   - eventually sends

7. Auto repo routing - undecidable
   - org has 3 repos; user mention has no keyword hits
   - router returns "undecidable"
   - bot replies "I'm not sure which repo. Please configure a
     default in Settings or include --repo <name>."
   - no workspace created

8. Slack workspace disconnected (token revoked)
   - validator detects 401 on auth.test
   - connection.status='reauth_required'
   - settings UI shows banner
   - inbound events return 200 but skip processing; no work created
```

## 10. Open Questions

1. **Slack user → Proliferate user identity linking.**

   When a user @mentions the bot, the event carries a
   `slack_user_id`. Today we don't have an `OAuthIdentity` row
   for Slack (only GitHub/Google/Apple). For V1, the bot acts on
   behalf of the org for `shared_unclaimed` work; the Slack user
   id is recorded in `authorization_context_json` for audit but
   not resolved.

   Implications:
     - claiming works because any org member can claim
       (spec 05); the Slack user can claim via Cloud once they
       sign in
     - if a non-org-member's slack_user_id appears (Slack
       Connect / guest), the bot should ignore the event. V1
       check: only act when the Slack team_id matches an
       installed connection AND the channel is allowed.

   Bias: defer identity-linking to a follow-up. V1 explicitly
   does not resolve Slack -> Proliferate user; the trail in
   `authorization_context_json` is enough for audit.

2. **Slash commands and interactive components.**

   The mention path is enough for V1. Slash commands and buttons
   (e.g. for the auto-router's "which repo?" question) require
   Slack interactive endpoints (`/interactivity` payload format).
   Bias: defer. The "undecidable" fallback in V1 is a text reply
   asking the user to add a `--repo` hint.

3. **One Slack workspace per Proliferate org, or many?**

   V1: one. Multi-team installation under a single org adds
   significant complexity (which bot config applies; which token
   to use for outbound). If demand arises, lift the UNIQUE on
   `(organization_id)` and add a connection selector.

4. **Per-channel routing rules.**

   `allowed_slack_channel_ids` is org-wide. Per-channel routing
   (e.g. #frontend → frontend repo) is a follow-up: add a
   `slack_channel_routing` table referencing `slack_bot_config`
   and `cloud_repo_config`. Bias: defer; the auto-router covers
   the same intent without channel-pinning.

5. **README cache freshness.**

   `cloud_repo_routing_profile.cached_at` + a 24h refresh job is
   the V1 plan. If repos change often and the router routes wrong,
   admins can edit `description` manually. Bias: keep the cache
   refresh simple; trust admins for ground truth via the description
   field.

6. **End-of-turn streaming.**

   V1 posts on completed turn boundaries. Live streaming (one
   message per token) is bandwidth-heavy and runs into Slack's
   chat.update edit limits. Bias: ship turn-boundary posting;
   add live streaming behind a feature flag when usage data
   demands it.

7. **Cascade attempt cap for Slack runs.**

   `slack_run_cascade_max_attempts` defaults 3. Same as
   automations. Bias: keep symmetric.

8. **Should `organization_settings` carry the Slack outbound rate
   override?**

   For ops, sometimes one org needs a lower rate (rate-limited by
   Slack at the app level). Bias: keep the rate global in V1
   (`settings.slack_outbound_rate_per_team_per_sec`); add a
   per-org override via `organization_settings.slack.outbound_rate_per_sec`
   when needed. Schema is forward-compatible (jsonb).
