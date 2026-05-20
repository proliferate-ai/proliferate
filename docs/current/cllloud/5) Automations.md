## High level model

Automations are scheduled or triggered commands that create/run work on a target.

They reuse the same primitives:

- sandbox config for MCPs/skills/plugins;
- sandbox agent auth;
- cloud running command queue;
- claiming for team-created work.

Automation-specific state should be schedule, prompt, target choice, repo, and
agent run config. It should not define its own MCP, agent auth, or model config
model.

## DB models + schemas

```text
automation
  id
  owner_scope: personal | organization
  owner_user_id
  organization_id
  name
  status: active | paused | archived
  target_mode: local | ssh | personal_cloud | shared_cloud
  repo_id
  sandbox_profile_id
  agent_run_config_id
  prompt
  schedule_json
  created_at

automation_run
  id
  automation_id
  scheduled_for
  started_at
  completed_at
  status: queued | running | succeeded | failed | cancelled
  target_id
  workspace_id
  session_id
  exposure_id
  session_projection_id
  claimable_work_id
  agent_run_config_snapshot_json
  error_code

automation_schedule_cursor
  automation_id
  next_run_at
  last_enqueued_at
  timezone
```

## End to end flows through the product

Create team automation:

1. User chooses Team.
2. UI shows shared sandbox readiness and public MCPs/skills/plugins.
3. User chooses repo, schedule, prompt, agent run config.
4. Server stores automation with shared sandbox profile.
5. Scheduler enqueues runs.
6. Runs create org-owned shared cloud work in `shared_unclaimed` state.
7. Until claimed, the resulting workspace/session is visible and interactable
   by all org members through Cloud-mediated APIs.
8. Any org member can claim it; after claim it leaves the unclaimed pool and
   becomes the claimed user's work.

Create personal cloud automation:

1. User chooses Personal Cloud.
2. UI uses personal sandbox auth/capability status.
3. Run executes on user's personal cloud target.
4. Work appears in user's sessions.

Create personal local automation:

1. User chooses Local.
2. Desktop owns local scheduling/execution or Cloud stores schedule and Desktop
   worker executes when available.
3. Uses local sandbox config and local credentials.

Run execution:

1. Scheduler creates `automation_run`.
2. Executor resolves target.
3. Executor loads the selected `agent_run_config`.
4. Executor validates it against current `catalog.json`.
5. Executor snapshots the resolved run config onto `automation_run`.
6. Executor ensures runtime config and agent auth are current.
7. Executor creates the appropriate Cloud exposure/projection:
   - personal run -> owner-visible exposure;
   - team run -> shared_unclaimed exposure.
8. Executor materializes workspace.
9. Executor starts session and sends prompt.
10. Worker uploads events for the active projection.
11. Run completes from end-of-turn/session status.

## Hooks / things used and why

Scheduler:

```text
scan due automations
  -> create automation_run idempotently
  -> enqueue executor job
```

Executor:

```text
resolve target
  -> resolve agent_run_config with catalog.json
  -> materialize workspace/environment
  -> apply MCP/skills runtime config
  -> apply agent auth
  -> start session with agentKind/modelId/modeId
  -> apply live default controls if needed
  -> send prompt
  -> watch completion
```

Agent run config:

```text
automation stores agent_run_config_id
run stores agent_run_config_snapshot_json

snapshot contains:
  agent_kind
  model_id
  control_values_json
  catalog_version

catalog.json remains the source of valid options/apply metadata.
```

This keeps scheduled runs understandable without making automations own a
separate agent/model config model.

Claiming hook:

```text
team run creates shared_unclaimed cloud workspace/session
  -> creates active exposure/projection by default
  -> visible in web/Desktop team sidebar for all org members
  -> all org members can interact through Cloud APIs before claim
  -> user can claim to take ownership and get Desktop direct-access flow
```

## One offs

- Personal and team automations should have the same basic creation form.
- Team automation requires shared cloud readiness.
- Team automation output is shared/unclaimed org work by default.
- Team automation output is exposed/projected by default so web/mobile/Slack
  can show progress and accept Cloud-mediated commands before claim.
- Local automation cannot assume Cloud can wake Desktop unless Desktop worker is
  online.
- Automation results should link to the Cloud session, not duplicate transcript
  storage.
- Do not make automations own billing; billing consumes run/target lifecycle.
- If a saved agent run config becomes invalid, fail fast before creating work
  and show the exact missing/unsupported control.

## Deeper concepts

Schedules:

- cron/rrule style wall-clock schedule;
- timezone explicit;
- idempotent run creation for missed ticks.

Execution boundary:

- automation orchestrates Cloud commands;
- worker executes target work;
- AnyHarness remains runtime truth.
