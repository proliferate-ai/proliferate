# Anonymous Telemetry

## Purpose
Anonymous telemetry is Proliferate's first-party install-level analytics path.
It captures minimal product-health and adoption signals without sending user
identity, replay data, prompt content, repo metadata, or other high-cardinality
payloads to third-party vendors.

## Used For
- Tracking install liveness from desktop and control-plane surfaces
- Capturing first-use activation milestones from the desktop app
- Capturing low-cardinality daily usage aggregates from the desktop app
- Preserving observability for `local_dev` and `self_managed` runs where vendor
  telemetry is disabled

## Workflows
- Desktop runtime routing
  - trigger: desktop startup after runtime API config bootstrap
  - code path:
    - `desktop/src/main.tsx`
    - `desktop/src/lib/infra/proliferate-api.ts`
    - `desktop/src/lib/domain/telemetry/mode.ts`
    - `desktop/src/lib/integrations/telemetry/client.ts`
  - sends: no record directly; resolves `telemetryMode` as one of
    `local_dev`, `self_managed`, or `hosted_product`
  - failure behavior: if runtime config cannot be read, desktop falls back to
    the baked API base URL and default telemetry settings
- Desktop version heartbeat
  - trigger: anonymous telemetry bootstrap, then every 24 hours while the app
    remains open
  - code path:
    - `desktop/src/main.tsx`
    - `desktop/src/lib/integrations/telemetry/anonymous.ts`
    - native state/bootstrap helpers in
      `desktop/src-tauri/src/commands/anonymous_telemetry.rs`
  - sends:
    - `recordType=VERSION`
    - payload:
      - `appVersion`
      - `platform`
      - `arch`
  - failure behavior: failed heartbeats are swallowed locally and retried on the
    next timer cycle
- Desktop activation milestones
  - trigger: first matching product event per install
  - code path:
    - existing `trackProductEvent(...)` call sites fan into
      `desktop/src/lib/integrations/telemetry/client.ts`
    - anonymous derivation lives in
      `desktop/src/lib/domain/telemetry/anonymous-events.ts`
    - delivery/persistence lives in
      `desktop/src/lib/integrations/telemetry/anonymous.ts`
  - sends:
    - `recordType=ACTIVATION`
    - payload:
      - `milestone`
    - current milestone values:
      - `first_launch`
      - `first_prompt_submitted`
      - `first_local_workspace_created`
      - `first_cloud_workspace_created`
      - `first_credential_synced`
      - `first_connector_installed`
      - `first_bundled_agent_seed_hydrated`
  - failure behavior: milestones are written to local pending state and retried
    on the next bootstrap and hourly housekeeping cycle until they succeed
- Desktop daily usage aggregate
  - trigger: usage counters are incremented from product events and flushed when
    24 hours have elapsed since the last successful usage flush
  - code path:
    - `desktop/src/lib/domain/telemetry/anonymous-events.ts`
    - `desktop/src/lib/integrations/telemetry/anonymous.ts`
  - sends:
    - `recordType=USAGE`
    - payload:
      - `sessionsStarted`
      - `promptsSubmitted`
      - `workspacesCreatedLocal`
      - `workspacesCreatedCloud`
      - `credentialsSynced`
      - `connectorsInstalled`
  - failure behavior: counters stay persisted locally and are only reset after a
    successful flush
- Server version heartbeat
  - trigger: control-plane startup, then every 24 hours
  - code path:
    - `server/proliferate/integrations/anonymous_telemetry.py`
    - `server/proliferate/utils/telemetry_mode.py`
  - sends:
    - `recordType=VERSION`
    - payload:
      - `appVersion`
      - `platform`
      - `arch`
  - failure behavior:
    - `hosted_product`: records locally through the anonymous telemetry service
    - `local_dev` / `self_managed`: logs and retries on the next interval if the
      remote collector POST fails
