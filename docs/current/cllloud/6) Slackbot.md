## High level model

Slackbot is a team automation entrypoint with Slack-specific identity, routing,
and message formatting.

Slack does not get a separate runtime model. A Slack mention always creates
shared cloud work in the shared sandbox using:

- shared sandbox MCP/skills/plugins;
- shared sandbox agent auth;
- cloud command queue;
- Cloud exposure/projection admission;
- claiming;
- Cloud transcript/event storage.

## DB models + schemas

```text
slack_workspace_connection
  id
  organization_id
  slack_team_id
  bot_user_id
  encrypted_bot_token
  status
  installed_by_user_id

slack_bot_config
  id
  organization_id
  slack_connection_id
  enabled
  repo_mode: fixed | auto
  fixed_repo_id
  allowed_repo_ids_json
  default_agent_run_config_id
  sandbox_profile_id
  allowed_channels_json

slack_thread_work
  id
  organization_id
  slack_team_id
  channel_id
  thread_ts
  root_message_ts
  workspace_id
  session_id
  exposure_id
  session_projection_id
  claimable_work_id
  status
```

Repo metadata used for auto-selection:

```text
repo_routing_profile
  repo_id
  organization_id
  name
  description
  default_branch
  readme_summary
  topics_json
  languages_json
  updated_at
```

This can be stored on the repo config row or as a separate projection. The
important point is that Slack auto-selection uses bounded metadata, not a fresh
scan of arbitrary private code on every Slack event.

## End to end flows through the product

Create Slack bot:

1. Admin installs Slack app.
2. Server stores Slack workspace connection.
3. Admin configures repo routing and default agent run config.
4. Server verifies shared cloud sandbox readiness.
5. Bot becomes enabled.

Slack mention -> work:

1. User mentions bot in Slack.
2. Server verifies Slack signature and org mapping.
3. Server selects repo from fixed config or auto-selection.
4. Server creates org-owned shared cloud workspace/session in
   `shared_unclaimed` state.
5. Server creates active exposure/projection for the shared work.
6. Server posts initial Slack acknowledgement.
7. Worker runs AnyHarness session.
8. Cloud event ingest/processors detect end-of-turn events and run Slack
   notification logic.
9. Server posts or updates Slack thread.
10. Work appears in web/Desktop as unclaimed shared team work for all org
   members.

Cloud/session message -> Slack:

1. AnyHarness emits assistant/end-of-turn events.
2. Worker uploads event batches to Cloud.
3. Cloud event processing detects "this batch completed a turn."
4. If the workspace/session came from Slack, Cloud runs Slack end-of-turn logic.
5. Slack handler formats summary/reply.
6. Server posts or updates Slack thread.

Claim Slack workspace:

1. User opens web/Desktop link from Slack.
2. Cloud shows claimable work.
3. User claims it.
4. Session continues under claimed user control.

## Hooks / things used and why

Slack inbound:

```text
verify Slack signature
dedupe event id / retry headers
resolve org/channel/thread
create or append to slack_thread_work
enqueue cloud command
```

Repo selection:

```text
repo_mode = fixed
  -> use fixed_repo_id

repo_mode = auto
  -> run system-owned repo selector over:
       Slack message text
       Slack thread context
       channel name
       allowed repo names/descriptions
       README summaries/topics/languages
  -> if confidence is high, use selected repo
  -> if confidence is low, ask in Slack with repo choices
  -> never expose an admin-facing "repo selection model config" in V1
```

The repo selector is product infrastructure, not a user-configured agent run
config. Admins configure the allowed repo set and fallback behavior, not which
model powers the router.

Agent run config:

```text
default_agent_run_config_id
  -> organization-owned or system-owned config
  -> filtered to usable_in_shared_sandboxes
  -> validated against catalog.json before launch
```

Slack should not have its own harness/model/mode fields. It references the same
`agent_run_config` object used by automations and new chat.

End-of-turn notifier:

```text
Cloud event batch processing sees completed assistant turn
  -> check whether workspace/session has slack_thread_work
  -> format Slack-safe summary
  -> post/update thread
```

Claiming:

```text
Slack-created work is always shared_unclaimed org work by default
exposure/projection exists by default
all org members can interact through Cloud before claim
links point to Cloud web session
Desktop can claim through Cloud grant
after claim, only the claiming user can interact through Cloud or direct Desktop
```

## One offs

- Respect Slack rate limits with queued outbound messages.
- Dedupe Slack retries.
- Never expose provider/MCP secrets in Slack.
- Prefer concise thread updates, not streaming every token.
- Admin config should be blocked until shared cloud and agent auth are ready.

## Deeper concepts

Slack API:

- signed event/webhook verification;
- OAuth app installation;
- channel/thread IDs;
- retry semantics;
- chat.postMessage / chat.update rate limits.

Product boundary:

- Slack is an input/output surface.
- Cloud work/session remains canonical.