- Anonymous telemetry ingestion
  - trigger: `POST /v1/telemetry/anonymous`
  - code path:
    - `server/proliferate/server/anonymous_telemetry/api.py`
    - `server/proliferate/server/anonymous_telemetry/models.py`
    - `server/proliferate/server/anonymous_telemetry/service.py`
    - `server/proliferate/db/store/anonymous_telemetry.py`
  - sends:
    - install upsert in `anonymous_telemetry_install`
    - append-only event row in `anonymous_telemetry_event`
    - local server install identity in `anonymous_telemetry_local_install`
  - failure behavior:
    - invalid payloads are rejected at the API boundary with request validation
    - valid payloads commit atomically through the store facade

## Env Vars
Required:
- `PROLIFERATE_TELEMETRY_MODE`
  - server-only
  - values: `local_dev`, `self_managed`, `hosted_product`

Optional:
- `VITE_PROLIFERATE_ANONYMOUS_TELEMETRY_ENDPOINT`
- `VITE_PROLIFERATE_TELEMETRY_DISABLED`
- `PROLIFERATE_ANONYMOUS_TELEMETRY_ENDPOINT`
- `PROLIFERATE_ANONYMOUS_TELEMETRY_DISABLED`

Runtime config, not env:
- `~/.proliferate/config.json`
- `~/.proliferate-local/config.json` in dev
  - supported fields:
    - `apiBaseUrl`
    - `telemetryDisabled`

## Current Usage
- Desktop runtime routing and fanout:
  - `desktop/src/lib/integrations/telemetry/client.ts`
- Desktop anonymous record derivation:
  - `desktop/src/lib/domain/telemetry/anonymous-events.ts`
- Desktop anonymous transport and local persistence:
  - `desktop/src/lib/integrations/telemetry/anonymous.ts`
  - `desktop/src/lib/integrations/telemetry/anonymous-storage.ts`
  - `desktop/src-tauri/src/commands/anonymous_telemetry.rs`
- Server anonymous collector:
  - `server/proliferate/server/anonymous_telemetry/api.py`
  - `server/proliferate/server/anonymous_telemetry/models.py`
  - `server/proliferate/server/anonymous_telemetry/service.py`
- Server anonymous storage:
  - `server/proliferate/db/models/anonymous_telemetry.py`
  - `server/proliferate/db/store/anonymous_telemetry.py`
  - `server/alembic/versions/d9e0f1a2b3c4_anonymous_telemetry.py`
- Exact records currently in use:
  - `VERSION`
    - desktop + server
  - `ACTIVATION`
    - desktop only
  - `USAGE`
    - desktop only
- Exact desktop anonymous source events currently wired:
  - `chat_session_created`
  - `chat_prompt_submitted`
  - `workspace_created`
  - `cloud_workspace_created`
  - `cloud_credential_synced`
  - `connector_install_succeeded`
  - `agent_seed_hydrated`
  - `agent_seed_hydration_failed`
- Bundled agent seed telemetry:
  - trigger: desktop observes runtime health reporting seed status
  - code path:
    - `desktop/src/hooks/telemetry/use-telemetry-agent-seed.ts`
    - `desktop/src/lib/domain/telemetry/events.ts`
    - `desktop/src/lib/domain/telemetry/anonymous-events.ts`
  - sends product events only with low-cardinality fields:
    - `status`
    - `source`
    - `ownership`
    - `lastAction`
    - `failureKind`
    - artifact counts
    - seeded agent count
  - does not send absolute paths, raw errors, prompts, repo names, or file
    contents
  - anonymous activation is recorded only when `agent_seed_hydrated` reports
    `status=ready`
- Vendor relationship:
  - `hosted_product` sends both vendor telemetry and anonymous telemetry
  - `local_dev` and `self_managed` send anonymous telemetry only
- Known gaps:
  - anonymous `FAILURE`/exception capture is intentionally not implemented in v1
  - server-side `ACTIVATION` and `USAGE` records are intentionally not
    implemented in v1
